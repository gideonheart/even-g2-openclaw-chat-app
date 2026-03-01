// ── IDB integrity flow integration tests ─────────────────────
// Integration tests that verify the IDB integrity check and closure flow.
// Composes real modules (ConversationStore, IntegrityChecker) with
// forceCloseDatabase from fake-indexeddb.
//
// CRITICAL: 'fake-indexeddb/auto' MUST be the first import.
// Each test opens a fresh DB and afterEach closes + deletes it.

import 'fake-indexeddb/auto';
import { forceCloseDatabase } from 'fake-indexeddb';
import { openDB, closeDB, DB_NAME } from '../../persistence/db';
import { createConversationStore } from '../../persistence/conversation-store';
import { createIntegrityChecker } from '../../persistence/integrity-checker';
import { createFailingStore } from '../helpers/failure-helpers';

describe('IDB integrity flow integration', () => {
  let db: IDBDatabase;

  afterEach(() => {
    try { closeDB(db); } catch { /* may already be closed */ }
    indexedDB.deleteDatabase(DB_NAME);
  });

  // ── Test 1: forceCloseDatabase triggers onclose callback ──

  it('forceCloseDatabase triggers onclose callback', async () => {
    db = await openDB();

    const onClose = vi.fn();
    db.onclose = onClose;

    forceCloseDatabase(db);

    expect(onClose).toHaveBeenCalledOnce();
  });

  // ── Test 2: Store operations fail after database closure ──

  it('store operations fail after database closure', async () => {
    db = await openDB();
    const store = createConversationStore(db);

    // Verify store works before closure
    const conv = await store.createConversation('Before close');
    expect(conv.name).toBe('Before close');

    // Close database forcefully
    forceCloseDatabase(db);

    // Store operations should fail after closure
    await expect(store.createConversation('After close')).rejects.toThrow();
  });

  // ── Test 3: Integrity checker detects orphaned messages ──

  it('integrity checker detects orphaned messages', async () => {
    db = await openDB();
    const store = createConversationStore(db);

    // Create a conversation and add 2 messages to it
    const conv = await store.createConversation('Orphan parent');
    await store.addMessage(conv.id, { role: 'user', text: 'Message 1', timestamp: Date.now() });
    await store.addMessage(conv.id, { role: 'assistant', text: 'Message 2', timestamp: Date.now() });

    // Verify messages exist
    const messagesBeforeDelete = await store.getMessages(conv.id);
    expect(messagesBeforeDelete).toHaveLength(2);

    // Manually delete the conversation record from IDB using a raw transaction
    // leaving messages orphaned (no parent conversation)
    const tx = db.transaction('conversations', 'readwrite');
    tx.objectStore('conversations').delete(conv.id);
    await new Promise<void>((r) => { tx.oncomplete = () => r(); });

    // Create integrity checker and run check
    const checker = createIntegrityChecker(db);
    const report = await checker.check();

    // Should detect orphaned messages
    expect(report.orphanedMessageIds.length).toBeGreaterThan(0);

    // Run cleanup to delete orphans
    const deletedCount = await checker.cleanupOrphans(report.orphanedMessageIds);
    expect(deletedCount).toBe(2);

    // Verify messages are now gone
    const messagesAfterCleanup = await store.getMessages(conv.id);
    expect(messagesAfterCleanup).toHaveLength(0);
  });

  // ── Test 4: Integrity checker reports clean state ──

  it('integrity checker reports clean state for valid data', async () => {
    db = await openDB();
    const store = createConversationStore(db);

    // Create a conversation and add a message
    const conv = await store.createConversation('Valid conversation');
    await store.addMessage(conv.id, { role: 'user', text: 'Hello', timestamp: Date.now() });

    // Create integrity checker and run check
    const checker = createIntegrityChecker(db);
    const report = await checker.check();

    // Should report no orphans and no issues
    expect(report.orphanedMessageIds).toHaveLength(0);
    expect(report.conversationCount).toBeGreaterThan(0);
    expect(report.messageCount).toBeGreaterThan(0);
  });

  // ── Test 5: createFailingStore allows N writes then fails ──

  it('createFailingStore allows N writes then fails', async () => {
    db = await openDB();
    const realStore = createConversationStore(db);

    // Wrap with createFailingStore(realStore, 2): first 2 writes succeed, 3rd fails
    const failStore = createFailingStore(realStore, 2);

    // First write (writeCount=1 <= 2): should succeed
    const conv = await failStore.createConversation('First conv');
    expect(conv.name).toBe('First conv');

    // Second write (writeCount=2 <= 2): should succeed
    const msgId = await failStore.addMessage(conv.id, {
      role: 'user',
      text: 'First message',
      timestamp: Date.now(),
    });
    expect(typeof msgId).toBe('string');

    // Third write (writeCount=3 > 2): should fail
    await expect(
      failStore.addMessage(conv.id, { role: 'assistant', text: 'Will fail', timestamp: Date.now() }),
    ).rejects.toThrow();

    // Reads still work even after write failures (pass through to real store)
    const messages = await failStore.getMessages(conv.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('First message');
  });
});
