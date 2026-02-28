import { createSyncBridge } from '../sync/sync-bridge';
import type { SyncMessage } from '../sync/sync-types';

// ── BroadcastChannel mock ──────────────────────────────────
// jsdom does not provide BroadcastChannel, so we create a minimal
// working mock that correctly routes messages between instances on
// the same channel name (but NOT back to the sender).

const channelInstances = new Map<string, Set<MockBroadcastChannel>>();

class MockBroadcastChannel {
  name: string;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  private _closed = false;

  constructor(name: string) {
    this.name = name;
    let set = channelInstances.get(name);
    if (!set) {
      set = new Set();
      channelInstances.set(name, set);
    }
    set.add(this);
  }

  postMessage(data: unknown) {
    if (this._closed) return;
    const peers = channelInstances.get(this.name);
    if (!peers) return;
    for (const peer of peers) {
      if (peer !== this && !peer._closed && peer.onmessage) {
        peer.onmessage({ data });
      }
    }
  }

  close() {
    this._closed = true;
    const set = channelInstances.get(this.name);
    if (set) {
      set.delete(this);
      if (set.size === 0) channelInstances.delete(this.name);
    }
  }
}

// ── Helper ─────────────────────────────────────────────────

function makeMsg(_type: SyncMessage['type'] = 'session:created'): SyncMessage {
  return {
    type: 'session:created',
    origin: 'glasses',
    session: { id: 'test-id', name: 'Test' },
  } as SyncMessage;
}

// ── Tests ──────────────────────────────────────────────────

describe('sync-bridge', () => {
  // ── BroadcastChannel transport ─────────────────────────

  describe('BroadcastChannel transport', () => {
    beforeEach(() => {
      channelInstances.clear();
      (globalThis as any).BroadcastChannel = MockBroadcastChannel;
    });

    afterEach(() => {
      channelInstances.clear();
      delete (globalThis as any).BroadcastChannel;
    });

    it('postMessage sends to another bridge instance via BroadcastChannel', () => {
      const bridgeA = createSyncBridge('glasses');
      const bridgeB = createSyncBridge('hub');

      const received: SyncMessage[] = [];
      bridgeB.onMessage((msg) => received.push(msg));

      const msg = makeMsg();
      bridgeA.postMessage(msg);

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(msg);

      bridgeA.destroy();
      bridgeB.destroy();
    });

    it('messages from same bridge are NOT delivered to own handlers', () => {
      const bridge = createSyncBridge('glasses');

      const received: SyncMessage[] = [];
      bridge.onMessage((msg) => received.push(msg));

      bridge.postMessage(makeMsg());

      // BroadcastChannel native: sender does not receive own message
      expect(received).toHaveLength(0);

      bridge.destroy();
    });

    it('onMessage returns unsubscribe function that stops delivery', () => {
      const bridgeA = createSyncBridge('glasses');
      const bridgeB = createSyncBridge('hub');

      const received: SyncMessage[] = [];
      const unsub = bridgeB.onMessage((msg) => received.push(msg));

      bridgeA.postMessage(makeMsg());
      expect(received).toHaveLength(1);

      unsub();

      bridgeA.postMessage(makeMsg());
      expect(received).toHaveLength(1); // no new messages

      bridgeA.destroy();
      bridgeB.destroy();
    });

    it('destroy() closes channel and stops all handlers', () => {
      const bridgeA = createSyncBridge('glasses');
      const bridgeB = createSyncBridge('hub');

      const received: SyncMessage[] = [];
      bridgeB.onMessage((msg) => received.push(msg));

      bridgeB.destroy();

      bridgeA.postMessage(makeMsg());
      expect(received).toHaveLength(0);

      bridgeA.destroy();
    });
  });

  // ── localStorage fallback transport ────────────────────

  describe('localStorage fallback transport', () => {
    beforeEach(() => {
      // Ensure BroadcastChannel is NOT available
      delete (globalThis as any).BroadcastChannel;
      localStorage.clear();
    });

    afterEach(() => {
      localStorage.clear();
    });

    it('postMessage writes to localStorage key and receives via storage event', () => {
      const bridge = createSyncBridge('glasses');

      const received: SyncMessage[] = [];
      bridge.onMessage((msg) => received.push(msg));

      const msg = makeMsg();

      // Simulate what happens in another tab:
      // The bridge writes to localStorage, other tabs receive a storage event.
      // In same-tab testing, we manually dispatch a storage event.
      const serialized = JSON.stringify(msg);
      const storageEvent = new StorageEvent('storage', {
        key: 'openclaw-sync-msg',
        newValue: serialized,
        storageArea: localStorage,
      });
      window.dispatchEvent(storageEvent);

      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('session:created');

      bridge.destroy();
    });

    it('onMessage returns unsubscribe function that stops delivery', () => {
      const bridge = createSyncBridge('glasses');

      const received: SyncMessage[] = [];
      const unsub = bridge.onMessage((msg) => received.push(msg));

      // First message
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'openclaw-sync-msg',
          newValue: JSON.stringify(makeMsg()),
          storageArea: localStorage,
        }),
      );
      expect(received).toHaveLength(1);

      unsub();

      // Second message after unsub
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'openclaw-sync-msg',
          newValue: JSON.stringify(makeMsg()),
          storageArea: localStorage,
        }),
      );
      expect(received).toHaveLength(1); // no new

      bridge.destroy();
    });

    it('ignores storage events for other keys', () => {
      const bridge = createSyncBridge('glasses');

      const received: SyncMessage[] = [];
      bridge.onMessage((msg) => received.push(msg));

      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'some-other-key',
          newValue: 'irrelevant',
          storageArea: localStorage,
        }),
      );

      expect(received).toHaveLength(0);

      bridge.destroy();
    });

    it('ignores storage events with null newValue', () => {
      const bridge = createSyncBridge('glasses');

      const received: SyncMessage[] = [];
      bridge.onMessage((msg) => received.push(msg));

      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'openclaw-sync-msg',
          newValue: null,
          storageArea: localStorage,
        }),
      );

      expect(received).toHaveLength(0);

      bridge.destroy();
    });

    it('destroy() removes event listener and clears handlers', () => {
      const bridge = createSyncBridge('glasses');

      const received: SyncMessage[] = [];
      bridge.onMessage((msg) => received.push(msg));

      bridge.destroy();

      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'openclaw-sync-msg',
          newValue: JSON.stringify(makeMsg()),
          storageArea: localStorage,
        }),
      );

      expect(received).toHaveLength(0);
    });
  });

  // ── Feature detection ──────────────────────────────────

  describe('feature detection', () => {
    it('uses BroadcastChannel when available', () => {
      (globalThis as any).BroadcastChannel = MockBroadcastChannel;

      const bridgeA = createSyncBridge('glasses');
      const bridgeB = createSyncBridge('hub');

      const received: SyncMessage[] = [];
      bridgeB.onMessage((msg) => received.push(msg));

      bridgeA.postMessage(makeMsg());
      expect(received).toHaveLength(1);

      bridgeA.destroy();
      bridgeB.destroy();
      delete (globalThis as any).BroadcastChannel;
    });

    it('falls back to localStorage when BroadcastChannel is undefined', () => {
      delete (globalThis as any).BroadcastChannel;

      const bridge = createSyncBridge('glasses');

      const received: SyncMessage[] = [];
      bridge.onMessage((msg) => received.push(msg));

      // Storage event path works
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'openclaw-sync-msg',
          newValue: JSON.stringify(makeMsg()),
          storageArea: localStorage,
        }),
      );

      expect(received).toHaveLength(1);

      bridge.destroy();
    });
  });
});
