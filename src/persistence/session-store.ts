// ── Session store ──────────────────────────────────────────
// Wraps ConversationStore with session-specific operations
// including cascade delete and active session tracking.
// Uses the factory/closure pattern consistent with the codebase.

import type { ConversationStore, SessionStore } from './types';

const ACTIVE_SESSION_KEY = 'openclaw-active-conversation';

export function createSessionStore(
  db: IDBDatabase,
  conversationStore: ConversationStore,
): SessionStore {
  function createSession(name?: string) {
    return conversationStore.createConversation(name);
  }

  function renameSession(id: string, name: string) {
    return conversationStore.updateConversation(id, { name });
  }

  function deleteSession(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['conversations', 'messages'], 'readwrite');

      // Delete the conversation record
      tx.objectStore('conversations').delete(id);

      // Delete all messages for this conversation via cursor on index
      const msgIndex = tx
        .objectStore('messages')
        .index('by-conversation');
      const cursorReq = msgIndex.openCursor(IDBKeyRange.only(id));

      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function listSessions() {
    return conversationStore.getAllConversations();
  }

  function getSession(id: string) {
    return conversationStore.getConversation(id);
  }

  function getActiveSessionId(): string | null {
    return localStorage.getItem(ACTIVE_SESSION_KEY);
  }

  function setActiveSessionId(id: string): void {
    localStorage.setItem(ACTIVE_SESSION_KEY, id);
  }

  return {
    createSession,
    renameSession,
    deleteSession,
    listSessions,
    getSession,
    getActiveSessionId,
    setActiveSessionId,
  };
}
