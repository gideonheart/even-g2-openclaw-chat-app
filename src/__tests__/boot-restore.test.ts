import 'fake-indexeddb/auto';
import { openDB, closeDB, DB_NAME } from '../persistence/db';
import { createConversationStore } from '../persistence/conversation-store';
import { restoreOrCreateConversation } from '../persistence/boot-restore';
import type { ConversationStore } from '../persistence/types';

describe('boot-restore', () => {
  let db: IDBDatabase;
  let store: ConversationStore;

  beforeEach(async () => {
    db = await openDB();
    store = createConversationStore(db);
    localStorage.clear();
  });

  afterEach(() => {
    closeDB(db);
    indexedDB.deleteDatabase(DB_NAME);
    localStorage.clear();
  });

  it('restores last conversation with messages when data exists', async () => {
    const conv = await store.createConversation('Existing');
    await store.addMessage(conv.id, {
      role: 'user',
      text: 'Hello',
      timestamp: 1000,
    });
    await store.addMessage(conv.id, {
      role: 'assistant',
      text: 'Hi there',
      timestamp: 2000,
    });

    const result = await restoreOrCreateConversation({ store });

    expect(result.restored).toBe(true);
    expect(result.storageAvailable).toBe(true);
    expect(result.conversationId).toBe(conv.id);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].text).toBe('Hello');
    expect(result.messages[1].text).toBe('Hi there');
    expect(result.error).toBeUndefined();
  });

  it('creates new conversation when no data exists', async () => {
    const result = await restoreOrCreateConversation({ store });

    expect(result.restored).toBe(false);
    expect(result.storageAvailable).toBe(true);
    expect(result.conversationId).toBeDefined();
    expect(result.messages).toHaveLength(0);
    expect(result.error).toBeUndefined();

    // Verify conversation was actually created in the store
    const conv = await store.getConversation(result.conversationId);
    expect(conv).toBeDefined();
  });

  it('returns storageAvailable: false when store is null', async () => {
    const result = await restoreOrCreateConversation({ store: null });

    expect(result.restored).toBe(false);
    expect(result.storageAvailable).toBe(false);
    expect(result.conversationId).toBeDefined();
    expect(result.messages).toHaveLength(0);
  });

  it('returns error message when store throws (corruption)', async () => {
    // Create a mock store that throws on read
    const corruptStore: ConversationStore = {
      ...store,
      getLastConversation: () =>
        Promise.reject(new Error('Corrupted data')),
      getConversation: () =>
        Promise.reject(new Error('Corrupted data')),
    };

    const result = await restoreOrCreateConversation({
      store: corruptStore,
    });

    expect(result.restored).toBe(false);
    expect(result.storageAvailable).toBe(true);
    expect(result.error).toBe("Previous conversation couldn't be restored");
    expect(result.conversationId).toBeDefined();
    expect(result.messages).toHaveLength(0);
  });

  it('stores and reads active conversation ID from localStorage', async () => {
    // First boot: create conversation
    const result1 = await restoreOrCreateConversation({ store });
    expect(result1.restored).toBe(false);

    // Verify localStorage was set
    expect(
      localStorage.getItem('openclaw-active-conversation'),
    ).toBe(result1.conversationId);

    // Add a message to make it restorable
    await store.addMessage(result1.conversationId, {
      role: 'user',
      text: 'Test',
      timestamp: Date.now(),
    });

    // Second boot: should restore via localStorage pointer
    const result2 = await restoreOrCreateConversation({ store });
    expect(result2.restored).toBe(true);
    expect(result2.conversationId).toBe(result1.conversationId);
  });
});
