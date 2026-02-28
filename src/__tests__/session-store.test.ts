import 'fake-indexeddb/auto';
import { openDB, closeDB, DB_NAME } from '../persistence/db';
import { createConversationStore } from '../persistence/conversation-store';
import { createSessionStore } from '../persistence/session-store';
import type { ConversationStore, SessionStore } from '../persistence/types';

describe('session-store', () => {
  let db: IDBDatabase;
  let convStore: ConversationStore;
  let session: SessionStore;

  beforeEach(async () => {
    localStorage.clear();
    db = await openDB();
    convStore = createConversationStore(db);
    session = createSessionStore(db, convStore);
  });

  afterEach(() => {
    closeDB(db);
    indexedDB.deleteDatabase(DB_NAME);
    localStorage.clear();
  });

  // ── createSession ────────────────────────────────────────

  describe('createSession', () => {
    it('creates a ConversationRecord with default name "New conversation"', async () => {
      const record = await session.createSession();
      expect(record.id).toBeDefined();
      expect(record.name).toBe('New conversation');
      expect(record.createdAt).toBeGreaterThan(0);
      expect(record.updatedAt).toBe(record.createdAt);
    });

    it('creates a ConversationRecord with a custom name', async () => {
      const record = await session.createSession('My Chat');
      expect(record.name).toBe('My Chat');
      expect(record.id).toBeDefined();
    });
  });

  // ── renameSession ────────────────────────────────────────

  describe('renameSession', () => {
    it('updates name field and returns updated record with new updatedAt', async () => {
      const created = await session.createSession('Original');
      await new Promise((r) => setTimeout(r, 10));

      const renamed = await session.renameSession(created.id, 'Renamed');
      expect(renamed.name).toBe('Renamed');
      expect(renamed.id).toBe(created.id);
      expect(renamed.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
    });
  });

  // ── deleteSession (cascade) ──────────────────────────────

  describe('deleteSession', () => {
    it('deletes conversation record AND all its messages in one transaction', async () => {
      const conv = await session.createSession('To Delete');
      const t = Date.now();
      await convStore.addMessage(conv.id, {
        role: 'user',
        text: 'Hello',
        timestamp: t,
      });
      await convStore.addMessage(conv.id, {
        role: 'assistant',
        text: 'Hi there',
        timestamp: t + 100,
      });

      // Verify messages exist before delete
      const beforeMsgs = await convStore.getMessages(conv.id);
      expect(beforeMsgs).toHaveLength(2);

      await session.deleteSession(conv.id);

      // Conversation should be gone
      const afterConv = await convStore.getConversation(conv.id);
      expect(afterConv).toBeUndefined();

      // Messages should also be gone
      const afterMsgs = await convStore.getMessages(conv.id);
      expect(afterMsgs).toHaveLength(0);
    });

    it('does not affect other conversations or their messages', async () => {
      const convA = await session.createSession('Keep');
      const convB = await session.createSession('Delete');

      await convStore.addMessage(convA.id, {
        role: 'user',
        text: 'Keep me',
        timestamp: Date.now(),
      });
      await convStore.addMessage(convB.id, {
        role: 'user',
        text: 'Delete me',
        timestamp: Date.now(),
      });

      await session.deleteSession(convB.id);

      // convA and its messages should remain
      const keptConv = await convStore.getConversation(convA.id);
      expect(keptConv).toBeDefined();
      expect(keptConv!.name).toBe('Keep');
      const keptMsgs = await convStore.getMessages(convA.id);
      expect(keptMsgs).toHaveLength(1);

      // convB should be gone
      expect(await convStore.getConversation(convB.id)).toBeUndefined();
      expect(await convStore.getMessages(convB.id)).toHaveLength(0);
    });
  });

  // ── listSessions ─────────────────────────────────────────

  describe('listSessions', () => {
    it('returns all conversations sorted by updatedAt descending', async () => {
      const a = await session.createSession('A');
      await new Promise((r) => setTimeout(r, 10));
      await session.createSession('B');
      await new Promise((r) => setTimeout(r, 10));
      // Update A to make it most recent
      await session.renameSession(a.id, 'A updated');

      const list = await session.listSessions();
      expect(list).toHaveLength(2);
      expect(list[0].name).toBe('A updated');
      expect(list[1].name).toBe('B');
    });
  });

  // ── getSession ───────────────────────────────────────────

  describe('getSession', () => {
    it('returns conversation by id', async () => {
      const created = await session.createSession('Test');
      const fetched = await session.getSession(created.id);
      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.name).toBe('Test');
    });

    it('returns undefined for nonexistent id', async () => {
      const result = await session.getSession('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  // ── Active session ID ────────────────────────────────────

  describe('getActiveSessionId / setActiveSessionId', () => {
    it('returns null when no active session set', () => {
      expect(session.getActiveSessionId()).toBeNull();
    });

    it('reads and writes active session via localStorage', () => {
      session.setActiveSessionId('session-123');
      expect(session.getActiveSessionId()).toBe('session-123');
      expect(localStorage.getItem('openclaw-active-conversation')).toBe(
        'session-123',
      );
    });

    it('reflects external localStorage changes', () => {
      localStorage.setItem('openclaw-active-conversation', 'external-id');
      expect(session.getActiveSessionId()).toBe('external-id');
    });
  });
});
