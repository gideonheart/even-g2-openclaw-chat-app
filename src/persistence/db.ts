// ── IndexedDB wrapper ──────────────────────────────────────
// Thin typed wrapper around the native IndexedDB API.
// Opens the database, defines the schema, and provides helpers.

export const DB_NAME = 'openclaw-chat';
export const DB_VERSION = 1;

// ── Module-level state for unexpected close handling ──────
let onUnexpectedClose: (() => void) | null = null;
let reopenAttempts = 0;
const MAX_REOPEN_ATTEMPTS = 3;
const REOPEN_DELAY_MS = 1000;

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

    request.onsuccess = () => {
      const db = request.result;
      db.onclose = () => {
        if (onUnexpectedClose) onUnexpectedClose();
      };
      resolve(db);
    };
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

/**
 * Register a callback to be invoked when the database is unexpectedly closed.
 * Boot code uses this to emit `persistence:error` with type 'database-closed'.
 */
export function setOnUnexpectedClose(cb: () => void): void {
  onUnexpectedClose = cb;
}

/**
 * Attempt to reopen the database after an unexpected closure.
 * Retries up to MAX_REOPEN_ATTEMPTS times with REOPEN_DELAY_MS cooldown.
 * Resets the attempt counter on success.
 */
export function reopenDB(): Promise<IDBDatabase> {
  if (reopenAttempts >= MAX_REOPEN_ATTEMPTS) {
    return Promise.reject(
      new Error(
        `Failed to reopen database after ${MAX_REOPEN_ATTEMPTS} attempts`,
      ),
    );
  }

  reopenAttempts++;

  return new Promise<void>((resolve) => {
    setTimeout(resolve, REOPEN_DELAY_MS);
  }).then(() => {
    return openDB().then((db) => {
      reopenAttempts = 0;
      return db;
    });
  });
}
