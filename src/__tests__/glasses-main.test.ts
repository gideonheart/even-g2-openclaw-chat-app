// ── Tests for glasses-main.ts lifecycle cleanup ────────────────
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock all module factories ──────────────────────────────────

const mockBusClear = vi.fn();
const mockBus = {
  on: vi.fn().mockReturnValue(vi.fn()),
  emit: vi.fn(),
  off: vi.fn(),
  clear: mockBusClear,
  listenerCount: vi.fn().mockReturnValue(0),
};

vi.mock('../events', () => ({
  createEventBus: vi.fn(() => mockBus),
}));

vi.mock('../settings', () => ({
  loadSettings: vi.fn(() => ({
    gatewayUrl: 'http://test',
    sessionKey: '',
    sttProvider: 'whisperx',
    apiKey: '',
  })),
}));

const mockBridgeDestroy = vi.fn().mockResolvedValue(undefined);
const mockBridge = {
  init: vi.fn().mockResolvedValue(undefined),
  destroy: mockBridgeDestroy,
  startAudio: vi.fn().mockResolvedValue(true),
  stopAudio: vi.fn().mockResolvedValue(true),
  textContainerUpgrade: vi.fn().mockResolvedValue(true),
  rebuildPageContainer: vi.fn().mockResolvedValue(true),
};

vi.mock('../bridge/even-bridge', () => ({
  createEvenBridgeService: vi.fn(() => mockBridge),
}));

vi.mock('../bridge/bridge-mock', () => ({
  createBridgeMock: vi.fn(() => mockBridge),
}));

const mockStopRecording = vi.fn<() => Promise<Blob>>().mockResolvedValue(new Blob());
const mockAudioCapture = {
  startRecording: vi.fn(),
  stopRecording: mockStopRecording,
  onFrame: vi.fn(),
  isRecording: vi.fn().mockReturnValue(false),
};

vi.mock('../audio/audio-capture', () => ({
  createAudioCapture: vi.fn(() => mockAudioCapture),
}));

const mockGestureHandlerDestroy = vi.fn();
vi.mock('../gestures/gesture-handler', () => ({
  createGestureHandler: vi.fn(() => ({
    getState: vi.fn().mockReturnValue('idle'),
    getHintText: vi.fn().mockReturnValue(''),
    destroy: mockGestureHandlerDestroy,
  })),
}));

const mockRendererDestroy = vi.fn();
const mockRenderer = {
  init: vi.fn().mockResolvedValue(undefined),
  destroy: mockRendererDestroy,
  setIconState: vi.fn(),
  addUserMessage: vi.fn(),
  startStreaming: vi.fn(),
  appendStreamChunk: vi.fn(),
  endStreaming: vi.fn(),
  scrollUp: vi.fn(),
  scrollDown: vi.fn(),
  hide: vi.fn().mockResolvedValue(undefined),
  wake: vi.fn().mockResolvedValue(undefined),
  isHidden: vi.fn().mockReturnValue(false),
  showWelcome: vi.fn(),
  showConfigRequired: vi.fn(),
  showError: vi.fn(),
};

vi.mock('../display/glasses-renderer', () => ({
  createGlassesRenderer: vi.fn(() => mockRenderer),
}));

const mockDisplayControllerDestroy = vi.fn();
vi.mock('../display/display-controller', () => ({
  createDisplayController: vi.fn(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    destroy: mockDisplayControllerDestroy,
  })),
}));

const mockGatewayDestroy = vi.fn();
const mockGateway = {
  sendVoiceTurn: vi.fn(),
  checkHealth: vi.fn().mockResolvedValue(true),
  startHeartbeat: vi.fn(),
  stopHeartbeat: vi.fn(),
  onChunk: vi.fn().mockReturnValue(vi.fn()),
  onStatusChange: vi.fn().mockReturnValue(vi.fn()),
  abort: vi.fn(),
  destroy: mockGatewayDestroy,
  getHealth: vi.fn().mockReturnValue({ status: 'disconnected', lastHeartbeat: null, reconnectAttempts: 0, latencyMs: null }),
};

vi.mock('../api/gateway-client', () => ({
  createGatewayClient: vi.fn(() => mockGateway),
}));

const mockVoiceLoopDestroy = vi.fn();
vi.mock('../voice-loop-controller', () => ({
  createVoiceLoopController: vi.fn(() => ({
    destroy: mockVoiceLoopDestroy,
  })),
}));

// ── Import boot AFTER all mocks are in place ──────────────────
import { boot } from '../glasses-main';

describe('glasses-main lifecycle cleanup', () => {
  let docAddEventSpy: ReturnType<typeof vi.spyOn>;
  let winAddEventSpy: ReturnType<typeof vi.spyOn>;
  let visibilityChangeCallback: (() => void) | null = null;
  let pagehideCallback: (() => void) | null = null;

  beforeEach(() => {
    // Simulate glasses mode (not devMode)
    (window as any).flutter_inappwebview = {};

    // Reset all mock call counters
    mockVoiceLoopDestroy.mockClear();
    mockGatewayDestroy.mockClear();
    mockDisplayControllerDestroy.mockClear();
    mockGestureHandlerDestroy.mockClear();
    mockStopRecording.mockClear();
    mockStopRecording.mockResolvedValue(new Blob());
    mockBridgeDestroy.mockClear();
    mockBusClear.mockClear();
    mockGateway.checkHealth.mockResolvedValue(true);

    visibilityChangeCallback = null;
    pagehideCallback = null;

    // Spy on addEventListener to capture callbacks
    docAddEventSpy = vi.spyOn(document, 'addEventListener').mockImplementation(
      (type: string, listener: unknown) => {
        if (type === 'visibilitychange') {
          visibilityChangeCallback = listener as () => void;
        }
      },
    );
    winAddEventSpy = vi.spyOn(window, 'addEventListener').mockImplementation(
      (type: string, listener: unknown) => {
        if (type === 'pagehide') {
          pagehideCallback = listener as () => void;
        }
      },
    );
  });

  afterEach(() => {
    docAddEventSpy.mockRestore();
    winAddEventSpy.mockRestore();
    delete (window as any).flutter_inappwebview;
  });

  it('boot() registers visibilitychange and pagehide listeners in glasses mode', async () => {
    await boot();

    expect(docAddEventSpy).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    );
    expect(winAddEventSpy).toHaveBeenCalledWith(
      'pagehide',
      expect.any(Function),
    );
  });

  it('cleanup destroys all modules on visibilitychange hidden', async () => {
    await boot();

    expect(visibilityChangeCallback).not.toBeNull();

    // Simulate visibilitychange to hidden
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });
    visibilityChangeCallback!();

    // Verify destroy was called on all modules
    expect(mockVoiceLoopDestroy).toHaveBeenCalledOnce();
    expect(mockGatewayDestroy).toHaveBeenCalledOnce();
    expect(mockDisplayControllerDestroy).toHaveBeenCalledOnce();
    expect(mockGestureHandlerDestroy).toHaveBeenCalledOnce();
    expect(mockStopRecording).toHaveBeenCalledOnce();
    expect(mockBridgeDestroy).toHaveBeenCalledOnce();
    expect(mockBusClear).toHaveBeenCalledOnce();
  });

  it('double cleanup is safe -- second call is a no-op', async () => {
    await boot();

    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });

    // First cleanup via visibilitychange
    visibilityChangeCallback!();
    // Second cleanup via pagehide
    pagehideCallback!();

    // destroy should be called exactly once (not twice)
    expect(mockGatewayDestroy).toHaveBeenCalledTimes(1);
    expect(mockVoiceLoopDestroy).toHaveBeenCalledTimes(1);
    expect(mockBridgeDestroy).toHaveBeenCalledTimes(1);
  });

  it('does NOT register cleanup listeners in dev mode (browser)', async () => {
    // Remove flutter_inappwebview to simulate browser dev mode
    delete (window as any).flutter_inappwebview;

    docAddEventSpy.mockClear();

    await boot();

    // visibilitychange should NOT be registered
    const visibilityCalls = docAddEventSpy.mock.calls.filter(
      (c) => c[0] === 'visibilitychange',
    );
    expect(visibilityCalls).toHaveLength(0);
  });

  it('audioCapture.stopRecording rejection does not throw', async () => {
    mockStopRecording.mockRejectedValue(new Error('not recording'));

    await boot();

    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });

    // Should not throw
    expect(() => visibilityChangeCallback!()).not.toThrow();

    // Other destroys should still have been called
    expect(mockGatewayDestroy).toHaveBeenCalledOnce();
    expect(mockBridgeDestroy).toHaveBeenCalledOnce();
  });
});
