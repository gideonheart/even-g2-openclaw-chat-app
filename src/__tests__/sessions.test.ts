import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSessionManager, isActiveSession } from '../sessions';
import type { SessionManager } from '../sessions';
import type { SessionStore, ConversationRecord } from '../persistence/types';
import type { SyncBridge, SyncMessage } from '../sync/sync-types';

// ── Mock factories ──────────────────────────────────────────

function makeMockSession(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  return {
    id: 'sess-1',
    name: 'Test Session',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeMockSessionStore(): SessionStore {
  const sessions: ConversationRecord[] = [];
  let activeId: string | null = null;

  return {
    createSession: vi.fn(async (name?: string) => {
      const s = makeMockSession({ id: crypto.randomUUID(), name: name ?? 'New conversation' });
      sessions.push(s);
      return s;
    }),
    renameSession: vi.fn(async (id: string, name: string) => {
      const s = sessions.find((s) => s.id === id);
      if (!s) throw new Error('Not found');
      s.name = name;
      s.updatedAt = Date.now();
      return { ...s };
    }),
    deleteSession: vi.fn(async (id: string) => {
      const idx = sessions.findIndex((s) => s.id === id);
      if (idx >= 0) sessions.splice(idx, 1);
    }),
    listSessions: vi.fn(async () => [...sessions]),
    getSession: vi.fn(async (id: string) => sessions.find((s) => s.id === id)),
    getActiveSessionId: vi.fn(() => activeId),
    setActiveSessionId: vi.fn((id: string) => { activeId = id; }),
  };
}

function makeMockSyncBridge(): SyncBridge & { messages: SyncMessage[] } {
  const messages: SyncMessage[] = [];
  return {
    messages,
    postMessage: vi.fn((msg: SyncMessage) => messages.push(msg)),
    onMessage: vi.fn(() => () => {}),
    destroy: vi.fn(),
  };
}

// ── Tests ───────────────────────────────────────────────────

describe('createSessionManager', () => {
  let store: ReturnType<typeof makeMockSessionStore>;
  let bridge: ReturnType<typeof makeMockSyncBridge>;
  let manager: SessionManager;

  beforeEach(() => {
    store = makeMockSessionStore();
    bridge = makeMockSyncBridge();
    manager = createSessionManager({
      sessionStore: store,
      syncBridge: bridge,
      origin: 'hub',
    });
  });

  describe('loadSessions', () => {
    it('delegates to sessionStore.listSessions', async () => {
      await manager.loadSessions();
      expect(store.listSessions).toHaveBeenCalledOnce();
    });
  });

  describe('createSession', () => {
    it('creates session and sends sync message', async () => {
      const session = await manager.createSession('My Session');

      expect(store.createSession).toHaveBeenCalledWith('My Session');
      expect(bridge.messages).toHaveLength(1);
      expect(bridge.messages[0].type).toBe('session:created');
      expect(bridge.messages[0].origin).toBe('hub');
      expect(session.name).toBe('My Session');
    });

    it('creates session with default name when no name provided', async () => {
      await manager.createSession();
      expect(store.createSession).toHaveBeenCalledWith(undefined);
    });
  });

  describe('renameSession', () => {
    it('renames session and sends sync message', async () => {
      const created = await manager.createSession('Original');
      const updated = await manager.renameSession(created.id, 'Renamed');

      expect(store.renameSession).toHaveBeenCalledWith(created.id, 'Renamed');
      expect(updated.name).toBe('Renamed');

      const renameMsg = bridge.messages.find((m) => m.type === 'session:renamed');
      expect(renameMsg).toBeDefined();
      if (renameMsg && renameMsg.type === 'session:renamed') {
        expect(renameMsg.sessionId).toBe(created.id);
        expect(renameMsg.name).toBe('Renamed');
      }
    });
  });

  describe('deleteSession', () => {
    it('deletes session and sends sync message', async () => {
      const created = await manager.createSession('To Delete');
      await manager.deleteSession(created.id);

      expect(store.deleteSession).toHaveBeenCalledWith(created.id);

      const deleteMsg = bridge.messages.find((m) => m.type === 'session:deleted');
      expect(deleteMsg).toBeDefined();
      if (deleteMsg && deleteMsg.type === 'session:deleted') {
        expect(deleteMsg.sessionId).toBe(created.id);
      }
    });
  });

  describe('getActiveSessionId', () => {
    it('delegates to sessionStore', () => {
      manager.getActiveSessionId();
      expect(store.getActiveSessionId).toHaveBeenCalledOnce();
    });
  });

  describe('switchSession', () => {
    it('sets active session ID and sends sync message', () => {
      manager.switchSession('sess-abc');

      expect(store.setActiveSessionId).toHaveBeenCalledWith('sess-abc');
      expect(bridge.messages).toHaveLength(1);
      expect(bridge.messages[0].type).toBe('session:switched');
      if (bridge.messages[0].type === 'session:switched') {
        expect(bridge.messages[0].sessionId).toBe('sess-abc');
      }
    });
  });
});

describe('isActiveSession', () => {
  it('returns true when ids match', () => {
    expect(isActiveSession('gideon', 'gideon')).toBe(true);
  });

  it('returns false when ids differ', () => {
    expect(isActiveSession('gideon', 'atlas')).toBe(false);
  });
});
