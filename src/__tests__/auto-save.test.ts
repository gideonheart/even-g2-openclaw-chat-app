import 'fake-indexeddb/auto';
import { openDB, closeDB, DB_NAME } from '../persistence/db';
import { createConversationStore } from '../persistence/conversation-store';
import { createAutoSave } from '../persistence/auto-save';
import { createEventBus } from '../events';
import type { AppEventMap } from '../types';
import type { ConversationStore } from '../persistence/types';

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

  it('resets pending text on error chunk', async () => {
    const autoSave = createAutoSave({
      bus,
      store,
      getConversationId: () => conversationId,
    });

    bus.emit('gateway:chunk', { type: 'response_start' });
    bus.emit('gateway:chunk', {
      type: 'response_delta',
      text: 'should be discarded',
    });
    bus.emit('gateway:chunk', {
      type: 'error',
      error: 'Something went wrong',
    });

    // Now start a new response — should NOT include the discarded text
    bus.emit('gateway:chunk', { type: 'response_start' });
    bus.emit('gateway:chunk', {
      type: 'response_delta',
      text: 'fresh response',
    });
    bus.emit('gateway:chunk', { type: 'response_end' });

    await new Promise((r) => setTimeout(r, 50));

    const messages = await store.getMessages(conversationId);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('fresh response');

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
});
