// ── IndexedDB wrapper ──────────────────────────────────────
// Thin typed wrapper around the native IndexedDB API.
// Opens the database, defines the schema, and provides helpers.

export const DB_NAME = 'openclaw-chat';
export const DB_VERSION = 1;

/**
 * Opens the IndexedDB database, creating object stores on first run
 * or when the version is bumped.
 */
export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const oldVersion = event.oldVersion;

      // v0 -> v1: initial schema
      if (oldVersion < 1) {
        const convStore = db.createObjectStore('conversations', {
          keyPath: 'id',
        });
        convStore.createIndex('by-updatedAt', 'updatedAt', { unique: false });

        const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
        msgStore.createIndex('by-conversation', 'conversationId', {
          unique: false,
        });
      }
    };

    request.onblocked = () => {
      console.warn('[db] Database upgrade blocked by another tab');
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Closes the database connection. */
export function closeDB(db: IDBDatabase): void {
  db.close();
}

/** Checks whether IndexedDB is available in the current environment. */
export function isIndexedDBAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}
