// ── Failure injection helpers ───────────────────────────────
// Reusable wrappers for simulating persistence and sync failures in tests.
// These helpers wrap real ConversationStore and SyncBridge instances with
// interceptors that inject failures at configurable points.
//
// Usage:
//   const failStore = createFailingStore(realStore, 2);  // fails after 2 writes
//   const quotaStore = createQuotaExceededStore(realStore);  // always fails
//   const lossyBridge = createLossySyncBridge(realBridge, 3);  // drops every 3rd msg

import type { ConversationStore } from '../../persistence/types';
import type { SyncBridge, SyncMessage } from '../../sync/sync-types';

// ── createFailingStore ───────────────────────────────────────
/**
 * Wraps a real ConversationStore and throws after N write operations.
 *
 * Write operations counted: addMessage, createConversation
 * Read operations pass through unchanged: getConversation, getAllConversations,
 * getMessages, getMessage, getLastConversation, searchMessages, countMessages,
 * verifyMessage, updateConversation
 *
 * @param realStore - The underlying real ConversationStore to delegate to
 * @param failAfterN - Number of successful writes before failures begin
 * @returns A ConversationStore that throws DOMException('AbortError') after N writes
 */
export function createFailingStore(
  realStore: ConversationStore,
  failAfterN: number,
): ConversationStore {
  let writeCount = 0;

  return {
    ...realStore,

    createConversation: async (...args) => {
      writeCount++;
      if (writeCount > failAfterN) {
        throw new DOMException('Simulated write failure', 'AbortError');
      }
      return realStore.createConversation(...args);
    },

    addMessage: async (...args) => {
      writeCount++;
      if (writeCount > failAfterN) {
        throw new DOMException('Simulated write failure', 'AbortError');
      }
      return realStore.addMessage(...args);
    },
  };
}

// ── createQuotaExceededStore ─────────────────────────────────
/**
 * Wraps a real ConversationStore and always throws QuotaExceededError on writes.
 *
 * Simulates storage quota exhaustion. Useful for testing quota-exceeded error paths
 * without needing to fill actual storage.
 *
 * @param realStore - The underlying real ConversationStore for read pass-throughs
 * @returns A ConversationStore where all writes throw DOMException('QuotaExceededError')
 */
export function createQuotaExceededStore(
  realStore: ConversationStore,
): ConversationStore {
  return {
    ...realStore,

    createConversation: async () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    },

    addMessage: async () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    },
  };
}

// ── createLossySyncBridge ────────────────────────────────────
/**
 * Wraps a real SyncBridge and silently drops every Nth message.
 *
 * Used to simulate unreliable sync channels (e.g., BroadcastChannel drops under load).
 * Every Nth postMessage call is silently dropped (not forwarded to the real bridge).
 * onMessage and destroy delegate to the real bridge unchanged.
 *
 * @param realBridge - The underlying real SyncBridge to delegate to
 * @param dropEveryN - Drop every Nth message (e.g., 3 = drop messages 3, 6, 9, ...)
 * @returns A SyncBridge that silently drops every Nth postMessage call
 */
export function createLossySyncBridge(
  realBridge: SyncBridge,
  dropEveryN: number,
): SyncBridge {
  let msgCount = 0;

  return {
    postMessage: (msg: SyncMessage) => {
      msgCount++;
      if (msgCount % dropEveryN === 0) return; // silently dropped
      realBridge.postMessage(msg);
    },

    onMessage: realBridge.onMessage.bind(realBridge),
    destroy: realBridge.destroy.bind(realBridge),
  };
}
