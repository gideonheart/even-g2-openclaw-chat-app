// ── Sync resilience integration tests ─────────────────────────
// Integration tests that verify sync message loss, drift detection,
// and reconciliation flows. Composes real SyncMonitor + DriftReconciler
// + ConversationStore with the lossy bridge failure helper.
//
// CRITICAL: 'fake-indexeddb/auto' MUST be the first import.
// Each test opens a fresh DB and afterEach closes + deletes it.

import 'fake-indexeddb/auto';
import { openDB, closeDB, DB_NAME } from '../../persistence/db';
import { createConversationStore } from '../../persistence/conversation-store';
import { createDriftReconciler } from '../../sync/drift-reconciler';
import { createSyncMonitor } from '../../sync/sync-monitor';
import { createLossySyncBridge } from '../helpers/failure-helpers';
import type { SyncBridge, SyncMessage } from '../../sync/sync-types';

describe('sync resilience integration', () => {
  let db: IDBDatabase;

  afterEach(() => {
    try { closeDB(db); } catch { /* may already be closed */ }
    indexedDB.deleteDatabase(DB_NAME);
    vi.useRealTimers();
  });

  // ── Test 1: Lossy bridge drops every Nth message ──────────

  it('createLossySyncBridge drops every Nth message', () => {
    // Create a simple mock SyncBridge that records received messages
    const received: SyncMessage[] = [];
    const mockBridge: SyncBridge = {
      postMessage: (msg) => received.push(msg),
      onMessage: () => () => {},
      destroy: () => {},
    };

    // Wrap with lossy bridge that drops every 3rd message
    const lossyBridge = createLossySyncBridge(mockBridge, 3);

    // Post 6 messages through the lossy bridge
    const makeMsg = (i: number): SyncMessage => ({
      type: 'session:created',
      origin: 'glasses',
      seq: i,
      session: { id: `s${i}`, name: `Session ${i}` },
    });

    for (let i = 1; i <= 6; i++) {
      lossyBridge.postMessage(makeMsg(i));
    }

    // Messages 3 and 6 were dropped -- should have 4 messages (1, 2, 4, 5)
    expect(received).toHaveLength(4);
    expect(received.map((m) => m.seq)).toEqual([1, 2, 4, 5]);
  });

  // ── Test 2: Drift reconciler detects 2-consecutive mismatches ──
  // NOTE: No fake timers here -- drift reconciler uses pure IDB async ops, no timers.

  it('drift reconciler detects count mismatch and triggers reconciliation', async () => {
    db = await openDB();
    const store = createConversationStore(db);

    // Create a conversation with 3 messages
    const conv = await store.createConversation('Drift test');
    await store.addMessage(conv.id, { role: 'user', text: 'Message 1', timestamp: Date.now() });
    await store.addMessage(conv.id, { role: 'assistant', text: 'Message 2', timestamp: Date.now() });
    await store.addMessage(conv.id, { role: 'user', text: 'Message 3', timestamp: Date.now() });

    // Verify local count is 3
    const localCount = await store.countMessages(conv.id);
    expect(localCount).toBe(3);

    const onReconcile = vi.fn();
    const reconciler = createDriftReconciler({
      store,
      onReconciled: onReconcile,
    });

    // Remote count is 5 -- mismatch with local count of 3
    // First heartbeat: single mismatch, not enough to trigger
    const firstResult = await reconciler.handleHeartbeat(conv.id, 5);
    expect(firstResult).toBe(false);
    expect(onReconcile).not.toHaveBeenCalled();

    // Second heartbeat: 2-consecutive mismatches trigger reconciliation
    const secondResult = await reconciler.handleHeartbeat(conv.id, 5);
    expect(secondResult).toBe(true);
    expect(onReconcile).toHaveBeenCalledOnce();
    expect(onReconcile).toHaveBeenCalledWith({
      conversationId: conv.id,
      action: 'full-reload',
    });

    reconciler.destroy();
  });

  // ── Test 3: Single mismatch does NOT trigger reconciliation ──
  // NOTE: No fake timers -- drift reconciler uses pure IDB async ops, no timers.

  it('drift reconciler ignores single mismatch (no false positive)', async () => {
    db = await openDB();
    const store = createConversationStore(db);

    // Create a conversation with 3 messages
    const conv = await store.createConversation('False positive test');
    await store.addMessage(conv.id, { role: 'user', text: 'Message 1', timestamp: Date.now() });
    await store.addMessage(conv.id, { role: 'assistant', text: 'Message 2', timestamp: Date.now() });
    await store.addMessage(conv.id, { role: 'user', text: 'Message 3', timestamp: Date.now() });

    const onReconcile = vi.fn();
    const reconciler = createDriftReconciler({
      store,
      onReconciled: onReconcile,
    });

    // First heartbeat: mismatch (local=3, remote=5)
    const mismatchResult = await reconciler.handleHeartbeat(conv.id, 5);
    expect(mismatchResult).toBe(false);

    // Second heartbeat: now counts match (remote=3 to match local=3)
    const matchResult = await reconciler.handleHeartbeat(conv.id, 3);
    expect(matchResult).toBe(false);

    // onReconcile should NOT have been called (single mismatch = no action)
    expect(onReconcile).not.toHaveBeenCalled();

    reconciler.destroy();
  });

  // ── Test 4: SyncMonitor tracks heartbeat and alive status ──
  // Uses vi.useFakeTimers() for Date.now() / timeout advancement.
  // No IDB needed for isAlive() behavior test.

  it('sync monitor tracks heartbeat and reports alive status', () => {
    vi.useFakeTimers();

    // Create a mock SyncBridge with a working onMessage handler
    const handlers = new Set<(msg: SyncMessage) => void>();
    const mockBridge: SyncBridge & { _fire: (msg: SyncMessage) => void } = {
      postMessage: vi.fn() as (msg: SyncMessage) => void,
      onMessage: (handler) => {
        handlers.add(handler);
        return () => { handlers.delete(handler); };
      },
      destroy: vi.fn(),
      _fire: (msg) => { for (const h of handlers) h(msg); },
    };

    // Use a mock store (no IDB needed for isAlive() test)
    const mockStore = {
      countMessages: vi.fn().mockResolvedValue(0),
    };

    const monitor = createSyncMonitor({
      bridge: mockBridge,
      store: mockStore,
      origin: 'glasses',
      getActiveConversationId: () => '',
    });

    // isAlive() returns true initially -- no heartbeat = peer may not have started
    expect(monitor.isAlive()).toBe(true);

    // Simulate receiving a heartbeat message from the remote peer (hub origin)
    mockBridge._fire({
      type: 'sync:heartbeat',
      origin: 'hub',
      messageCount: 3,
      conversationId: 'conv-1',
    });

    // Still alive after receiving a message
    expect(monitor.isAlive()).toBe(true);

    // Advance time past 30 seconds without another message
    vi.advanceTimersByTime(30_001);

    // Now isAlive returns false -- silence exceeded timeout
    expect(monitor.isAlive()).toBe(false);

    monitor.destroy();
  });
});
