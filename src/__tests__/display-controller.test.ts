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
  setRecordingActive: Mock;
  setPendingTurns: Mock;
  setStreamingActive: Mock;
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
  loadMessages: Mock;
}

// ── Mock GlassesRenderer (all methods as vi.fn()) ──────────

function createMockRenderer(): MockRenderer {
  return {
    init: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    destroy: vi.fn(),
    setIconState: vi.fn(),
    setRecordingActive: vi.fn(),
    setPendingTurns: vi.fn(),
    setStreamingActive: vi.fn(),
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
    loadMessages: vi.fn(),
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
      renderer.setRecordingActive.mockClear();

      bus.emit('gateway:chunk', { type: 'transcript', text: 'hello' });
      bus.emit('gesture:scroll-up', { timestamp: Date.now() });
      bus.emit('audio:recording-start', { sessionId: 's1' });

      expect(renderer.addUserMessage).not.toHaveBeenCalled();
      expect(renderer.startStreaming).not.toHaveBeenCalled();
      expect(renderer.scrollUp).not.toHaveBeenCalled();
      expect(renderer.setRecordingActive).not.toHaveBeenCalled();
    });

    it('destroy() calls renderer.destroy()', () => {
      controller.destroy();
      expect(renderer.destroy).toHaveBeenCalledOnce();
    });
  });

  // ── Streaming flow (CHAT-03) ─────────────────────────────

  describe('streaming flow (CHAT-03)', () => {
    it('gateway:chunk type=transcript -> addUserMessage', () => {
      // Simulate a turn in-flight: stop-requested increments pendingTurns
      bus.emit('audio:stop-requested', {});
      renderer.setPendingTurns.mockClear();

      bus.emit('gateway:chunk', { type: 'transcript', text: 'Hello world' });

      expect(renderer.addUserMessage).toHaveBeenCalledWith('Hello world');
      // No pending turns change on transcript -- already set by stop-requested
    });

    it('gateway:chunk type=response_start -> startStreaming + setStreamingActive(true)', () => {
      bus.emit('audio:stop-requested', {});
      renderer.setStreamingActive.mockClear();

      bus.emit('gateway:chunk', { type: 'response_start' });

      expect(renderer.startStreaming).toHaveBeenCalledOnce();
      expect(renderer.setStreamingActive).toHaveBeenCalledWith(true);
    });

    it('gateway:chunk type=response_start sets streaming when no pending turns', () => {
      renderer.setStreamingActive.mockClear();
      bus.emit('gateway:chunk', { type: 'response_start' });

      expect(renderer.startStreaming).toHaveBeenCalledOnce();
      expect(renderer.setStreamingActive).toHaveBeenCalledWith(true);
    });

    it('gateway:chunk type=response_delta -> appendStreamChunk with text', () => {
      bus.emit('gateway:chunk', { type: 'response_delta', text: 'chunk data' });

      expect(renderer.appendStreamChunk).toHaveBeenCalledWith('chunk data');
    });

    it('gateway:chunk type=response_end -> endStreaming + setPendingTurns(0) after 500ms', () => {
      // Setup: simulate a pending turn
      bus.emit('audio:stop-requested', {});
      renderer.setPendingTurns.mockClear();
      renderer.setStreamingActive.mockClear();

      bus.emit('gateway:chunk', { type: 'response_end' });

      expect(renderer.endStreaming).toHaveBeenCalledOnce();
      expect(renderer.setStreamingActive).toHaveBeenCalledWith(false);
      // Pending turns decrement delayed by 500ms settle period
      expect(renderer.setPendingTurns).not.toHaveBeenCalled();

      vi.advanceTimersByTime(500);
      expect(renderer.setPendingTurns).toHaveBeenCalledWith(0);
    });

    it('gateway:chunk type=error -> endStreaming + showError + setPendingTurns(0) after 500ms', () => {
      // Setup: simulate a pending turn
      bus.emit('audio:stop-requested', {});
      renderer.setPendingTurns.mockClear();
      renderer.setStreamingActive.mockClear();

      bus.emit('gateway:chunk', { type: 'error', error: 'something broke' });

      expect(renderer.endStreaming).toHaveBeenCalledOnce();
      expect(renderer.showError).toHaveBeenCalledWith('something broke');
      expect(renderer.setStreamingActive).toHaveBeenCalledWith(false);
      // Pending turns decrement delayed by 500ms settle period
      expect(renderer.setPendingTurns).not.toHaveBeenCalled();

      vi.advanceTimersByTime(500);
      expect(renderer.setPendingTurns).toHaveBeenCalledWith(0);
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

  // ── Condition-based icon wiring ───────────────────────────

  describe('condition-based icon wiring', () => {
    it('audio:recording-start -> setRecordingActive(true)', () => {
      renderer.setRecordingActive.mockClear();
      bus.emit('audio:recording-start', { sessionId: 'session-1' });

      expect(renderer.setRecordingActive).toHaveBeenCalledWith(true);
    });

    it('audio:stop-requested -> setRecordingActive(false) + setPendingTurns(1)', () => {
      // First start recording
      bus.emit('audio:recording-start', { sessionId: 'session-1' });
      renderer.setRecordingActive.mockClear();
      renderer.setPendingTurns.mockClear();

      bus.emit('audio:stop-requested', {});

      expect(renderer.setRecordingActive).toHaveBeenCalledWith(false);
      expect(renderer.setPendingTurns).toHaveBeenCalledWith(1);
    });

    it('audio:recording-stop does NOT change conditions (handled by stop-requested)', () => {
      bus.emit('audio:recording-start', { sessionId: 'session-1' });
      bus.emit('audio:stop-requested', {});
      renderer.setRecordingActive.mockClear();
      renderer.setPendingTurns.mockClear();

      bus.emit('audio:recording-stop', { sessionId: 'session-1', blob: new Blob() });

      expect(renderer.setRecordingActive).not.toHaveBeenCalled();
      expect(renderer.setPendingTurns).not.toHaveBeenCalled();
    });

    it('audio:recording-start cancels pending settle timer from error', () => {
      // Fire an error chunk to start the 500ms settle timer
      bus.emit('audio:stop-requested', {});
      bus.emit('gateway:chunk', { type: 'error', error: 'fail' });
      renderer.setPendingTurns.mockClear();
      renderer.setRecordingActive.mockClear();

      // Start recording immediately (before 500ms settle fires)
      bus.emit('audio:recording-start', { sessionId: 'session-2' });
      expect(renderer.setRecordingActive).toHaveBeenCalledWith(true);

      renderer.setPendingTurns.mockClear();

      // Advance past the 500ms settle -- it should have been cancelled
      vi.advanceTimersByTime(500);
      expect(renderer.setPendingTurns).not.toHaveBeenCalled();
    });

    it('response_start -> setStreamingActive(true)', () => {
      renderer.setStreamingActive.mockClear();
      bus.emit('gateway:chunk', { type: 'response_start' });
      expect(renderer.setStreamingActive).toHaveBeenCalledWith(true);
    });

    it('response_end -> setStreamingActive(false)', () => {
      bus.emit('gateway:chunk', { type: 'response_start' });
      renderer.setStreamingActive.mockClear();
      bus.emit('gateway:chunk', { type: 'response_end' });
      expect(renderer.setStreamingActive).toHaveBeenCalledWith(false);
    });
  });

  // ── Overlap scenarios (core requirement) ──────────────────

  describe('overlap scenarios (recording + loading parallel)', () => {
    it('stop A, start B while A pending -> both setRecordingActive(true) and pendingTurns > 0', () => {
      // Turn A: stop -> pending=1
      bus.emit('audio:stop-requested', {});
      expect(renderer.setPendingTurns).toHaveBeenCalledWith(1);

      renderer.setRecordingActive.mockClear();
      renderer.setPendingTurns.mockClear();

      // Turn B: start recording while A is pending
      bus.emit('audio:recording-start', { sessionId: 's2' });
      expect(renderer.setRecordingActive).toHaveBeenCalledWith(true);
      // setPendingTurns was NOT called (still 1 from stop-requested)
      // This proves both conditions are active simultaneously:
      // recording=true AND pendingTurns=1
    });

    it('transcript A arrives during B recording -> loading(A) clears, recording(B) remains', () => {
      // Turn A: stop -> pending=1
      bus.emit('audio:stop-requested', {});

      // Turn B: start recording
      bus.emit('audio:recording-start', { sessionId: 's2' });

      // Turn A response_end arrives
      bus.emit('gateway:chunk', { type: 'response_end' });
      renderer.setRecordingActive.mockClear();
      renderer.setPendingTurns.mockClear();

      // After 500ms settle: setPendingTurns(0) called
      vi.advanceTimersByTime(500);
      expect(renderer.setPendingTurns).toHaveBeenCalledWith(0);
      // setRecordingActive NOT called with false -- recording is independent
      expect(renderer.setRecordingActive).not.toHaveBeenCalled();
    });

    it('multiple pending turns: second response_end clears last pending', () => {
      // Stop A (pending=1), Stop B (pending=2)
      bus.emit('audio:stop-requested', {});
      bus.emit('audio:stop-requested', {});
      expect(renderer.setPendingTurns).toHaveBeenLastCalledWith(2);
      renderer.setPendingTurns.mockClear();

      // response_end A + 500ms -> pending=1 (still shows loading)
      bus.emit('gateway:chunk', { type: 'response_end' });
      vi.advanceTimersByTime(500);
      expect(renderer.setPendingTurns).toHaveBeenCalledWith(1);
      renderer.setPendingTurns.mockClear();

      // response_end B + 500ms -> pending=0 (loading gone)
      bus.emit('gateway:chunk', { type: 'response_end' });
      vi.advanceTimersByTime(500);
      expect(renderer.setPendingTurns).toHaveBeenCalledWith(0);
    });

    it('recording during pending: stop-tap shows loading dots immediately', () => {
      // Start recording
      bus.emit('audio:recording-start', { sessionId: 's1' });
      expect(renderer.setRecordingActive).toHaveBeenCalledWith(true);
      renderer.setRecordingActive.mockClear();
      renderer.setPendingTurns.mockClear();

      // Stop -- immediately shows loading
      bus.emit('audio:stop-requested', {});
      expect(renderer.setRecordingActive).toHaveBeenCalledWith(false);
      expect(renderer.setPendingTurns).toHaveBeenCalledWith(1);

      // Later, async blob arrives -- no condition change
      renderer.setRecordingActive.mockClear();
      renderer.setPendingTurns.mockClear();
      bus.emit('audio:recording-stop', { sessionId: 's1', blob: new Blob() });
      expect(renderer.setRecordingActive).not.toHaveBeenCalled();
      expect(renderer.setPendingTurns).not.toHaveBeenCalled();
    });

    it('response_end during recording does NOT clear recording flag', () => {
      // Turn A: record, stop, pending turn
      bus.emit('audio:recording-start', { sessionId: 's1' });
      bus.emit('audio:stop-requested', {});

      // Turn B: start new recording while turn A is processing
      bus.emit('audio:recording-start', { sessionId: 's2' });
      renderer.setRecordingActive.mockClear();

      // Turn A's response_end arrives while user is still recording turn B
      bus.emit('gateway:chunk', { type: 'response_end' });
      vi.advanceTimersByTime(500);

      // Recording was never set to false -- only stop-requested does that
      expect(renderer.setRecordingActive).not.toHaveBeenCalledWith(false);
    });

    it('overlapping turns maintain sent indicator until all settle', () => {
      // Turn A: submit
      bus.emit('audio:recording-start', { sessionId: 's1' });
      bus.emit('audio:stop-requested', {});
      expect(renderer.setPendingTurns).toHaveBeenCalledWith(1);

      // Turn B: submit while A is still processing
      bus.emit('audio:recording-start', { sessionId: 's2' });
      bus.emit('audio:stop-requested', {});
      expect(renderer.setPendingTurns).toHaveBeenCalledWith(2);

      // Turn A completes
      bus.emit('gateway:chunk', { type: 'response_end' });
      renderer.setPendingTurns.mockClear();
      vi.advanceTimersByTime(500); // settle A

      // pendingTurns went from 2 to 1 -- still > 0, so loading persists
      expect(renderer.setPendingTurns).toHaveBeenCalledWith(1);

      // Turn B completes
      bus.emit('gateway:chunk', { type: 'response_end' });
      renderer.setPendingTurns.mockClear();
      vi.advanceTimersByTime(500); // settle B

      // pendingTurns now 0 -- loading clears
      expect(renderer.setPendingTurns).toHaveBeenCalledWith(0);
    });

    it('error settle does not affect recording flag', () => {
      // Turn A errors
      bus.emit('audio:stop-requested', {});
      bus.emit('gateway:chunk', { type: 'error', error: 'oops' });
      renderer.setRecordingActive.mockClear();

      // Start recording before settle fires
      bus.emit('audio:recording-start', { sessionId: 's2' });
      expect(renderer.setRecordingActive).toHaveBeenCalledWith(true);

      renderer.setRecordingActive.mockClear();
      renderer.setPendingTurns.mockClear();
      // Settle timer fires -- but it was cleared by recording-start
      vi.advanceTimersByTime(500);
      expect(renderer.setRecordingActive).not.toHaveBeenCalled();
      expect(renderer.setPendingTurns).not.toHaveBeenCalled();
    });

    it('full voice pipeline: record -> stop -> transcript -> response -> idle', () => {
      // Record
      bus.emit('audio:recording-start', { sessionId: 's1' });
      expect(renderer.setRecordingActive).toHaveBeenCalledWith(true);

      // Stop
      bus.emit('audio:stop-requested', {});
      expect(renderer.setRecordingActive).toHaveBeenCalledWith(false);
      expect(renderer.setPendingTurns).toHaveBeenCalledWith(1);

      // Transcript
      bus.emit('gateway:chunk', { type: 'transcript', text: 'hello' });
      expect(renderer.addUserMessage).toHaveBeenCalledWith('hello');

      // Response
      bus.emit('gateway:chunk', { type: 'response_start' });
      expect(renderer.setStreamingActive).toHaveBeenCalledWith(true);

      bus.emit('gateway:chunk', { type: 'response_delta', text: 'world' });

      bus.emit('gateway:chunk', { type: 'response_end' });
      expect(renderer.setStreamingActive).toHaveBeenCalledWith(false);

      renderer.setPendingTurns.mockClear();

      // After 500ms settle, pendingTurns decrements to 0
      vi.advanceTimersByTime(500);
      expect(renderer.setPendingTurns).toHaveBeenCalledWith(0);
    });
  });
});
