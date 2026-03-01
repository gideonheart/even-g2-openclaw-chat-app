import { describe, it, expect, vi } from 'vitest';
import {
  createAppState,
  connectGlasses,
  disconnectGlasses,
  setGlassesConnecting,
  setGlassesConnected,
  setGlassesDisconnected,
  switchSession,
  resolveLogFilter,
  buildSettingsViewModel,
  buildHealthViewModel,
} from '../app-wiring';
import type { LogFn } from '../app-wiring';
import type { AppSettings, LogLevel } from '../types';
import type { LogStore } from '../logs';

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    gatewayUrl: 'https://gw.example.com',
    sessionKey: 'sk-secret-123',
    sttProvider: 'whisperx',
    apiKey: 'ak-secret-456',
    ...overrides,
  };
}

function makeLogFn(): { logFn: LogFn; logs: Array<[LogLevel, string, string | null | undefined]> } {
  const logs: Array<[LogLevel, string, string | null | undefined]> = [];
  const logFn: LogFn = (level, msg, cid) => logs.push([level, msg, cid]);
  return { logFn, logs };
}

describe('app-wiring', () => {
  describe('createAppState', () => {
    it('returns correct defaults', () => {
      const settings = makeSettings();
      const state = createAppState(settings);

      expect(state.settings).toEqual(settings);
      expect(state.glassesConnected).toBe(false);
      expect(state.glassesConnectionState).toBe('disconnected');
      expect(state.glassesBattery).toBe('-- %');
      expect(state.glassesDeviceName).toBe('');
      expect(state.activeSession).toBe('');
      expect(state.currentLogFilter).toBe('all');
      expect(state.pendingConfirm).toBeNull();
      expect(state.currentEditField).toBeNull();
    });
  });

  // ── New stateful connection API ──

  describe('setGlassesConnecting', () => {
    it('sets state to connecting and glassesConnected false', () => {
      const state = createAppState(makeSettings());
      const { logFn, logs } = makeLogFn();

      const result = setGlassesConnecting(state, logFn);

      expect(state.glassesConnectionState).toBe('connecting');
      expect(state.glassesConnected).toBe(false);
      expect(result.connectionState).toBe('connecting');
      expect(logs).toHaveLength(1);
      expect(logs[0][1]).toContain('connecting');
    });
  });

  describe('setGlassesConnected', () => {
    it('sets state to connected with device name and battery', () => {
      const state = createAppState(makeSettings());
      const { logFn, logs } = makeLogFn();

      const result = setGlassesConnected(state, logFn, 'Even G2', '92 %');

      expect(state.glassesConnectionState).toBe('connected');
      expect(state.glassesConnected).toBe(true);
      expect(state.glassesDeviceName).toBe('Even G2');
      expect(state.glassesBattery).toBe('92 %');
      expect(result.connectionState).toBe('connected');
      expect(result.battery).toBe('92 %');
      expect(result.deviceName).toBe('Even G2');
      expect(logs).toHaveLength(1);
      expect(logs[0][1]).toContain('Even G2');
    });

    it('keeps existing battery if none provided', () => {
      const state = createAppState(makeSettings());
      state.glassesBattery = '50 %';
      const { logFn } = makeLogFn();

      setGlassesConnected(state, logFn, 'Even G2');

      expect(state.glassesBattery).toBe('50 %');
    });
  });

  describe('setGlassesDisconnected', () => {
    it('resets all connection state', () => {
      const state = createAppState(makeSettings());
      state.glassesConnectionState = 'connected';
      state.glassesConnected = true;
      state.glassesBattery = '85 %';
      state.glassesDeviceName = 'Even G2';
      const { logFn, logs } = makeLogFn();

      const result = setGlassesDisconnected(state, logFn, 'user request');

      expect(state.glassesConnectionState).toBe('disconnected');
      expect(state.glassesConnected).toBe(false);
      expect(state.glassesBattery).toBe('-- %');
      expect(state.glassesDeviceName).toBe('');
      expect(result.connectionState).toBe('disconnected');
      expect(result.battery).toBe('-- %');
      expect(logs).toHaveLength(1);
      expect(logs[0][1]).toContain('user request');
    });

    it('logs generic message when no reason', () => {
      const state = createAppState(makeSettings());
      const { logFn, logs } = makeLogFn();

      setGlassesDisconnected(state, logFn);

      expect(logs[0][1]).toBe('Glasses disconnected');
    });
  });

  // ── Deprecated (backward compat) ──

  describe('connectGlasses (deprecated)', () => {
    it('sets state.glassesConnected to true and calls log', () => {
      const state = createAppState(makeSettings());
      const { logFn, logs } = makeLogFn();

      const result = connectGlasses(state, logFn);

      expect(state.glassesConnected).toBe(true);
      expect(result.connected).toBe(true);
      expect(result.battery).toBe('87 %');
      expect(logs).toHaveLength(1);
      expect(logs[0][0]).toBe('info');
      expect(logs[0][1]).toContain('Glasses connected');
    });
  });

  describe('disconnectGlasses (deprecated)', () => {
    it('sets state.glassesConnected to false and calls log', () => {
      const state = createAppState(makeSettings());
      state.glassesConnected = true;
      const { logFn, logs } = makeLogFn();

      const result = disconnectGlasses(state, logFn);

      expect(state.glassesConnected).toBe(false);
      expect(result.connected).toBe(false);
      expect(result.battery).toBe('-- %');
      expect(logs).toHaveLength(1);
      expect(logs[0][0]).toBe('info');
      expect(logs[0][1]).toContain('Glasses disconnected');
    });
  });

  describe('switchSession', () => {
    it('with valid session ID returns switched: true', () => {
      const state = createAppState(makeSettings());
      state.activeSession = 'old-session';
      const { logFn } = makeLogFn();

      const result = switchSession(state, 'new-session', logFn);

      expect(result.switched).toBe(true);
      expect(result.sessionId).toBe('new-session');
      expect(state.activeSession).toBe('new-session');
    });

    it('with empty session ID returns switched: false', () => {
      const state = createAppState(makeSettings());
      const { logFn } = makeLogFn();

      const result = switchSession(state, '', logFn);

      expect(result.switched).toBe(false);
      expect(result.reason).toBe('Already active session');
    });

    it('with same-as-current session returns switched: false', () => {
      const state = createAppState(makeSettings());
      state.activeSession = 'my-session';
      const { logFn } = makeLogFn();

      const result = switchSession(state, 'my-session', logFn);

      expect(result.switched).toBe(false);
      expect(result.reason).toBe('Already active session');
    });

    it('with no session ID provided returns switched: false', () => {
      const state = createAppState(makeSettings());
      state.activeSession = 'current';
      const { logFn } = makeLogFn();

      const result = switchSession(state, '', logFn);

      expect(result.switched).toBe(false);
    });
  });

  describe('buildSettingsViewModel', () => {
    it('masks secrets and truncates URLs', () => {
      const settings = makeSettings({
        gatewayUrl: 'https://a-very-long-gateway-url.example.com/api/v1/voice',
      });
      const vm = buildSettingsViewModel(settings);

      expect(vm.gatewayDisplay.length).toBeLessThanOrEqual(31);
      expect(vm.sessionKeyDisplay).not.toContain('sk-secret');
      expect(vm.apiKeyDisplay).not.toContain('ak-secret');
      expect(vm.sttDisplay).toBe('WhisperX');
    });

    it('shows "Not set" for empty gateway URL', () => {
      const settings = makeSettings({ gatewayUrl: '' });
      const vm = buildSettingsViewModel(settings);

      expect(vm.gatewayDisplay).toBe('Not set');
    });

    it('shows "Not set" for empty secrets', () => {
      const settings = makeSettings({ sessionKey: '', apiKey: '' });
      const vm = buildSettingsViewModel(settings);

      expect(vm.sessionKeyDisplay).toBe('Not set');
      expect(vm.apiKeyDisplay).toBe('Not set');
    });
  });

  describe('buildHealthViewModel', () => {
    it('returns ok dots for configured settings with live gateway status', () => {
      const settings = makeSettings();
      const vm = buildHealthViewModel(settings, 'gideon', 'connected');

      expect(vm.gateway.dot).toBe('ok');
      expect(vm.gateway.label).toContain('gw.example.com');
      expect(vm.stt.dot).toBe('ok');
      expect(vm.stt.label).toBe('WhisperX');
      expect(vm.session.dot).toBe('ok');
      expect(vm.session.label).toBe('gideon');
    });

    it('returns off dot for configured gateway without live status', () => {
      const settings = makeSettings();
      const vm = buildHealthViewModel(settings, 'gideon');

      // Gateway URL is set but no live status — dot is off until health check runs
      expect(vm.gateway.dot).toBe('off');
      expect(vm.gateway.label).toContain('gw.example.com');
    });

    it('returns err dot when gateway status is error', () => {
      const settings = makeSettings();
      const vm = buildHealthViewModel(settings, 'gideon', 'error');

      expect(vm.gateway.dot).toBe('err');
      expect(vm.gateway.label).toBe('Unreachable');
    });

    it('returns warn dot when gateway status is connecting', () => {
      const settings = makeSettings();
      const vm = buildHealthViewModel(settings, 'gideon', 'connecting');

      expect(vm.gateway.dot).toBe('warn');
      expect(vm.gateway.label).toContain('Connecting');
    });

    it('returns off dots for unconfigured settings', () => {
      const settings = makeSettings({ gatewayUrl: '', sttProvider: '' as 'whisperx' });
      const vm = buildHealthViewModel(settings, '');

      expect(vm.gateway.dot).toBe('off');
      expect(vm.gateway.label).toBe('Not configured');
      expect(vm.stt.dot).toBe('off');
      expect(vm.stt.label).toBe('Not configured');
      expect(vm.session.dot).toBe('off');
      expect(vm.session.label).toBe('No session');
    });

    it('shows "Ready" label when connected with readyStatus ready', () => {
      const settings = makeSettings();
      const vm = buildHealthViewModel(settings, 'gideon', 'connected', {
        readyStatus: 'ready',
        sttReady: true,
        openclawReady: true,
      });

      expect(vm.gateway.dot).toBe('ok');
      expect(vm.gateway.label).toBe('Ready');
    });

    it('shows warn dot and "Degraded: STT down" when sttReady is false', () => {
      const settings = makeSettings();
      const vm = buildHealthViewModel(settings, 'gideon', 'connected', {
        readyStatus: 'not_ready',
        sttReady: false,
        openclawReady: true,
      });

      expect(vm.gateway.dot).toBe('warn');
      expect(vm.gateway.label).toBe('Degraded: STT down');
    });

    it('shows "Degraded: STT, OpenClaw down" when both are false', () => {
      const settings = makeSettings();
      const vm = buildHealthViewModel(settings, 'gideon', 'connected', {
        readyStatus: 'not_ready',
        sttReady: false,
        openclawReady: false,
      });

      expect(vm.gateway.dot).toBe('warn');
      expect(vm.gateway.label).toBe('Degraded: STT, OpenClaw down');
    });

    it('shows "Not ready" when readyStatus is not_ready but no specific deps down', () => {
      const settings = makeSettings();
      const vm = buildHealthViewModel(settings, 'gideon', 'connected', {
        readyStatus: 'not_ready',
        sttReady: true,
        openclawReady: true,
      });

      expect(vm.gateway.dot).toBe('warn');
      expect(vm.gateway.label).toBe('Not ready');
    });

    it('enriches error label with readyz detail when error + not_ready', () => {
      const settings = makeSettings();
      const vm = buildHealthViewModel(settings, 'gideon', 'error', {
        readyStatus: 'not_ready',
        sttReady: false,
        openclawReady: true,
      });

      expect(vm.gateway.dot).toBe('err');
      expect(vm.gateway.label).toBe('Unreachable: STT down');
    });

    it('backward compatible: no readyzDetail behaves exactly as before', () => {
      const settings = makeSettings();
      const vm = buildHealthViewModel(settings, 'gideon', 'connected');

      expect(vm.gateway.dot).toBe('ok');
      expect(vm.gateway.label).toContain('gw.example.com');
    });
  });

  describe('resolveLogFilter', () => {
    it('delegates to logStore.filter correctly', () => {
      const mockFilter = vi.fn().mockReturnValue([]);
      const mockLogStore = { filter: mockFilter } as unknown as LogStore;

      resolveLogFilter('error', mockLogStore);

      expect(mockFilter).toHaveBeenCalledOnce();
      expect(mockFilter).toHaveBeenCalledWith('error');
    });

    it('returns logStore.filter result for "all"', () => {
      const entries = [{ id: 1, level: 'info', msg: 'test', cid: null, time: new Date() }];
      const mockFilter = vi.fn().mockReturnValue(entries);
      const mockLogStore = { filter: mockFilter } as unknown as LogStore;

      const result = resolveLogFilter('all', mockLogStore);

      expect(result).toBe(entries);
      expect(mockFilter).toHaveBeenCalledWith('all');
    });
  });
});
