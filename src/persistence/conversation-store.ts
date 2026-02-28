// ── Conversation store ─────────────────────────────────────
// CRUD operations for conversations and messages over IndexedDB.
// Uses the factory/closure pattern consistent with the rest of the codebase.

import type {
  ConversationRecord,
  ConversationStore,
  MessageRecord,
} from './types';

// ── Auto-naming ──────────────────────────────────────────

/**
 * Generate a conversation name from the first user message.
 * Truncates at ~50 characters at a word boundary.
 */
export function generateConversationName(firstMessage: string): string {
  const MAX_LEN = 50;
  const MIN_WORD_BOUNDARY = 20;

  if (!firstMessage) return 'New conversation';
  if (firstMessage.length <= MAX_LEN) return firstMessage;

  const truncated = firstMessage.slice(0, MAX_LEN);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > MIN_WORD_BOUNDARY) {
    return truncated.slice(0, lastSpace) + '...';
  }

  return truncated + '...';
}

// ── Store factory ────────────────────────────────────────

export function createConversationStore(
  db: IDBDatabase,
): ConversationStore {
  // ── Conversation CRUD ────────────────────────────────

  function createConversation(
    name?: string,
  ): Promise<ConversationRecord> {
    const now = Date.now();
    const record: ConversationRecord = {
      id: crypto.randomUUID(),
      name: name ?? 'New conversation',
      createdAt: now,
      updatedAt: now,
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction('conversations', 'readwrite');
      tx.objectStore('conversations').put(record);
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
    });
  }

  function getConversation(
    id: string,
  ): Promise<ConversationRecord | undefined> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('conversations', 'readonly');
      const req = tx.objectStore('conversations').get(id);
      req.onsuccess = () => resolve(req.result ?? undefined);
      req.onerror = () => reject(req.error);
    });
  }

  function updateConversation(
    id: string,
    updates: Partial<Pick<ConversationRecord, 'name'>>,
  ): Promise<ConversationRecord> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('conversations', 'readwrite');
      const store = tx.objectStore('conversations');
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const existing = getReq.result as ConversationRecord | undefined;
        if (!existing) {
          reject(new Error(`Conversation ${id} not found`));
          return;
        }

        const updated: ConversationRecord = {
          ...existing,
          ...updates,
          updatedAt: Date.now(),
        };
        store.put(updated);
        tx.oncomplete = () => resolve(updated);
      };

      tx.onerror = () => reject(tx.error);
    });
  }

  function getAllConversations(): Promise<ConversationRecord[]> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('conversations', 'readonly');
      const index = tx.objectStore('conversations').index('by-updatedAt');
      const results: ConversationRecord[] = [];

      const cursorReq = index.openCursor(null, 'prev');
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          results.push(cursor.value as ConversationRecord);
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve(results);
      tx.onerror = () => reject(tx.error);
    });
  }

  function getLastConversation(): Promise<ConversationRecord | undefined> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('conversations', 'readonly');
      const index = tx.objectStore('conversations').index('by-updatedAt');

      const cursorReq = index.openCursor(null, 'prev');
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        resolve(cursor ? (cursor.value as ConversationRecord) : undefined);
      };

      tx.onerror = () => reject(tx.error);
    });
  }

  // ── Message CRUD ─────────────────────────────────────

  function addMessage(
    conversationId: string,
    msg: { role: 'user' | 'assistant'; text: string; timestamp: number },
  ): Promise<string> {
    const id = crypto.randomUUID();
    const record: MessageRecord = { id, conversationId, ...msg };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        ['messages', 'conversations'],
        'readwrite',
      );
      tx.objectStore('messages').put(record);

      // Update conversation's updatedAt in the same transaction
      const convStore = tx.objectStore('conversations');
      const getReq = convStore.get(conversationId);
      getReq.onsuccess = () => {
        const conv = getReq.result as ConversationRecord | undefined;
        if (conv) {
          conv.updatedAt = msg.timestamp;
          convStore.put(conv);
        }
      };

      tx.oncomplete = () => resolve(id);
      tx.onerror = () => reject(tx.error);
    });
  }

  function getMessages(
    conversationId: string,
  ): Promise<MessageRecord[]> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('messages', 'readonly');
      const index = tx.objectStore('messages').index('by-conversation');
      const req = index.getAll(conversationId);
      req.onsuccess = () => {
        const results = (req.result as MessageRecord[]).sort(
          (a, b) => a.timestamp - b.timestamp,
        );
        resolve(results);
      };
      req.onerror = () => reject(req.error);
    });
  }

  return {
    createConversation,
    getConversation,
    updateConversation,
    getAllConversations,
    addMessage,
    getMessages,
    getLastConversation,
  };
}
