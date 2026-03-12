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

const { mockLoadSettings } = vi.hoisted(() => ({
  mockLoadSettings: vi.fn(() => ({
    gatewayUrl: 'http://test',
    sessionKey: '',
    sttProvider: 'whisperx',
    apiKey: '',
  })),
}));

vi.mock('../settings', () => ({
  loadSettings: mockLoadSettings,
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
  setRecordingActive: vi.fn(),
  setPendingTurns: vi.fn(),
  setStreamingActive: vi.fn(),
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
  loadMessages: vi.fn(),
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
  getLastSeq: vi.fn().mockReturnValue(null),
  setLastSeq: vi.fn(),
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

const { mockRestoreOrCreateConversation } = vi.hoisted(() => ({
  mockRestoreOrCreateConversation: vi.fn().mockResolvedValue({
    conversationId: 'test-conv-id',
    restored: false,
    messages: [],
    storageAvailable: false,
  }),
}));

vi.mock('../persistence/boot-restore', () => ({
  restoreOrCreateConversation: mockRestoreOrCreateConversation,
  writeActiveConversationId: vi.fn(),
}));

// ── Persistence/IDB mocks for preload+swap tests ──────────────
const { mockIsIndexedDBAvailable, mockOpenDB, mockSetOnUnexpectedClose, mockReopenDB } = vi.hoisted(() => ({
  mockIsIndexedDBAvailable: vi.fn().mockReturnValue(false),
  mockOpenDB: vi.fn(),
  mockSetOnUnexpectedClose: vi.fn(),
  mockReopenDB: vi.fn(),
}));

vi.mock('../persistence/db', () => ({
  isIndexedDBAvailable: mockIsIndexedDBAvailable,
  openDB: mockOpenDB,
  setOnUnexpectedClose: mockSetOnUnexpectedClose,
  reopenDB: mockReopenDB,
}));

const { mockStore } = vi.hoisted(() => ({
  mockStore: {
    getMessages: vi.fn().mockResolvedValue([]),
    addMessage: vi.fn(),
    getConversation: vi.fn(),
    createConversation: vi.fn(),
    updateConversation: vi.fn(),
    countMessages: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock('../persistence/conversation-store', () => ({
  createConversationStore: vi.fn(() => mockStore),
}));

const { mockSessionStore } = vi.hoisted(() => ({
  mockSessionStore: {
    listSessions: vi.fn().mockResolvedValue([]),
    saveSession: vi.fn(),
    deleteSession: vi.fn(),
    getSession: vi.fn(),
  },
}));

vi.mock('../persistence/session-store', () => ({
  createSessionStore: vi.fn(() => mockSessionStore),
}));

vi.mock('../persistence/integrity-checker', () => ({
  createIntegrityChecker: vi.fn(() => ({
    check: vi.fn().mockResolvedValue({
      sentinelPresent: true,
      conversationCount: 0,
      orphanedMessageIds: [],
      danglingPointer: false,
    }),
    writeSentinel: vi.fn().mockResolvedValue(undefined),
    cleanupOrphans: vi.fn().mockResolvedValue(0),
  })),
}));

vi.mock('../persistence/storage-health', () => ({
  createStorageHealth: vi.fn(() => ({
    getQuota: vi.fn().mockResolvedValue({
      isAvailable: false,
      usageBytes: 0,
      quotaBytes: 0,
      usagePercent: 0,
      isPersisted: false,
    }),
    requestPersistence: vi.fn().mockResolvedValue(false),
  })),
}));

vi.mock('../persistence/auto-save', () => ({
  createAutoSave: vi.fn(() => ({
    destroy: vi.fn(),
  })),
}));

vi.mock('../sync/sync-monitor', () => ({
  createSyncMonitor: vi.fn(() => ({
    startHeartbeat: vi.fn(),
    destroy: vi.fn(),
  })),
}));

vi.mock('../sync/drift-reconciler', () => ({
  createDriftReconciler: vi.fn(() => ({
    handleHeartbeat: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
  })),
}));

vi.mock('../sessions', () => ({
  createSessionManager: vi.fn(() => ({
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    listSessions: vi.fn().mockResolvedValue([]),
    switchSession: vi.fn(),
  })),
}));

vi.mock('../menu/menu-controller', () => ({
  createMenuController: vi.fn(() => ({
    destroy: vi.fn(),
  })),
}));

// ── Replay client mock ──────────────────────────────────────
const { mockFetchSessionReplay, mockReplayEventsAsChunks } = vi.hoisted(() => ({
  mockFetchSessionReplay: vi.fn().mockResolvedValue([]),
  mockReplayEventsAsChunks: vi.fn().mockReturnValue(-1),
}));

vi.mock('../api/replay-client', () => ({
  fetchSessionReplay: mockFetchSessionReplay,
  replayEventsAsChunks: mockReplayEventsAsChunks,
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
    mockGateway.getLastSeq.mockReturnValue(null);
    mockGateway.setLastSeq.mockClear();
    mockErrorPresenterDestroy.mockClear();
    mockBridge.init.mockClear();
    syncMessageHandler = null;
    mockSyncBridge.onMessage.mockClear();
    mockSyncBridge.postMessage.mockClear();
    mockSyncBridge.destroy.mockClear();
    mockFetchSessionReplay.mockClear();
    mockFetchSessionReplay.mockResolvedValue([]);
    mockReplayEventsAsChunks.mockClear();
    mockReplayEventsAsChunks.mockReturnValue(-1);

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
    mockGateway.getLastSeq.mockReturnValue(null);
    mockGateway.setLastSeq.mockClear();
    mockErrorPresenterDestroy.mockClear();
    mockBridge.init.mockClear();
    syncMessageHandler = null;
    mockSyncBridge.onMessage.mockClear();
    mockSyncBridge.postMessage.mockClear();
    mockSyncBridge.destroy.mockClear();
    mockFetchSessionReplay.mockClear();
    mockFetchSessionReplay.mockResolvedValue([]);
    mockReplayEventsAsChunks.mockClear();
    mockReplayEventsAsChunks.mockReturnValue(-1);

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

// ── Bridge event forwarding during boot tests ───────────────────
describe('bridge event forwarding during boot', () => {
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
    mockBus.on.mockClear();
    mockGateway.checkHealth.mockResolvedValue(true);
    mockGateway.getLastSeq.mockReturnValue(null);
    mockGateway.setLastSeq.mockClear();
    mockErrorPresenterDestroy.mockClear();
    mockBridge.init.mockClear();
    syncMessageHandler = null;
    mockSyncBridge.onMessage.mockClear();
    mockSyncBridge.postMessage.mockClear();
    mockSyncBridge.destroy.mockClear();
    mockFetchSessionReplay.mockClear();
    mockFetchSessionReplay.mockResolvedValue([]);
    mockReplayEventsAsChunks.mockClear();
    mockReplayEventsAsChunks.mockReturnValue(-1);

    // Suppress lifecycle listener registration in dev mode
    docAddEventSpy = vi.spyOn(document, 'addEventListener').mockImplementation(() => {});
    winAddEventSpy = vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
  });

  afterEach(() => {
    docAddEventSpy.mockRestore();
    winAddEventSpy.mockRestore();
    delete (window as any).flutter_inappwebview;
  });

  it('bridge:connected is forwarded to syncBridge via bus listener', async () => {
    await boot();

    // Find the bus.on('bridge:connected') registration
    const connectedCall = mockBus.on.mock.calls.find(
      (call) => call[0] === 'bridge:connected',
    );
    expect(connectedCall).toBeDefined();

    // Extract the registered callback and invoke it
    const callback = connectedCall![1] as (payload: { deviceName: string }) => void;
    mockSyncBridge.postMessage.mockClear();
    callback({ deviceName: 'Even G2' });

    expect(mockSyncBridge.postMessage).toHaveBeenCalledWith({
      type: 'bridge:connected',
      origin: 'glasses',
      deviceName: 'Even G2',
    });
  });

  it('bridge:disconnected is forwarded to syncBridge via bus listener', async () => {
    await boot();

    // Find the bus.on('bridge:disconnected') registration
    const disconnectedCall = mockBus.on.mock.calls.find(
      (call) => call[0] === 'bridge:disconnected',
    );
    expect(disconnectedCall).toBeDefined();

    // Extract the registered callback and invoke it
    const callback = disconnectedCall![1] as (payload: { reason: string }) => void;
    mockSyncBridge.postMessage.mockClear();
    callback({ reason: 'lost' });

    expect(mockSyncBridge.postMessage).toHaveBeenCalledWith({
      type: 'bridge:disconnected',
      origin: 'glasses',
      reason: 'lost',
    });
  });

  it('bridge:connected listener is registered before bridge:audio-frame listener (order check)', async () => {
    await boot();

    // Find indices of specific bus.on registrations
    const calls = mockBus.on.mock.calls;
    const connectedIndex = calls.findIndex((call) => call[0] === 'bridge:connected');
    const audioFrameIndex = calls.findIndex((call) => call[0] === 'bridge:audio-frame');

    expect(connectedIndex).toBeGreaterThanOrEqual(0);
    expect(audioFrameIndex).toBeGreaterThanOrEqual(0);

    // bridge:connected must be registered BEFORE bridge:audio-frame
    // (bridge:audio-frame is registered after bridge.init())
    expect(connectedIndex).toBeLessThan(audioFrameIndex);
  });
});

// ── Resume sync wiring tests ────────────────────────────────────
describe('resume sync wiring', () => {
  let docAddEventSpy: ReturnType<typeof vi.spyOn>;
  let winAddEventSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetLifecycleState();

    // Dev mode -- simpler lifecycle
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
    mockGateway.getLastSeq.mockReturnValue(null);
    mockGateway.setLastSeq.mockClear();
    mockErrorPresenterDestroy.mockClear();
    mockBridge.init.mockClear();
    syncMessageHandler = null;
    mockSyncBridge.onMessage.mockClear();
    mockSyncBridge.postMessage.mockClear();
    mockSyncBridge.destroy.mockClear();
    mockFetchSessionReplay.mockClear();
    mockFetchSessionReplay.mockResolvedValue([]);
    mockReplayEventsAsChunks.mockClear();
    mockReplayEventsAsChunks.mockReturnValue(-1);
    mockBus.emit.mockClear();

    // Configure settings with a sessionKey for resume sync
    mockLoadSettings.mockReturnValue({
      gatewayUrl: 'http://test',
      sessionKey: 'test-session-key',
      sttProvider: 'whisperx',
      apiKey: '',
    });

    // Suppress lifecycle listener registration
    docAddEventSpy = vi.spyOn(document, 'addEventListener').mockImplementation(() => {});
    winAddEventSpy = vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
  });

  afterEach(() => {
    docAddEventSpy.mockRestore();
    winAddEventSpy.mockRestore();
    delete (window as any).flutter_inappwebview;
    // Reset settings to default (no sessionKey) for other test suites
    mockLoadSettings.mockReturnValue({
      gatewayUrl: 'http://test',
      sessionKey: '',
      sttProvider: 'whisperx',
      apiKey: '',
    });
  });

  it('calls fetchSessionReplay when lastSeq is available and sessionKey is set', async () => {
    mockGateway.getLastSeq.mockReturnValue(42);

    await boot();
    // Allow fire-and-forget promise to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(mockFetchSessionReplay).toHaveBeenCalledWith('http://test', 'test-session-key', 42);
  });

  it('does not call fetchSessionReplay when lastSeq is null', async () => {
    mockGateway.getLastSeq.mockReturnValue(null);

    await boot();
    await new Promise((r) => setTimeout(r, 10));

    expect(mockFetchSessionReplay).not.toHaveBeenCalled();
  });

  it('does not call fetchSessionReplay when sessionKey is empty', async () => {
    mockLoadSettings.mockReturnValue({
      gatewayUrl: 'http://test',
      sessionKey: '',
      sttProvider: 'whisperx',
      apiKey: '',
    });
    mockGateway.getLastSeq.mockReturnValue(42);

    await boot();
    await new Promise((r) => setTimeout(r, 10));

    expect(mockFetchSessionReplay).not.toHaveBeenCalled();
  });

  it('calls replayEventsAsChunks and setLastSeq when events are returned', async () => {
    const fakeEvents = [
      { turnId: 't1', sessionKey: 'sk', seq: 43, type: 'transcript', payload: { transcript: 'hi' }, timestamp: 1 },
      { turnId: 't1', sessionKey: 'sk', seq: 44, type: 'done', payload: {}, timestamp: 2 },
    ];
    mockGateway.getLastSeq.mockReturnValue(42);
    mockFetchSessionReplay.mockResolvedValue(fakeEvents);
    mockReplayEventsAsChunks.mockReturnValue(44);

    await boot();
    await new Promise((r) => setTimeout(r, 10));

    expect(mockReplayEventsAsChunks).toHaveBeenCalledWith(fakeEvents, expect.any(Function));
    expect(mockGateway.setLastSeq).toHaveBeenCalledWith(44);
  });

  it('does not call setLastSeq when highestSeq is <= 0', async () => {
    const fakeEvents = [{ turnId: 't1', sessionKey: 'sk', seq: 0, type: 'done', payload: {}, timestamp: 1 }];
    mockGateway.getLastSeq.mockReturnValue(42);
    mockFetchSessionReplay.mockResolvedValue(fakeEvents);
    mockReplayEventsAsChunks.mockReturnValue(-1);

    await boot();
    await new Promise((r) => setTimeout(r, 10));

    // replayEventsAsChunks returned -1, so setLastSeq should not be called
    expect(mockGateway.setLastSeq).not.toHaveBeenCalled();
  });

  it('emits replayed chunks to bus as gateway:chunk', async () => {
    const fakeEvents = [
      { turnId: 't1', sessionKey: 'sk', seq: 43, type: 'transcript', payload: { transcript: 'hi' }, timestamp: 1 },
    ];
    mockGateway.getLastSeq.mockReturnValue(42);
    mockFetchSessionReplay.mockResolvedValue(fakeEvents);
    // Capture the emitChunkCallback and invoke it to verify bus.emit
    mockReplayEventsAsChunks.mockImplementation((_events: unknown, emitCb: (chunk: unknown) => void) => {
      emitCb({ type: 'transcript', text: 'hi', turnId: 't1' });
      return 43;
    });

    await boot();
    await new Promise((r) => setTimeout(r, 10));

    // Verify bus.emit was called with 'gateway:chunk' and the chunk
    const chunkEmits = mockBus.emit.mock.calls.filter(
      (call) => call[0] === 'gateway:chunk' && call[1]?.type === 'transcript',
    );
    expect(chunkEmits.length).toBeGreaterThanOrEqual(1);
    expect(chunkEmits[0][1]).toEqual({ type: 'transcript', text: 'hi', turnId: 't1' });
  });

  it('silently handles fetchSessionReplay failure (non-blocking)', async () => {
    mockGateway.getLastSeq.mockReturnValue(42);
    mockFetchSessionReplay.mockRejectedValue(new Error('network down'));

    await boot();
    // Should not throw -- fire-and-forget with .catch
    await new Promise((r) => setTimeout(r, 10));

    expect(mockReplayEventsAsChunks).not.toHaveBeenCalled();
  });
});
