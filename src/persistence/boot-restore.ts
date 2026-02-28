// ── Boot restore — restores the last active conversation on app boot ──
//
// Handles all failure modes: no data, no IndexedDB, corrupted data.
// Returns a RestoreResult that the boot sequence uses to populate the display.

import type { ConversationStore, MessageRecord } from './types';

const ACTIVE_CONVERSATION_KEY = 'openclaw-active-conversation';

export interface RestoreResult {
  conversationId: string;
  messages: MessageRecord[];
  restored: boolean;
  storageAvailable: boolean;
  error?: string;
}

/**
 * Restores the last active conversation from IndexedDB, or creates a fresh one.
 * Returns a RestoreResult that the boot sequence uses to populate the display.
 *
 * - If store is null (IndexedDB unavailable): returns in-memory-only result
 * - If stored data is corrupted: returns fresh conversation with error message
 * - If no data exists: creates a new conversation
 * - If data exists: loads messages and returns them
 */
export async function restoreOrCreateConversation(opts: {
  store: ConversationStore | null;
}): Promise<RestoreResult> {
  const { store } = opts;

  // IndexedDB unavailable — in-memory only mode
  if (!store) {
    return {
      conversationId: crypto.randomUUID(),
      messages: [],
      restored: false,
      storageAvailable: false,
    };
  }

  try {
    // Try to find the last active conversation by ID in localStorage
    const savedId = readActiveConversationId();
    let conversation = savedId
      ? await store.getConversation(savedId)
      : undefined;

    // If no saved ID or saved conversation doesn't exist, try getLastConversation
    if (!conversation) {
      conversation = await store.getLastConversation();
    }

    if (conversation) {
      // Restore existing conversation
      const messages = await store.getMessages(conversation.id);
      writeActiveConversationId(conversation.id);
      return {
        conversationId: conversation.id,
        messages,
        restored: true,
        storageAvailable: true,
      };
    }

    // No existing data — create a fresh conversation
    const newConv = await store.createConversation();
    writeActiveConversationId(newConv.id);
    return {
      conversationId: newConv.id,
      messages: [],
      restored: false,
      storageAvailable: true,
    };
  } catch {
    // Corrupted data — start fresh
    return {
      conversationId: crypto.randomUUID(),
      messages: [],
      restored: false,
      storageAvailable: true,
      error: "Previous conversation couldn't be restored",
    };
  }
}

// ── localStorage helpers for active conversation pointer ──

function readActiveConversationId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_CONVERSATION_KEY);
  } catch {
    return null;
  }
}

function writeActiveConversationId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_CONVERSATION_KEY, id);
  } catch {
    // localStorage unavailable — silently continue
  }
}
