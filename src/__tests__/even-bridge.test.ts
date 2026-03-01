// ── Tests for EvenBridge SDK lifecycle and event mapping ────
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEventBus } from '../events';
import type { AppEventMap } from '../types';

// ── SDK mock (vi.hoisted so vi.mock factory can reference it) ──

const { mockBridge, getOnEvenHubEventCb, getOnDeviceStatusChangedCb, resetCbs } =
  vi.hoisted(() => {
    let _onEvenHubEventCb: ((event: any) => void) | null = null;
    let _onDeviceStatusChangedCb: ((status: any) => void) | null = null;

    const bridge = {
      createStartUpPageContainer: vi.fn().mockResolvedValue(0),
      shutDownPageContainer: vi.fn().mockResolvedValue(true),
      audioControl: vi.fn().mockResolvedValue(true),
      textContainerUpgrade: vi.fn().mockResolvedValue(true),
      rebuildPageContainer: vi.fn().mockResolvedValue(true),
      onDeviceStatusChanged: vi.fn((cb: (status: any) => void) => {
        _onDeviceStatusChangedCb = cb;
        return () => {
          _onDeviceStatusChangedCb = null;
        };
      }),
      onEvenHubEvent: vi.fn((cb: (event: any) => void) => {
        _onEvenHubEventCb = cb;
        return () => {
          _onEvenHubEventCb = null;
        };
      }),
    };

    return {
      mockBridge: bridge,
      getOnEvenHubEventCb: () => _onEvenHubEventCb,
      getOnDeviceStatusChangedCb: () => _onDeviceStatusChangedCb,
      resetCbs: () => {
        _onEvenHubEventCb = null;
        _onDeviceStatusChangedCb = null;
      },
    };
  });

vi.mock('@evenrealities/even_hub_sdk', async () => {
  const actual = await vi.importActual<
    typeof import('@evenrealities/even_hub_sdk')
  >('@evenrealities/even_hub_sdk');
  return {
    ...actual,
    waitForEvenAppBridge: vi.fn().mockResolvedValue(mockBridge),
  };
});

import { createEvenBridgeService } from '../bridge/even-bridge';

describe('EvenBridge service', () => {
  let bus: ReturnType<typeof createEventBus<AppEventMap>>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetCbs();
    bus = createEventBus<AppEventMap>();
  });

  it('init() calls waitForEvenAppBridge then createStartUpPageContainer', async () => {
    const { waitForEvenAppBridge } = await import(
      '@evenrealities/even_hub_sdk'
    );
    const service = createEvenBridgeService(bus);
    await service.init();

    expect(waitForEvenAppBridge).toHaveBeenCalledOnce();
    expect(mockBridge.createStartUpPageContainer).toHaveBeenCalledOnce();
    expect(mockBridge.onDeviceStatusChanged).toHaveBeenCalledOnce();
    expect(mockBridge.onEvenHubEvent).toHaveBeenCalledOnce();
  });

  it('emits gesture:tap when CLICK_EVENT (0) arrives', async () => {
    const service = createEvenBridgeService(bus);
    await service.init();

    const handler = vi.fn();
    bus.on('gesture:tap', handler);

    getOnEvenHubEventCb()!({ textEvent: { eventType: 0 } });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toHaveProperty('timestamp');
  });

  it('emits gesture:double-tap when DOUBLE_CLICK_EVENT (3) arrives', async () => {
    const service = createEvenBridgeService(bus);
    await service.init();

    const handler = vi.fn();
    bus.on('gesture:double-tap', handler);

    getOnEvenHubEventCb()!({ listEvent: { eventType: 3 } });

    expect(handler).toHaveBeenCalledOnce();
  });

  it('emits gesture:scroll-up when SCROLL_TOP_EVENT (1) arrives', async () => {
    const service = createEvenBridgeService(bus);
    await service.init();

    const handler = vi.fn();
    bus.on('gesture:scroll-up', handler);

    getOnEvenHubEventCb()!({ textEvent: { eventType: 1 } });

    expect(handler).toHaveBeenCalledOnce();
  });

  it('emits gesture:scroll-down when SCROLL_BOTTOM_EVENT (2) arrives', async () => {
    const service = createEvenBridgeService(bus);
    await service.init();

    const handler = vi.fn();
    bus.on('gesture:scroll-down', handler);

    getOnEvenHubEventCb()!({ sysEvent: { eventType: 2 } });

    expect(handler).toHaveBeenCalledOnce();
  });

  it('emits bridge:audio-frame when audioEvent arrives', async () => {
    const service = createEvenBridgeService(bus);
    await service.init();

    const handler = vi.fn();
    bus.on('bridge:audio-frame', handler);

    const pcm = new Uint8Array([1, 2, 3, 4]);
    getOnEvenHubEventCb()!({ audioEvent: { audioPcm: pcm } });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].pcm).toBe(pcm);
    expect(handler.mock.calls[0][0]).toHaveProperty('timestamp');
  });

  it('destroy() closes mic, unsubscribes listeners, and calls shutDownPageContainer', async () => {
    const service = createEvenBridgeService(bus);
    await service.init();

    await service.destroy();

    // Must close mic before shutting down page to avoid "Failed Tap to speak"
    // on the next boot (Even G2 OS shows this when mic is left open across sessions)
    expect(mockBridge.audioControl).toHaveBeenCalledWith(false);
    expect(mockBridge.shutDownPageContainer).toHaveBeenCalledWith(0);
    // After destroy, the event callbacks should be nulled
    expect(getOnEvenHubEventCb()).toBeNull();
    expect(getOnDeviceStatusChangedCb()).toBeNull();
  });

  it('destroy() is idempotent -- calling twice does not throw', async () => {
    const service = createEvenBridgeService(bus);
    await service.init();

    await service.destroy();
    await expect(service.destroy()).resolves.not.toThrow();
  });

  it('startAudio() delegates to bridge.audioControl(true)', async () => {
    const service = createEvenBridgeService(bus);
    await service.init();

    const result = await service.startAudio();

    expect(mockBridge.audioControl).toHaveBeenCalledWith(true);
    expect(result).toBe(true);
  });

  it('stopAudio() delegates to bridge.audioControl(false)', async () => {
    const service = createEvenBridgeService(bus);
    await service.init();

    const result = await service.stopAudio();

    expect(mockBridge.audioControl).toHaveBeenCalledWith(false);
    expect(result).toBe(true);
  });

  it('emits gesture:tap when eventType is undefined (CLICK_EVENT SDK quirk)', async () => {
    const service = createEvenBridgeService(bus);
    await service.init();

    const tapHandler = vi.fn();
    bus.on('gesture:tap', tapHandler);

    // Event with no eventType field -- SDK normalizes CLICK_EVENT (0) to undefined
    getOnEvenHubEventCb()!({});

    expect(tapHandler).toHaveBeenCalledOnce();
    expect(tapHandler.mock.calls[0][0]).toHaveProperty('timestamp');
  });
});
