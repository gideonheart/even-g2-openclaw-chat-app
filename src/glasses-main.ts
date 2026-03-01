// ── Glasses runtime boot ────────────────────────────────────
// Initializes all modules in strict Layer 0-5 dependency order.
// Only runs inside Even App WebView (detected by main.ts router).
//
// Lifecycle: The Even Hub SDK reuses the same WebView across glasses
// view open/close cycles. When the view is hidden (visibilitychange
// -> hidden), all modules are destroyed to free resources. When the
// view becomes visible again, boot() re-runs to reinitialize everything.
// This ensures gestures, display, and persistence are always live when
// the glasses view is active.

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
import { openDB, isIndexedDBAvailable, setOnUnexpectedClose, reopenDB } from './persistence/db';
import { createConversationStore } from './persistence/conversation-store';
import { createAutoSave } from './persistence/auto-save';
import { restoreOrCreateConversation, writeActiveConversationId } from './persistence/boot-restore';
import type { ConversationStore, SessionStore } from './persistence/types';
import { createSessionStore } from './persistence/session-store';
import { createIntegrityChecker } from './persistence/integrity-checker';
import { createStorageHealth } from './persistence/storage-health';
import { createSyncBridge } from './sync/sync-bridge';
import { createSyncMonitor } from './sync/sync-monitor';
import { createDriftReconciler } from './sync/drift-reconciler';
import { createSessionManager } from './sessions';
import { createMenuController } from './menu/menu-controller';
import { createGlassesErrorPresenter } from './display/error-presenter';

// ── Module-level lifecycle state ────────────────────────────
// Tracks cleanup callback and prevents duplicate listener registration
// across multiple boot()/cleanup() cycles.
let _activeCleanup: (() => void) | null = null;
let _lifecycleRegistered = false;
let _booting = false;

/** Exported for tests: reset module-level lifecycle state. */
export function _resetLifecycleState(): void {
  _activeCleanup = null;
  _lifecycleRegistered = false;
  _booting = false;
}

export async function boot(): Promise<void> {
  // Guard against concurrent boot calls (e.g. rapid hidden->visible transitions)
  if (_booting) return;
  _booting = true;
  // Layer 0: Foundation (no dependencies)
  const bus = createEventBus<AppEventMap>();
  const settings = loadSettings();
  const devMode = typeof (window as any).flutter_inappwebview === 'undefined';

  // ── Persistence: try to open IndexedDB, fall back to in-memory ──
  let store: ConversationStore | null = null;
  let sessionStore: SessionStore | null = null;
  let evictionDetected = false;
  if (isIndexedDBAvailable()) {
    try {
      const db = await openDB();
      store = createConversationStore(db);
      sessionStore = createSessionStore(db, store);

      // Phase 14: Integrity check (read-only, <10ms typical)
      const integrityChecker = createIntegrityChecker(db);
      const report = await integrityChecker.check();

      // Sentinel check for eviction detection (RES-04)
      if (!report.sentinelPresent) {
        const hadPreviousData = localStorage.getItem('openclaw-conversation-count');
        if (hadPreviousData && report.conversationCount === 0) {
          bus.emit('storage:evicted', {});
          evictionDetected = true;
        }
        await integrityChecker.writeSentinel();
      }
      // Track conversation count for eviction detection on future boots
      try {
        localStorage.setItem('openclaw-conversation-count', String(report.conversationCount));
      } catch { /* localStorage unavailable */ }

      // Orphan grace-period lifecycle (RES-05)
      if (report.orphanedMessageIds.length > 0) {
        bus.emit('log', { level: 'warn', msg: `Integrity: ${report.orphanedMessageIds.length} orphaned messages detected` });

        // Check if we have previously-detected orphans past grace period
        try {
          const prevOrphansJson = localStorage.getItem('openclaw-orphan-ids');
          const prevDetectedAt = localStorage.getItem('openclaw-orphan-detected-at');

          if (prevOrphansJson && prevDetectedAt) {
            const elapsed = Date.now() - Number(prevDetectedAt);
            if (elapsed >= 30_000) {
              // Grace period elapsed -- clean up confirmed-stale orphans
              const prevOrphans: string[] = JSON.parse(prevOrphansJson);
              // Only clean orphans that were ALSO detected in current boot (still orphaned)
              const staleOrphans = prevOrphans.filter(id => report.orphanedMessageIds.includes(id));
              if (staleOrphans.length > 0) {
                const cleaned = await integrityChecker.cleanupOrphans(staleOrphans);
                bus.emit('log', { level: 'info', msg: `Integrity: cleaned ${cleaned} stale orphaned messages` });
              }
              // Clear orphan tracking after cleanup attempt
              localStorage.removeItem('openclaw-orphan-ids');
              localStorage.removeItem('openclaw-orphan-detected-at');
            } else {
              // Grace period not elapsed -- update orphan list with current detection
              localStorage.setItem('openclaw-orphan-ids', JSON.stringify(report.orphanedMessageIds));
            }
          } else {
            // First detection -- persist orphan IDs and timestamp
            localStorage.setItem('openclaw-orphan-ids', JSON.stringify(report.orphanedMessageIds));
            localStorage.setItem('openclaw-orphan-detected-at', String(Date.now()));
          }
        } catch { /* localStorage unavailable */ }
      } else {
        // No orphans -- clear any previous orphan tracking
        try {
          localStorage.removeItem('openclaw-orphan-ids');
          localStorage.removeItem('openclaw-orphan-detected-at');
        } catch { /* localStorage unavailable */ }
      }
      if (report.danglingPointer) {
        bus.emit('log', { level: 'warn', msg: 'Integrity: dangling session pointer detected' });
      }

      // Storage health (RES-02, RES-03)
      const storageHealth = createStorageHealth();
      const quota = await storageHealth.getQuota();
      if (quota.isAvailable) {
        bus.emit('persistence:health', quota);
        if (quota.usagePercent >= 95) {
          bus.emit('log', { level: 'error', msg: `Storage critical: ${quota.usagePercent.toFixed(1)}% used` });
        } else if (quota.usagePercent >= 80) {
          bus.emit('log', { level: 'warn', msg: `Storage warning: ${quota.usagePercent.toFixed(1)}% used` });
        }
        // Request persistent storage on first boot (RES-03)
        if (!quota.isPersisted) {
          const granted = await storageHealth.requestPersistence();
          bus.emit('log', { level: 'info', msg: `Persistent storage ${granted ? 'granted' : 'denied'}` });
        }
      }

      // Hook IDB onclose for unexpected closure detection (RES-15)
      setOnUnexpectedClose(() => {
        bus.emit('persistence:error', {
          type: 'database-closed',
          recoverable: true,
          message: 'Database connection unexpectedly closed',
        });
        bus.emit('log', { level: 'error', msg: 'Database connection unexpectedly closed' });

        // Attempt to reopen and propagate new handle to all IDB-dependent modules (RES-15)
        reopenDB().then((newDb) => {
          // Recreate stores from fresh handle
          store = createConversationStore(newDb);
          sessionStore = createSessionStore(newDb, store);

          // Destroy and recreate autoSave with new store (captures store in closure)
          autoSave?.destroy();
          autoSave = createAutoSave({
            bus,
            store,
            getConversationId: () => activeConversationId,
            onConversationNamed: (name) => {
              syncBridge.postMessage({
                type: 'conversation:named',
                origin: 'glasses',
                conversationId: activeConversationId,
                name,
              });
            },
            syncBridge,
          });

          // Destroy and recreate driftReconciler with new store
          driftReconciler?.destroy();
          driftReconciler = createDriftReconciler({
            store,
            onDriftDetected: (info) => {
              bus.emit('sync:drift-detected', info);
              bus.emit('log', {
                level: 'warn',
                msg: `Sync drift: local=${info.localCount} remote=${info.remoteCount} conv=${info.conversationId}`,
              });
            },
            onReconciled: (info) => {
              bus.emit('sync:reconciled', info);
              bus.emit('log', { level: 'info', msg: `Sync reconciled: ${info.conversationId}` });
            },
          });

          // Destroy and recreate syncMonitor with new store
          syncMonitor?.destroy();
          syncMonitor = createSyncMonitor({
            bridge: syncBridge,
            store,
            origin: 'glasses',
            getActiveConversationId: () => activeConversationId,
            onHeartbeat: driftReconciler
              ? (conversationId, remoteCount) => {
                  driftReconciler!.handleHeartbeat(conversationId, remoteCount).catch(() => {});
                }
              : undefined,
          });
          syncMonitor.startHeartbeat();

          bus.emit('log', { level: 'info', msg: 'Database reconnected -- all stores refreshed' });
        }).catch(() => {
          bus.emit('persistence:error', {
            type: 'database-closed',
            recoverable: false,
            message: 'Failed to reopen database after max retries',
          });
          bus.emit('log', { level: 'error', msg: 'Database reopen failed after max retries -- restart required' });
        });
      });
    } catch {
      // IndexedDB unavailable -- continue with in-memory
    }
  }

  // Restore or create conversation (runs early to minimize boot latency)
  const restoreResult = await restoreOrCreateConversation({ store });
  let activeConversationId = restoreResult.conversationId;

  // ── Cross-context sync: initialize bridge for hub <-> glasses messaging ──
  const syncBridge = createSyncBridge();

  // ── Sync hardening: SyncMonitor + DriftReconciler (Phase 16) ──
  let driftReconciler = store ? createDriftReconciler({
    store,
    onDriftDetected: (info) => {
      bus.emit('sync:drift-detected', info);
      bus.emit('log', {
        level: 'warn',
        msg: `Sync drift: local=${info.localCount} remote=${info.remoteCount} conv=${info.conversationId}`,
      });
    },
    onReconciled: (info) => {
      bus.emit('sync:reconciled', info);
      bus.emit('log', { level: 'info', msg: `Sync reconciled: ${info.conversationId}` });
    },
  }) : null;

  let syncMonitor = store ? createSyncMonitor({
    bridge: syncBridge,
    store,
    origin: 'glasses',
    getActiveConversationId: () => activeConversationId,
    onHeartbeat: driftReconciler
      ? (conversationId: string, remoteCount: number) => {
          driftReconciler!.handleHeartbeat(conversationId, remoteCount).catch(() => {});
        }
      : undefined,
  }) : null;

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

  // Show eviction notification after renderer is initialized (RES-04)
  if (evictionDetected) {
    renderer.showError('Data was cleared by system');
  }

  // Layer 4.5: Error presenter (subscribes after display init — cannot show errors before display exists)
  // Pauses icon animator during error display, resumes on auto-clear (Pitfall 1 mitigation)
  const glassesErrorPresenter = createGlassesErrorPresenter({
    bus,
    bridge,
    renderer,
    iconAnimator: renderer.getIconAnimator() ?? { stop: () => {}, start: () => {} },
  });

  // Start sync heartbeat after display init and restore are complete (Phase 16)
  syncMonitor?.startHeartbeat();

  // ── Session switching helper ──────────────────────────────
  async function switchToSession(sessionId: string): Promise<void> {
    const previousId = activeConversationId;
    activeConversationId = sessionId;
    writeActiveConversationId(sessionId);

    // Clear display and reload with new session's messages
    renderer.destroy();
    await renderer.init();

    if (store) {
      const messages = await store.getMessages(sessionId);
      for (const msg of messages) {
        if (msg.role === 'user') {
          renderer.addUserMessage(msg.text);
        } else {
          renderer.startStreaming();
          renderer.appendStreamChunk(msg.text);
          renderer.endStreaming();
        }
      }
    }

    // Emit local bus event for interested modules (auto-save uses getConversationId getter)
    bus.emit('session:switched', { id: sessionId, previousId });
  }

  // Sync drift reconciliation: re-read from IDB and re-render when drift detected
  bus.on('sync:reconciled', async ({ conversationId }) => {
    if (conversationId === activeConversationId && store) {
      renderer.destroy();
      await renderer.init();
      const messages = await store.getMessages(conversationId);
      for (const msg of messages) {
        if (msg.role === 'user') {
          renderer.addUserMessage(msg.text);
        } else {
          renderer.startStreaming();
          renderer.appendStreamChunk(msg.text);
          renderer.endStreaming();
        }
      }
    }
  });

  // ── Menu controller (Layer 4b: depends on renderer, sessions) ──
  const sessionManager = sessionStore ? createSessionManager({
    sessionStore,
    syncBridge,
    origin: 'glasses',
  }) : null;

  const menuController = sessionManager ? createMenuController({
    bus,
    renderer,
    sessionManager,
    getActiveSessionId: () => activeConversationId,
    onSessionSwitch: switchToSession,
    store,
  }) : null;

  // ── Handle sync messages from hub context ──────────────────
  syncBridge.onMessage((msg) => {
    if (msg.origin === 'glasses') return; // ignore own echoes

    switch (msg.type) {
      case 'session:switched': {
        // Hub switched session -- load new session into display
        switchToSession(msg.sessionId).catch(() => {
          // sync switch failed -- glasses will retry on next message
        });
        break;
      }
      case 'session:deleted': {
        // Hub deleted a session -- if it was active, switch to most recent
        if (msg.sessionId === activeConversationId && sessionStore) {
          sessionStore.listSessions().then((sessions) => {
            if (sessions.length > 0) {
              switchToSession(sessions[0].id);
            }
            // If no sessions remain, a new one will be created on next voice turn
          }).catch(() => {
            // session list unavailable
          });
        }
        break;
      }
      case 'session:created':
      case 'session:renamed':
        // No glasses-side action needed -- hub UI handles these
        break;
    }
  });

  // Layer 5: Gateway + voice loop
  const gateway = createGatewayClient();
  const voiceLoopController = createVoiceLoopController({
    bus,
    gateway,
    settings: () => settings,
  });

  // ── Persistence: wire auto-save after voice loop is ready ──
  let autoSave = store ? createAutoSave({
    bus,
    store,
    getConversationId: () => activeConversationId,
    onConversationNamed: (name) => {
      syncBridge.postMessage({
        type: 'conversation:named',
        origin: 'glasses',
        conversationId: activeConversationId,
        name,
      });
    },
    syncBridge,
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

  // Forward gateway errors and status changes to hub via sync bridge
  bus.on('gateway:chunk', (chunk) => {
    if (chunk.type === 'error') {
      syncBridge.postMessage({
        type: 'gateway:error',
        origin: 'glasses',
        error: chunk.error ?? 'Unknown error',
      });
    }
  });
  bus.on('gateway:status', ({ status }) => {
    syncBridge.postMessage({
      type: 'gateway:status-changed',
      origin: 'glasses',
      status,
    });
  });

  // NOTE: 500ms settle period is handled in display-controller.ts,
  // not here. The display controller delays setIconState('idle') after response_end.

  // Gateway health check at boot (per user decision)
  if (settings.gatewayUrl) {
    const reachable = await gateway.checkHealth(settings.gatewayUrl);
    if (reachable) {
      bus.emit('gateway:status', { status: 'connected' });
    }
    // Always start heartbeat so status can recover if the initial check
    // fails (e.g. during gateway startup race).
    gateway.startHeartbeat(settings.gatewayUrl);
  } else {
    // Gateway URL not configured -- show blocking config message
    renderer.showConfigRequired();
  }

  // ── Lifecycle cleanup ───────────────────────────────────────
  // Destroy all modules in reverse init order when the WebView is hidden.
  // On return to visible, boot() is re-called to reinitialize everything.
  // Double-call guard prevents duplicate teardown when both
  // visibilitychange and pagehide fire in sequence.

  let cleaned = false;
  function cleanup(): void {
    if (cleaned) return;
    cleaned = true;

    // Reverse initialization order (Layer 5 -> Layer 0)
    driftReconciler?.destroy();  // clear mismatch counter before stopping heartbeat
    syncMonitor?.destroy();      // stop heartbeat before bridge teardown
    syncBridge.destroy();        // cross-context sync (no dependencies)
    autoSave?.destroy();
    voiceLoopController.destroy();
    gateway.destroy();           // stops heartbeat, aborts in-flight fetch
    menuController?.destroy();   // unsubscribes menu bus listeners, clears auto-close timer
    glassesErrorPresenter.destroy(); // clears status-bar timers, unsubscribes error bus handlers
    displayController.destroy(); // stops icon animator, clears flush timer
    gestureHandler.destroy();    // unsubscribes bus listeners
    // audioCapture has no destroy() -- stopRecording is best-effort cleanup
    audioCapture.stopRecording().catch(() => {});
    bridge.destroy();            // unsubscribes SDK, shuts down page container
    setOnUnexpectedClose(() => {}); // Prevent post-cleanup onclose events
    bus.clear();                 // clear all remaining subscriptions
  }

  // Store cleanup reference at module level for visibility handler
  _activeCleanup = cleanup;
  _booting = false;

  // Only register lifecycle handlers in glasses mode (not devMode).
  // In browser dev mode, tab switching fires visibilitychange with 'hidden',
  // which would destroy the voice loop during normal development.
  // Listeners are registered ONCE (module-level guard) to prevent duplicates
  // across multiple boot()/cleanup() cycles.
  if (!devMode && !_lifecycleRegistered) {
    _lifecycleRegistered = true;

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        _activeCleanup?.();
        _activeCleanup = null;
      } else if (document.visibilityState === 'visible' && !_activeCleanup) {
        // Previously cleaned up -- reboot to restore all modules.
        // The Even Hub SDK reuses the same WebView, so without reboot
        // all gesture handling, display, and menu remain dead.
        boot().catch((err) => {
          console.error('[glasses-main] Reboot on visibility change failed:', err);
        });
      }
    });
    window.addEventListener('pagehide', () => {
      _activeCleanup?.();
      _activeCleanup = null;
    });
  }
}
