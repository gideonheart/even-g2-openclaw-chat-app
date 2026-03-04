// ── Display controller — wires bus events to GlassesRenderer ──────────
//
// This is the glue layer that makes the display reactive. Subscribes to
// bus events (gateway chunks, gestures, audio state) and calls the
// appropriate GlassesRenderer methods.
//
// Icon state is managed through a deterministic priority function rather
// than last-write-wins, preventing race conditions between overlapping
// turns and late gateway events.

import type { EventBus } from '../events';
import type { AppEventMap, IconState } from '../types';
import type { GlassesRenderer } from './glasses-renderer';

// ── Public interface ──────────────────────────────────────

export interface DisplayController {
  init(): Promise<void>;
  destroy(): void;
}

// ── Icon priority (highest to lowest) ─────────────────────
// recording > sent > thinking > idle
//
// Priority rule: the resolved icon state is the highest-priority
// condition that is currently active. Individual event handlers
// update condition flags/counters, then call resolveIcon() which
// applies the priority and calls renderer.setIconState() only if
// the resolved state differs from the last-applied state.

const ICON_PRIORITY: ReadonlyArray<IconState> = ['recording', 'sent', 'thinking', 'idle'];

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

  // ── Priority state tracking ──────────────────────────────
  // These flags represent active conditions. resolveIcon() reads them
  // to determine the highest-priority icon state.
  let recordingActive = false;
  let pendingTurns = 0;     // turns submitted but not yet response_end/error
  let streamingActive = false; // true between response_start and response_end/error
  let lastAppliedIcon: IconState = 'idle';

  /**
   * Compute the highest-priority icon state from current conditions
   * and apply it to the renderer if it changed.
   */
  function resolveIcon(): void {
    let resolved: IconState = 'idle';
    for (const state of ICON_PRIORITY) {
      switch (state) {
        case 'recording':
          if (recordingActive) { resolved = 'recording'; break; }
          continue;
        case 'sent':
          if (pendingTurns > 0) { resolved = 'sent'; break; }
          continue;
        case 'thinking':
          if (streamingActive) { resolved = 'thinking'; break; }
          continue;
        case 'idle':
          resolved = 'idle';
          break;
      }
      break; // matched — stop iterating
    }

    if (resolved !== lastAppliedIcon) {
      lastAppliedIcon = resolved;
      renderer.setIconState(resolved);
    }
  }

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
            // Transcript arrival confirms the turn is in flight — no counter change needed.
            resolveIcon();
            break;
          case 'response_start':
            renderer.startStreaming();
            streamingActive = true;
            resolveIcon();
            break;
          case 'response_delta':
            renderer.appendStreamChunk(chunk.text!);
            break;
          case 'response_end':
            renderer.endStreaming();
            streamingActive = false;
            // 500ms settle: keep current icon visible to discourage premature tap.
            // After settle, decrement pendingTurns and re-resolve.
            clearSettle();
            settleTimer = setTimeout(() => {
              settleTimer = null;
              if (pendingTurns > 0) pendingTurns--;
              resolveIcon();
            }, 500);
            break;
          case 'error':
            renderer.endStreaming();
            renderer.showError(chunk.error ?? 'Something went wrong');
            streamingActive = false;
            clearSettle();
            settleTimer = setTimeout(() => {
              settleTimer = null;
              if (pendingTurns > 0) pendingTurns--;
              resolveIcon();
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

    // ── 4. Icon state wiring (priority-based) ───────────────
    unsubs.push(
      bus.on('audio:recording-start', () => {
        clearSettle();
        recordingActive = true;
        resolveIcon();
      }),
    );

    // Immediate stop-requested: user tapped stop, show loading dots NOW
    // (before async bridge.stopAudio / audioCapture.stopRecording complete)
    unsubs.push(
      bus.on('audio:stop-requested', () => {
        recordingActive = false;
        pendingTurns++;
        resolveIcon();
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
    recordingActive = false;
    pendingTurns = 0;
    streamingActive = false;
    lastAppliedIcon = 'idle';
    renderer.destroy();
  }

  return { init, destroy };
}
