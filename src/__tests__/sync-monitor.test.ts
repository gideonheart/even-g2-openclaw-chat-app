import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSyncMonitor } from '../sync/sync-monitor';
import type { SyncBridge, SyncMessage, SyncOrigin } from '../sync/sync-types';

// ── Mocks ──────────────────────────────────────────────────

function createMockBridge(): SyncBridge & { handlers: Set<(msg: SyncMessage) => void> } {
  const handlers = new Set<(msg: SyncMessage) => void>();
  return {
    handlers,
    postMessage: vi.fn(),
    onMessage(handler: (msg: SyncMessage) => void): () => void {
      handlers.add(handler);
      return () => { handlers.delete(handler); };
    },
    destroy: vi.fn(),
  };
}

function createMockStore(countResult = 0) {
  return {
    countMessages: vi.fn().mockResolvedValue(countResult),
  };
}

function simulateIncoming(bridge: ReturnType<typeof createMockBridge>, msg: SyncMessage) {
  for (const handler of bridge.handlers) {
    handler(msg);
  }
}

// ── Tests ──────────────────────────────────────────────────

describe('SyncMonitor', () => {
  let bridge: ReturnType<typeof createMockBridge>;
  let store: ReturnType<typeof createMockStore>;
  const origin: SyncOrigin = 'glasses';
  const remoteOrigin: SyncOrigin = 'hub';

  beforeEach(() => {
    bridge = createMockBridge();
    store = createMockStore(5);
  });

  it('send() attaches monotonic seq numbers', () => {
    const monitor = createSyncMonitor({
      bridge,
      store,
      origin,
      getActiveConversationId: () => 'conv-1',
    });

    const msg1: SyncMessage = { type: 'session:created', origin, session: { id: '1', name: 'A' } };
    const msg2: SyncMessage = { type: 'session:deleted', origin, sessionId: '2' };

    monitor.send(msg1);
    monitor.send(msg2);

    expect(bridge.postMessage).toHaveBeenCalledTimes(2);
    expect(bridge.postMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({ seq: 1 }));
    expect(bridge.postMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ seq: 2 }));

    monitor.destroy();
  });

  it('incoming message updates lastRemoteSeq', () => {
    const monitor = createSyncMonitor({
      bridge,
      store,
      origin,
      getActiveConversationId: () => 'conv-1',
    });

    simulateIncoming(bridge, {
      type: 'session:created',
      origin: remoteOrigin,
      seq: 5,
      session: { id: '1', name: 'A' },
    });

    expect(monitor.getStats().lastRemoteSeq).toBe(5);
    monitor.destroy();
  });

  it('detects sequence gaps', () => {
    const monitor = createSyncMonitor({
      bridge,
      store,
      origin,
      getActiveConversationId: () => 'conv-1',
    });

    simulateIncoming(bridge, {
      type: 'session:created',
      origin: remoteOrigin,
      seq: 1,
      session: { id: '1', name: 'A' },
    });

    simulateIncoming(bridge, {
      type: 'session:created',
      origin: remoteOrigin,
      seq: 4,
      session: { id: '2', name: 'B' },
    });

    expect(monitor.getStats().sequenceGaps).toBe(2);
    monitor.destroy();
  });

  it('peer reboot resets tracking without increasing gaps', () => {
    const monitor = createSyncMonitor({
      bridge,
      store,
      origin,
      getActiveConversationId: () => 'conv-1',
    });

    simulateIncoming(bridge, {
      type: 'session:created',
      origin: remoteOrigin,
      seq: 10,
      session: { id: '1', name: 'A' },
    });

    // Peer reboots -- seq goes lower
    simulateIncoming(bridge, {
      type: 'session:created',
      origin: remoteOrigin,
      seq: 1,
      session: { id: '2', name: 'B' },
    });

    expect(monitor.getStats().sequenceGaps).toBe(0);
    expect(monitor.getStats().lastRemoteSeq).toBe(1);
    monitor.destroy();
  });

  it('ignores own-origin messages for seq tracking', () => {
    const monitor = createSyncMonitor({
      bridge,
      store,
      origin,
      getActiveConversationId: () => 'conv-1',
    });

    simulateIncoming(bridge, {
      type: 'session:created',
      origin, // same origin
      seq: 5,
      session: { id: '1', name: 'A' },
    });

    expect(monitor.getStats().lastRemoteSeq).toBe(-1);
    monitor.destroy();
  });

  it('startHeartbeat fires at 10s interval', async () => {
    vi.useFakeTimers();
    store = createMockStore(5);

    const monitor = createSyncMonitor({
      bridge,
      store,
      origin,
      getActiveConversationId: () => 'conv-1',
    });

    monitor.startHeartbeat();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(bridge.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sync:heartbeat',
        messageCount: 5,
        conversationId: 'conv-1',
      }),
    );

    monitor.destroy();
    vi.useRealTimers();
  });

  it('heartbeat skips when no active conversation', async () => {
    vi.useFakeTimers();

    const monitor = createSyncMonitor({
      bridge,
      store,
      origin,
      getActiveConversationId: () => '',
    });

    monitor.startHeartbeat();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(bridge.postMessage).not.toHaveBeenCalled();

    monitor.destroy();
    vi.useRealTimers();
  });

  it('stopHeartbeat / destroy clears interval', async () => {
    vi.useFakeTimers();
    store = createMockStore(5);

    const monitor = createSyncMonitor({
      bridge,
      store,
      origin,
      getActiveConversationId: () => 'conv-1',
    });

    monitor.startHeartbeat();
    monitor.destroy();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(bridge.postMessage).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('heartbeat message includes seq', async () => {
    vi.useFakeTimers();
    store = createMockStore(3);

    const monitor = createSyncMonitor({
      bridge,
      store,
      origin,
      getActiveConversationId: () => 'conv-1',
    });

    monitor.startHeartbeat();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(bridge.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sync:heartbeat',
        seq: 1,
      }),
    );

    monitor.destroy();
    vi.useRealTimers();
  });

  it('incoming heartbeat triggers onHeartbeat callback', () => {
    const onHeartbeat = vi.fn();

    const monitor = createSyncMonitor({
      bridge,
      store,
      origin,
      getActiveConversationId: () => 'conv-1',
      onHeartbeat,
    });

    simulateIncoming(bridge, {
      type: 'sync:heartbeat',
      origin: remoteOrigin,
      messageCount: 7,
      conversationId: 'conv-1',
    });

    expect(onHeartbeat).toHaveBeenCalledWith('conv-1', 7);

    monitor.destroy();
  });

  it('isAlive() returns true when no heartbeat ever received', () => {
    const monitor = createSyncMonitor({
      bridge,
      store,
      origin,
      getActiveConversationId: () => 'conv-1',
    });

    expect(monitor.isAlive()).toBe(true);
    monitor.destroy();
  });

  it('isAlive() returns true within 30s of last received message', () => {
    vi.useFakeTimers();

    const monitor = createSyncMonitor({
      bridge,
      store,
      origin,
      getActiveConversationId: () => 'conv-1',
    });

    simulateIncoming(bridge, {
      type: 'session:created',
      origin: remoteOrigin,
      seq: 1,
      session: { id: '1', name: 'A' },
    });

    vi.advanceTimersByTime(29_999);

    expect(monitor.isAlive()).toBe(true);

    monitor.destroy();
    vi.useRealTimers();
  });

  it('isAlive() returns false after 30s silence', () => {
    vi.useFakeTimers();

    const monitor = createSyncMonitor({
      bridge,
      store,
      origin,
      getActiveConversationId: () => 'conv-1',
    });

    simulateIncoming(bridge, {
      type: 'session:created',
      origin: remoteOrigin,
      seq: 1,
      session: { id: '1', name: 'A' },
    });

    vi.advanceTimersByTime(30_001);

    expect(monitor.isAlive()).toBe(false);

    monitor.destroy();
    vi.useRealTimers();
  });
});
