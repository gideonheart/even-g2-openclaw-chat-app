// ── Glasses error presenter ─────────────────────────────────
// Subscribes to persistence:error and fsm:watchdog-reset bus events.
// Shows user-friendly auto-clearing messages in the status bar (container 1).
// Never uses renderer.showError() — that inserts into the chat container.
// Satisfies RES-16 (error hierarchy) and RES-19 (no jargon, auto-clear).

import type { EventBus } from '../events';
import type { AppEventMap } from '../types';
import type { BridgeService } from '../bridge/bridge-types';
import type { GlassesRenderer } from './glasses-renderer';

// ── Public interface ──────────────────────────────────────

export interface GlassesErrorPresenter {
  destroy(): void;
}

// ── Factory ───────────────────────────────────────────────

export function createGlassesErrorPresenter(opts: {
  bus: EventBus<AppEventMap>;
  bridge: BridgeService;
  renderer: GlassesRenderer;
  iconAnimator: { stop(): void; start(): void };
}): GlassesErrorPresenter {
  const { bus, bridge, iconAnimator } = opts;
  const unsubs: Array<() => void> = [];
  let statusClearTimer: ReturnType<typeof setTimeout> | null = null;
  let lastErrorLevel: 'warning' | 'error' | null = null;

  // ── Helpers ─────────────────────────────────────────────

  function showStatusBar(message: string, durationMs: number): void {
    if (statusClearTimer) clearTimeout(statusClearTimer);
    iconAnimator.stop();
    bridge.textContainerUpgrade(1, message);
    statusClearTimer = setTimeout(() => {
      statusClearTimer = null;
      lastErrorLevel = null;
      iconAnimator.start();
    }, durationMs);
  }

  /** RES-19: Map technical error types to user-friendly strings. */
  function mapErrorTypeToMessage(type: string): string {
    switch (type) {
      case 'database-closed':  return 'Data connection lost \u2014 reconnecting';
      case 'quota-exceeded':   return 'Storage full';
      case 'write-failed':     return 'Could not save message';
      case 'verify-failed':    return 'Storage check failed';
      default:                 return 'Something went wrong';
    }
  }

  // ── Bus subscriptions ───────────────────────────────────

  // RES-16: persistence:error — transient (3s) or recoverable (10s)
  unsubs.push(bus.on('persistence:error', ({ type, recoverable }) => {
    if (lastErrorLevel === 'error') return; // Pitfall 2 guard: already showing error
    lastErrorLevel = 'error';
    const userMsg = mapErrorTypeToMessage(type);
    if (recoverable) {
      showStatusBar(userMsg + ' \u2014 tap to retry', 10_000);
    } else {
      showStatusBar(userMsg, 3_000);
    }
  }));

  // RES-16: fsm:watchdog-reset — "tap to retry" for stuck states
  unsubs.push(bus.on('fsm:watchdog-reset', ({ previousState }) => {
    showStatusBar(`${previousState} timed out \u2014 tap to retry`, 5_000);
  }));

  // ── Cleanup ─────────────────────────────────────────────

  function destroy(): void {
    if (statusClearTimer) clearTimeout(statusClearTimer);
    statusClearTimer = null;
    for (const unsub of unsubs) unsub();
    unsubs.length = 0;
  }

  return { destroy };
}
