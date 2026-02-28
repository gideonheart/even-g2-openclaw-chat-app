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
  getHintText: Mock<() => string>;
  updateHint: Mock;
}

interface MockGestureHandler {
  getState: Mock;
  getHintText: Mock<() => string>;
  destroy: Mock;
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
    getHintText: vi.fn<() => string>().mockReturnValue(''),
    updateHint: vi.fn(),
  };
}

// ── Mock GestureHandlerAPI ──────────────────────────────────

function createMockGestureHandler(): MockGestureHandler {
  return {
    getState: vi.fn().mockReturnValue('idle'),
    getHintText: vi.fn<() => string>().mockReturnValue('Tap to record | Double-tap for menu'),
    destroy: vi.fn(),
  };
}

describe('DisplayController', () => {
  let bus: ReturnType<typeof createEventBus<AppEventMap>>;
  let renderer: MockRenderer;
  let gestureHandler: MockGestureHandler;
  let controller: DisplayController;

  beforeEach(async () => {
    bus = createEventBus<AppEventMap>();
    renderer = createMockRenderer();
    gestureHandler = createMockGestureHandler();
    controller = createDisplayController({ bus, renderer, gestureHandler });
    await controller.init();
  });

  afterEach(() => {
    controller.destroy();
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
      renderer.updateHint.mockClear();

      bus.emit('gateway:chunk', { type: 'transcript', text: 'hello' });
      bus.emit('gesture:scroll-up', { timestamp: Date.now() });
      bus.emit('audio:recording-start', { sessionId: 's1' });
      bus.emit('gesture:tap', { timestamp: Date.now() });

      expect(renderer.addUserMessage).not.toHaveBeenCalled();
      expect(renderer.startStreaming).not.toHaveBeenCalled();
      expect(renderer.scrollUp).not.toHaveBeenCalled();
      expect(renderer.setIconState).not.toHaveBeenCalled();
      expect(renderer.updateHint).not.toHaveBeenCalled();
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

    it('gateway:chunk type=response_end -> endStreaming + setIconState(idle)', () => {
      bus.emit('gateway:chunk', { type: 'response_end' });

      expect(renderer.endStreaming).toHaveBeenCalledOnce();
      expect(renderer.setIconState).toHaveBeenCalledWith('idle');
    });

    it('gateway:chunk type=error -> endStreaming + setIconState(idle)', () => {
      bus.emit('gateway:chunk', { type: 'error', error: 'something broke' });

      expect(renderer.endStreaming).toHaveBeenCalledOnce();
      expect(renderer.setIconState).toHaveBeenCalledWith('idle');
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
    it('gesture:menu-toggle active=true -> renderer.hide', () => {
      bus.emit('gesture:menu-toggle', { active: true });

      expect(renderer.hide).toHaveBeenCalledOnce();
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
  });

  // ── Hint bar flow ────────────────────────────────────────

  describe('hint bar flow', () => {
    it('gesture:tap -> updateHint with gestureHandler.getHintText()', () => {
      gestureHandler.getHintText.mockReturnValue('Tap to stop recording');
      renderer.updateHint.mockClear();

      bus.emit('gesture:tap', { timestamp: Date.now() });

      expect(renderer.updateHint).toHaveBeenCalledWith('Tap to stop recording');
    });

    it('gesture:double-tap -> updateHint with gestureHandler.getHintText()', () => {
      gestureHandler.getHintText.mockReturnValue('Double-tap to close | Scroll to navigate');
      renderer.updateHint.mockClear();

      bus.emit('gesture:double-tap', { timestamp: Date.now() });

      expect(renderer.updateHint).toHaveBeenCalledWith('Double-tap to close | Scroll to navigate');
    });

    it('gesture:scroll-up -> updateHint with gestureHandler.getHintText()', () => {
      gestureHandler.getHintText.mockReturnValue('Tap to record | Double-tap for menu');
      renderer.updateHint.mockClear();

      bus.emit('gesture:scroll-up', { timestamp: Date.now() });

      expect(renderer.updateHint).toHaveBeenCalledWith('Tap to record | Double-tap for menu');
    });

    it('gesture:scroll-down -> updateHint with gestureHandler.getHintText()', () => {
      gestureHandler.getHintText.mockReturnValue('AI is thinking... | Double-tap for menu');
      renderer.updateHint.mockClear();

      bus.emit('gesture:scroll-down', { timestamp: Date.now() });

      expect(renderer.updateHint).toHaveBeenCalledWith('AI is thinking... | Double-tap for menu');
    });
  });
});
