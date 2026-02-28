import 'fake-indexeddb/auto';
import { openDB, closeDB, DB_NAME } from '../persistence/db';
import { createConversationStore } from '../persistence/conversation-store';
import { createAutoSave } from '../persistence/auto-save';
import { createEventBus } from '../events';
import type { AppEventMap } from '../types';
import type { ConversationStore } from '../persistence/types';
import type { SyncBridge } from '../sync/sync-types';

function createMockSyncBridge(): SyncBridge & { postMessage: ReturnType<typeof vi.fn> } {
  return {
    postMessage: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    destroy: vi.fn(),
  };
}

describe('auto-save', () => {
  let db: IDBDatabase;
  let store: ConversationStore;
  let bus: ReturnType<typeof createEventBus<AppEventMap>>;
  let conversationId: string;

  beforeEach(async () => {
    db = await openDB();
    store = createConversationStore(db);
    bus = createEventBus<AppEventMap>();
    const conv = await store.createConversation('Test');
    conversationId = conv.id;
  });

  afterEach(() => {
    closeDB(db);
    indexedDB.deleteDatabase(DB_NAME);
  });

  it('saves user message on transcript chunk', async () => {
    const autoSave = createAutoSave({
      bus,
      store,
      getConversationId: () => conversationId,
    });

    bus.emit('gateway:chunk', { type: 'transcript', text: 'Hello world' });

    // Wait for async save
    await new Promise((r) => setTimeout(r, 50));

    const messages = await store.getMessages(conversationId);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].text).toBe('Hello world');

    autoSave.destroy();
  });

  it('accumulates response_delta and saves on response_end', async () => {
    const autoSave = createAutoSave({
      bus,
      store,
      getConversationId: () => conversationId,
    });

    bus.emit('gateway:chunk', { type: 'response_start' });
    bus.emit('gateway:chunk', { type: 'response_delta', text: 'Hello ' });
    bus.emit('gateway:chunk', { type: 'response_delta', text: 'world' });
    bus.emit('gateway:chunk', { type: 'response_end' });

    await new Promise((r) => setTimeout(r, 50));

    const messages = await store.getMessages(conversationId);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].text).toBe('Hello world');

    autoSave.destroy();
  });

  it('does not save partial response during streaming', async () => {
    const autoSave = createAutoSave({
      bus,
      store,
      getConversationId: () => conversationId,
    });

    bus.emit('gateway:chunk', { type: 'response_start' });
    bus.emit('gateway:chunk', { type: 'response_delta', text: 'partial' });

    await new Promise((r) => setTimeout(r, 50));

    const messages = await store.getMessages(conversationId);
    expect(messages).toHaveLength(0);

    autoSave.destroy();
  });

  it('saves partial text on error chunk and does not pollute next response', async () => {
    const autoSave = createAutoSave({
      bus,
      store,
      getConversationId: () => conversationId,
    });

    bus.emit('gateway:chunk', { type: 'response_start' });
    bus.emit('gateway:chunk', {
      type: 'response_delta',
      text: 'should be saved',
    });
    bus.emit('gateway:chunk', {
      type: 'error',
      error: 'Something went wrong',
    });

    // Now start a new response -- should NOT include the partial text
    bus.emit('gateway:chunk', { type: 'response_start' });
    bus.emit('gateway:chunk', {
      type: 'response_delta',
      text: 'fresh response',
    });
    bus.emit('gateway:chunk', { type: 'response_end' });

    await new Promise((r) => setTimeout(r, 50));

    const messages = await store.getMessages(conversationId);
    expect(messages).toHaveLength(2);
    const texts = messages.map((m) => m.text).sort();
    expect(texts).toContain('fresh response');
    expect(texts).toContain('should be saved [response interrupted]');

    autoSave.destroy();
  });

  it('auto-names conversation from first user message', async () => {
    let namedWith: string | undefined;
    const autoSave = createAutoSave({
      bus,
      store,
      getConversationId: () => conversationId,
      onConversationNamed: (name) => {
        namedWith = name;
      },
    });

    bus.emit('gateway:chunk', {
      type: 'transcript',
      text: 'What is the weather like today',
    });

    await new Promise((r) => setTimeout(r, 50));

    const conv = await store.getConversation(conversationId);
    expect(conv!.name).toBe('What is the weather like today');
    expect(namedWith).toBe('What is the weather like today');

    autoSave.destroy();
  });

  it('emits persistence:warning after failed retries', async () => {
    vi.useFakeTimers();

    // Create a mock store that always fails
    const failStore: ConversationStore = {
      ...store,
      addMessage: () => Promise.reject(new Error('DB write failed')),
    };

    const warnings: string[] = [];
    bus.on('persistence:warning', ({ message }) => warnings.push(message));

    const autoSave = createAutoSave({
      bus,
      store: failStore,
      getConversationId: () => conversationId,
    });

    bus.emit('gateway:chunk', { type: 'transcript', text: 'Will fail' });

    // Advance through all retry delays: 500, 1000, 1500ms
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(500);
    }

    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toBe('Messages may not be saved');

    autoSave.destroy();
    vi.useRealTimers();
  });

  it('destroy() unsubscribes from bus', async () => {
    const autoSave = createAutoSave({
      bus,
      store,
      getConversationId: () => conversationId,
    });

    autoSave.destroy();

    // Emit after destroy — should NOT save
    bus.emit('gateway:chunk', { type: 'transcript', text: 'After destroy' });
    await new Promise((r) => setTimeout(r, 50));

    const messages = await store.getMessages(conversationId);
    expect(messages).toHaveLength(0);
  });

  // ── SyncBridge integration tests ──────────────────────────

  it('posts message:added via syncBridge after successful user message save', async () => {
    const mockBridge = createMockSyncBridge();
    const autoSave = createAutoSave({
      bus,
      store,
      getConversationId: () => conversationId,
      syncBridge: mockBridge,
    });

    bus.emit('gateway:chunk', { type: 'transcript', text: 'Hello sync' });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockBridge.postMessage).toHaveBeenCalledWith({
      type: 'message:added',
      origin: 'glasses',
      conversationId: expect.any(String),
      role: 'user',
      text: 'Hello sync',
    });

    autoSave.destroy();
  });

  it('posts message:added via syncBridge after successful assistant message save', async () => {
    const mockBridge = createMockSyncBridge();
    const autoSave = createAutoSave({
      bus,
      store,
      getConversationId: () => conversationId,
      syncBridge: mockBridge,
    });

    bus.emit('gateway:chunk', { type: 'response_delta', text: 'Assistant reply' });
    bus.emit('gateway:chunk', { type: 'response_end' });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockBridge.postMessage).toHaveBeenCalledWith({
      type: 'message:added',
      origin: 'glasses',
      conversationId: expect.any(String),
      role: 'assistant',
      text: 'Assistant reply',
    });

    autoSave.destroy();
  });

  // ── Streaming sync message tests ──────────────────────────

  it('posts streaming:start via syncBridge on response_start chunk', async () => {
    const mockBridge = createMockSyncBridge();
    const autoSave = createAutoSave({
      bus,
      store,
      getConversationId: () => conversationId,
      syncBridge: mockBridge,
    });

    bus.emit('gateway:chunk', { type: 'response_start' });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockBridge.postMessage).toHaveBeenCalledWith({
      type: 'streaming:start',
      origin: 'glasses',
      conversationId,
    });

    autoSave.destroy();
  });

  it('posts streaming:end via syncBridge on response_end chunk after successful save', async () => {
    const mockBridge = createMockSyncBridge();
    const autoSave = createAutoSave({
      bus,
      store,
      getConversationId: () => conversationId,
      syncBridge: mockBridge,
    });

    bus.emit('gateway:chunk', { type: 'response_delta', text: 'Reply text' });
    bus.emit('gateway:chunk', { type: 'response_end' });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockBridge.postMessage).toHaveBeenCalledWith({
      type: 'streaming:end',
      origin: 'glasses',
      conversationId,
    });

    autoSave.destroy();
  });

  it('posts streaming:end via syncBridge on error chunk (cleanup)', async () => {
    const mockBridge = createMockSyncBridge();
    const autoSave = createAutoSave({
      bus,
      store,
      getConversationId: () => conversationId,
      syncBridge: mockBridge,
    });

    bus.emit('gateway:chunk', { type: 'response_start' });
    bus.emit('gateway:chunk', { type: 'response_delta', text: 'partial' });
    bus.emit('gateway:chunk', { type: 'error', error: 'Something broke' });

    await new Promise((r) => setTimeout(r, 50));

    // streaming:start was posted on response_start, streaming:end on error
    const streamingCalls = mockBridge.postMessage.mock.calls.filter(
      (c: unknown[]) => (c[0] as { type: string }).type.startsWith('streaming:'),
    );
    expect(streamingCalls).toHaveLength(2);
    expect((streamingCalls[0][0] as { type: string }).type).toBe('streaming:start');
    expect((streamingCalls[1][0] as { type: string }).type).toBe('streaming:end');

    autoSave.destroy();
  });

  it('does not post streaming sync messages when syncBridge is not provided', async () => {
    const autoSave = createAutoSave({
      bus,
      store,
      getConversationId: () => conversationId,
      // No syncBridge
    });

    bus.emit('gateway:chunk', { type: 'response_start' });
    bus.emit('gateway:chunk', { type: 'response_delta', text: 'text' });
    bus.emit('gateway:chunk', { type: 'response_end' });

    await new Promise((r) => setTimeout(r, 50));

    // Should not crash — messages still saved
    const messages = await store.getMessages(conversationId);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('text');

    autoSave.destroy();
  });

  it('does not post sync message when syncBridge is not provided', async () => {
    // This test verifies existing tests still work without syncBridge (no crash)
    const autoSave = createAutoSave({
      bus,
      store,
      getConversationId: () => conversationId,
      // No syncBridge -- must not crash
    });

    bus.emit('gateway:chunk', { type: 'transcript', text: 'No bridge' });

    await new Promise((r) => setTimeout(r, 50));

    // Verify message was saved (existing behavior preserved)
    const messages = await store.getMessages(conversationId);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('No bridge');

    autoSave.destroy();
  });

  // ── RES-06: First-write verification tests ────────────────

  describe('first-write verification (RES-06)', () => {
    it('verifies first user message save via separate read-back', async () => {
      const errors: Array<{ type: string }> = [];
      bus.on('persistence:error', (e) => errors.push(e));

      const autoSave = createAutoSave({
        bus,
        store,
        getConversationId: () => conversationId,
      });

      bus.emit('gateway:chunk', { type: 'transcript', text: 'First message' });
      await new Promise((r) => setTimeout(r, 50));

      // Message saved and verifiable
      const messages = await store.getMessages(conversationId);
      expect(messages).toHaveLength(1);
      expect(messages[0].text).toBe('First message');

      // No persistence:error emitted (verification succeeded)
      expect(errors).toHaveLength(0);

      // Second transcript should NOT trigger re-verification (no additional errors)
      bus.emit('gateway:chunk', { type: 'transcript', text: 'Second message' });
      await new Promise((r) => setTimeout(r, 50));

      expect(errors).toHaveLength(0);
      const msgs2 = await store.getMessages(conversationId);
      expect(msgs2).toHaveLength(2);

      autoSave.destroy();
    });

    it('emits persistence:error with verify-failed when verification fails', async () => {
      const errors: Array<{ type: string; recoverable: boolean }> = [];
      bus.on('persistence:error', (e) => errors.push(e));

      // Mock store where addMessage succeeds but verifyMessage returns false
      const mockStore: ConversationStore = {
        ...store,
        verifyMessage: () => Promise.resolve(false),
      };

      const autoSave = createAutoSave({
        bus,
        store: mockStore,
        getConversationId: () => conversationId,
      });

      bus.emit('gateway:chunk', { type: 'transcript', text: 'Test verify' });
      await new Promise((r) => setTimeout(r, 50));

      expect(errors).toHaveLength(1);
      expect(errors[0].type).toBe('verify-failed');
      expect(errors[0].recoverable).toBe(false);

      autoSave.destroy();
    });

    it('resets storageVerified on persistence:warning and re-verifies', async () => {
      const errors: Array<{ type: string }> = [];
      bus.on('persistence:error', (e) => errors.push(e));

      let verifyCallCount = 0;
      const mockStore: ConversationStore = {
        ...store,
        verifyMessage: () => {
          verifyCallCount++;
          // First call succeeds, second fails
          return Promise.resolve(verifyCallCount <= 1);
        },
      };

      const autoSave = createAutoSave({
        bus,
        store: mockStore,
        getConversationId: () => conversationId,
      });

      // First save + verification (succeeds)
      bus.emit('gateway:chunk', { type: 'transcript', text: 'First' });
      await new Promise((r) => setTimeout(r, 50));
      expect(errors).toHaveLength(0);

      // Reset verification flag
      bus.emit('persistence:warning', { message: 'test warning' });

      // Second save triggers re-verification (fails this time)
      bus.emit('gateway:chunk', { type: 'transcript', text: 'Second' });
      await new Promise((r) => setTimeout(r, 50));

      expect(errors).toHaveLength(1);
      expect(errors[0].type).toBe('verify-failed');

      autoSave.destroy();
    });
  });

  // ── RES-07: Error escalation tests ────────────────────────

  describe('error escalation (RES-07)', () => {
    it('emits persistence:error with write-failed after all retries exhausted', async () => {
      vi.useFakeTimers();

      const failStore: ConversationStore = {
        ...store,
        addMessage: () => Promise.reject(new Error('DB write failed')),
      };

      const warnings: string[] = [];
      const errors: Array<{ type: string; recoverable: boolean }> = [];
      bus.on('persistence:warning', ({ message }) => warnings.push(message));
      bus.on('persistence:error', (e) => errors.push(e));

      const autoSave = createAutoSave({
        bus,
        store: failStore,
        getConversationId: () => conversationId,
      });

      bus.emit('gateway:chunk', { type: 'transcript', text: 'Will fail' });

      // Advance through all retry delays: 500, 1000, 1500ms
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(500);
      }

      // Both warning AND error emitted (dual-emit)
      expect(warnings.length).toBeGreaterThan(0);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].type).toBe('write-failed');
      expect(errors[0].recoverable).toBe(false);

      autoSave.destroy();
      vi.useRealTimers();
    });

    it('includes conversationId in persistence:error payload', async () => {
      vi.useFakeTimers();

      const failStore: ConversationStore = {
        ...store,
        addMessage: () => Promise.reject(new Error('DB write failed')),
      };

      const errors: Array<{ type: string; conversationId?: string }> = [];
      bus.on('persistence:error', (e) => errors.push(e));

      const autoSave = createAutoSave({
        bus,
        store: failStore,
        getConversationId: () => conversationId,
      });

      bus.emit('gateway:chunk', { type: 'transcript', text: 'Will fail' });

      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(500);
      }

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].conversationId).toBe(conversationId);

      autoSave.destroy();
      vi.useRealTimers();
    });
  });

  // ── RES-08: Partial response preservation tests ───────────

  describe('partial response preservation (RES-08)', () => {
    it('saves partial response with [response interrupted] on error chunk', async () => {
      const autoSave = createAutoSave({
        bus,
        store,
        getConversationId: () => conversationId,
      });

      bus.emit('gateway:chunk', { type: 'response_start' });
      bus.emit('gateway:chunk', { type: 'response_delta', text: 'Hello world' });
      bus.emit('gateway:chunk', { type: 'error', error: 'Stream failed' });

      await new Promise((r) => setTimeout(r, 50));

      const messages = await store.getMessages(conversationId);
      expect(messages).toHaveLength(1);
      expect(messages[0].text).toBe('Hello world [response interrupted]');
      expect(messages[0].role).toBe('assistant');

      autoSave.destroy();
    });

    it('syncs partial response via syncBridge on error chunk', async () => {
      const mockBridge = createMockSyncBridge();
      const autoSave = createAutoSave({
        bus,
        store,
        getConversationId: () => conversationId,
        syncBridge: mockBridge,
      });

      bus.emit('gateway:chunk', { type: 'response_start' });
      bus.emit('gateway:chunk', { type: 'response_delta', text: 'Partial text' });
      bus.emit('gateway:chunk', { type: 'error', error: 'Stream failed' });

      await new Promise((r) => setTimeout(r, 50));

      // Should have message:added with interrupted text
      expect(mockBridge.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'message:added',
          text: expect.stringContaining('[response interrupted]'),
        }),
      );

      autoSave.destroy();
    });

    it('does not save partial response when no pending text on error', async () => {
      const autoSave = createAutoSave({
        bus,
        store,
        getConversationId: () => conversationId,
      });

      // Error without any prior response_delta
      bus.emit('gateway:chunk', { type: 'error', error: 'Something broke' });

      await new Promise((r) => setTimeout(r, 50));

      const messages = await store.getMessages(conversationId);
      expect(messages).toHaveLength(0);

      autoSave.destroy();
    });

    it('partial save does not pollute next response', async () => {
      const autoSave = createAutoSave({
        bus,
        store,
        getConversationId: () => conversationId,
      });

      // First: partial response interrupted
      bus.emit('gateway:chunk', { type: 'response_start' });
      bus.emit('gateway:chunk', { type: 'response_delta', text: 'partial' });
      bus.emit('gateway:chunk', { type: 'error', error: 'Stream failed' });

      await new Promise((r) => setTimeout(r, 50));

      // Second: clean response
      bus.emit('gateway:chunk', { type: 'response_start' });
      bus.emit('gateway:chunk', { type: 'response_delta', text: 'clean response' });
      bus.emit('gateway:chunk', { type: 'response_end' });

      await new Promise((r) => setTimeout(r, 50));

      const messages = await store.getMessages(conversationId);
      expect(messages).toHaveLength(2);
      const texts = messages.map((m) => m.text).sort();
      expect(texts).toContain('clean response');
      expect(texts).toContain('partial [response interrupted]');

      autoSave.destroy();
    });
  });
});
