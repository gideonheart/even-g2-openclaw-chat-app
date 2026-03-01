// ── Hub error presenter ───────────────────────────────────
// Factory that subscribes to bus error events and surfaces them
// as toasts (transient) or banners (persistent). Accepts callbacks
// for portability and testability.

import type { EventBus } from './events';
import type { AppEventMap } from './types';

export interface HubErrorPresenter {
  destroy(): void;
}

export function createHubErrorPresenter(opts: {
  bus: EventBus<AppEventMap>;
  showToast: (msg: string, durationMs: number) => void;
  showBanner: (msg: string, severity: 'warn' | 'err') => void;
  hideBanner: () => void;
}): HubErrorPresenter {
  const { bus, showToast, showBanner } = opts;
  const unsubs: Array<() => void> = [];

  function mapErrorMessage(type: string): string {
    switch (type) {
      case 'database-closed':  return 'Data connection lost';
      case 'quota-exceeded':   return 'Storage full';
      case 'write-failed':     return 'Could not save message';
      case 'verify-failed':    return 'Storage check failed';
      default:                 return 'Something went wrong';
    }
  }

  unsubs.push(bus.on('persistence:error', ({ type, recoverable }) => {
    const msg = mapErrorMessage(type);
    if (recoverable) {
      showToast(msg, 5000);
    } else {
      showBanner(msg, 'err');
    }
  }));

  unsubs.push(bus.on('fsm:watchdog-reset', ({ previousState }) => {
    showToast(`${previousState} timed out \u2014 tap to retry on glasses`, 5000);
  }));

  return {
    destroy(): void {
      for (const unsub of unsubs) unsub();
      unsubs.length = 0;
    },
  };
}
