// ── VoiceLoopController — bridges gateway client events to the app event bus ──
//
// Subscribes to gateway.onChunk and gateway.onStatusChange, forwarding events
// to the typed bus. Listens for audio:recording-stop on the bus and dispatches
// voice turns to the gateway client using current settings (via getter).

import type { EventBus } from './events';
import type { AppEventMap, AppSettings } from './types';
import type { GatewayClient } from './api/gateway-client';

export interface VoiceLoopController {
  destroy(): void;
}

export function createVoiceLoopController(opts: {
  bus: EventBus<AppEventMap>;
  gateway: GatewayClient;
  settings: () => AppSettings;
}): VoiceLoopController {
  const { bus, gateway, settings } = opts;
  const unsubs: Array<() => void> = [];

  // Forward gateway chunks to bus
  unsubs.push(gateway.onChunk((chunk) => {
    bus.emit('gateway:chunk', chunk);
  }));

  // Forward gateway status changes to bus
  unsubs.push(gateway.onStatusChange((status) => {
    bus.emit('gateway:status', { status });
  }));

  // When recording stops, send voice turn to gateway
  unsubs.push(bus.on('audio:recording-stop', ({ sessionId, blob }) => {
    const s = settings();
    gateway.sendVoiceTurn(s, {
      sessionId,
      audio: blob,
      sttProvider: s.sttProvider,
    });
  }));

  function destroy(): void {
    for (const unsub of unsubs) {
      unsub();
    }
    unsubs.length = 0;
  }

  return { destroy };
}
