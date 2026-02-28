// ── Icon animation loop ────────────────────────────────────
// State-driven animation with frame-drop protection.
// No SDK imports -- the updateFn callback is injected by the caller.

import type { IconState } from '../types';
import { ICON_FRAMES } from './icon-bitmaps';

export type { IconState };

export interface IconAnimator {
  /** Switch to a new icon state. Resets frame index and fires an immediate tick. */
  setState(state: IconState): void;
  /** Begin the animation interval (~5fps at 200ms). */
  start(): void;
  /** Stop the animation interval. */
  stop(): void;
  /** Return the current icon state. */
  getState(): IconState;
}

/**
 * Factory: create an icon animator that calls `updateFn` with the current
 * frame string on each tick. Drops frames when the previous updateFn
 * call is still in-flight (unresolved promise).
 *
 * @param updateFn - async callback that pushes the icon text to the display
 */
export function createIconAnimator(
  updateFn: (text: string) => Promise<unknown>,
): IconAnimator {
  let currentState: IconState = 'idle';
  let frameIdx = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  function tick(): void {
    if (inFlight) return; // Drop frame if previous update hasn't resolved

    const frames = ICON_FRAMES[currentState];
    const frame = frames[frameIdx % frames.length];
    frameIdx++;

    inFlight = true;
    updateFn(frame).then(
      () => { inFlight = false; },
      () => { inFlight = false; },
    );
  }

  return {
    setState(state: IconState): void {
      currentState = state;
      frameIdx = 0;
      tick(); // Immediate first frame on state change
    },

    start(): void {
      if (timer) return; // Idempotent
      timer = setInterval(tick, 200); // ~5fps
    },

    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },

    getState(): IconState {
      return currentState;
    },
  };
}
