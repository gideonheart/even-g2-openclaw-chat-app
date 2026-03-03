// ── Tests for glasses-main.ts lifecycle cleanup & resume ────────
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
  isLocalhostUrl: vi.fn(() => false),
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
  getFrameCount: vi.fn().mockReturnValue(0),
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
const mockIconAnimator = { stop: vi.fn(), start: vi.fn() };
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
  showMenuOverlay: vi.fn(),
  restoreConversation: vi.fn(),
  getIconAnimator: vi.fn().mockReturnValue(mockIconAnimator),
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

const mockErrorPresenterDestroy = vi.fn();
vi.mock('../display/error-presenter', () => ({
  createGlassesErrorPresenter: vi.fn(() => ({
    destroy: mockErrorPresenterDestroy,
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

// ── Sync bridge mock: capture onMessage handler for test-driven sync messages ──
let syncMessageHandler: ((msg: any) => void) | null = null;
const mockSyncBridge = {
  postMessage: vi.fn(),
  onMessage: vi.fn((handler: (msg: any) => void) => {
    syncMessageHandler = handler;
    return vi.fn(); // unsubscribe
  }),
  destroy: vi.fn(),
};

vi.mock('../sync/sync-bridge', () => ({
  createSyncBridge: vi.fn(() => mockSyncBridge),
}));

// ── Boot-restore mock: predictable conversation ID ──────────
const TEST_CONV_ID = 'test-conv-id';

vi.mock('../persistence/boot-restore', () => ({
  restoreOrCreateConversation: vi.fn().mockResolvedValue({
    conversationId: 'test-conv-id',
    restored: false,
    messages: [],
    storageAvailable: false,
  }),
  writeActiveConversationId: vi.fn(),
}));

// ── Import boot AFTER all mocks are in place ──────────────────
import { boot, _resetLifecycleState } from '../glasses-main';

describe('glasses-main lifecycle cleanup', () => {
  let docAddEventSpy: ReturnType<typeof vi.spyOn>;
  let winAddEventSpy: ReturnType<typeof vi.spyOn>;
  let visibilityChangeCallback: (() => void) | null = null;
  let pagehideCallback: (() => void) | null = null;

  beforeEach(() => {
    // Reset module-level lifecycle state between tests
    _resetLifecycleState();

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
    mockErrorPresenterDestroy.mockClear();
    mockBridge.init.mockClear();
    syncMessageHandler = null;
    mockSyncBridge.onMessage.mockClear();
    mockSyncBridge.postMessage.mockClear();
    mockSyncBridge.destroy.mockClear();

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

  // ── Lifecycle resume tests (visibility hidden -> visible) ────

  it('visibilitychange to visible after cleanup re-calls boot()', async () => {
    await boot();

    // First call to bridge.init during boot
    expect(mockBridge.init).toHaveBeenCalledTimes(1);

    // Simulate hidden -> cleanup
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });
    visibilityChangeCallback!();
    expect(mockBridgeDestroy).toHaveBeenCalledTimes(1);

    // Simulate visible -> should reboot
    mockBridge.init.mockClear();
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
    visibilityChangeCallback!();

    // boot() is async, so we need to flush the microtask
    await vi.waitFor(() => {
      expect(mockBridge.init).toHaveBeenCalledTimes(1);
    });
  });

  it('visibilitychange to visible without prior cleanup does NOT reboot', async () => {
    await boot();

    const initCount = mockBridge.init.mock.calls.length;

    // Simulate visible without prior hidden -- boot should NOT be called again
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
    visibilityChangeCallback!();

    // Give any async operations a chance to settle
    await new Promise((r) => setTimeout(r, 10));

    // bridge.init should NOT have been called again
    expect(mockBridge.init).toHaveBeenCalledTimes(initCount);
  });

  it('lifecycle listeners are registered only once across multiple boots', async () => {
    await boot();

    // Simulate hidden -> visible cycle
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });
    visibilityChangeCallback!();

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
    visibilityChangeCallback!();

    // Wait for reboot to complete
    await vi.waitFor(() => {
      expect(mockBridge.init).toHaveBeenCalledTimes(2);
    });

    // addEventListener should have been called only once for each event type
    const visibilityCalls = docAddEventSpy.mock.calls.filter(
      (c) => c[0] === 'visibilitychange',
    );
    expect(visibilityCalls).toHaveLength(1);

    const pagehideCalls = winAddEventSpy.mock.calls.filter(
      (c) => c[0] === 'pagehide',
    );
    expect(pagehideCalls).toHaveLength(1);
  });

  it('reboot after cleanup restores full module teardown capability', async () => {
    await boot();
    // First hidden/visible cycle
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });
    visibilityChangeCallback!();
    expect(mockGatewayDestroy).toHaveBeenCalledTimes(1);

    // Reboot
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
    visibilityChangeCallback!();

    // Wait for full reboot to complete. boot() contains a 2s "Storage unavailable"
    // delay (no IndexedDB in jsdom), so we must wait for gateway.checkHealth --
    // the last async call before _activeCleanup is set -- with a sufficient timeout.
    const healthCallsBefore = mockGateway.checkHealth.mock.calls.length;
    await vi.waitFor(() => {
      expect(mockGateway.checkHealth).toHaveBeenCalledTimes(healthCallsBefore + 1);
    }, { timeout: 3000 });
    // Flush any remaining microtasks after checkHealth resolves
    await new Promise((r) => setTimeout(r, 50));

    // Clear counters
    mockGatewayDestroy.mockClear();
    mockBridgeDestroy.mockClear();
    mockBusClear.mockClear();

    // Second hidden -- should destroy the new boot's modules
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });
    visibilityChangeCallback!();

    expect(mockGatewayDestroy).toHaveBeenCalledTimes(1);
    expect(mockBridgeDestroy).toHaveBeenCalledTimes(1);
    expect(mockBusClear).toHaveBeenCalledTimes(1);
  });

  it('concurrent boot guard prevents duplicate initialization', async () => {
    // Call boot twice rapidly without awaiting
    const p1 = boot();
    const p2 = boot();

    await Promise.all([p1, p2]);

    // bridge.init should only be called once (second boot was a no-op)
    expect(mockBridge.init).toHaveBeenCalledTimes(1);
  });
});

// ── Sync bridge text turn rendering tests ───────────────────────
describe('sync bridge text turn rendering', () => {
  let docAddEventSpy: ReturnType<typeof vi.spyOn>;
  let winAddEventSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetLifecycleState();

    // Dev mode (no flutter_inappwebview) -- avoids lifecycle listener complexity
    delete (window as any).flutter_inappwebview;

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
    mockErrorPresenterDestroy.mockClear();
    mockBridge.init.mockClear();
    syncMessageHandler = null;
    mockSyncBridge.onMessage.mockClear();
    mockSyncBridge.postMessage.mockClear();
    mockSyncBridge.destroy.mockClear();

    // Clear renderer mocks to isolate from boot-time calls (welcome message etc)
    mockRenderer.addUserMessage.mockClear();
    mockRenderer.startStreaming.mockClear();
    mockRenderer.appendStreamChunk.mockClear();
    mockRenderer.endStreaming.mockClear();
    mockRenderer.setIconState.mockClear();

    // Suppress lifecycle listener registration in dev mode
    docAddEventSpy = vi.spyOn(document, 'addEventListener').mockImplementation(() => {});
    winAddEventSpy = vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
  });

  afterEach(() => {
    docAddEventSpy.mockRestore();
    winAddEventSpy.mockRestore();
    delete (window as any).flutter_inappwebview;
  });

  it('message:added (role=user, origin=hub) calls renderer.addUserMessage', async () => {
    await boot();
    // Clear renderer mocks after boot (showWelcome etc)
    mockRenderer.addUserMessage.mockClear();

    expect(syncMessageHandler).not.toBeNull();
    syncMessageHandler!({
      type: 'message:added',
      origin: 'hub',
      conversationId: TEST_CONV_ID,
      role: 'user',
      text: 'Hello from hub',
    });

    expect(mockRenderer.addUserMessage).toHaveBeenCalledWith('Hello from hub');
  });

  it('streaming:start (origin=hub) calls renderer.startStreaming and setIconState', async () => {
    await boot();
    mockRenderer.startStreaming.mockClear();
    mockRenderer.setIconState.mockClear();

    syncMessageHandler!({
      type: 'streaming:start',
      origin: 'hub',
      conversationId: TEST_CONV_ID,
    });

    expect(mockRenderer.startStreaming).toHaveBeenCalledOnce();
    expect(mockRenderer.setIconState).toHaveBeenCalledWith('thinking');
  });

  it('message:added (role=assistant, origin=hub) calls renderer.appendStreamChunk', async () => {
    await boot();
    mockRenderer.appendStreamChunk.mockClear();

    syncMessageHandler!({
      type: 'message:added',
      origin: 'hub',
      conversationId: TEST_CONV_ID,
      role: 'assistant',
      text: 'AI response',
    });

    expect(mockRenderer.appendStreamChunk).toHaveBeenCalledWith('AI response');
  });

  it('streaming:end (origin=hub) calls renderer.endStreaming', async () => {
    await boot();
    mockRenderer.endStreaming.mockClear();

    syncMessageHandler!({
      type: 'streaming:end',
      origin: 'hub',
      conversationId: TEST_CONV_ID,
    });

    expect(mockRenderer.endStreaming).toHaveBeenCalledOnce();
  });

  it('messages for different conversation are ignored', async () => {
    await boot();
    mockRenderer.addUserMessage.mockClear();

    syncMessageHandler!({
      type: 'message:added',
      origin: 'hub',
      conversationId: 'different-id',
      role: 'user',
      text: 'wrong session',
    });

    expect(mockRenderer.addUserMessage).not.toHaveBeenCalled();
  });

  it('own-origin (glasses) messages are ignored', async () => {
    await boot();
    mockRenderer.addUserMessage.mockClear();

    syncMessageHandler!({
      type: 'message:added',
      origin: 'glasses',
      conversationId: TEST_CONV_ID,
      role: 'user',
      text: 'echo',
    });

    expect(mockRenderer.addUserMessage).not.toHaveBeenCalled();
  });
});
