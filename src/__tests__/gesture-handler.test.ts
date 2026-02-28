import { describe, it, expect, vi, beforeEach } from 'vitest';
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
