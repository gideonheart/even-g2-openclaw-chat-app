// ── Bridge mock for dev mode ────────────────────────────────
//
// Simulates Even G2 gesture events via keyboard shortcuts.
// Enables development and testing without physical glasses.

import type { EventBus } from '../events';
import type { AppEventMap } from '../types';
import type { BridgeService } from './bridge-types';

const KEY_MAP: Record<string, keyof AppEventMap> = {
  t: 'gesture:tap',
  d: 'gesture:double-tap',
  ArrowUp: 'gesture:scroll-up',
  ArrowDown: 'gesture:scroll-down',
};

export function createBridgeMock(
  bus: EventBus<AppEventMap>,
): BridgeService {
  let keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  async function init(): Promise<void> {
    keydownHandler = (e: KeyboardEvent) => {
      const eventName = KEY_MAP[e.key];
      if (eventName) {
        bus.emit(eventName, { timestamp: Date.now() } as AppEventMap[typeof eventName]);
      }
    };
    window.addEventListener('keydown', keydownHandler);
    console.info(
      '[BridgeMock] Keyboard shortcuts active: T=tap, D=double-tap, Up/Down=scroll',
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

  return { init, destroy, startAudio, stopAudio };
}
