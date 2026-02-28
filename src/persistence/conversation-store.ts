// ── Conversation store ─────────────────────────────────────
// CRUD operations for conversations and messages over IndexedDB.
// Uses the factory/closure pattern consistent with the rest of the codebase.

import type {
  ConversationRecord,
  ConversationStore,
  MessageRecord,
  SearchResult,
} from './types';

export const SENTINEL_ID = '__sentinel__';

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

// ── Snippet extraction ───────────────────────────────────

/**
 * Extract a snippet around the first occurrence of `query` in `text`.
 * Returns `{ before, match, after }` with context characters and ellipsis
 * when the match is not at the start/end of the text.
 */
export function extractSnippet(
  text: string,
  query: string,
  contextChars = 40,
): { before: string; match: string; after: string } {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);

  if (idx === -1) return { before: '', match: '', after: '' };

  const matchEnd = idx + query.length;

  let before = text.slice(Math.max(0, idx - contextChars), idx);
  if (idx > contextChars) before = '...' + before;

  const match = text.slice(idx, matchEnd);

  let after = text.slice(matchEnd, matchEnd + contextChars);
  if (matchEnd + contextChars < text.length) after = after + '...';

  return { before, match, after };
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
          const record = cursor.value as ConversationRecord;
          if (record.id !== SENTINEL_ID) {
            results.push(record);
          }
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
        if (cursor) {
          const record = cursor.value as ConversationRecord;
          if (record.id === SENTINEL_ID) {
            cursor.continue();
            return;
          }
          resolve(record);
        } else {
          resolve(undefined);
        }
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

  // ── Search ──────────────────────────────────────────────

  function searchMessages(
    query: string,
    limit = 50,
  ): Promise<SearchResult[]> {
    if (!query || !query.trim()) return Promise.resolve([]);

    const lowerQuery = query.toLowerCase();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        ['conversations', 'messages'],
        'readonly',
      );

      // First load all conversation names into a map
      const nameMap = new Map<string, string>();
      const results: SearchResult[] = [];
      const convReq = tx.objectStore('conversations').getAll();

      convReq.onsuccess = () => {
        for (const conv of convReq.result as ConversationRecord[]) {
          if (conv.id !== SENTINEL_ID) {
            nameMap.set(conv.id, conv.name);
          }
        }

        // Then scan messages
        const msgStore = tx.objectStore('messages');
        const cursorReq = msgStore.openCursor();

        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor && results.length < limit) {
            const msg = cursor.value as MessageRecord;
            if (msg.text.toLowerCase().includes(lowerQuery)) {
              results.push({
                messageId: msg.id,
                conversationId: msg.conversationId,
                conversationName:
                  nameMap.get(msg.conversationId) ?? 'Unknown',
                role: msg.role,
                text: msg.text,
                timestamp: msg.timestamp,
                snippet: extractSnippet(msg.text, query),
              });
            }
            cursor.continue();
          }
        };
      };

      tx.oncomplete = () => {
        // Sort by timestamp descending (most recent first)
        resolve(
          results.sort((a, b) => b.timestamp - a.timestamp),
        );
      };
      tx.onerror = () => reject(tx.error);
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
    searchMessages,
  };
}
