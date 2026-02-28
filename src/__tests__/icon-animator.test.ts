import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createIconAnimator } from '../display/icon-animator';
import { ICON_FRAMES } from '../display/icon-bitmaps';

describe('IconAnimator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('setState("idle") calls updateFn with idle frame immediately', async () => {
    const updateFn = vi.fn(() => Promise.resolve());
    const animator = createIconAnimator(updateFn);

    animator.setState('idle');

    expect(updateFn).toHaveBeenCalledWith(ICON_FRAMES.idle[0]);
  });

  it('setState("recording") calls updateFn with recording frame immediately', async () => {
    const updateFn = vi.fn(() => Promise.resolve());
    const animator = createIconAnimator(updateFn);

    animator.setState('recording');

    expect(updateFn).toHaveBeenCalledWith(ICON_FRAMES.recording[0]);
  });

  it('getState() returns current state', () => {
    const updateFn = vi.fn(() => Promise.resolve());
    const animator = createIconAnimator(updateFn);

    expect(animator.getState()).toBe('idle');
    animator.setState('thinking');
    expect(animator.getState()).toBe('thinking');
  });

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

  it('setState resets frameIdx (cycling starts from frame 0)', async () => {
    const updateFn = vi.fn(() => Promise.resolve());
    const animator = createIconAnimator(updateFn);

    animator.setState('thinking');
    // Should get frame 0 of thinking
    expect(updateFn).toHaveBeenLastCalledWith(ICON_FRAMES.thinking[0]);

    animator.start();

    // Advance: should get frame 1
    await vi.advanceTimersByTimeAsync(200);
    expect(updateFn).toHaveBeenLastCalledWith(ICON_FRAMES.thinking[1]);

    // Now switch state -- frameIdx resets
    animator.setState('recording');
    expect(updateFn).toHaveBeenLastCalledWith(ICON_FRAMES.recording[0]);

    animator.stop();
  });

  it('cycles through all frames of a multi-frame state', async () => {
    const updateFn = vi.fn(() => Promise.resolve());
    const animator = createIconAnimator(updateFn);

    animator.setState('thinking');
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
