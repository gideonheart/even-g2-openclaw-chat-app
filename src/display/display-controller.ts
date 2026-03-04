// ── Display controller -- wires bus events to GlassesRenderer ──────────
//
// This is the glue layer that makes the display reactive. Subscribes to
// bus events (gateway chunks, gestures, audio state) and calls the
// appropriate GlassesRenderer methods.
//
// Icon conditions are passed independently to the renderer (recording,
// pendingTurns, streaming) instead of resolving a single priority state.
// The icon animator composes them into a composite status string that can
// show multiple indicators simultaneously.

import type { EventBus } from '../events';
import type { AppEventMap } from '../types';
import type { GlassesRenderer } from './glasses-renderer';

// ── Public interface ──────────────────────────────────────

export interface DisplayController {
  init(): Promise<void>;
  destroy(): void;
}

// ── Factory ───────────────────────────────────────────────

export function createDisplayController(opts: {
  bus: EventBus<AppEventMap>;
  renderer: GlassesRenderer;
}): DisplayController {
  const { bus, renderer } = opts;

  // Collect all unsub functions for cleanup on destroy (same pattern as gesture-handler.ts)
  const unsubs: Array<() => void> = [];
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let menuActive = false;

  // ── Condition tracking ─────────────────────────────────────
  // pendingTurns is the only counter maintained here (decremented on
  // response_end/error settle). Recording and streaming flags are passed
  // directly to the renderer without local bookkeeping.
  let pendingTurns = 0;     // turns submitted but not yet response_end/error

  function clearSettle(): void {
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
  }

  async function init(): Promise<void> {
    await renderer.init();

    // ── 1. Streaming wiring (CHAT-03) ──────────────────────
    unsubs.push(
      bus.on('gateway:chunk', (chunk) => {
        switch (chunk.type) {
          case 'transcript':
            renderer.addUserMessage(chunk.text!);
            // pendingTurns already incremented on audio:stop-requested.
            // Transcript arrival confirms the turn is in flight -- no counter change needed.
            break;
          case 'response_start':
            renderer.startStreaming();
            renderer.setStreamingActive(true);
            break;
          case 'response_delta':
            renderer.appendStreamChunk(chunk.text!);
            break;
          case 'response_end':
            renderer.endStreaming();
            renderer.setStreamingActive(false);
            // 500ms settle: keep current icon visible to discourage premature tap.
            // After settle, decrement pendingTurns and update renderer.
            clearSettle();
            settleTimer = setTimeout(() => {
              settleTimer = null;
              if (pendingTurns > 0) pendingTurns--;
              renderer.setPendingTurns(pendingTurns);
            }, 500);
            break;
          case 'error':
            renderer.endStreaming();
            renderer.showError(chunk.error ?? 'Something went wrong');
            renderer.setStreamingActive(false);
            clearSettle();
            settleTimer = setTimeout(() => {
              settleTimer = null;
              if (pendingTurns > 0) pendingTurns--;
              renderer.setPendingTurns(pendingTurns);
            }, 500);
            break;
        }
      }),
    );

    // ── 2. Scroll wiring (CHAT-05, CHAT-06) ───────────────
    unsubs.push(
      bus.on('gesture:scroll-up', () => {
        if (menuActive) return;
        if (!renderer.isHidden()) {
          renderer.scrollUp();
        }
      }),
    );

    unsubs.push(
      bus.on('gesture:scroll-down', () => {
        if (menuActive) return;
        if (!renderer.isHidden()) {
          renderer.scrollDown();
        }
      }),
    );

    // ── 3. Hide/wake wiring (UIMD-01, UIMD-02) ───────────
    // Double-tap when hidden -> wake the display
    unsubs.push(
      bus.on('gesture:double-tap', () => {
        if (renderer.isHidden()) {
          renderer.wake();
        }
      }),
    );

    // Menu toggle: track menuActive flag.
    // Menu controller handles display via showMenuOverlay/restoreConversation.
    // Display controller only guards scroll events and provides safety-net wake.
    unsubs.push(
      bus.on('gesture:menu-toggle', ({ active }) => {
        if (active) {
          menuActive = true;
        } else {
          menuActive = false;
          renderer.wake();
        }
      }),
    );

    // ── 4. Condition wiring (independent flags) ─────────────
    unsubs.push(
      bus.on('audio:recording-start', () => {
        clearSettle();
        renderer.setRecordingActive(true);
      }),
    );

    // Immediate stop-requested: user tapped stop, show loading dots NOW
    // (before async bridge.stopAudio / audioCapture.stopRecording complete)
    unsubs.push(
      bus.on('audio:stop-requested', () => {
        renderer.setRecordingActive(false);
        pendingTurns++;
        renderer.setPendingTurns(pendingTurns);
      }),
    );

    // audio:recording-stop carries the blob for the voice pipeline.
    // Icon state is already handled by audio:stop-requested above.
    // No icon action needed here.
    unsubs.push(
      bus.on('audio:recording-stop', () => {
        // No-op for icon state. Blob handling is in voice-loop-controller.
      }),
    );
  }

  function destroy(): void {
    clearSettle();
    for (const unsub of unsubs) {
      unsub();
    }
    unsubs.length = 0;
    pendingTurns = 0;
    renderer.destroy();
  }

  return { init, destroy };
}
