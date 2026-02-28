import 'fake-indexeddb/auto';
import { openDB, closeDB, isIndexedDBAvailable, DB_NAME, DB_VERSION } from '../persistence/db';

// Use unique DB names per test to avoid version conflicts with fake-indexeddb.
// We override the DB_NAME by directly calling indexedDB.open with the same schema logic.
// Instead, we just close and delete after each test.

describe('db', () => {
  let db: IDBDatabase;

  afterEach(() => {
    if (db) {
      closeDB(db);
    }
    // Delete the database to avoid version conflicts between tests
    indexedDB.deleteDatabase(DB_NAME);
  });

  it('openDB() resolves with an IDBDatabase instance', async () => {
    db = await openDB();
    expect(db).toBeInstanceOf(IDBDatabase);
    expect(db.name).toBe(DB_NAME);
    expect(db.version).toBe(DB_VERSION);
  });

  it('openDB() creates conversations object store with id keyPath', async () => {
    db = await openDB();
    expect(db.objectStoreNames.contains('conversations')).toBe(true);

    const tx = db.transaction('conversations', 'readonly');
    const store = tx.objectStore('conversations');
    expect(store.keyPath).toBe('id');
  });

  it('openDB() creates messages object store with id keyPath', async () => {
    db = await openDB();
    expect(db.objectStoreNames.contains('messages')).toBe(true);

    const tx = db.transaction('messages', 'readonly');
    const store = tx.objectStore('messages');
    expect(store.keyPath).toBe('id');
  });

  it('openDB() creates by-conversation index on messages store', async () => {
    db = await openDB();
    const tx = db.transaction('messages', 'readonly');
    const store = tx.objectStore('messages');

    expect(store.indexNames.contains('by-conversation')).toBe(true);
    const index = store.index('by-conversation');
    expect(index.keyPath).toBe('conversationId');
  });

  it('openDB() creates by-updatedAt index on conversations store', async () => {
    db = await openDB();
    const tx = db.transaction('conversations', 'readonly');
    const store = tx.objectStore('conversations');

    expect(store.indexNames.contains('by-updatedAt')).toBe(true);
    const index = store.index('by-updatedAt');
    expect(index.keyPath).toBe('updatedAt');
  });

  it('isIndexedDBAvailable() returns true when indexedDB exists', () => {
    expect(isIndexedDBAvailable()).toBe(true);
  });
});
