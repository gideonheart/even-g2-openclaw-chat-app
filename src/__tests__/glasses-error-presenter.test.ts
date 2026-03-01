// ── Glasses Error Presenter tests ────────────────────────────
// Covers RES-16 (error hierarchy, auto-clear timers) and RES-19 (message mapping, no jargon).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGlassesErrorPresenter } from '../display/error-presenter';

// ── Mock helpers ────────────────────────────────────────────

function createMockBus() {
  const handlers = new Map<string, Set<(payload: any) => void>>();
  const unsubs: Array<() => void> = [];

  function on(event: string, handler: (payload: any) => void): () => void {
    let set = handlers.get(event);
    if (!set) {
      set = new Set();
      handlers.set(event, set);
    }
    set.add(handler);
    const unsub = () => { set!.delete(handler); };
    unsubs.push(unsub);
    return unsub;
  }

  function emit(event: string, payload: any): void {
    const set = handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      handler(payload);
    }
  }

  return { on, emit, _unsubs: unsubs };
}

function createMockBridge() {
  return {
    textContainerUpgrade: vi.fn(() => Promise.resolve(true)),
  };
}

function createMockRenderer() {
  return {
    isHidden: vi.fn(() => false),
  };
}

function createMockIconAnimator() {
  return {
    stop: vi.fn(),
    start: vi.fn(),
  };
}

// ── Tests ───────────────────────────────────────────────────

describe('GlassesErrorPresenter', () => {
  let bus: ReturnType<typeof createMockBus>;
  let bridge: ReturnType<typeof createMockBridge>;
  let renderer: ReturnType<typeof createMockRenderer>;
  let iconAnimator: ReturnType<typeof createMockIconAnimator>;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = createMockBus();
    bridge = createMockBridge();
    renderer = createMockRenderer();
    iconAnimator = createMockIconAnimator();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createPresenter() {
    return createGlassesErrorPresenter({
      bus: bus as any,
      bridge: bridge as any,
      renderer: renderer as any,
      iconAnimator,
    });
  }

  describe('persistence:error — transient (recoverable=false)', () => {
    it('shows user-friendly message via bridge.textContainerUpgrade(1, ...)', () => {
      createPresenter();
      bus.emit('persistence:error', { type: 'write-failed', recoverable: false });

      expect(bridge.textContainerUpgrade).toHaveBeenCalledWith(1, 'Could not save message');
    });

    it('auto-clears after 3000ms', () => {
      createPresenter();
      bus.emit('persistence:error', { type: 'write-failed', recoverable: false });

      // After 3s, iconAnimator.start should be called (restoring animation)
      vi.advanceTimersByTime(3000);

      expect(iconAnimator.start).toHaveBeenCalled();
    });

    it('pauses icon animator on show', () => {
      createPresenter();
      bus.emit('persistence:error', { type: 'write-failed', recoverable: false });

      expect(iconAnimator.stop).toHaveBeenCalled();
      // stop must be called before textContainerUpgrade
      const stopOrder = iconAnimator.stop.mock.invocationCallOrder[0];
      const upgradeOrder = bridge.textContainerUpgrade.mock.invocationCallOrder[0];
      expect(stopOrder).toBeLessThan(upgradeOrder);
    });
  });

  describe('persistence:error — recoverable (recoverable=true)', () => {
    it('shows message with tap to retry suffix', () => {
      createPresenter();
      bus.emit('persistence:error', { type: 'quota-exceeded', recoverable: true });

      expect(bridge.textContainerUpgrade).toHaveBeenCalledWith(
        1,
        expect.stringContaining('Storage full'),
      );
      expect(bridge.textContainerUpgrade).toHaveBeenCalledWith(
        1,
        expect.stringContaining('tap to retry'),
      );
    });

    it('auto-clears after 10000ms', () => {
      createPresenter();
      bus.emit('persistence:error', { type: 'quota-exceeded', recoverable: true });

      vi.advanceTimersByTime(10000);

      expect(iconAnimator.start).toHaveBeenCalled();
    });

    it('does NOT auto-clear at 3000ms', () => {
      createPresenter();
      bus.emit('persistence:error', { type: 'quota-exceeded', recoverable: true });

      // Reset call tracking after the initial show
      bridge.textContainerUpgrade.mockClear();

      vi.advanceTimersByTime(3000);

      // Timer should NOT have fired yet — bridge should not have been called again
      expect(bridge.textContainerUpgrade).not.toHaveBeenCalled();
      expect(iconAnimator.start).not.toHaveBeenCalled();
    });
  });

  describe('persistence:error — message mapping (RES-19)', () => {
    it("maps database-closed to 'Data connection lost \\u2014 reconnecting'", () => {
      createPresenter();
      bus.emit('persistence:error', { type: 'database-closed', recoverable: false });

      expect(bridge.textContainerUpgrade).toHaveBeenCalledWith(
        1,
        'Data connection lost \u2014 reconnecting',
      );
    });

    it("maps quota-exceeded to 'Storage full'", () => {
      createPresenter();
      bus.emit('persistence:error', { type: 'quota-exceeded', recoverable: false });

      expect(bridge.textContainerUpgrade).toHaveBeenCalledWith(1, 'Storage full');
    });

    it("maps write-failed to 'Could not save message'", () => {
      createPresenter();
      bus.emit('persistence:error', { type: 'write-failed', recoverable: false });

      expect(bridge.textContainerUpgrade).toHaveBeenCalledWith(1, 'Could not save message');
    });

    it("maps verify-failed to 'Storage check failed'", () => {
      createPresenter();
      bus.emit('persistence:error', { type: 'verify-failed', recoverable: false });

      expect(bridge.textContainerUpgrade).toHaveBeenCalledWith(1, 'Storage check failed');
    });

    it("maps unknown type to 'Something went wrong'", () => {
      createPresenter();
      bus.emit('persistence:error', { type: 'some-unknown-type' as any, recoverable: false });

      expect(bridge.textContainerUpgrade).toHaveBeenCalledWith(1, 'Something went wrong');
    });
  });

  describe('fsm:watchdog-reset', () => {
    it('shows tap-to-retry message with 5000ms auto-clear', () => {
      createPresenter();
      bus.emit('fsm:watchdog-reset', { previousState: 'recording', elapsed: 45000 });

      expect(bridge.textContainerUpgrade).toHaveBeenCalledWith(
        1,
        expect.stringContaining('timed out'),
      );
      expect(bridge.textContainerUpgrade).toHaveBeenCalledWith(
        1,
        expect.stringContaining('tap to retry'),
      );

      // After 5s, iconAnimator.start should be called
      vi.advanceTimersByTime(5000);
      expect(iconAnimator.start).toHaveBeenCalled();
    });
  });

  describe('lastErrorLevel guard — dual-emit ordering', () => {
    it('suppresses persistence:error message if persistence:error already shown', () => {
      createPresenter();

      // First error
      bus.emit('persistence:error', { type: 'write-failed', recoverable: false });
      expect(bridge.textContainerUpgrade).toHaveBeenCalledTimes(1);

      // Second error — should be suppressed by guard
      bus.emit('persistence:error', { type: 'quota-exceeded', recoverable: false });
      expect(bridge.textContainerUpgrade).toHaveBeenCalledTimes(1);
    });
  });

  describe('destroy()', () => {
    it('clears outstanding statusClearTimer on destroy', () => {
      const presenter = createPresenter();
      bus.emit('persistence:error', { type: 'write-failed', recoverable: false });

      // Destroy before timer fires
      presenter.destroy();

      // Reset mock to detect post-destroy calls
      bridge.textContainerUpgrade.mockClear();

      // Advance past the 3s timer — should NOT fire (was cleared)
      vi.advanceTimersByTime(5000);
      expect(iconAnimator.start).not.toHaveBeenCalledAfter(iconAnimator.stop);
    });

    it('unsubscribes all bus handlers', () => {
      const presenter = createPresenter();

      // Track unsub calls by checking that bus no longer delivers events
      presenter.destroy();

      // Reset mock
      bridge.textContainerUpgrade.mockClear();

      // Emit after destroy — should not trigger any handler
      bus.emit('persistence:error', { type: 'write-failed', recoverable: false });
      expect(bridge.textContainerUpgrade).not.toHaveBeenCalled();

      bus.emit('fsm:watchdog-reset', { previousState: 'recording', elapsed: 45000 });
      expect(bridge.textContainerUpgrade).not.toHaveBeenCalled();
    });
  });
});
