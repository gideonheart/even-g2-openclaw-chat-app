// ── Glasses runtime boot ────────────────────────────────────
// Initializes all modules in strict Layer 0-5 dependency order.
// Only runs inside Even App WebView (detected by main.ts router).

import { createEventBus } from './events';
import type { AppEventMap } from './types';
import { loadSettings } from './settings';
import { createEvenBridgeService } from './bridge/even-bridge';
import { createBridgeMock } from './bridge/bridge-mock';
import { createAudioCapture } from './audio/audio-capture';
import { createGestureHandler } from './gestures/gesture-handler';
import { createGlassesRenderer } from './display/glasses-renderer';
import { createDisplayController } from './display/display-controller';
import { createGatewayClient } from './api/gateway-client';
import { createVoiceLoopController } from './voice-loop-controller';

export async function boot(): Promise<void> {
  // Layer 0: Foundation (no dependencies)
  const bus = createEventBus<AppEventMap>();
  const settings = loadSettings();
  const devMode = typeof (window as any).flutter_inappwebview === 'undefined';

  // Layer 1: Hardware boundary
  const bridge = devMode ? createBridgeMock(bus) : createEvenBridgeService(bus);
  await bridge.init();

  // Boot indicator: show "Connecting..." while remaining layers initialize (~1 second).
  // displayController.init() will call rebuildPageContainer, replacing this text with the chat layout.
  bridge.textContainerUpgrade(1, 'Connecting...');

  // Layer 2: Audio capture + PCM wiring (LOOP-05)
  // Mock audio: dev mode (browser) OR explicit ?mock-audio URL param for headless CI without mic
  const mockAudio = devMode || new URLSearchParams(location.search).has('mock-audio');
  const audioCapture = createAudioCapture(mockAudio);
  // Wire bridge audio frames to audio capture for glasses-mode PCM recording.
  // This subscription MUST exist before the first tap, otherwise glasses-mode
  // recording produces empty blobs (frames are silently dropped).
  bus.on('bridge:audio-frame', ({ pcm }) => audioCapture.onFrame(pcm));

  // Layer 3: Gesture handling (subscribes to bus FIRST -- before display controller)
  // The handler subscribes to gesture events in its constructor and drives the FSM.
  // We don't reference the return value directly -- bus subscriptions are the integration point.
  createGestureHandler({
    bus,
    bridge,
    audioCapture,
    activeSessionId: () => 'gideon',
  });

  // Layer 4: Display pipeline (subscribes AFTER gesture handler -- bus dispatch order matters)
  const renderer = createGlassesRenderer({ bridge, bus });
  const displayController = createDisplayController({
    bus,
    renderer,
  });
  await displayController.init();

  // Show welcome message (per user decision: "Tap to ask" -- functional tone, first time only)
  renderer.showWelcome();

  // Layer 5: Gateway + voice loop
  const gateway = createGatewayClient();
  createVoiceLoopController({
    bus,
    gateway,
    settings: () => settings,
  });

  // NOTE: 500ms settle period is handled in display-controller.ts,
  // not here. The display controller delays setIconState('idle') after response_end.

  // Gateway health check at boot (per user decision)
  if (settings.gatewayUrl) {
    const healthy = await gateway.checkHealth(settings.gatewayUrl);
    if (healthy) {
      gateway.startHeartbeat(settings.gatewayUrl);
      bus.emit('gateway:status', { status: 'connected' });
    }
    // Auto-retry handled by heartbeat system (per user decision: no manual retry needed)
  } else {
    // Gateway URL not configured -- show blocking config message
    renderer.showConfigRequired();
  }
}
