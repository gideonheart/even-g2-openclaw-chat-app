// ── Dynamic session manager ─────────────────────────────────
// Replaces the hardcoded SESSIONS array with IndexedDB-backed
// session operations. All mutations notify the sync bridge for
// cross-context updates between glasses WebView and hub tab.

import type { SessionStore, ConversationRecord } from './persistence/types';
import type { SyncBridge, SyncOrigin } from './sync/sync-types';

// ── SessionManager interface ────────────────────────────────

export interface SessionManager {
  /** Load all sessions from IndexedDB */
  loadSessions(): Promise<ConversationRecord[]>;
  /** Create a new session, notify sync bridge */
  createSession(name?: string): Promise<ConversationRecord>;
  /** Rename a session, notify sync bridge */
  renameSession(id: string, name: string): Promise<ConversationRecord>;
  /** Delete a session (cascade), notify sync bridge */
  deleteSession(id: string): Promise<void>;
  /** Get active session ID */
  getActiveSessionId(): string | null;
  /** Set active session ID, notify sync bridge */
  switchSession(id: string): void;
}

// ── Factory ─────────────────────────────────────────────────

export function createSessionManager(opts: {
  sessionStore: SessionStore;
  syncBridge: SyncBridge;
  origin: SyncOrigin;
}): SessionManager {
  const { sessionStore, syncBridge, origin } = opts;

  return {
    loadSessions: () => sessionStore.listSessions(),

    createSession: async (name?: string) => {
      const session = await sessionStore.createSession(name);
      syncBridge.postMessage({
        type: 'session:created',
        origin,
        session: { id: session.id, name: session.name },
      });
      return session;
    },

    renameSession: async (id: string, name: string) => {
      const updated = await sessionStore.renameSession(id, name);
      syncBridge.postMessage({
        type: 'session:renamed',
        origin,
        sessionId: id,
        name,
      });
      return updated;
    },

    deleteSession: async (id: string) => {
      await sessionStore.deleteSession(id);
      syncBridge.postMessage({
        type: 'session:deleted',
        origin,
        sessionId: id,
      });
    },

    getActiveSessionId: () => sessionStore.getActiveSessionId(),

    switchSession: (id: string) => {
      sessionStore.setActiveSessionId(id);
      syncBridge.postMessage({
        type: 'session:switched',
        origin,
        sessionId: id,
      });
    },
  };
}

// ── Backward-compatible utilities ───────────────────────────
// Kept for callers that still use simple session ID matching.

export function isActiveSession(
  sessionId: string,
  activeId: string,
): boolean {
  return sessionId === activeId;
}
