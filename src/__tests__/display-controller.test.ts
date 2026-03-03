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
    it('gateway:chunk type=transcript -> addUserMessage + setIconState(sent)', () => {
      bus.emit('gateway:chunk', { type: 'transcript', text: 'Hello world' });

      expect(renderer.addUserMessage).toHaveBeenCalledWith('Hello world');
      expect(renderer.setIconState).toHaveBeenCalledWith('sent');
    });

    it('gateway:chunk type=response_start -> startStreaming + setIconState(thinking)', () => {
      bus.emit('gateway:chunk', { type: 'response_start' });

      expect(renderer.startStreaming).toHaveBeenCalledOnce();
      expect(renderer.setIconState).toHaveBeenCalledWith('thinking');
    });

    it('gateway:chunk type=response_delta -> appendStreamChunk with text', () => {
      bus.emit('gateway:chunk', { type: 'response_delta', text: 'chunk data' });

      expect(renderer.appendStreamChunk).toHaveBeenCalledWith('chunk data');
    });

    it('gateway:chunk type=response_end -> endStreaming + setIconState(idle) after 500ms', () => {
      bus.emit('gateway:chunk', { type: 'response_end' });

      expect(renderer.endStreaming).toHaveBeenCalledOnce();
      // Idle icon is delayed by 500ms settle period
      expect(renderer.setIconState).not.toHaveBeenCalledWith('idle');

      vi.advanceTimersByTime(500);
      expect(renderer.setIconState).toHaveBeenCalledWith('idle');
    });

    it('gateway:chunk type=error -> endStreaming + showError + setIconState(idle) after 500ms', () => {
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

    it('audio:recording-stop -> setIconState(sent)', () => {
      renderer.setIconState.mockClear();
      bus.emit('audio:recording-stop', { sessionId: 'session-1', blob: new Blob() });

      expect(renderer.setIconState).toHaveBeenCalledWith('sent');
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
});
