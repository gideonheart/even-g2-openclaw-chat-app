// ── Integrity Checker ────────────────────────────────────
// Boot-time data integrity verification for IndexedDB.
// check() is read-only. writeSentinel() and cleanupOrphans() are explicit mutations.
// Uses IDB callback pattern (no async/await in transactions) for Safari safety.

import { SENTINEL_ID } from './conversation-store';
import type { ConversationRecord } from './types';

export interface IntegrityReport {
  orphanedMessageIds: string[];
  danglingPointer: boolean;
  sentinelPresent: boolean;
  conversationCount: number;
  messageCount: number;
  checkedAt: number;
}

export interface IntegrityChecker {
  check(): Promise<IntegrityReport>;
  cleanupOrphans(ids: string[]): Promise<number>;
  writeSentinel(): Promise<void>;
}

export function createIntegrityChecker(db: IDBDatabase): IntegrityChecker {
  function check(): Promise<IntegrityReport> {
    return new Promise((resolve, reject) => {
      const report: IntegrityReport = {
        orphanedMessageIds: [],
        danglingPointer: false,
        sentinelPresent: false,
        conversationCount: 0,
        messageCount: 0,
        checkedAt: Date.now(),
      };

      const tx = db.transaction(['conversations', 'messages'], 'readonly');
      const convStore = tx.objectStore('conversations');
      const msgStore = tx.objectStore('messages');

      // Load all conversation IDs into a Set (keys only -- fast, no deserialization)
      const convIds = new Set<string>();
      const keysReq = convStore.getAllKeys();

      keysReq.onsuccess = () => {
        for (const key of keysReq.result as string[]) {
          if (key === SENTINEL_ID) {
            report.sentinelPresent = true;
          } else {
            convIds.add(key);
          }
        }
        report.conversationCount = convIds.size;

        // Scan messages for orphans via cursor (need conversationId from value)
        const cursorReq = msgStore.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            report.messageCount++;
            const msg = cursor.value;
            if (!convIds.has(msg.conversationId)) {
              report.orphanedMessageIds.push(msg.id);
            }
            cursor.continue();
          }
        };
      };

      // Check dangling localStorage pointer (after convIds populated)
      tx.oncomplete = () => {
        try {
          const savedId = localStorage.getItem(
            'openclaw-active-conversation',
          );
          if (savedId && !convIds.has(savedId)) {
            report.danglingPointer = true;
          }
        } catch {
          // localStorage unavailable -- skip dangling pointer check
        }
        resolve(report);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  function writeSentinel(): Promise<void> {
    return new Promise((resolve, reject) => {
      const now = Date.now();
      const sentinel: ConversationRecord = {
        id: SENTINEL_ID,
        name: '__sentinel__',
        createdAt: now,
        updatedAt: now,
      };
      const tx = db.transaction('conversations', 'readwrite');
      tx.objectStore('conversations').put(sentinel);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function cleanupOrphans(ids: string[]): Promise<number> {
    if (ids.length === 0) return Promise.resolve(0);

    // Phase 1: Re-verify orphan status in a new readonly transaction
    return new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(
        ['conversations', 'messages'],
        'readonly',
      );
      const convStore = tx.objectStore('conversations');
      const msgStore = tx.objectStore('messages');
      const convIds = new Set<string>();
      const confirmed: string[] = [];

      const keysReq = convStore.getAllKeys();
      keysReq.onsuccess = () => {
        for (const key of keysReq.result as string[]) {
          convIds.add(key);
        }

        // Check each suspected orphan
        for (const id of ids) {
          const getReq = msgStore.get(id);
          getReq.onsuccess = () => {
            if (
              getReq.result &&
              !convIds.has(getReq.result.conversationId)
            ) {
              confirmed.push(id);
            }
          };
        }
      };

      tx.oncomplete = () => resolve(confirmed);
      tx.onerror = () => reject(tx.error);
    }).then((confirmed) => {
      if (confirmed.length === 0) return 0;

      // Phase 2: Delete confirmed orphans in a readwrite transaction
      return new Promise<number>((resolve, reject) => {
        const tx = db.transaction('messages', 'readwrite');
        const msgStore = tx.objectStore('messages');
        for (const id of confirmed) {
          msgStore.delete(id);
        }
        tx.oncomplete = () => resolve(confirmed.length);
        tx.onerror = () => reject(tx.error);
      });
    });
  }

  return { check, cleanupOrphans, writeSentinel };
}
