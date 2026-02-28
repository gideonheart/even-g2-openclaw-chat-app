// ── Display controller — wires bus events to GlassesRenderer ──────────
//
// This is the glue layer that makes the display reactive. Subscribes to
// bus events (gateway chunks, gestures, audio state) and calls the
// appropriate GlassesRenderer methods.

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

  async function init(): Promise<void> {
    await renderer.init();

    // ── 1. Streaming wiring (CHAT-03) ──────────────────────
    unsubs.push(
      bus.on('gateway:chunk', (chunk) => {
        switch (chunk.type) {
          case 'transcript':
            renderer.addUserMessage(chunk.text!);
            renderer.setIconState('sent');
            break;
          case 'response_start':
            renderer.startStreaming();
            renderer.setIconState('thinking');
            break;
          case 'response_delta':
            renderer.appendStreamChunk(chunk.text!);
            break;
          case 'response_end':
            renderer.endStreaming();
            // 500ms settle: keep 'thinking' icon visible to discourage premature tap
            if (settleTimer) clearTimeout(settleTimer);
            settleTimer = setTimeout(() => { settleTimer = null; renderer.setIconState('idle'); }, 500);
            break;
          case 'error':
            renderer.endStreaming();
            renderer.showError(chunk.error ?? 'Something went wrong');
            if (settleTimer) clearTimeout(settleTimer);
            settleTimer = setTimeout(() => { settleTimer = null; renderer.setIconState('idle'); }, 500);
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

    // ── 4. Icon state wiring ──────────────────────────────
    unsubs.push(
      bus.on('audio:recording-start', () => {
        // Cancel any pending settle timer from a previous error/response_end
        // to prevent it from overwriting the recording icon (Pitfall 5)
        if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
        renderer.setIconState('recording');
      }),
    );

    unsubs.push(
      bus.on('audio:recording-stop', () => {
        renderer.setIconState('sent');
      }),
    );
  }

  function destroy(): void {
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
    for (const unsub of unsubs) {
      unsub();
    }
    unsubs.length = 0;
    renderer.destroy();
  }

  return { init, destroy };
}
