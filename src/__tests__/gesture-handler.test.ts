import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGestureHandler, getHintText } from '../gestures/gesture-handler';
import { createEventBus } from '../events';
import type { AppEventMap } from '../types';
import type { BridgeService } from '../bridge/bridge-types';
import type { AudioCapture } from '../audio/audio-capture';

function makeMockBridge(): BridgeService {
  return {
    init: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    destroy: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    startAudio: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    stopAudio: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    textContainerUpgrade: vi.fn<(id: number, c: string) => Promise<boolean>>().mockResolvedValue(true),
    rebuildPageContainer: vi.fn().mockResolvedValue(true),
  };
}

function makeMockAudioCapture(): AudioCapture {
  const blob = new Blob(['test-audio'], { type: 'audio/pcm' });
  return {
    startRecording: vi.fn<(sessionId: string) => void>(),
    stopRecording: vi.fn<() => Promise<Blob>>().mockResolvedValue(blob),
    onFrame: vi.fn<(pcm: Uint8Array) => void>(),
    isRecording: vi.fn<() => boolean>().mockReturnValue(false),
  };
}

describe('createGestureHandler', () => {
  let bus: ReturnType<typeof createEventBus<AppEventMap>>;
  let bridge: BridgeService;
  let audioCapture: AudioCapture;
  let sessionId: string;

  beforeEach(() => {
    bus = createEventBus<AppEventMap>();
    bridge = makeMockBridge();
    audioCapture = makeMockAudioCapture();
    sessionId = 'test-session-1';
  });

  function createHandler() {
    return createGestureHandler({
      bus,
      bridge,
      audioCapture,
      activeSessionId: () => sessionId,
    });
  }

  // ── State tracking ─────────────────────────────────────────

  describe('state tracking', () => {
    it('starts in idle state', () => {
      const handler = createHandler();
      expect(handler.getState()).toBe('idle');
    });

    it('transitions to recording after tap', () => {
      const handler = createHandler();
      bus.emit('gesture:tap', { timestamp: 1000 });
      expect(handler.getState()).toBe('recording');
    });

    it('transitions to sent after second tap', () => {
      const handler = createHandler();
      bus.emit('gesture:tap', { timestamp: 1000 });
      bus.emit('gesture:tap', { timestamp: 1300 }); // 300ms apart, not debounced
      expect(handler.getState()).toBe('sent');
    });
  });

  // ── Debounce behavior ──────────────────────────────────────

  describe('debounce', () => {
    it('suppresses second tap within 275ms', () => {
      const handler = createHandler();
      bus.emit('gesture:tap', { timestamp: 1000 }); // tap -> recording
      bus.emit('gesture:tap', { timestamp: 1100 }); // 100ms later -> suppressed
      expect(handler.getState()).toBe('recording'); // still recording, not sent
      expect(bridge.startAudio).toHaveBeenCalledTimes(1);
    });

    it('allows second tap after 275ms', () => {
      const handler = createHandler();
      bus.emit('gesture:tap', { timestamp: 1000 }); // tap -> recording
      bus.emit('gesture:tap', { timestamp: 1300 }); // 300ms later -> processed
      expect(handler.getState()).toBe('sent');
    });

    it('suppresses tap 200ms before double-tap (race condition prevention)', () => {
      const handler = createHandler();
      // In the real scenario: user physically double-taps, but the bridge
      // emits tap first, then double-tap 200ms later.
      bus.emit('gesture:tap', { timestamp: 1000 }); // tap -> recording
      // The debounce only applies to 'tap' inputs, not 'double-tap',
      // so the double-tap is processed (FSM ignores double-tap in recording state)
      bus.emit('gesture:double-tap', { timestamp: 1200 });
      // Double-tap in recording is ignored by FSM (no transition)
      expect(handler.getState()).toBe('recording');
    });

    it('does not debounce double-tap input', () => {
      const handler = createHandler();
      // double-tap is never debounced; only taps are
      bus.emit('gesture:double-tap', { timestamp: 1000 }); // idle -> menu
      expect(handler.getState()).toBe('menu');
    });

    it('suppresses trailing tap within 275ms after double-tap (SDK quirk)', () => {
      const handler = createHandler();
      const menuToggleSpy = vi.fn();
      const menuSelectSpy = vi.fn();
      bus.on('gesture:menu-toggle', menuToggleSpy);
      bus.on('menu:select', menuSelectSpy);

      // Real hardware: SDK fires double-click then a trailing click ~50ms later
      bus.emit('gesture:double-tap', { timestamp: 1000 }); // idle -> menu
      expect(handler.getState()).toBe('menu');
      expect(menuToggleSpy).toHaveBeenCalledWith({ active: true });

      // Trailing tap within debounce window must be suppressed
      bus.emit('gesture:tap', { timestamp: 1050 }); // should be debounced
      expect(handler.getState()).toBe('menu'); // still in menu, NOT menu:select
      expect(menuSelectSpy).not.toHaveBeenCalled();
    });

    it('allows tap in menu after debounce window (intentional select)', () => {
      const handler = createHandler();
      const menuSelectSpy = vi.fn();
      bus.on('menu:select', menuSelectSpy);

      bus.emit('gesture:double-tap', { timestamp: 1000 }); // idle -> menu
      expect(handler.getState()).toBe('menu');

      // Intentional tap well after debounce window
      bus.emit('gesture:tap', { timestamp: 1300 }); // 300ms later -> processed
      expect(handler.getState()).toBe('menu'); // menu state, MENU_SELECT keeps in menu
      expect(menuSelectSpy).toHaveBeenCalledTimes(1);
    });

    it('does not debounce scroll events', () => {
      const handler = createHandler();
      bus.emit('gesture:scroll-up', { timestamp: 1000 });
      bus.emit('gesture:scroll-up', { timestamp: 1050 }); // 50ms apart, still processed
      // Both processed (both stay in idle with SCROLL_UP action)
      expect(handler.getState()).toBe('idle');
    });
  });

  // ── Action dispatch ────────────────────────────────────────

  describe('action dispatch', () => {
    it('tap in idle emits audio:recording-start', () => {
      const handler = createHandler();
      const spy = vi.fn();
      bus.on('audio:recording-start', spy);
      bus.emit('gesture:tap', { timestamp: 1000 });
      expect(spy).toHaveBeenCalledWith({ sessionId: 'test-session-1' });
      expect(handler.getState()).toBe('recording');
    });

    it('tap in recording emits audio:recording-stop with blob', async () => {
      createHandler();
      const spy = vi.fn();
      bus.on('audio:recording-stop', spy);
      bus.emit('gesture:tap', { timestamp: 1000 }); // idle -> recording
      bus.emit('gesture:tap', { timestamp: 1300 }); // recording -> sent

      // stopRecording returns a promise, so we need to flush microtasks
      await vi.waitFor(() => {
        expect(spy).toHaveBeenCalledTimes(1);
      });
      expect(spy).toHaveBeenCalledWith({
        sessionId: 'test-session-1',
        blob: expect.any(Blob),
      });
    });

    it('double-tap in idle emits gesture:menu-toggle with active=true', () => {
      createHandler();
      const spy = vi.fn();
      bus.on('gesture:menu-toggle', spy);
      bus.emit('gesture:double-tap', { timestamp: 1000 }); // idle -> menu
      expect(spy).toHaveBeenCalledWith({ active: true });
    });

    it('double-tap in menu emits gesture:menu-toggle with active=false', () => {
      createHandler();
      const spy = vi.fn();
      bus.on('gesture:menu-toggle', spy);
      bus.emit('gesture:double-tap', { timestamp: 1000 }); // idle -> menu
      bus.emit('gesture:double-tap', { timestamp: 1300 }); // menu -> idle
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenLastCalledWith({ active: false });
    });
  });

  // ── Bridge integration ─────────────────────────────────────

  describe('bridge integration', () => {
    it('START_RECORDING calls audioCapture.startRecording and bridge.startAudio', () => {
      createHandler();
      bus.emit('gesture:tap', { timestamp: 1000 }); // idle -> recording
      expect(audioCapture.startRecording).toHaveBeenCalledWith('test-session-1');
      expect(bridge.startAudio).toHaveBeenCalledTimes(1);
    });

    it('STOP_RECORDING calls bridge.stopAudio and audioCapture.stopRecording', () => {
      createHandler();
      bus.emit('gesture:tap', { timestamp: 1000 }); // idle -> recording
      bus.emit('gesture:tap', { timestamp: 1300 }); // recording -> sent
      expect(bridge.stopAudio).toHaveBeenCalledTimes(1);
      expect(audioCapture.stopRecording).toHaveBeenCalledTimes(1);
    });
  });

  // ── Error recovery (gateway:chunk reset) ───────────────────

  describe('error recovery', () => {
    it('gateway:chunk error resets FSM from sent to idle', () => {
      const handler = createHandler();
      // idle -> recording -> sent
      bus.emit('gesture:tap', { timestamp: 1000 });
      bus.emit('gesture:tap', { timestamp: 1300 });
      expect(handler.getState()).toBe('sent');

      // Error chunk should reset to idle
      bus.emit('gateway:chunk', { type: 'error', error: 'test error' });
      expect(handler.getState()).toBe('idle');
    });

    it('gateway:chunk error resets FSM from recording to idle', () => {
      const handler = createHandler();
      // idle -> recording
      bus.emit('gesture:tap', { timestamp: 1000 });
      expect(handler.getState()).toBe('recording');

      // Error chunk should reset to idle (and trigger STOP_RECORDING action)
      bus.emit('gateway:chunk', { type: 'error', error: 'connection lost' });
      expect(handler.getState()).toBe('idle');
    });

    it('gateway:chunk non-error types do NOT reset FSM', () => {
      const handler = createHandler();
      // idle -> recording -> sent
      bus.emit('gesture:tap', { timestamp: 1000 });
      bus.emit('gesture:tap', { timestamp: 1300 });
      expect(handler.getState()).toBe('sent');

      // Non-error chunk types should not trigger reset
      bus.emit('gateway:chunk', { type: 'response_start' });
      expect(handler.getState()).toBe('sent');

      bus.emit('gateway:chunk', { type: 'response_delta', text: 'hello' });
      expect(handler.getState()).toBe('sent');

      bus.emit('gateway:chunk', { type: 'response_end' });
      expect(handler.getState()).toBe('sent');
    });
  });

  // ── Destroy ────────────────────────────────────────────────

  describe('destroy', () => {
    it('unsubscribes from all bus events', () => {
      const handler = createHandler();
      handler.destroy();
      bus.emit('gesture:tap', { timestamp: 2000 });
      expect(handler.getState()).toBe('idle'); // no change
      expect(bridge.startAudio).not.toHaveBeenCalled();
    });
  });

  // ── FSM watchdog ──────────────────────────────────────────

  describe('FSM watchdog', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('resets FSM to idle after 45s in recording state', () => {
      const handler = createHandler();
      bus.emit('gesture:tap', { timestamp: 1000 });
      expect(handler.getState()).toBe('recording');

      vi.advanceTimersByTime(45_000);
      expect(handler.getState()).toBe('idle');
    });

    it('resets FSM to idle after 45s in sent state', () => {
      const handler = createHandler();
      bus.emit('gesture:tap', { timestamp: 1000 });
      bus.emit('gesture:tap', { timestamp: 1300 });
      expect(handler.getState()).toBe('sent');

      vi.advanceTimersByTime(45_000);
      expect(handler.getState()).toBe('idle');
    });

    it('emits fsm:watchdog-reset event with previousState and elapsed', () => {
      createHandler(); // handler created for side-effects (bus subscription)
      const spy = vi.fn();
      bus.on('fsm:watchdog-reset', spy);

      bus.emit('gesture:tap', { timestamp: 1000 }); // idle -> recording
      vi.advanceTimersByTime(45_000);

      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith({
        previousState: 'recording',
        elapsed: 45_000,
      });
    });

    it('emits log warning when watchdog fires', () => {
      createHandler();
      const logSpy = vi.fn();
      bus.on('log', logSpy);

      bus.emit('gesture:tap', { timestamp: 1000 }); // idle -> recording
      vi.advanceTimersByTime(45_000);

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warn',
          msg: expect.stringContaining('watchdog'),
        }),
      );
    });

    it('does NOT fire watchdog in idle state', () => {
      createHandler();
      const spy = vi.fn();
      bus.on('fsm:watchdog-reset', spy);

      vi.advanceTimersByTime(60_000);
      expect(spy).not.toHaveBeenCalled();
    });

    it('does NOT fire watchdog in menu state', () => {
      createHandler();
      const spy = vi.fn();
      bus.on('fsm:watchdog-reset', spy);

      bus.emit('gesture:double-tap', { timestamp: 1000 }); // idle -> menu
      vi.advanceTimersByTime(60_000);
      expect(spy).not.toHaveBeenCalled();
    });

    it('resets watchdog timer on response_delta chunks (keeps alive during streaming)', () => {
      createHandler();
      const spy = vi.fn();
      bus.on('fsm:watchdog-reset', spy);

      bus.emit('gesture:tap', { timestamp: 1000 }); // idle -> recording
      bus.emit('gesture:tap', { timestamp: 1300 }); // recording -> sent

      // Advance 30s, then send a delta (resets the 45s window)
      vi.advanceTimersByTime(30_000);
      bus.emit('gateway:chunk', { type: 'response_delta', text: 'hello' });

      // Advance another 30s -- only 30s since last delta, should NOT fire
      vi.advanceTimersByTime(30_000);
      expect(spy).not.toHaveBeenCalled();

      // Advance remaining 15s to hit 45s since last delta -- NOW it fires
      vi.advanceTimersByTime(15_000);
      expect(spy).toHaveBeenCalledOnce();
    });

    it('clears watchdog on state transition to idle (no double-fire after error reset)', () => {
      createHandler();
      const spy = vi.fn();
      bus.on('fsm:watchdog-reset', spy);

      bus.emit('gesture:tap', { timestamp: 1000 }); // idle -> recording
      bus.emit('gesture:tap', { timestamp: 1300 }); // recording -> sent

      // Error chunk resets FSM to idle, which clears watchdog
      vi.advanceTimersByTime(10_000);
      bus.emit('gateway:chunk', { type: 'error', error: 'test error' });

      // Advance past 45s -- watchdog should NOT fire (was cleared on reset)
      vi.advanceTimersByTime(45_000);
      expect(spy).not.toHaveBeenCalled();
    });

    it('clears watchdog on destroy', () => {
      const handler = createHandler();
      const spy = vi.fn();
      bus.on('fsm:watchdog-reset', spy);

      bus.emit('gesture:tap', { timestamp: 1000 }); // idle -> recording
      handler.destroy();

      vi.advanceTimersByTime(45_000);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});

// ── Hint text (standalone function) ────────────────────────

describe('getHintText', () => {
  it('returns correct text for idle', () => {
    expect(getHintText('idle')).toBe('Tap to record | Double-tap for menu');
  });

  it('returns correct text for recording', () => {
    expect(getHintText('recording')).toBe('Tap to stop recording');
  });

  it('returns correct text for sent', () => {
    expect(getHintText('sent')).toBe('Processing...');
  });

  it('returns correct text for thinking', () => {
    expect(getHintText('thinking')).toBe('AI is thinking... | Double-tap for menu');
  });

  it('returns correct text for menu', () => {
    expect(getHintText('menu')).toBe('Double-tap to close | Scroll to navigate');
  });

  it('all 5 states produce non-empty text', () => {
    const states = ['idle', 'recording', 'sent', 'thinking', 'menu'] as const;
    for (const s of states) {
      expect(getHintText(s)).toBeTruthy();
      expect(getHintText(s).length).toBeGreaterThan(0);
    }
  });
});

// ── Handler hint text via getHintText() method ─────────────

describe('handler.getHintText()', () => {
  it('returns hint text for current state', () => {
    const bus = createEventBus<AppEventMap>();
    const handler = createGestureHandler({
      bus,
      bridge: makeMockBridge(),
      audioCapture: makeMockAudioCapture(),
      activeSessionId: () => 'sess',
    });
    expect(handler.getHintText()).toBe('Tap to record | Double-tap for menu');
    bus.emit('gesture:tap', { timestamp: 1000 });
    expect(handler.getHintText()).toBe('Tap to stop recording');
  });
});
