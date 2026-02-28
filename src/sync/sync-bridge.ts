// ── Sync bridge ────────────────────────────────────────────
// Cross-context message passing between glasses WebView and hub tab.
// Primary transport: BroadcastChannel (same-origin, low latency).
// Fallback: localStorage storage event (wider compatibility).
// Uses the factory/closure pattern consistent with the codebase.

import type { SyncBridge, SyncMessage } from './sync-types';

const CHANNEL_NAME = 'openclaw-sync';
const LS_KEY = 'openclaw-sync-msg';

// ── BroadcastChannel transport ─────────────────────────────

function createBroadcastChannelBridge(): SyncBridge {
  const channel = new BroadcastChannel(CHANNEL_NAME);
  const handlers = new Set<(msg: SyncMessage) => void>();

  channel.onmessage = (event: MessageEvent) => {
    const msg = event.data as SyncMessage;
    for (const handler of handlers) {
      handler(msg);
    }
  };

  function postMessage(msg: SyncMessage): void {
    channel.postMessage(msg);
  }

  function onMessage(handler: (msg: SyncMessage) => void): () => void {
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }

  function destroy(): void {
    handlers.clear();
    channel.onmessage = null;
    channel.close();
  }

  return { postMessage, onMessage, destroy };
}

// ── localStorage fallback transport ────────────────────────

function createLocalStorageBridge(): SyncBridge {
  const handlers = new Set<(msg: SyncMessage) => void>();

  function storageListener(event: StorageEvent): void {
    if (event.key !== LS_KEY || !event.newValue) return;

    try {
      const msg = JSON.parse(event.newValue) as SyncMessage;
      for (const handler of handlers) {
        handler(msg);
      }
    } catch {
      // Ignore malformed JSON
    }
  }

  window.addEventListener('storage', storageListener);

  function postMessage(msg: SyncMessage): void {
    localStorage.setItem(LS_KEY, JSON.stringify(msg));
    localStorage.removeItem(LS_KEY);
  }

  function onMessage(handler: (msg: SyncMessage) => void): () => void {
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }

  function destroy(): void {
    handlers.clear();
    window.removeEventListener('storage', storageListener);
  }

  return { postMessage, onMessage, destroy };
}

// ── Factory with feature detection ─────────────────────────

export function createSyncBridge(): SyncBridge {
  if (typeof BroadcastChannel !== 'undefined') {
    return createBroadcastChannelBridge();
  }
  return createLocalStorageBridge();
}
