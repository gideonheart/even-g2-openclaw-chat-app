// ── Replay client ───────────────────────────────────────────
// Fetches missed gateway events from replay endpoints and maps them
// to VoiceTurnChunks for the existing chunk pipeline. Used by
// glasses-main resume sync after visibility hidden -> visible.

import type { ReplayEvent, VoiceTurnChunk } from '../types';

/**
 * Fetch all events for a session after a given sequence number.
 * Returns an empty array on any error (replay is best-effort).
 */
export async function fetchSessionReplay(
  gatewayUrl: string,
  sessionKey: string,
  afterSeq?: number,
): Promise<ReplayEvent[]> {
  try {
    const url = `${gatewayUrl}/api/sessions/${sessionKey}/events${afterSeq != null ? '?afterSeq=' + afterSeq : ''}`;
    const resp = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return [];
    return (await resp.json()) as ReplayEvent[];
  } catch {
    return [];
  }
}

/**
 * Fetch all events for a specific turn after a given sequence number.
 * Returns an empty array on any error (replay is best-effort).
 */
export async function fetchTurnReplay(
  gatewayUrl: string,
  turnId: string,
  afterSeq?: number,
): Promise<ReplayEvent[]> {
  try {
    const url = `${gatewayUrl}/api/turns/${turnId}/events${afterSeq != null ? '?afterSeq=' + afterSeq : ''}`;
    const resp = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return [];
    return (await resp.json()) as ReplayEvent[];
  } catch {
    return [];
  }
}

/**
 * Map replay events to VoiceTurnChunks and emit them through the
 * provided callback. Returns the highest `seq` seen, or -1 if empty.
 *
 * Mirrors handleServerSentEvent mapping in gateway-client.ts:
 *   transcript      -> { type: 'transcript', text, turnId }
 *   assistant_delta -> { type: 'response_start' } (first per turnId), then { type: 'response_delta', text, turnId }
 *   done            -> { type: 'response_end', turnId }
 *   error           -> { type: 'error', error }
 *
 * Tracks "has emitted response_start" PER turnId (replays may span multiple turns).
 */
export function replayEventsAsChunks(
  events: ReplayEvent[],
  emitChunkCallback: (chunk: VoiceTurnChunk) => void,
): number {
  if (events.length === 0) return -1;

  let highestSeq = -1;
  const responseStartEmitted = new Set<string>();

  for (const event of events) {
    if (event.seq > highestSeq) highestSeq = event.seq;

    const payload = event.payload as Record<string, unknown>;

    switch (event.type) {
      case 'transcript':
        emitChunkCallback({
          type: 'transcript',
          text: payload.transcript as string,
          turnId: event.turnId,
        });
        break;

      case 'assistant_delta':
        if (!responseStartEmitted.has(event.turnId)) {
          emitChunkCallback({ type: 'response_start', turnId: event.turnId });
          responseStartEmitted.add(event.turnId);
        }
        emitChunkCallback({
          type: 'response_delta',
          text: payload.text as string,
          turnId: event.turnId,
        });
        break;

      case 'done':
        emitChunkCallback({
          type: 'response_end',
          turnId: event.turnId,
        });
        break;

      case 'error':
        emitChunkCallback({
          type: 'error',
          error: payload.error as string,
        });
        break;

      // Unknown event types are silently skipped
    }
  }

  return highestSeq;
}
