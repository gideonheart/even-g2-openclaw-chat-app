import { describe, it, expect, vi } from 'vitest';
import {
  createAppState,
  connectGlasses,
  disconnectGlasses,
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
      expect(state.activeSession).toBe('gideon');
      expect(state.currentLogFilter).toBe('all');
      expect(state.pendingConfirm).toBeNull();
      expect(state.currentEditField).toBeNull();
    });
  });

  describe('connectGlasses', () => {
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

  describe('disconnectGlasses', () => {
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
      const { logFn } = makeLogFn();

      // gideon is the default active, switch to atlas
      const result = switchSession(state, 'atlas', logFn);

      expect(result.switched).toBe(true);
      expect(result.session?.id).toBe('atlas');
      expect(state.activeSession).toBe('atlas');
    });

    it('with invalid session ID returns switched: false', () => {
      const state = createAppState(makeSettings());
      const { logFn } = makeLogFn();

      const result = switchSession(state, 'nonexistent', logFn);

      expect(result.switched).toBe(false);
      expect(result.reason).toBe('Session not found');
      expect(state.activeSession).toBe('gideon'); // unchanged
    });

    it('with same-as-current session returns switched: false', () => {
      const state = createAppState(makeSettings());
      const { logFn } = makeLogFn();

      const result = switchSession(state, 'gideon', logFn);

      expect(result.switched).toBe(false);
      expect(result.reason).toBe('Already active session');
    });
  });

  describe('buildSettingsViewModel', () => {
    it('masks secrets and truncates URLs', () => {
      const settings = makeSettings({
        gatewayUrl: 'https://a-very-long-gateway-url.example.com/api/v1/voice',
      });
      const vm = buildSettingsViewModel(settings);

      expect(vm.gatewayDisplay.length).toBeLessThanOrEqual(31); // 30 + ellipsis char
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
    it('returns ok dots for configured settings', () => {
      const settings = makeSettings();
      const vm = buildHealthViewModel(settings, 'gideon');

      expect(vm.gateway.dot).toBe('ok');
      expect(vm.gateway.label).toContain('gw.example.com');
      expect(vm.stt.dot).toBe('ok');
      expect(vm.stt.label).toBe('WhisperX');
      expect(vm.session.dot).toBe('ok');
      expect(vm.session.label).toBe('gideon');
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
