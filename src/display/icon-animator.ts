// ── Icon animation loop ────────────────────────────────────
// Composite status animator with independent recording + loading segments.
// Renders a combined status string from independent condition flags instead
// of a single IconState enum. No SDK imports -- the updateFn callback is
// injected by the caller.

import type { IconState } from '../types';
import { ICON_FRAMES } from './icon-bitmaps';

export type { IconState };

/** Independent condition flags for composite status rendering. */
export interface StatusConditions {
  recording: boolean;
  pendingTurns: number;   // > 0 means show loading dots
  streaming: boolean;     // true means show thinking spinner (only when not recording and no pending)
}

export interface IconAnimator {
  /** Update composite conditions and fire an immediate tick. */
  setConditions(conditions: StatusConditions): void;
  /**
   * @deprecated Use setConditions() instead. Kept for backward compatibility
   * (error-presenter.ts via getIconAnimator(), glasses-main.ts sync bridge).
   * Maps a single IconState to conditions.
   */
  setState(state: IconState): void;
  /** Begin the animation interval (~5fps at 200ms). */
  start(): void;
  /** Stop the animation interval. */
  stop(): void;
  /** Return the derived icon state (recording > sent > thinking > idle). */
  getState(): IconState;
}

/**
 * Factory: create an icon animator that calls `updateFn` with the current
 * frame string on each tick. Drops frames when the previous updateFn
 * call is still in-flight (unresolved promise).
 *
 * Renders composite status: `[recording dot + timer]  [loading dots]` when
 * both recording and pending turns are active, with independent frame
 * counters per segment.
 *
 * @param updateFn - async callback that pushes the icon text to the display
 */
export function createIconAnimator(
  updateFn: (text: string) => Promise<unknown>,
): IconAnimator {
  let conditions: StatusConditions = { recording: false, pendingTurns: 0, streaming: false };
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  // Independent frame counters per segment
  let recordingFrameIdx = 0;
  let loadingFrameIdx = 0;
  let thinkingFrameIdx = 0;
  let recordingStartedAt = 0;

  // Track previous conditions for edge-triggered resets
  let prevRecording = false;
  let prevPendingPositive = false;
  let prevStreaming = false;

  function formatElapsed(ms: number): string {
    const secs = Math.floor(ms / 1000);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function tick(): void {
    if (inFlight) return; // Drop frame if previous update hasn't resolved

    let output = '';

    // Build left segment: recording dot + elapsed timer
    if (conditions.recording) {
      const frames = ICON_FRAMES.recording;
      const frame = frames[recordingFrameIdx % frames.length];
      recordingFrameIdx++;
      const elapsed = recordingStartedAt > 0 ? formatElapsed(Date.now() - recordingStartedAt) : '0:00';
      output = `${frame} ${elapsed}`;
    }

    // Build right segment: loading dots
    if (conditions.pendingTurns > 0) {
      const frames = ICON_FRAMES.sent;
      const frame = frames[loadingFrameIdx % frames.length];
      loadingFrameIdx++;

      if (output.length > 0) {
        // Both active: two spaces between segments for visual separation
        output = `${output}  ${frame}`;
      } else {
        // Not recording but pending: prefix idle icon so user knows they can tap
        output = `${ICON_FRAMES.idle[0]} ${frame}`;
      }
    }

    // Thinking spinner (only when not recording and no pending)
    if (!conditions.recording && conditions.pendingTurns === 0 && conditions.streaming) {
      const frames = ICON_FRAMES.thinking;
      output = frames[thinkingFrameIdx % frames.length];
      thinkingFrameIdx++;
    }

    // Idle (neither recording, nor pending, nor streaming)
    if (!conditions.recording && conditions.pendingTurns === 0 && !conditions.streaming) {
      output = ICON_FRAMES.idle[0];
    }

    inFlight = true;
    updateFn(output).then(
      () => { inFlight = false; },
      () => { inFlight = false; },
    );
  }

  function applyConditions(newConditions: StatusConditions): void {
    const pendingNowPositive = newConditions.pendingTurns > 0;

    // Edge-triggered resets: reset frame counter when condition transitions to active
    if (newConditions.recording && !prevRecording) {
      recordingFrameIdx = 0;
      recordingStartedAt = Date.now();
    }
    if (!newConditions.recording) {
      recordingStartedAt = 0;
    }
    if (pendingNowPositive && !prevPendingPositive) {
      loadingFrameIdx = 0;
    }
    if (newConditions.streaming && !prevStreaming) {
      thinkingFrameIdx = 0;
    }

    prevRecording = newConditions.recording;
    prevPendingPositive = pendingNowPositive;
    prevStreaming = newConditions.streaming;
    conditions = { ...newConditions };

    tick(); // Immediate first frame on condition change
  }

  return {
    setConditions(newConditions: StatusConditions): void {
      applyConditions(newConditions);
    },

    setState(state: IconState): void {
      // Backward-compat: map single IconState to conditions
      applyConditions({
        recording: state === 'recording',
        pendingTurns: state === 'sent' ? 1 : 0,
        streaming: state === 'thinking',
      });
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
      // Derive from conditions: recording > sent (pending>0) > thinking (streaming) > idle
      if (conditions.recording) return 'recording';
      if (conditions.pendingTurns > 0) return 'sent';
      if (conditions.streaming) return 'thinking';
      return 'idle';
    },
  };
}
