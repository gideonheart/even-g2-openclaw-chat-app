// ── Error escalation integration tests ────────────────────────
// Integration tests that verify write failure -> retry exhaustion ->
// error escalation via event bus flow. Composes real AutoSave + EventBus
// + ConversationStore with failure helpers.
//
// CRITICAL: 'fake-indexeddb/auto' MUST be the first import.
// IDB setup (openDB, createConversation) runs in beforeEach with REAL timers.
// Individual tests call vi.useFakeTimers() AFTER IDB setup is complete.
// Use vi.advanceTimersByTimeAsync() (ASYNC) to advance through retries since
// async save operations must interleave with timer advancement.

import 'fake-indexeddb/auto';
import { openDB, closeDB, DB_NAME } from '../../persistence/db';
import { createConversationStore } from '../../persistence/conversation-store';
import { createAutoSave } from '../../persistence/auto-save';
import { createEventBus } from '../../events';
import type { AppEventMap } from '../../types';
import { createFailingStore, createQuotaExceededStore } from '../helpers/failure-helpers';
import type { ConversationStore } from '../../persistence/types';

describe('error escalation integration', () => {
  let db: IDBDatabase;
  let realStore: ConversationStore;
  let conversationId: string;

  // IDB setup runs with real timers -- fake timers activated per-test
  beforeEach(async () => {
    db = await openDB();
    realStore = createConversationStore(db);
    const conv = await realStore.createConversation('Test conversation');
    conversationId = conv.id;
  });

  afterEach(() => {
    vi.useRealTimers();
    try { closeDB(db); } catch { /* may already be closed */ }
    indexedDB.deleteDatabase(DB_NAME);
  });

  // ── Test 1: Write failure triggers persistence:warning after retries ──

  it('write failure triggers persistence:warning after retries', async () => {
    vi.useFakeTimers();

    // failAfterN=0: all addMessage calls fail immediately
    // (writeCount increments to 1 on first call, 1 > 0 = fail)
    const failStore = createFailingStore(realStore, 0);

    const bus = createEventBus<AppEventMap>();
    const warnings: string[] = [];
    bus.on('persistence:warning', ({ message }) => warnings.push(message));

    const autoSave = createAutoSave({
      bus,
      store: failStore,
      getConversationId: () => conversationId,
    });

    // Emit a transcript chunk -- triggers addMessage which will fail
    bus.emit('gateway:chunk', { type: 'transcript', text: 'Will fail' });

    // Advance through all retry delays: 500ms, 1000ms, 1500ms (3 retries)
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(500);
    }

    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toBe('Messages may not be saved');

    autoSave.destroy();
  });

  // ── Test 2: Write failure triggers persistence:error after retry exhaustion ──

  it('write failure triggers persistence:error after retry exhaustion', async () => {
    vi.useFakeTimers();

    const failStore = createFailingStore(realStore, 0);

    const bus = createEventBus<AppEventMap>();
    const errors: Array<{ type: string; recoverable: boolean }> = [];
    bus.on('persistence:error', (e) => errors.push(e));

    const autoSave = createAutoSave({
      bus,
      store: failStore,
      getConversationId: () => conversationId,
    });

    bus.emit('gateway:chunk', { type: 'transcript', text: 'Will fail' });

    // Advance through full retry cycle
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(500);
    }

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].type).toBe('write-failed');
    expect(errors[0].recoverable).toBe(false);

    autoSave.destroy();
  });

  // ── Test 3: Quota exceeded triggers persistence:error ──

  it('quota exceeded triggers persistence:error with quota-exceeded type', async () => {
    vi.useFakeTimers();

    // createQuotaExceededStore: all write ops throw DOMException('QuotaExceededError')
    const quotaStore = createQuotaExceededStore(realStore);

    const bus = createEventBus<AppEventMap>();
    const errors: Array<{ type: string; recoverable: boolean }> = [];
    bus.on('persistence:error', (e) => errors.push(e));

    const autoSave = createAutoSave({
      bus,
      store: quotaStore,
      getConversationId: () => conversationId,
    });

    bus.emit('gateway:chunk', { type: 'transcript', text: 'Quota exceeded message' });

    // Advance through retry cycle -- quota errors exhaust all retries
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(500);
    }

    // persistence:error should be emitted after retry exhaustion
    expect(errors.length).toBeGreaterThan(0);

    autoSave.destroy();
  });

  // ── Test 4: Successful write emits no error events ──

  it('successful write emits no error events', async () => {
    vi.useFakeTimers();

    const bus = createEventBus<AppEventMap>();
    const warnings: string[] = [];
    const errors: Array<{ type: string }> = [];
    bus.on('persistence:warning', ({ message }) => warnings.push(message));
    bus.on('persistence:error', (e) => errors.push(e));

    // Use the real store (NOT a failing store)
    const autoSave = createAutoSave({
      bus,
      store: realStore,
      getConversationId: () => conversationId,
    });

    bus.emit('gateway:chunk', { type: 'transcript', text: 'This should succeed' });

    // Advance timers to let the async save complete
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(100);
    }

    // Neither persistence:warning nor persistence:error should be emitted
    expect(warnings).toHaveLength(0);
    expect(errors).toHaveLength(0);

    autoSave.destroy();
  });

  // ── Test 5: Partial write succeeds before failAfterN threshold ──

  it('partial write succeeds before failAfterN threshold', async () => {
    vi.useFakeTimers();

    // failAfterN=1: first addMessage succeeds (writeCount=1 is NOT > 1),
    // second addMessage fails (writeCount=2 > 1)
    const failStore = createFailingStore(realStore, 1);

    const bus = createEventBus<AppEventMap>();
    const warnings: string[] = [];
    bus.on('persistence:warning', ({ message }) => warnings.push(message));

    const autoSave = createAutoSave({
      bus,
      store: failStore,
      getConversationId: () => conversationId,
    });

    // First gateway:chunk -- should succeed (within threshold)
    bus.emit('gateway:chunk', { type: 'transcript', text: 'First message' });

    // Advance timers to let first save complete
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(100);
    }

    // Switch back to real timers temporarily to verify IDB state
    vi.useRealTimers();
    const messagesAfterFirst = await realStore.getMessages(conversationId);
    expect(messagesAfterFirst).toHaveLength(1);
    expect(messagesAfterFirst[0].text).toBe('First message');

    // Re-activate fake timers for second save retry cycle
    vi.useFakeTimers();

    // Second gateway:chunk -- should fail (past threshold)
    bus.emit('gateway:chunk', { type: 'transcript', text: 'Second message (will fail)' });

    // Advance through retry cycle for the second save
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(500);
    }

    // persistence:warning should be emitted for the second (failed) save
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toBe('Messages may not be saved');

    autoSave.destroy();
  });
});
