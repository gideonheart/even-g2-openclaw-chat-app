import 'fake-indexeddb/auto';
import { openDB, closeDB, DB_NAME } from '../db';
import { createConversationStore } from '../conversation-store';
import { SENTINEL_ID } from '../conversation-store';
import {
  createIntegrityChecker,
  type IntegrityReport,
  type IntegrityChecker,
} from '../integrity-checker';
import type { ConversationStore } from '../types';

describe('integrity-checker', () => {
  let db: IDBDatabase;
  let store: ConversationStore;
  let checker: IntegrityChecker;

  beforeEach(async () => {
    db = await openDB();
    store = createConversationStore(db);
    checker = createIntegrityChecker(db);
  });

  afterEach(() => {
    closeDB(db);
    indexedDB.deleteDatabase(DB_NAME);
    localStorage.clear();
  });

  // ── check() ─────────────────────────────────────────────

  describe('check()', () => {
    it('returns empty report for empty database', async () => {
      const report = await checker.check();

      expect(report.orphanedMessageIds).toEqual([]);
      expect(report.conversationCount).toBe(0);
      expect(report.messageCount).toBe(0);
      expect(report.danglingPointer).toBe(false);
      expect(report.sentinelPresent).toBe(false);
      expect(report.checkedAt).toBeGreaterThan(0);
    });

    it('counts conversations and messages correctly', async () => {
      const conv1 = await store.createConversation('Chat 1');
      const conv2 = await store.createConversation('Chat 2');
      await store.addMessage(conv1.id, {
        role: 'user',
        text: 'Hello',
        timestamp: Date.now(),
      });
      await store.addMessage(conv1.id, {
        role: 'assistant',
        text: 'Hi',
        timestamp: Date.now() + 1,
      });
      await store.addMessage(conv2.id, {
        role: 'user',
        text: 'World',
        timestamp: Date.now() + 2,
      });

      const report = await checker.check();

      expect(report.conversationCount).toBe(2);
      expect(report.messageCount).toBe(3);
      expect(report.orphanedMessageIds).toEqual([]);
    });

    it('detects orphaned messages (conversationId points to non-existent conversation)', async () => {
      const conv = await store.createConversation('Real');
      await store.addMessage(conv.id, {
        role: 'user',
        text: 'Valid',
        timestamp: Date.now(),
      });

      // Manually insert orphaned message with fake conversationId
      const orphanId = 'orphan-msg-1';
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('messages', 'readwrite');
        tx.objectStore('messages').put({
          id: orphanId,
          conversationId: 'deleted-conv-id',
          role: 'user',
          text: 'I am an orphan',
          timestamp: Date.now(),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      const report = await checker.check();

      expect(report.orphanedMessageIds).toContain(orphanId);
      expect(report.orphanedMessageIds).toHaveLength(1);
      expect(report.messageCount).toBe(2);
    });

    it('detects sentinel as present when written', async () => {
      await checker.writeSentinel();
      const report = await checker.check();

      expect(report.sentinelPresent).toBe(true);
      // Sentinel should NOT be counted in conversationCount
      expect(report.conversationCount).toBe(0);
    });

    it('reports sentinel not present when missing', async () => {
      const report = await checker.check();
      expect(report.sentinelPresent).toBe(false);
    });

    it('does not count sentinel in conversationCount', async () => {
      await checker.writeSentinel();
      await store.createConversation('Real conversation');

      const report = await checker.check();

      expect(report.sentinelPresent).toBe(true);
      expect(report.conversationCount).toBe(1);
    });

    it('detects dangling localStorage pointer', async () => {
      localStorage.setItem(
        'openclaw-active-conversation',
        'deleted-conversation-id',
      );

      const report = await checker.check();

      expect(report.danglingPointer).toBe(true);
    });

    it('reports valid localStorage pointer as not dangling', async () => {
      const conv = await store.createConversation('Active');
      localStorage.setItem('openclaw-active-conversation', conv.id);

      const report = await checker.check();

      expect(report.danglingPointer).toBe(false);
    });

    it('reports no dangling pointer when localStorage is empty', async () => {
      const report = await checker.check();
      expect(report.danglingPointer).toBe(false);
    });
  });

  // ── writeSentinel() ─────────────────────────────────────

  describe('writeSentinel()', () => {
    it('creates sentinel record in conversations store', async () => {
      await checker.writeSentinel();

      // Verify sentinel exists by direct IDB read
      const sentinel = await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction('conversations', 'readonly');
        const req = tx.objectStore('conversations').get(SENTINEL_ID);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      expect(sentinel).toBeDefined();
      expect((sentinel as { id: string }).id).toBe(SENTINEL_ID);
      expect((sentinel as { name: string }).name).toBe('__sentinel__');
    });

    it('subsequent check() reports sentinelPresent = true', async () => {
      await checker.writeSentinel();
      const report = await checker.check();
      expect(report.sentinelPresent).toBe(true);
    });

    it('is idempotent (calling twice does not error)', async () => {
      await checker.writeSentinel();
      await checker.writeSentinel();

      const report = await checker.check();
      expect(report.sentinelPresent).toBe(true);
      // Should still only have 0 conversations (sentinel excluded)
      expect(report.conversationCount).toBe(0);
    });
  });

  // ── cleanupOrphans() ───────────────────────────────────

  describe('cleanupOrphans()', () => {
    it('returns 0 for empty ids array with no IDB operations', async () => {
      const count = await checker.cleanupOrphans([]);
      expect(count).toBe(0);
    });

    it('deletes confirmed orphan messages and returns count', async () => {
      // Insert orphaned messages directly
      const orphanIds = ['orphan-1', 'orphan-2'];
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('messages', 'readwrite');
        const msgStore = tx.objectStore('messages');
        for (const id of orphanIds) {
          msgStore.put({
            id,
            conversationId: 'gone-conv',
            role: 'user',
            text: 'orphan',
            timestamp: Date.now(),
          });
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      const count = await checker.cleanupOrphans(orphanIds);

      expect(count).toBe(2);

      // Verify messages are gone
      const report = await checker.check();
      expect(report.messageCount).toBe(0);
      expect(report.orphanedMessageIds).toEqual([]);
    });

    it('skips messages that gained a conversation since detection (re-verification)', async () => {
      // Create a message that looks orphaned
      const msgId = 'maybe-orphan';
      const convId = 'new-conv';

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('messages', 'readwrite');
        tx.objectStore('messages').put({
          id: msgId,
          conversationId: convId,
          role: 'user',
          text: 'Was orphan, now has parent',
          timestamp: Date.now(),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      // Now create the conversation that the message belongs to
      // (simulating: conversation was created between check() and cleanupOrphans())
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('conversations', 'readwrite');
        tx.objectStore('conversations').put({
          id: convId,
          name: 'Restored',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      const count = await checker.cleanupOrphans([msgId]);

      // Should not delete because re-verification finds the conversation exists
      expect(count).toBe(0);

      // Message should still exist
      const report = await checker.check();
      expect(report.messageCount).toBe(1);
      expect(report.orphanedMessageIds).toEqual([]);
    });

    it('handles mix of valid and stale orphans correctly', async () => {
      const realOrphanId = 'real-orphan';
      const staleOrphanId = 'stale-orphan';
      const existingConvId = 'existing-conv';

      // Insert real orphan (conversationId points to nothing)
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('messages', 'readwrite');
        const msgStore = tx.objectStore('messages');
        msgStore.put({
          id: realOrphanId,
          conversationId: 'gone-forever',
          role: 'user',
          text: 'real orphan',
          timestamp: Date.now(),
        });
        msgStore.put({
          id: staleOrphanId,
          conversationId: existingConvId,
          role: 'user',
          text: 'not really an orphan',
          timestamp: Date.now(),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      // Create conversation for the stale orphan
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('conversations', 'readwrite');
        tx.objectStore('conversations').put({
          id: existingConvId,
          name: 'Exists',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      const count = await checker.cleanupOrphans([
        realOrphanId,
        staleOrphanId,
      ]);

      // Only the real orphan should be deleted
      expect(count).toBe(1);

      // Check remaining state
      const report = await checker.check();
      expect(report.messageCount).toBe(1); // stale orphan kept
      expect(report.orphanedMessageIds).toEqual([]); // no orphans left
    });
  });
});
