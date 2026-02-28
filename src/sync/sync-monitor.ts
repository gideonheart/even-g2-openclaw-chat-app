// ── Sync monitor ───────────────────────────────────────────
// Observer-wrapper around SyncBridge that adds monotonic sequence numbers,
// heartbeat emission, gap detection, and peer liveness tracking.
// Zero new dependencies -- uses existing SyncBridge interface.

import type { SyncBridge, SyncMessage, SyncMonitor, SyncMonitorStats, SyncOrigin } from './sync-types';

const HEARTBEAT_INTERVAL_MS = 10_000;
const ALIVE_TIMEOUT_MS = 30_000;

export function createSyncMonitor(opts: {
  bridge: SyncBridge;
  store: { countMessages(conversationId: string): Promise<number> };
  origin: SyncOrigin;
  getActiveConversationId: () => string;
  onHeartbeat?: (conversationId: string, remoteCount: number) => void;
}): SyncMonitor {
  const { bridge, store, origin, getActiveConversationId, onHeartbeat } = opts;

  let localSeq = 0;
  let lastRemoteSeq = -1;
  let lastReceivedAt = 0;
  let sequenceGaps = 0;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // ── Send with seq ──────────────────────────────────────

  function send(msg: SyncMessage): void {
    localSeq += 1;
    bridge.postMessage({ ...msg, seq: localSeq });
  }

  // ── Incoming message handler ───────────────────────────

  function handleIncoming(msg: SyncMessage): void {
    // Ignore own-origin messages
    if (msg.origin === origin) return;

    lastReceivedAt = Date.now();

    // Sequence tracking
    if (msg.seq !== undefined) {
      if (lastRemoteSeq >= 0 && msg.seq > lastRemoteSeq + 1) {
        // Gap detected
        sequenceGaps += msg.seq - lastRemoteSeq - 1;
      } else if (lastRemoteSeq >= 0 && msg.seq <= lastRemoteSeq) {
        // Peer reboot -- reset tracking, do NOT increase gaps
        // (seq went lower than last seen)
      }
      lastRemoteSeq = msg.seq;
    }

    // Heartbeat callback
    if (msg.type === 'sync:heartbeat' && onHeartbeat) {
      onHeartbeat(msg.conversationId, msg.messageCount);
    }
  }

  const unsubscribe = bridge.onMessage(handleIncoming);

  // ── Heartbeat ──────────────────────────────────────────

  function startHeartbeat(): void {
    if (heartbeatTimer !== null) return;
    heartbeatTimer = setInterval(async () => {
      const conversationId = getActiveConversationId();
      if (!conversationId) return;

      const messageCount = await store.countMessages(conversationId);
      send({
        type: 'sync:heartbeat',
        origin,
        messageCount,
        conversationId,
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  // ── Lifecycle ──────────────────────────────────────────

  function destroy(): void {
    stopHeartbeat();
    unsubscribe();
  }

  function getStats(): SyncMonitorStats {
    return {
      localSeq,
      lastRemoteSeq,
      sequenceGaps,
      lastReceivedAt,
      heartbeatActive: heartbeatTimer !== null,
    };
  }

  function isAlive(): boolean {
    if (lastReceivedAt === 0) return true; // No heartbeat ever received -- peer may not have started yet
    return Date.now() - lastReceivedAt < ALIVE_TIMEOUT_MS;
  }

  return { send, startHeartbeat, stopHeartbeat, destroy, getStats, isAlive };
}
