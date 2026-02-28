// ── Cross-context sync types ───────────────────────────────
// Typed messages for real-time sync between glasses WebView and hub tab.

export type SyncOrigin = 'glasses' | 'hub';

export type SyncMessage =
  | { type: 'session:created'; origin: SyncOrigin; session: { id: string; name: string } }
  | { type: 'session:renamed'; origin: SyncOrigin; sessionId: string; name: string }
  | { type: 'session:deleted'; origin: SyncOrigin; sessionId: string }
  | { type: 'session:switched'; origin: SyncOrigin; sessionId: string }
  | { type: 'message:added'; origin: SyncOrigin; conversationId: string; role: string; text: string }
  | { type: 'conversation:named'; origin: SyncOrigin; conversationId: string; name: string };

export interface SyncBridge {
  postMessage(msg: SyncMessage): void;
  onMessage(handler: (msg: SyncMessage) => void): () => void;
  destroy(): void;
}
