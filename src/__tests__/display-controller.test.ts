// ── Tests for DisplayController (bus event -> GlassesRenderer wiring) ──
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { createDisplayController, type DisplayController } from '../display/display-controller';
import { createEventBus } from '../events';
import type { AppEventMap } from '../types';


// ── Mock types (every method is a vi.fn mock) ──────────────

interface MockRenderer {
  init: Mock<() => Promise<void>>;
  destroy: Mock;
  setIconState: Mock;
  addUserMessage: Mock;
  startStreaming: Mock;
  appendStreamChunk: Mock;
  endStreaming: Mock;
  scrollUp: Mock;
  scrollDown: Mock;
  hide: Mock<() => Promise<void>>;
  wake: Mock<() => Promise<void>>;
  isHidden: Mock<() => boolean>;
  showWelcome: Mock;
  showConfigRequired: Mock;
  showError: Mock;
  showMenuOverlay: Mock;
  restoreConversation: Mock;
  getIconAnimator: Mock;
  getViewportState: Mock;
}

// ── Mock GlassesRenderer (all methods as vi.fn()) ──────────

function createMockRenderer(): MockRenderer {
  return {
    init: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    destroy: vi.fn(),
    setIconState: vi.fn(),
    addUserMessage: vi.fn(),
    startStreaming: vi.fn(),
    appendStreamChunk: vi.fn(),
    endStreaming: vi.fn(),
    scrollUp: vi.fn(),
    scrollDown: vi.fn(),
    hide: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    wake: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    isHidden: vi.fn<() => boolean>().mockReturnValue(false),
    showWelcome: vi.fn(),
    showConfigRequired: vi.fn(),
    showError: vi.fn(),
    showMenuOverlay: vi.fn(),
    restoreConversation: vi.fn(),
    getIconAnimator: vi.fn().mockReturnValue(null),
    getViewportState: vi.fn().mockReturnValue({ messages: [], scrollOffset: 0, autoScroll: true }),
  };
}

describe('DisplayController', () => {
  let bus: ReturnType<typeof createEventBus<AppEventMap>>;
  let renderer: MockRenderer;
  let controller: DisplayController;

  beforeEach(async () => {
    vi.useFakeTimers();
    bus = createEventBus<AppEventMap>();
    renderer = createMockRenderer();
    controller = createDisplayController({ bus, renderer });
    await controller.init();
  });

  afterEach(() => {
    controller.destroy();
    vi.useRealTimers();
  });

  // ── Lifecycle ────────────────────────────────────────────

  describe('lifecycle', () => {
    it('init() calls renderer.init()', () => {
      // init was already called in beforeEach
      expect(renderer.init).toHaveBeenCalledOnce();
    });

    it('destroy() unsubscribes: events after destroy do NOT call renderer methods', () => {
      controller.destroy();
      renderer.addUserMessage.mockClear();
      renderer.startStreaming.mockClear();
      renderer.scrollUp.mockClear();
      renderer.setIconState.mockClear();

      bus.emit('gateway:chunk', { type: 'transcript', text: 'hello' });
      bus.emit('gesture:scroll-up', { timestamp: Date.now() });
      bus.emit('audio:recording-start', { sessionId: 's1' });

      expect(renderer.addUserMessage).not.toHaveBeenCalled();
      expect(renderer.startStreaming).not.toHaveBeenCalled();
      expect(renderer.scrollUp).not.toHaveBeenCalled();
      expect(renderer.setIconState).not.toHaveBeenCalled();
    });

    it('destroy() calls renderer.destroy()', () => {
      controller.destroy();
      expect(renderer.destroy).toHaveBeenCalledOnce();
    });
  });

  // ── Streaming flow (CHAT-03) ─────────────────────────────

  describe('streaming flow (CHAT-03)', () => {
    it('gateway:chunk type=transcript -> addUserMessage (icon resolved via priority)', () => {
      // Simulate a turn in-flight: stop-requested increments pendingTurns
      bus.emit('audio:stop-requested', {});
      renderer.setIconState.mockClear();

      bus.emit('gateway:chunk', { type: 'transcript', text: 'Hello world' });

      expect(renderer.addUserMessage).toHaveBeenCalledWith('Hello world');
      // Icon stays 'sent' because pendingTurns > 0 — already applied, no change call
      // (resolveIcon is idempotent when state hasn't changed)
    });

    it('gateway:chunk type=response_start -> startStreaming + icon resolved', () => {
      // Setup: have a pending turn so we get 'sent' state first
      bus.emit('audio:stop-requested', {});
      renderer.setIconState.mockClear();

      bus.emit('gateway:chunk', { type: 'response_start' });

      expect(renderer.startStreaming).toHaveBeenCalledOnce();
      // With pendingTurns > 0, priority is 'sent' (higher than 'thinking')
      // So no icon change expected here — sent beats thinking
    });

    it('gateway:chunk type=response_start sets thinking when no pending turns', () => {
      renderer.setIconState.mockClear();
      bus.emit('gateway:chunk', { type: 'response_start' });

      expect(renderer.startStreaming).toHaveBeenCalledOnce();
      expect(renderer.setIconState).toHaveBeenCalledWith('thinking');
    });

    it('gateway:chunk type=response_delta -> appendStreamChunk with text', () => {
      bus.emit('gateway:chunk', { type: 'response_delta', text: 'chunk data' });

      expect(renderer.appendStreamChunk).toHaveBeenCalledWith('chunk data');
    });

    it('gateway:chunk type=response_end -> endStreaming + setIconState(idle) after 500ms', () => {
      // Setup: simulate a pending turn so we start from non-idle state
      bus.emit('audio:stop-requested', {});
      renderer.setIconState.mockClear();

      bus.emit('gateway:chunk', { type: 'response_end' });

      expect(renderer.endStreaming).toHaveBeenCalledOnce();
      // Idle icon is delayed by 500ms settle period
      expect(renderer.setIconState).not.toHaveBeenCalledWith('idle');

      vi.advanceTimersByTime(500);
      expect(renderer.setIconState).toHaveBeenCalledWith('idle');
    });

    it('gateway:chunk type=error -> endStreaming + showError + setIconState(idle) after 500ms', () => {
      // Setup: simulate a pending turn so we start from non-idle state
      bus.emit('audio:stop-requested', {});
      renderer.setIconState.mockClear();

      bus.emit('gateway:chunk', { type: 'error', error: 'something broke' });

      expect(renderer.endStreaming).toHaveBeenCalledOnce();
      expect(renderer.showError).toHaveBeenCalledWith('something broke');
      // Idle icon is delayed by 500ms settle period
      expect(renderer.setIconState).not.toHaveBeenCalledWith('idle');

      vi.advanceTimersByTime(500);
      expect(renderer.setIconState).toHaveBeenCalledWith('idle');
    });

    it('gateway:chunk type=error with no error field -> showError with fallback message', () => {
      bus.emit('gateway:chunk', { type: 'error' });

      expect(renderer.showError).toHaveBeenCalledWith('Something went wrong');
    });
  });

  // ── Scroll flow (CHAT-05, CHAT-06) ──────────────────────

  describe('scroll flow (CHAT-05, CHAT-06)', () => {
    it('gesture:scroll-up -> renderer.scrollUp when display is visible', () => {
      renderer.isHidden.mockReturnValue(false);
      bus.emit('gesture:scroll-up', { timestamp: Date.now() });

      expect(renderer.scrollUp).toHaveBeenCalledOnce();
    });

    it('gesture:scroll-down -> renderer.scrollDown when display is visible', () => {
      renderer.isHidden.mockReturnValue(false);
      bus.emit('gesture:scroll-down', { timestamp: Date.now() });

      expect(renderer.scrollDown).toHaveBeenCalledOnce();
    });

    it('gesture:scroll-up does NOT call scrollUp when display is hidden', () => {
      renderer.isHidden.mockReturnValue(true);
      bus.emit('gesture:scroll-up', { timestamp: Date.now() });

      expect(renderer.scrollUp).not.toHaveBeenCalled();
    });

    it('gesture:scroll-down does NOT call scrollDown when display is hidden', () => {
      renderer.isHidden.mockReturnValue(true);
      bus.emit('gesture:scroll-down', { timestamp: Date.now() });

      expect(renderer.scrollDown).not.toHaveBeenCalled();
    });
  });

  // ── Hide/wake flow (UIMD-01, UIMD-02) ──────────────────

  describe('hide/wake flow (UIMD-01, UIMD-02)', () => {
    it('gesture:menu-toggle active=true -> sets menuActive flag (scroll guard), no hide', () => {
      bus.emit('gesture:menu-toggle', { active: true });

      // Menu controller handles overlay display; display controller only guards scroll
      expect(renderer.hide).not.toHaveBeenCalled();

      // Verify scroll guard is active: scroll events should NOT reach renderer
      renderer.scrollUp.mockClear();
      bus.emit('gesture:scroll-up', { timestamp: Date.now() });
      expect(renderer.scrollUp).not.toHaveBeenCalled();
    });

    it('gesture:menu-toggle active=false -> renderer.wake', () => {
      bus.emit('gesture:menu-toggle', { active: false });

      expect(renderer.wake).toHaveBeenCalledOnce();
    });

    it('gesture:double-tap when hidden -> renderer.wake', () => {
      renderer.isHidden.mockReturnValue(true);
      bus.emit('gesture:double-tap', { timestamp: Date.now() });

      expect(renderer.wake).toHaveBeenCalledOnce();
    });

    it('gesture:double-tap when visible does NOT call wake', () => {
      renderer.isHidden.mockReturnValue(false);
      bus.emit('gesture:double-tap', { timestamp: Date.now() });

      expect(renderer.wake).not.toHaveBeenCalled();
    });
  });

  // ── Icon state flow ──────────────────────────────────────

  describe('icon state flow', () => {
    it('audio:recording-start -> setIconState(recording)', () => {
      renderer.setIconState.mockClear();
      bus.emit('audio:recording-start', { sessionId: 'session-1' });

      expect(renderer.setIconState).toHaveBeenCalledWith('recording');
    });

    it('audio:stop-requested -> immediate setIconState(sent)', () => {
      // First start recording so we are in recording state
      bus.emit('audio:recording-start', { sessionId: 'session-1' });
      renderer.setIconState.mockClear();

      bus.emit('audio:stop-requested', {});

      expect(renderer.setIconState).toHaveBeenCalledWith('sent');
    });

    it('audio:recording-stop does NOT change icon state (handled by stop-requested)', () => {
      bus.emit('audio:recording-start', { sessionId: 'session-1' });
      bus.emit('audio:stop-requested', {});
      renderer.setIconState.mockClear();

      bus.emit('audio:recording-stop', { sessionId: 'session-1', blob: new Blob() });

      // No setIconState call — icon was already set to 'sent' by stop-requested
      expect(renderer.setIconState).not.toHaveBeenCalled();
    });

    it('audio:recording-start cancels pending settle timer from error', () => {
      // Fire an error chunk to start the 500ms settle timer
      bus.emit('gateway:chunk', { type: 'error', error: 'fail' });
      renderer.setIconState.mockClear();

      // Start recording immediately (before 500ms settle fires)
      bus.emit('audio:recording-start', { sessionId: 'session-2' });
      expect(renderer.setIconState).toHaveBeenCalledWith('recording');

      renderer.setIconState.mockClear();

      // Advance past the 500ms settle -- it should have been cancelled
      vi.advanceTimersByTime(500);
      expect(renderer.setIconState).not.toHaveBeenCalledWith('idle');
    });
  });

  // ── Priority-based icon resolution ────────────────────────

  describe('priority-based icon resolution', () => {
    it('stop-tap shows loading dots immediately (no wait for async audio stop)', () => {
      // Simulate: user taps to start recording
      bus.emit('audio:recording-start', { sessionId: 's1' });
      expect(renderer.setIconState).toHaveBeenCalledWith('recording');
      renderer.setIconState.mockClear();

      // User taps to stop — stop-requested fires synchronously, before any async
      bus.emit('audio:stop-requested', {});
      expect(renderer.setIconState).toHaveBeenCalledWith('sent');

      // Later, async blob arrives — no icon change
      renderer.setIconState.mockClear();
      bus.emit('audio:recording-stop', { sessionId: 's1', blob: new Blob() });
      expect(renderer.setIconState).not.toHaveBeenCalled();
    });

    it('response_end from previous turn does NOT override active recording icon', () => {
      // Turn A: record, stop, pending turn
      bus.emit('audio:recording-start', { sessionId: 's1' });
      bus.emit('audio:stop-requested', {});
      renderer.setIconState.mockClear();

      // Turn B: start new recording while turn A is processing
      bus.emit('audio:recording-start', { sessionId: 's2' });
      expect(renderer.setIconState).toHaveBeenCalledWith('recording');
      renderer.setIconState.mockClear();

      // Turn A's response_end arrives while user is still recording turn B
      bus.emit('gateway:chunk', { type: 'response_end' });
      vi.advanceTimersByTime(500);

      // Icon must still be 'recording' (recording > idle)
      // The settle timer decremented pendingTurns, but recording is higher priority
      expect(renderer.setIconState).not.toHaveBeenCalledWith('idle');
      expect(renderer.setIconState).not.toHaveBeenCalledWith('sent');
    });

    it('overlapping turns maintain deterministic status priority', () => {
      // Turn A: record and stop
      bus.emit('audio:recording-start', { sessionId: 's1' });
      bus.emit('audio:stop-requested', {});
      expect(renderer.setIconState).toHaveBeenCalledWith('sent');

      // Turn A response flows
      bus.emit('gateway:chunk', { type: 'transcript', text: 'hello' });
      bus.emit('gateway:chunk', { type: 'response_start' });

      renderer.setIconState.mockClear();

      // Turn B: start recording while Turn A response is streaming
      bus.emit('audio:recording-start', { sessionId: 's2' });
      expect(renderer.setIconState).toHaveBeenCalledWith('recording');
      renderer.setIconState.mockClear();

      // Turn A response_end arrives mid-recording for Turn B
      bus.emit('gateway:chunk', { type: 'response_end' });
      vi.advanceTimersByTime(500);

      // Must NOT go to idle — still recording
      expect(renderer.setIconState).not.toHaveBeenCalledWith('idle');

      // Stop turn B
      renderer.setIconState.mockClear();
      bus.emit('audio:stop-requested', {});
      expect(renderer.setIconState).toHaveBeenCalledWith('sent');
    });

    it('after all pending processing clears and not recording -> idle', () => {
      // Single turn: record -> stop -> gateway processes -> response_end
      bus.emit('audio:recording-start', { sessionId: 's1' });
      bus.emit('audio:stop-requested', {});
      expect(renderer.setIconState).toHaveBeenCalledWith('sent');

      bus.emit('gateway:chunk', { type: 'transcript', text: 'hello' });
      bus.emit('gateway:chunk', { type: 'response_start' });
      bus.emit('gateway:chunk', { type: 'response_delta', text: 'world' });
      bus.emit('gateway:chunk', { type: 'response_end' });
      renderer.setIconState.mockClear();

      // After 500ms settle, pendingTurns decrements to 0 -> resolves to idle
      vi.advanceTimersByTime(500);
      expect(renderer.setIconState).toHaveBeenCalledWith('idle');
    });

    it('response_start shows thinking only when no pendingTurns (stale chunk)', () => {
      // No pending turns — a stale response_start arrives
      renderer.setIconState.mockClear();
      bus.emit('gateway:chunk', { type: 'response_start' });
      expect(renderer.setIconState).toHaveBeenCalledWith('thinking');
    });

    it('sent priority beats thinking when pendingTurns > 0', () => {
      // Have a pending turn
      bus.emit('audio:stop-requested', {});
      expect(renderer.setIconState).toHaveBeenCalledWith('sent');
      renderer.setIconState.mockClear();

      // Response starts — sent (pendingTurns > 0) has higher priority than thinking
      bus.emit('gateway:chunk', { type: 'response_start' });
      // Should NOT switch to thinking — sent beats thinking
      expect(renderer.setIconState).not.toHaveBeenCalledWith('thinking');
    });

    it('recording priority beats everything', () => {
      // Have a pending turn AND a response streaming
      bus.emit('audio:stop-requested', {});
      bus.emit('gateway:chunk', { type: 'response_start' });
      renderer.setIconState.mockClear();

      // Start recording — recording beats all
      bus.emit('audio:recording-start', { sessionId: 's2' });
      expect(renderer.setIconState).toHaveBeenCalledWith('recording');
    });

    it('error settle does not override recording', () => {
      // Turn A errors
      bus.emit('audio:stop-requested', {});
      bus.emit('gateway:chunk', { type: 'error', error: 'oops' });
      renderer.setIconState.mockClear();

      // Start recording before settle fires
      bus.emit('audio:recording-start', { sessionId: 's2' });
      expect(renderer.setIconState).toHaveBeenCalledWith('recording');

      renderer.setIconState.mockClear();
      // Settle timer fires — but recording is active, so idle should NOT apply
      // Note: settle timer was cleared by recording-start, so nothing happens
      vi.advanceTimersByTime(500);
      expect(renderer.setIconState).not.toHaveBeenCalledWith('idle');
    });

    it('multiple overlapping turns: sent persists until all settle', () => {
      // Turn A: submit
      bus.emit('audio:recording-start', { sessionId: 's1' });
      bus.emit('audio:stop-requested', {});
      expect(renderer.setIconState).toHaveBeenCalledWith('sent');

      // Turn B: submit while A is still processing
      bus.emit('audio:recording-start', { sessionId: 's2' });
      bus.emit('audio:stop-requested', {});

      // Turn A completes
      bus.emit('gateway:chunk', { type: 'response_end' });
      renderer.setIconState.mockClear();
      vi.advanceTimersByTime(500); // settle A

      // pendingTurns went from 2 to 1 — still > 0, so stay 'sent'
      expect(renderer.setIconState).not.toHaveBeenCalledWith('idle');

      // Turn B completes
      bus.emit('gateway:chunk', { type: 'response_end' });
      renderer.setIconState.mockClear();
      vi.advanceTimersByTime(500); // settle B

      // pendingTurns now 0 — idle
      expect(renderer.setIconState).toHaveBeenCalledWith('idle');
    });
  });
});
