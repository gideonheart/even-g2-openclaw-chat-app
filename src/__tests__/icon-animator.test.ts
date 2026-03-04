import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createIconAnimator } from '../display/icon-animator';
import type { StatusConditions } from '../display/icon-animator';
import { ICON_FRAMES } from '../display/icon-bitmaps';

describe('IconAnimator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Backward compat: setState still works ─────────────────

  describe('backward compat setState', () => {
    it('setState("idle") calls updateFn with idle frame immediately', async () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      animator.setState('idle');

      expect(updateFn).toHaveBeenCalledWith(ICON_FRAMES.idle[0]);
    });

    it('setState("recording") calls updateFn with recording frame + timer immediately', async () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      animator.setState('recording');

      expect(updateFn).toHaveBeenCalledWith(`${ICON_FRAMES.recording[0]} 0:00`);
    });

    it('getState() returns current state', () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      expect(animator.getState()).toBe('idle');
      animator.setState('thinking');
      expect(animator.getState()).toBe('thinking');
    });
  });

  // ── Composite setConditions ────────────────────────────────

  describe('setConditions composite rendering', () => {
    it('recording + pending: output contains both recording dot+timer AND loading dots', () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      animator.setConditions({ recording: true, pendingTurns: 1, streaming: false });

      const output = updateFn.mock.calls[0][0] as string;
      // Should contain recording dot
      expect(output).toMatch(/[●○]/);
      // Should contain timer
      expect(output).toContain('0:00');
      // Should contain loading dot
      expect(output).toContain('.');
      // Two spaces between segments
      expect(output).toMatch(/0:00\s{2}\./);
    });

    it('loading only: outputs loading dots', () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      animator.setConditions({ recording: false, pendingTurns: 2, streaming: false });

      expect(updateFn).toHaveBeenCalledWith(ICON_FRAMES.sent[0]);
    });

    it('recording only: outputs recording dot+timer', () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      animator.setConditions({ recording: true, pendingTurns: 0, streaming: false });

      expect(updateFn).toHaveBeenCalledWith(`${ICON_FRAMES.recording[0]} 0:00`);
    });

    it('streaming only: outputs thinking spinner', () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      animator.setConditions({ recording: false, pendingTurns: 0, streaming: true });

      expect(updateFn).toHaveBeenCalledWith(ICON_FRAMES.thinking[0]);
    });

    it('idle (all false): outputs idle icon', () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      animator.setConditions({ recording: false, pendingTurns: 0, streaming: false });

      expect(updateFn).toHaveBeenCalledWith(ICON_FRAMES.idle[0]);
    });

    it('pending + streaming: loading dots take priority over thinking spinner', () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      animator.setConditions({ recording: false, pendingTurns: 1, streaming: true });

      // Should show loading dots, not thinking spinner
      expect(updateFn).toHaveBeenCalledWith(ICON_FRAMES.sent[0]);
    });

    it('recording + streaming: recording dot+timer (no thinking spinner)', () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      animator.setConditions({ recording: true, pendingTurns: 0, streaming: true });

      // Should show recording, not thinking
      const output = updateFn.mock.calls[0][0] as string;
      expect(output).toMatch(/[●○] 0:00/);
      // Should not contain thinking spinner characters
      for (const frame of ICON_FRAMES.thinking) {
        expect(output).not.toContain(frame);
      }
    });
  });

  // ── Independent frame counters ─────────────────────────────

  describe('independent frame counters', () => {
    it('recording frame counter resets when recording flips to true', async () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      // Start recording
      animator.setConditions({ recording: true, pendingTurns: 0, streaming: false });
      animator.start();

      // Advance a few frames
      await vi.advanceTimersByTimeAsync(600); // 3 ticks

      // Stop recording
      animator.setConditions({ recording: false, pendingTurns: 1, streaming: false });
      await vi.advanceTimersByTimeAsync(0);

      // Re-start recording -- should reset to frame 0
      updateFn.mockClear();
      animator.setConditions({ recording: true, pendingTurns: 1, streaming: false });

      const output = updateFn.mock.calls[0][0] as string;
      // Frame 0 of recording is the filled circle
      expect(output).toContain(ICON_FRAMES.recording[0]);

      animator.stop();
    });

    it('loading frame counter resets when pendingTurns goes from 0 to positive', async () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      // Start with pending turns
      animator.setConditions({ recording: false, pendingTurns: 1, streaming: false });
      animator.start();

      // Advance through some frames
      await vi.advanceTimersByTimeAsync(400); // 2 ticks
      // We've advanced past frame 0

      // Clear pending
      animator.setConditions({ recording: false, pendingTurns: 0, streaming: false });
      await vi.advanceTimersByTimeAsync(0);

      // Re-add pending -- should reset to frame 0
      updateFn.mockClear();
      animator.setConditions({ recording: false, pendingTurns: 1, streaming: false });

      expect(updateFn).toHaveBeenCalledWith(ICON_FRAMES.sent[0]);

      animator.stop();
    });

    it('thinking frame counter resets when streaming transitions to true', async () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      animator.setConditions({ recording: false, pendingTurns: 0, streaming: true });
      animator.start();

      // Advance a few frames
      await vi.advanceTimersByTimeAsync(400);

      // Stop streaming
      animator.setConditions({ recording: false, pendingTurns: 0, streaming: false });
      await vi.advanceTimersByTimeAsync(0);

      // Re-start streaming -- should reset to frame 0
      updateFn.mockClear();
      animator.setConditions({ recording: false, pendingTurns: 0, streaming: true });

      expect(updateFn).toHaveBeenCalledWith(ICON_FRAMES.thinking[0]);

      animator.stop();
    });

    it('recording and loading frames advance independently', async () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      animator.setConditions({ recording: true, pendingTurns: 1, streaming: false });
      animator.start();

      // Collect several frames
      const outputs: string[] = [updateFn.mock.calls[0][0] as string];
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(200);
        outputs.push(updateFn.mock.calls[updateFn.mock.calls.length - 1][0] as string);
      }

      // Recording alternates between two frames (2-frame blink)
      // Loading cycles through 3 frames
      // Both should be progressing in the composite output
      const hasRecordingDot = outputs.some(o => o.includes(ICON_FRAMES.recording[0]));
      const hasRecordingCircle = outputs.some(o => o.includes(ICON_FRAMES.recording[1]));
      const hasOneDot = outputs.some(o => o.includes('  .'));
      const hasTwoDots = outputs.some(o => o.includes('  ..'));

      expect(hasRecordingDot).toBe(true);
      expect(hasRecordingCircle).toBe(true);
      expect(hasOneDot).toBe(true);
      expect(hasTwoDots).toBe(true);

      animator.stop();
    });
  });

  // ── getState() derives from conditions ─────────────────────

  describe('getState() derivation', () => {
    it('recording conditions -> getState returns recording', () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      animator.setConditions({ recording: true, pendingTurns: 1, streaming: true });
      expect(animator.getState()).toBe('recording');
    });

    it('pending only -> getState returns sent', () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      animator.setConditions({ recording: false, pendingTurns: 2, streaming: false });
      expect(animator.getState()).toBe('sent');
    });

    it('streaming only -> getState returns thinking', () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      animator.setConditions({ recording: false, pendingTurns: 0, streaming: true });
      expect(animator.getState()).toBe('thinking');
    });

    it('all false -> getState returns idle', () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      animator.setConditions({ recording: false, pendingTurns: 0, streaming: false });
      expect(animator.getState()).toBe('idle');
    });
  });

  // ── Core animation mechanics ────────────────────────────────

  describe('animation mechanics', () => {
    it('start() calls updateFn on 200ms interval', async () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      animator.start();

      // First tick at 200ms
      await vi.advanceTimersByTimeAsync(200);
      expect(updateFn).toHaveBeenCalledTimes(1);

      // Second tick at 400ms
      await vi.advanceTimersByTimeAsync(200);
      expect(updateFn).toHaveBeenCalledTimes(2);

      animator.stop();
    });

    it('stop() clears interval (no more calls)', async () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      animator.start();
      await vi.advanceTimersByTimeAsync(200);
      expect(updateFn).toHaveBeenCalledTimes(1);

      animator.stop();

      await vi.advanceTimersByTimeAsync(600);
      expect(updateFn).toHaveBeenCalledTimes(1); // no more calls
    });

    it('drops frames when updateFn is still in-flight', async () => {
      // Create a slow updateFn that never resolves until manually triggered
      let resolveUpdate: (() => void) | null = null;
      const updateFn = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveUpdate = resolve;
          }),
      );

      const animator = createIconAnimator(updateFn);
      animator.start();

      // First tick: updateFn called, promise pending (in-flight)
      await vi.advanceTimersByTimeAsync(200);
      expect(updateFn).toHaveBeenCalledTimes(1);

      // Second tick: should be SKIPPED because first is still in-flight
      await vi.advanceTimersByTimeAsync(200);
      expect(updateFn).toHaveBeenCalledTimes(1); // still 1, frame dropped

      // Resolve the first call
      resolveUpdate!();
      await vi.advanceTimersByTimeAsync(0); // flush microtasks

      // Third tick: should now fire since in-flight is cleared
      await vi.advanceTimersByTimeAsync(200);
      expect(updateFn).toHaveBeenCalledTimes(2);

      animator.stop();
    });

    it('setConditions resets frame counters (cycling starts from frame 0)', async () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      animator.setConditions({ recording: false, pendingTurns: 0, streaming: true });
      // Should get frame 0 of thinking
      expect(updateFn).toHaveBeenLastCalledWith(ICON_FRAMES.thinking[0]);

      animator.start();

      // Advance: should get frame 1
      await vi.advanceTimersByTimeAsync(200);
      expect(updateFn).toHaveBeenLastCalledWith(ICON_FRAMES.thinking[1]);

      // Now switch to recording -- frameIdx resets
      animator.setConditions({ recording: true, pendingTurns: 0, streaming: false });
      expect(updateFn).toHaveBeenLastCalledWith(`${ICON_FRAMES.recording[0]} 0:00`);

      animator.stop();
    });

    it('cycles through all frames of thinking spinner', async () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      animator.setConditions({ recording: false, pendingTurns: 0, streaming: true });
      const calls: string[] = [ICON_FRAMES.thinking[0]]; // immediate call

      animator.start();

      // Advance through all 10 frames of thinking spinner
      for (let i = 1; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(200);
        const lastCall = updateFn.mock.calls[updateFn.mock.calls.length - 1] as unknown[];
        calls.push(lastCall[0] as string);
      }

      // Should have cycled through all 10 frames
      expect(calls).toEqual(ICON_FRAMES.thinking);

      // Next tick wraps around to frame 0
      await vi.advanceTimersByTimeAsync(200);
      expect(updateFn).toHaveBeenLastCalledWith(ICON_FRAMES.thinking[0]);

      animator.stop();
    });

    it('loading dots cycle through frames', async () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      animator.setConditions({ recording: false, pendingTurns: 1, streaming: false });
      expect(updateFn).toHaveBeenLastCalledWith(ICON_FRAMES.sent[0]); // '.'

      animator.start();

      await vi.advanceTimersByTimeAsync(200);
      expect(updateFn).toHaveBeenLastCalledWith(ICON_FRAMES.sent[1]); // '..'

      await vi.advanceTimersByTimeAsync(200);
      expect(updateFn).toHaveBeenLastCalledWith(ICON_FRAMES.sent[2]); // '...'

      // Wraps back to frame 0
      await vi.advanceTimersByTimeAsync(200);
      expect(updateFn).toHaveBeenLastCalledWith(ICON_FRAMES.sent[0]); // '.'

      animator.stop();
    });

    it('start() is idempotent (calling twice does not create duplicate intervals)', async () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      animator.start();
      animator.start(); // second call should be no-op

      await vi.advanceTimersByTimeAsync(200);
      expect(updateFn).toHaveBeenCalledTimes(1); // not 2

      animator.stop();
    });

    it('stop() is safe to call when not started', () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      // Should not throw
      expect(() => animator.stop()).not.toThrow();
    });
  });

  // ── Recording timer ─────────────────────────────────────────

  describe('recording timer', () => {
    it('includes elapsed time in recording frame (immediate tick shows 0:00)', () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      animator.setConditions({ recording: true, pendingTurns: 0, streaming: false });

      expect(updateFn).toHaveBeenCalledWith(`${ICON_FRAMES.recording[0]} 0:00`);
    });

    it('elapsed time increments as real time passes', async () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      animator.setConditions({ recording: true, pendingTurns: 0, streaming: false });
      animator.start();

      // Advance 3 seconds (15 ticks at 200ms)
      await vi.advanceTimersByTimeAsync(3000);

      const lastCall = updateFn.mock.calls[updateFn.mock.calls.length - 1] as unknown[];
      expect(lastCall[0]).toMatch(/^[●○] 0:03$/);

      animator.stop();
    });

    it('formats minutes correctly after 60s', async () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      animator.setConditions({ recording: true, pendingTurns: 0, streaming: false });
      animator.start();

      await vi.advanceTimersByTimeAsync(65_000);

      const lastCall = updateFn.mock.calls[updateFn.mock.calls.length - 1] as unknown[];
      expect(lastCall[0]).toMatch(/^[●○] 1:05$/);

      animator.stop();
    });

    it('timer resets when recording goes false', async () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      animator.setConditions({ recording: true, pendingTurns: 0, streaming: false });
      animator.start();
      await vi.advanceTimersByTimeAsync(5000);

      // Switch to loading -- no recording segment
      animator.setConditions({ recording: false, pendingTurns: 1, streaming: false });
      expect(updateFn).toHaveBeenLastCalledWith(ICON_FRAMES.sent[0]);

      animator.stop();
    });

    it('timer restarts from 0:00 on re-entering recording', async () => {
      const updateFn = vi.fn(() => Promise.resolve());
      const animator = createIconAnimator(updateFn);

      animator.setConditions({ recording: true, pendingTurns: 0, streaming: false });
      animator.start();
      await vi.advanceTimersByTimeAsync(5000);

      // Leave recording
      animator.setConditions({ recording: false, pendingTurns: 1, streaming: false });
      // Flush microtask so inFlight clears from the sent tick
      await vi.advanceTimersByTimeAsync(0);
      // Re-enter recording
      animator.setConditions({ recording: true, pendingTurns: 1, streaming: false });

      const lastCall = updateFn.mock.calls[updateFn.mock.calls.length - 1] as unknown[];
      const output = lastCall[0] as string;
      // Should contain 0:00 (reset timer) and recording dot
      expect(output).toMatch(/[●○] 0:00/);

      animator.stop();
    });
  });
});
