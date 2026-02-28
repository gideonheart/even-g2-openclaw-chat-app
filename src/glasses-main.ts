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
import { openDB, isIndexedDBAvailable } from './persistence/db';
import { createConversationStore } from './persistence/conversation-store';
import { createAutoSave } from './persistence/auto-save';
import { restoreOrCreateConversation } from './persistence/boot-restore';
import type { ConversationStore } from './persistence/types';

export async function boot(): Promise<void> {
  // Layer 0: Foundation (no dependencies)
  const bus = createEventBus<AppEventMap>();
  const settings = loadSettings();
  const devMode = typeof (window as any).flutter_inappwebview === 'undefined';

  // ── Persistence: try to open IndexedDB, fall back to in-memory ──
  let store: ConversationStore | null = null;
  if (isIndexedDBAvailable()) {
    try {
      const db = await openDB();
      store = createConversationStore(db);
    } catch {
      // IndexedDB unavailable -- continue with in-memory
    }
  }

  // Restore or create conversation (runs early to minimize boot latency)
  const restoreResult = await restoreOrCreateConversation({ store });
  let activeConversationId = restoreResult.conversationId;

  // Layer 1: Hardware boundary
  const bridge = devMode ? createBridgeMock(bus) : createEvenBridgeService(bus);
  await bridge.init();

  // Show storage/restore warnings briefly before normal boot indicator
  if (!restoreResult.storageAvailable) {
    bridge.textContainerUpgrade(1, 'Storage unavailable \u2014 conversations won\'t be saved');
    await new Promise((r) => setTimeout(r, 2000));
  } else if (restoreResult.error) {
    bridge.textContainerUpgrade(1, 'Previous conversation couldn\'t be restored');
    await new Promise((r) => setTimeout(r, 2000));
  }

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
  const gestureHandler = createGestureHandler({
    bus,
    bridge,
    audioCapture,
    activeSessionId: () => activeConversationId,
  });

  // Layer 4: Display pipeline (subscribes AFTER gesture handler -- bus dispatch order matters)
  const renderer = createGlassesRenderer({ bridge, bus });
  const displayController = createDisplayController({
    bus,
    renderer,
  });
  await displayController.init();

  // ── Restore messages into display after display init ──
  if (restoreResult.restored && restoreResult.messages.length > 0) {
    for (const msg of restoreResult.messages) {
      if (msg.role === 'user') {
        renderer.addUserMessage(msg.text);
      } else {
        renderer.startStreaming();
        renderer.appendStreamChunk(msg.text);
        renderer.endStreaming();
      }
    }
    // Emit restore event for any interested listeners
    bus.emit('persistence:restored', {
      conversationId: activeConversationId,
      messageCount: restoreResult.messages.length,
    });
  } else {
    // Show welcome message (per user decision: "Tap to ask" -- functional tone, first time only)
    renderer.showWelcome();
  }

  // Layer 5: Gateway + voice loop
  const gateway = createGatewayClient();
  const voiceLoopController = createVoiceLoopController({
    bus,
    gateway,
    settings: () => settings,
  });

  // ── Persistence: wire auto-save after voice loop is ready ──
  const autoSave = store ? createAutoSave({
    bus,
    store,
    getConversationId: () => activeConversationId,
    onConversationNamed: (_name) => {
      // Future: update UI with conversation name (Phase 10+ concern)
    },
  }) : null;

  // ── Persistence warning listener ──
  // Show subtle non-blocking warning when saves fail
  let warningShown = false;
  bus.on('persistence:warning', ({ message }) => {
    if (!warningShown) {
      warningShown = true;
      renderer.showError(message);
    }
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

  // ── Lifecycle cleanup ───────────────────────────────────────
  // Destroy all modules in reverse init order when the WebView closes.
  // Double-call guard prevents duplicate teardown when both
  // visibilitychange and pagehide fire in sequence.

  let cleaned = false;
  function cleanup(): void {
    if (cleaned) return;
    cleaned = true;

    // Reverse initialization order (Layer 5 -> Layer 0)
    autoSave?.destroy();
    voiceLoopController.destroy();
    gateway.destroy();           // stops heartbeat, aborts in-flight fetch
    displayController.destroy(); // stops icon animator, clears flush timer
    gestureHandler.destroy();    // unsubscribes bus listeners
    // audioCapture has no destroy() -- stopRecording is best-effort cleanup
    audioCapture.stopRecording().catch(() => {});
    bridge.destroy();            // unsubscribes SDK, shuts down page container
    bus.clear();                 // clear all remaining subscriptions
  }

  // Only register lifecycle cleanup in glasses mode (not devMode).
  // In browser dev mode, tab switching fires visibilitychange with 'hidden',
  // which would destroy the voice loop during normal development.
  if (!devMode) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        cleanup();
      }
    });
    window.addEventListener('pagehide', cleanup);
  }
}
