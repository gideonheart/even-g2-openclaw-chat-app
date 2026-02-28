// ── Auto-save -- event bus subscriber that persists messages to IndexedDB ──
//
// Subscribes to gateway:chunk events. Saves user messages on 'transcript',
// assistant messages on 'response_end'. Fire-and-forget with retry logic.
//
// RES-06: First-write verification (read-back via separate readonly tx)
// RES-07: Error escalation (persistence:error after retry exhaustion)
// RES-08: Partial response preservation on error chunk

import type { EventBus } from '../events';
import type { AppEventMap } from '../types';
import type { ConversationStore } from './types';
import type { SyncBridge } from '../sync/sync-types';
import { generateConversationName } from './conversation-store';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

export interface AutoSaveOptions {
  bus: EventBus<AppEventMap>;
  store: ConversationStore;
  getConversationId: () => string;
  /** Called when auto-naming triggers on first user message */
  onConversationNamed?: (name: string) => void;
  /** Optional sync bridge for cross-context message notifications */
  syncBridge?: SyncBridge;
}

export interface AutoSave {
  destroy(): void;
}

export function createAutoSave(opts: AutoSaveOptions): AutoSave {
  const { bus, store, getConversationId, onConversationNamed, syncBridge } = opts;
  const unsubs: Array<() => void> = [];

  let pendingAssistantText = '';
  let hasUserMessage = false;
  let storageVerified = false;

  // RES-06: Verify first write via separate read-back
  async function verifyFirstWrite(messageId: string): Promise<void> {
    if (storageVerified) return;

    const exists = await store.verifyMessage(messageId);
    if (exists) {
      storageVerified = true;
    } else {
      bus.emit('persistence:error', {
        type: 'verify-failed',
        recoverable: false,
        message: 'Storage verification failed -- first message not readable',
        conversationId: getConversationId(),
      });
    }
  }

  // RES-07: Enhanced saveWithRetry with error escalation
  async function saveWithRetry(
    operation: () => Promise<unknown>,
    context?: { conversationId: string },
  ): Promise<boolean> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await operation();
        return true;
      } catch {
        if (attempt < MAX_RETRIES) {
          await new Promise((r) =>
            setTimeout(r, RETRY_DELAY_MS * (attempt + 1)),
          );
        }
      }
    }

    // RES-07: Emit persistence:error after all retries exhausted
    bus.emit('persistence:error', {
      type: 'write-failed',
      recoverable: false,
      message: 'Failed to save message after retries',
      conversationId: context?.conversationId,
    });

    return false;
  }

  // RES-06: Reset verification flag on persistence:warning
  unsubs.push(bus.on('persistence:warning', () => {
    storageVerified = false;
  }));

  unsubs.push(
    bus.on('gateway:chunk', (chunk) => {
      switch (chunk.type) {
        case 'transcript': {
          const convId = getConversationId();
          const text = chunk.text!;
          const isFirst = !hasUserMessage;
          hasUserMessage = true;

          // Capture message ID for verification
          let lastSavedId = '';

          // Fire-and-forget save
          saveWithRetry(
            async () => { lastSavedId = await store.addMessage(convId, {
              role: 'user',
              text,
              timestamp: Date.now(),
            }); },
            { conversationId: convId },
          ).then((ok) => {
            // RES-06: Verify first write
            if (ok && !storageVerified) {
              verifyFirstWrite(lastSavedId);
            }
            if (ok && syncBridge) {
              syncBridge.postMessage({
                type: 'message:added',
                origin: 'glasses',
                conversationId: convId,
                role: 'user',
                text,
              });
            }
            if (!ok) {
              bus.emit('persistence:warning', {
                message: 'Messages may not be saved',
              });
            }
          });

          // Auto-name conversation from first user message
          if (isFirst) {
            const name = generateConversationName(text);
            store
              .updateConversation(convId, { name })
              .then(() => {
                onConversationNamed?.(name);
              })
              .catch(() => {
                // Silent failure on naming -- non-critical
              });
          }
          break;
        }

        case 'response_start':
          if (syncBridge) {
            syncBridge.postMessage({
              type: 'streaming:start',
              origin: 'glasses',
              conversationId: getConversationId(),
            });
          }
          break;

        case 'response_delta':
          pendingAssistantText += chunk.text ?? '';
          break;

        case 'response_end': {
          if (pendingAssistantText) {
            const convId = getConversationId();
            const text = pendingAssistantText;
            pendingAssistantText = '';

            saveWithRetry(
              () => store.addMessage(convId, {
                role: 'assistant',
                text,
                timestamp: Date.now(),
              }),
              { conversationId: convId },
            ).then((ok) => {
              if (ok && syncBridge) {
                syncBridge.postMessage({
                  type: 'message:added',
                  origin: 'glasses',
                  conversationId: convId,
                  role: 'assistant',
                  text,
                });
                syncBridge.postMessage({
                  type: 'streaming:end',
                  origin: 'glasses',
                  conversationId: convId,
                });
              }
              if (!ok) {
                bus.emit('persistence:warning', {
                  message: 'Messages may not be saved',
                });
              }
            });
          }
          break;
        }

        case 'error': {
          // RES-08: Save partial response with interruption marker
          if (pendingAssistantText) {
            const convId = getConversationId();
            const text = pendingAssistantText + ' [response interrupted]';
            pendingAssistantText = '';
            saveWithRetry(
              () => store.addMessage(convId, { role: 'assistant', text, timestamp: Date.now() }),
              { conversationId: convId },
            ).then((ok) => {
              if (ok && syncBridge) {
                syncBridge.postMessage({
                  type: 'message:added',
                  origin: 'glasses',
                  conversationId: convId,
                  role: 'assistant',
                  text,
                });
              }
            });
          } else {
            pendingAssistantText = '';
          }

          if (syncBridge) {
            syncBridge.postMessage({
              type: 'streaming:end',
              origin: 'glasses',
              conversationId: getConversationId(),
            });
          }
          break;
        }
      }
    }),
  );

  function destroy(): void {
    for (const unsub of unsubs) {
      unsub();
    }
    unsubs.length = 0;
    pendingAssistantText = '';
  }

  return { destroy };
}
