import { describe, it, expect, beforeEach } from 'vitest';
import { createLogStore, buildDiagnostics, MAX_LOGS } from '../logs';
import type { LogStore } from '../logs';

describe('logs', () => {
  let store: LogStore;

  beforeEach(() => {
    store = createLogStore();
  });

  describe('createLogStore', () => {
    it('starts empty', () => {
      expect(store.count()).toBe(0);
      expect(store.getAll()).toHaveLength(0);
    });

    it('adds log entries', () => {
      store.add('info', 'test message');
      expect(store.count()).toBe(1);
      expect(store.getAll()[0].msg).toBe('test message');
      expect(store.getAll()[0].level).toBe('info');
    });

    it('assigns sequential IDs', () => {
      store.add('info', 'first');
      store.add('warn', 'second');
      expect(store.getAll()[0].id).toBe(2); // newest first
      expect(store.getAll()[1].id).toBe(1);
    });

    it('stores entries newest-first', () => {
      store.add('info', 'first');
      store.add('info', 'second');
      store.add('info', 'third');
      expect(store.getAll()[0].msg).toBe('third');
      expect(store.getAll()[2].msg).toBe('first');
    });

    it('preserves correlation ID', () => {
      store.add('info', 'with cid', 'cid-123');
      expect(store.getAll()[0].cid).toBe('cid-123');
    });

    it('defaults correlation ID to null', () => {
      store.add('info', 'no cid');
      expect(store.getAll()[0].cid).toBeNull();
    });

    it('records timestamp', () => {
      const before = new Date();
      store.add('info', 'timed');
      const after = new Date();
      const entryTime = store.getAll()[0].time.getTime();
      expect(entryTime).toBeGreaterThanOrEqual(before.getTime());
      expect(entryTime).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('ring buffer', () => {
    it('respects max capacity of ' + MAX_LOGS, () => {
      for (let i = 0; i < MAX_LOGS + 50; i++) {
        store.add('info', `msg-${i}`);
      }
      expect(store.count()).toBe(MAX_LOGS);
    });

    it('evicts oldest entries when full', () => {
      for (let i = 0; i < MAX_LOGS + 5; i++) {
        store.add('info', `msg-${i}`);
      }
      const all = store.getAll();
      // Newest should be the last added
      expect(all[0].msg).toBe(`msg-${MAX_LOGS + 4}`);
      // Oldest should be msg-5 (first 5 were evicted)
      expect(all[all.length - 1].msg).toBe('msg-5');
    });
  });

  describe('filter', () => {
    beforeEach(() => {
      store.add('info', 'info msg');
      store.add('warn', 'warn msg');
      store.add('error', 'error msg');
      store.add('info', 'info msg 2');
    });

    it('returns all entries with "all" filter', () => {
      expect(store.filter('all')).toHaveLength(4);
    });

    it('filters by info level', () => {
      const filtered = store.filter('info');
      expect(filtered).toHaveLength(2);
      expect(filtered.every((l) => l.level === 'info')).toBe(true);
    });

    it('filters by warn level', () => {
      const filtered = store.filter('warn');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].msg).toBe('warn msg');
    });

    it('filters by error level', () => {
      const filtered = store.filter('error');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].msg).toBe('error msg');
    });

    it('returns empty array for level with no entries', () => {
      const freshStore = createLogStore();
      expect(freshStore.filter('error')).toHaveLength(0);
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      store.add('info', 'one');
      store.add('warn', 'two');
      store.clear();
      expect(store.count()).toBe(0);
      expect(store.getAll()).toHaveLength(0);
    });
  });

  describe('buildDiagnostics', () => {
    it('produces valid diagnostics payload', () => {
      store.add('info', 'test log', 'cid-1');
      store.add('error', 'error log');

      const diag = buildDiagnostics(store, 'gideon', true, {
        gatewayUrl: 'https://gw.example.com',
        sttProvider: 'whisperx',
      });

      expect(diag.timestamp).toBeTruthy();
      expect(diag.activeSession).toBe('gideon');
      expect(diag.glassesConnected).toBe(true);
      expect(diag.settings.gatewayUrl).toBe('https://gw.example.com');
      expect(diag.settings.sttProvider).toBe('whisperx');
      expect(diag.logs).toHaveLength(2);
      expect(diag.logs[0].level).toBe('error'); // newest first
    });

    it('limits diagnostics to 50 log entries', () => {
      for (let i = 0; i < 100; i++) {
        store.add('info', `log-${i}`);
      }

      const diag = buildDiagnostics(store, 'gideon', false, {
        gatewayUrl: '',
        sttProvider: 'whisperx',
      });

      expect(diag.logs).toHaveLength(50);
    });

    it('excludes secrets from diagnostics', () => {
      const diag = buildDiagnostics(store, 'gideon', false, {
        gatewayUrl: 'https://gw.example.com',
        sttProvider: 'openai',
      });

      // Only gatewayUrl and sttProvider should be present
      const keys = Object.keys(diag.settings);
      expect(keys).toEqual(['gatewayUrl', 'sttProvider']);
    });
  });
});
