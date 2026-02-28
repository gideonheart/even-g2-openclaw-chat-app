// ── Display controller — wires bus events to GlassesRenderer ──────────
//
// This is the glue layer that makes the display reactive. Subscribes to
// bus events (gateway chunks, gestures, audio state) and calls the
// appropriate GlassesRenderer methods.
//
// ORDERING NOTE: The display controller's hint-update handlers must be
// registered AFTER the gesture handler is created. The event bus dispatches
// synchronously to all handlers in registration order, so the gesture
// handler processes state transitions first, then getHintText() reflects
// the new state when the display controller reads it.

import type { EventBus } from '../events';
import type { AppEventMap } from '../types';
import type { GlassesRenderer } from './glasses-renderer';
import type { GestureHandlerAPI } from '../gestures/gesture-handler';

// ── Public interface ──────────────────────────────────────

export interface DisplayController {
  init(): Promise<void>;
  destroy(): void;
}

// ── Factory ───────────────────────────────────────────────

export function createDisplayController(opts: {
  bus: EventBus<AppEventMap>;
  renderer: GlassesRenderer;
  gestureHandler: GestureHandlerAPI;
}): DisplayController {
  const { bus, renderer, gestureHandler } = opts;

  // Collect all unsub functions for cleanup on destroy (same pattern as gesture-handler.ts)
  const unsubs: Array<() => void> = [];

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
            renderer.setIconState('idle');
            break;
          case 'error':
            renderer.endStreaming();
            renderer.setIconState('idle');
            break;
        }
      }),
    );

    // ── 2. Scroll wiring (CHAT-05, CHAT-06) ───────────────
    unsubs.push(
      bus.on('gesture:scroll-up', () => {
        if (!renderer.isHidden()) {
          renderer.scrollUp();
        }
      }),
    );

    unsubs.push(
      bus.on('gesture:scroll-down', () => {
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

    // Menu toggle drives hide/wake:
    // active=true (menu opens) -> hide display
    // active=false (menu closes) -> wake display
    unsubs.push(
      bus.on('gesture:menu-toggle', ({ active }) => {
        if (active) {
          renderer.hide();
        } else {
          renderer.wake();
        }
      }),
    );

    // ── 4. Icon state wiring ──────────────────────────────
    unsubs.push(
      bus.on('audio:recording-start', () => {
        renderer.setIconState('recording');
      }),
    );

    unsubs.push(
      bus.on('audio:recording-stop', () => {
        renderer.setIconState('sent');
      }),
    );

    // ── 5. Hint bar wiring ────────────────────────────────
    // ORDERING: These hint-update subscriptions fire AFTER the gesture
    // handler processes the event (bus dispatches synchronously in
    // registration order). The gesture handler must be created first so
    // getHintText() reflects the post-transition state.
    unsubs.push(
      bus.on('gesture:tap', () => {
        renderer.updateHint(gestureHandler.getHintText());
      }),
    );

    unsubs.push(
      bus.on('gesture:double-tap', () => {
        renderer.updateHint(gestureHandler.getHintText());
      }),
    );

    unsubs.push(
      bus.on('gesture:scroll-up', () => {
        renderer.updateHint(gestureHandler.getHintText());
      }),
    );

    unsubs.push(
      bus.on('gesture:scroll-down', () => {
        renderer.updateHint(gestureHandler.getHintText());
      }),
    );
  }

  function destroy(): void {
    for (const unsub of unsubs) {
      unsub();
    }
    unsubs.length = 0;
    renderer.destroy();
  }

  return { init, destroy };
}
