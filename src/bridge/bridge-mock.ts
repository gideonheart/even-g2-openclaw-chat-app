// ── Bridge mock for dev mode ────────────────────────────────
//
// Simulates Even G2 gesture events via keyboard shortcuts.
// Enables development and testing without physical glasses.

import type { EventBus } from '../events';
import type { AppEventMap } from '../types';
import type { BridgeService, PageContainerConfig } from './bridge-types';

/** Extended mock interface exposing inspection helpers for tests. */
export interface MockBridgeService extends BridgeService {
  getLastUpgrade(): { containerID: number; content: string } | null;
  getLastPageConfig(): PageContainerConfig | null;
}

const KEY_MAP: Record<string, keyof AppEventMap> = {
  ' ': 'gesture:tap',          // Spacebar = tap (toggle recording)
  d: 'gesture:double-tap',
  ArrowUp: 'gesture:scroll-up',
  ArrowDown: 'gesture:scroll-down',
};

export function createBridgeMock(
  bus: EventBus<AppEventMap>,
): MockBridgeService {
  let keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  let lastUpgrade: { containerID: number; content: string } | null = null;
  let lastPageConfig: PageContainerConfig | null = null;

  async function init(): Promise<void> {
    keydownHandler = (e: KeyboardEvent) => {
      const eventName = KEY_MAP[e.key];
      if (eventName) {
        bus.emit(eventName, { timestamp: Date.now() } as AppEventMap[typeof eventName]);
      }
    };
    window.addEventListener('keydown', keydownHandler);
    console.info(
      '[BridgeMock] Keyboard shortcuts active: Space=tap, D=double-tap, Up/Down=scroll',
    );
    bus.emit('bridge:connected', { deviceName: 'BridgeMock' });
  }

  async function destroy(): Promise<void> {
    if (keydownHandler) {
      window.removeEventListener('keydown', keydownHandler);
      keydownHandler = null;
    }
  }

  async function startAudio(): Promise<boolean> {
    return true; // no-op in mock; dev audio handled by AudioCapture MediaRecorder
  }

  async function stopAudio(): Promise<boolean> {
    return true;
  }

  async function textContainerUpgrade(
    containerID: number,
    content: string,
  ): Promise<boolean> {
    lastUpgrade = { containerID, content };
    console.info(
      `[BridgeMock] textContainerUpgrade(container=${containerID}, len=${content.length})`,
    );
    return true;
  }

  async function rebuildPageContainer(
    config: PageContainerConfig,
  ): Promise<boolean> {
    lastPageConfig = config;
    console.info(
      `[BridgeMock] rebuildPageContainer(containers=${config.containerTotalNum})`,
    );
    return true;
  }

  function getLastUpgrade(): { containerID: number; content: string } | null {
    return lastUpgrade;
  }

  function getLastPageConfig(): PageContainerConfig | null {
    return lastPageConfig;
  }

  return {
    init,
    destroy,
    startAudio,
    stopAudio,
    textContainerUpgrade,
    rebuildPageContainer,
    getLastUpgrade,
    getLastPageConfig,
  };
}
