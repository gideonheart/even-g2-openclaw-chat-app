// ── EvenBridge service — wraps @evenrealities/even_hub_sdk ──
//
// This is the ONLY module that imports from the Even Hub SDK.
// All other modules interact with the bridge via the typed event bus.

import {
  waitForEvenAppBridge,
  OsEventTypeList,
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  RebuildPageContainer,
} from '@evenrealities/even_hub_sdk';
import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import type { EventBus } from '../events';
import type { AppEventMap } from '../types';
import type { BridgeService, PageContainerConfig } from './bridge-types';

// Phase 2 minimal startup layout: one text container with event capture
const STARTUP_LAYOUT = new CreateStartUpPageContainer({
  containerTotalNum: 1,
  textObject: [
    new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 288,
      containerID: 1,
      containerName: 'main',
      isEventCapture: 1,
      content: '',
    }),
  ],
});

export function createEvenBridgeService(
  bus: EventBus<AppEventMap>,
): BridgeService {
  let bridge: EvenAppBridge | null = null;
  let unsubEvent: (() => void) | null = null;
  let unsubStatus: (() => void) | null = null;

  async function init(): Promise<void> {
    bridge = await waitForEvenAppBridge();

    // Must create page container before audio control works
    await bridge.createStartUpPageContainer(STARTUP_LAYOUT);

    unsubStatus = bridge.onDeviceStatusChanged((status) => {
      if (status.isConnected()) {
        bus.emit('bridge:connected', { deviceName: 'Even G2' });
      } else if (status.isDisconnected()) {
        bus.emit('bridge:disconnected', {
          reason: status.connectType,
        });
      }
    });

    unsubEvent = bridge.onEvenHubEvent((event) => {
      const now = Date.now();

      // Forward audio PCM frames to the bus
      if (event.audioEvent) {
        bus.emit('bridge:audio-frame', {
          pcm: event.audioEvent.audioPcm,
          timestamp: now,
        });
      }

      // Map SDK gesture events to typed bus events
      const eventType =
        event.listEvent?.eventType ??
        event.textEvent?.eventType ??
        event.sysEvent?.eventType;

      // Handle CLICK_EVENT quirk: SDK fromJson normalizes 0 to undefined
      if (eventType === OsEventTypeList.CLICK_EVENT || eventType === undefined) {
        bus.emit('gesture:tap', { timestamp: now });
      } else {
        switch (eventType) {
          case OsEventTypeList.DOUBLE_CLICK_EVENT:
            bus.emit('gesture:double-tap', { timestamp: now });
            break;
          case OsEventTypeList.SCROLL_TOP_EVENT:
            bus.emit('gesture:scroll-up', { timestamp: now });
            break;
          case OsEventTypeList.SCROLL_BOTTOM_EVENT:
            bus.emit('gesture:scroll-down', { timestamp: now });
            break;
        }
      }
    });

    bus.emit('bridge:connected', { deviceName: 'Even G2' });
  }

  async function destroy(): Promise<void> {
    unsubEvent?.();
    unsubEvent = null;
    unsubStatus?.();
    unsubStatus = null;
    // Close microphone before shutting down the page container.
    // If audioControl(true) was called during a recording session and the app
    // is hidden without closing the mic, the Even G2 OS leaves the audio state
    // open. On the next boot the OS shows "Failed Tap to speak" because it
    // cannot open an already-open microphone. Closing it here ensures a clean
    // state for the next session.
    await bridge?.audioControl(false).catch(() => {});
    await bridge?.shutDownPageContainer(0);
    bridge = null;
  }

  async function startAudio(): Promise<boolean> {
    return (await bridge?.audioControl(true)) ?? false;
  }

  async function stopAudio(): Promise<boolean> {
    return (await bridge?.audioControl(false)) ?? false;
  }

  async function textContainerUpgrade(
    containerID: number,
    content: string,
  ): Promise<boolean> {
    if (!bridge) return false;
    const upgrade = new TextContainerUpgrade({ containerID, content });
    return bridge.textContainerUpgrade(upgrade);
  }

  async function rebuildPageContainer(
    config: PageContainerConfig,
  ): Promise<boolean> {
    if (!bridge) return false;
    const container = new RebuildPageContainer({
      containerTotalNum: config.containerTotalNum,
      textObject: config.textObject.map(
        (t) => new TextContainerProperty(t),
      ),
    });
    return bridge.rebuildPageContainer(container);
  }

  return {
    init,
    destroy,
    startAudio,
    stopAudio,
    textContainerUpgrade,
    rebuildPageContainer,
  };
}
