// ── Auto-save — event bus subscriber that persists messages to IndexedDB ──
//
// Subscribes to gateway:chunk events. Saves user messages on 'transcript',
// assistant messages on 'response_end'. Fire-and-forget with retry logic.

import type { EventBus } from '../events';
import type { AppEventMap } from '../types';
import type { ConversationStore } from './types';
import { generateConversationName } from './conversation-store';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

export interface AutoSaveOptions {
  bus: EventBus<AppEventMap>;
  store: ConversationStore;
  getConversationId: () => string;
  /** Called when auto-naming triggers on first user message */
  onConversationNamed?: (name: string) => void;
}

export interface AutoSave {
  destroy(): void;
}

export function createAutoSave(opts: AutoSaveOptions): AutoSave {
  const { bus, store, getConversationId, onConversationNamed } = opts;
  const unsubs: Array<() => void> = [];

  let pendingAssistantText = '';
  let hasUserMessage = false;

  async function saveWithRetry(
    operation: () => Promise<unknown>,
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
    return false;
  }

  unsubs.push(
    bus.on('gateway:chunk', (chunk) => {
      switch (chunk.type) {
        case 'transcript': {
          const convId = getConversationId();
          const text = chunk.text!;
          const isFirst = !hasUserMessage;
          hasUserMessage = true;

          // Fire-and-forget save
          saveWithRetry(() =>
            store.addMessage(convId, {
              role: 'user',
              text,
              timestamp: Date.now(),
            }),
          ).then((ok) => {
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

        case 'response_delta':
          pendingAssistantText += chunk.text ?? '';
          break;

        case 'response_end': {
          if (pendingAssistantText) {
            const convId = getConversationId();
            const text = pendingAssistantText;
            pendingAssistantText = '';

            saveWithRetry(() =>
              store.addMessage(convId, {
                role: 'assistant',
                text,
                timestamp: Date.now(),
              }),
            ).then((ok) => {
              if (!ok) {
                bus.emit('persistence:warning', {
                  message: 'Messages may not be saved',
                });
              }
            });
          }
          break;
        }

        case 'error':
          // Discard pending assistant text on error (don't save failed responses)
          pendingAssistantText = '';
          break;
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
