// ── Session store ──────────────────────────────────────────
// Wraps ConversationStore with session-specific operations
// including cascade delete and active session tracking.

import type { ConversationStore, SessionStore } from './types';

export function createSessionStore(
  _db: IDBDatabase,
  _conversationStore: ConversationStore,
): SessionStore {
  return {
    createSession() {
      throw new Error('Not implemented');
    },
    renameSession() {
      throw new Error('Not implemented');
    },
    deleteSession() {
      throw new Error('Not implemented');
    },
    listSessions() {
      throw new Error('Not implemented');
    },
    getSession() {
      throw new Error('Not implemented');
    },
    getActiveSessionId() {
      throw new Error('Not implemented');
    },
    setActiveSessionId() {
      throw new Error('Not implemented');
    },
  };
}
