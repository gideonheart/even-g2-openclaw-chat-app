// ── VoiceLoopController — bridges gateway client events to the app event bus ──
//
// Subscribes to gateway.onChunk and gateway.onStatusChange, forwarding events
// to the typed bus. Listens for audio:recording-stop on the bus and enqueues
// voice turns into a bounded FIFO queue for sequential execution via the
// gateway client. Uses current settings (via getter) at send time.

import type { EventBus } from './events';
import type { AppEventMap, AppSettings } from './types';
import type { GatewayClient } from './api/gateway-client';
import { MIN_AUDIO_BYTES } from './audio/audio-capture';

export interface VoiceLoopController {
  destroy(): void;
  getQueueLength(): number;
}

export function createVoiceLoopController(opts: {
  bus: EventBus<AppEventMap>;
  gateway: GatewayClient;
  settings: () => AppSettings;
}): VoiceLoopController {
  const { bus, gateway, settings } = opts;
  const unsubs: Array<() => void> = [];

  // Voice turn queue -- ensures sequential execution, no abort of in-flight requests.
  // Gateway client calls abort() on every sendVoiceTurn, so concurrent sends would cancel
  // the in-flight turn. The queue holds pending turns and drains one at a time.
  const MAX_QUEUE = 5;
  interface PendingTurn { sessionId: string; blob: Blob }
  const pendingTurns: PendingTurn[] = [];
  let busy = false;

  function processQueue(): void {
    if (busy || pendingTurns.length === 0) return;
    busy = true;
    const turn = pendingTurns.shift()!;
    const s = settings();
    bus.emit('log', {
      level: 'info',
      msg: `Sending voice turn: ${turn.blob.size} bytes ${turn.blob.type} to ${s.gatewayUrl || '(not set)'} stt=${s.sttProvider} (queue: ${pendingTurns.length} remaining)`,
    });
    gateway.sendVoiceTurn(s, {
      sessionId: turn.sessionId,
      audio: turn.blob,
      sttProvider: s.sttProvider,
    });
  }

  // Forward gateway chunks to bus (with error logging)
  unsubs.push(gateway.onChunk((chunk) => {
    if (chunk.type === 'error') {
      bus.emit('log', {
        level: 'error',
        msg: `Gateway error: ${chunk.error ?? 'unknown'}`,
      });
    }
    bus.emit('gateway:chunk', chunk);

    // Drain queue on response_end or error (turn lifecycle is complete).
    // Queue state (busy flag, pendingTurns) is independent of the gesture FSM
    // state. If a watchdog reset fires in gesture-handler (resetting FSM to idle),
    // the queue continues to drain correctly when response_end/error arrives.
    if (chunk.type === 'response_end' || chunk.type === 'error') {
      busy = false;
      processQueue();
    }
  }));

  // Forward gateway status changes to bus (with logging)
  unsubs.push(gateway.onStatusChange((status) => {
    bus.emit('log', {
      level: status === 'error' ? 'error' : 'info',
      msg: `Gateway status: ${status}`,
    });
    bus.emit('gateway:status', { status });
  }));

  // When recording stops, enqueue voice turn (sequential, not immediate send).
  // Guard: skip empty audio (WAV header only) to avoid hallucinated transcriptions.
  unsubs.push(bus.on('audio:recording-stop', ({ sessionId, blob }) => {
    if (blob.size <= 44) {
      // WAV header only — no actual audio data captured
      bus.emit('log', { level: 'warn', msg: `Empty audio blob (${blob.size} bytes, WAV header only) — skipping gateway send. Check bridge audio frame wiring.` });
      return; // do not enqueue
    }
    if (blob.size < MIN_AUDIO_BYTES + 44) {
      // Too short for meaningful speech — warn but still send (let STT decide)
      bus.emit('log', { level: 'warn', msg: `Very short audio: ${blob.size} bytes (${blob.size - 44} PCM bytes). May produce hallucinated transcription.` });
    }

    if (pendingTurns.length >= MAX_QUEUE) {
      bus.emit('log', { level: 'warn', msg: `Voice queue full (${MAX_QUEUE}), dropping oldest turn` });
      pendingTurns.shift();
    }
    pendingTurns.push({ sessionId, blob });
    processQueue();
  }));

  function destroy(): void {
    for (const unsub of unsubs) {
      unsub();
    }
    unsubs.length = 0;
    pendingTurns.length = 0;
    busy = false;
  }

  return { destroy, getQueueLength: () => pendingTurns.length };
}
