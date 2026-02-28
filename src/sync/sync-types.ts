// ── Cross-context sync types ───────────────────────────────
// Typed messages for real-time sync between glasses WebView and hub tab.

export type SyncOrigin = 'glasses' | 'hub';

export type SyncMessage =
  | { type: 'session:created'; origin: SyncOrigin; seq?: number; session: { id: string; name: string } }
  | { type: 'session:renamed'; origin: SyncOrigin; seq?: number; sessionId: string; name: string }
  | { type: 'session:deleted'; origin: SyncOrigin; seq?: number; sessionId: string }
  | { type: 'session:switched'; origin: SyncOrigin; seq?: number; sessionId: string }
  | { type: 'message:added'; origin: SyncOrigin; seq?: number; conversationId: string; role: string; text: string }
  | { type: 'conversation:named'; origin: SyncOrigin; seq?: number; conversationId: string; name: string }
  | { type: 'streaming:start'; origin: SyncOrigin; seq?: number; conversationId: string }
  | { type: 'streaming:end'; origin: SyncOrigin; seq?: number; conversationId: string }
  | { type: 'sync:heartbeat'; origin: SyncOrigin; seq?: number; messageCount: number; conversationId: string };

export interface SyncBridge {
  postMessage(msg: SyncMessage): void;
  onMessage(handler: (msg: SyncMessage) => void): () => void;
  destroy(): void;
}

export interface SyncMonitor {
  startHeartbeat(): void;
  stopHeartbeat(): void;
  destroy(): void;
  getStats(): SyncMonitorStats;
  /** Returns true if a heartbeat was received within the last 30s. Returns true if no heartbeat has ever been received (peer may not have started yet). */
  isAlive(): boolean;
}

export interface SyncMonitorStats {
  heartbeatSeq: number;
  lastRemoteSeq: number;
  heartbeatGaps: number;
  lastReceivedAt: number;
  heartbeatActive: boolean;
}

export interface DriftReconciler {
  handleHeartbeat(conversationId: string, remoteCount: number): Promise<boolean>;
  destroy(): void;
}
