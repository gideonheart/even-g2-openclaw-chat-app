import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadSettings,
  saveSettings,
  exportSettingsJson,
  importSettingsJson,
  validateField,
  maskSecret,
  isLocalhostUrl,
  isRealDeviceRuntime,
  localhostWarning,
  DEFAULT_SETTINGS,
  STORAGE_KEY,
} from '../settings';
import type { AppSettings } from '../types';

// ── Mock localStorage ────────────────────────────────────────

function createMockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (index: number) => [...store.keys()][index] ?? null,
  };
}

describe('settings', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createMockStorage();
  });

  describe('loadSettings', () => {
    it('returns defaults when storage is empty', () => {
      const result = loadSettings(storage);
      expect(result).toEqual(DEFAULT_SETTINGS);
    });

    it('loads persisted settings from storage', () => {
      const saved: AppSettings = {
        gatewayUrl: 'https://gw.example.com',
        sessionKey: 'sk_test',
        sttProvider: 'openai',
        apiKey: 'ak_test',
      };
      storage.setItem(STORAGE_KEY, JSON.stringify(saved));
      const result = loadSettings(storage);
      expect(result).toEqual(saved);
    });

    it('merges partial settings with defaults', () => {
      storage.setItem(STORAGE_KEY, JSON.stringify({ gatewayUrl: 'https://example.com' }));
      const result = loadSettings(storage);
      expect(result.gatewayUrl).toBe('https://example.com');
      expect(result.sttProvider).toBe('whisperx');
      expect(result.sessionKey).toBe('');
    });

    it('returns defaults on corrupt JSON', () => {
      storage.setItem(STORAGE_KEY, '{corrupt');
      const result = loadSettings(storage);
      expect(result).toEqual(DEFAULT_SETTINGS);
    });
  });

  describe('saveSettings', () => {
    it('persists settings to storage', () => {
      const settings: AppSettings = {
        gatewayUrl: 'https://gw.example.com',
        sessionKey: 'sk_123',
        sttProvider: 'custom',
        apiKey: 'ak_456',
      };
      saveSettings(settings, storage);
      const raw = storage.getItem(STORAGE_KEY);
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw!)).toEqual(settings);
    });
  });

  describe('exportSettingsJson', () => {
    it('excludes secrets from export', () => {
      const settings: AppSettings = {
        gatewayUrl: 'https://gw.example.com',
        sessionKey: 'secret_key',
        sttProvider: 'whisperx',
        apiKey: 'secret_api_key',
      };
      const exported = JSON.parse(exportSettingsJson(settings));
      expect(exported.gatewayUrl).toBe('https://gw.example.com');
      expect(exported.sttProvider).toBe('whisperx');
      expect(exported.sessionKey).toBeUndefined();
      expect(exported.apiKey).toBeUndefined();
    });
  });

  describe('importSettingsJson', () => {
    it('merges imported settings with current', () => {
      const current: AppSettings = {
        gatewayUrl: 'https://old.example.com',
        sessionKey: 'existing_key',
        sttProvider: 'whisperx',
        apiKey: 'existing_api_key',
      };
      const imported = JSON.stringify({ gatewayUrl: 'https://new.example.com', sttProvider: 'openai' });
      const result = importSettingsJson(imported, current);
      expect(result.gatewayUrl).toBe('https://new.example.com');
      expect(result.sttProvider).toBe('openai');
      expect(result.sessionKey).toBe('existing_key'); // preserved
      expect(result.apiKey).toBe('existing_api_key'); // preserved
    });

    it('throws on invalid JSON', () => {
      expect(() => importSettingsJson('{bad', DEFAULT_SETTINGS)).toThrow();
    });

    it('throws on non-object JSON', () => {
      expect(() => importSettingsJson('"string"', DEFAULT_SETTINGS)).toThrow('Invalid format');
    });

    it('overwrites secrets if explicitly in import file', () => {
      const current: AppSettings = {
        gatewayUrl: '',
        sessionKey: 'old_key',
        sttProvider: 'whisperx',
        apiKey: '',
      };
      const imported = JSON.stringify({ sessionKey: 'new_key' });
      const result = importSettingsJson(imported, current);
      expect(result.sessionKey).toBe('new_key');
    });
  });

  describe('validateField', () => {
    it('accepts valid https URL', () => {
      expect(validateField('gatewayUrl', 'https://gw.example.com')).toBe('');
    });

    it('accepts valid http URL', () => {
      expect(validateField('gatewayUrl', 'http://localhost:3000')).toBe('');
    });

    it('accepts empty gateway URL (optional)', () => {
      expect(validateField('gatewayUrl', '')).toBe('');
    });

    it('rejects invalid gateway URL', () => {
      const err = validateField('gatewayUrl', 'not-a-url');
      expect(err).toContain('http');
    });

    it('accepts any session key value', () => {
      expect(validateField('sessionKey', 'anything')).toBe('');
    });

    it('accepts any STT provider value', () => {
      expect(validateField('sttProvider', 'whisperx')).toBe('');
    });

    it('returns error for unknown field', () => {
      expect(validateField('unknownField', 'value')).toBe('Unknown field');
    });
  });

  describe('maskSecret', () => {
    it('returns bullet mask for non-empty value', () => {
      expect(maskSecret('my_secret')).toBe('\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022');
    });

    it('returns Not set for empty value', () => {
      expect(maskSecret('')).toBe('Not set');
    });
  });

  describe('isLocalhostUrl', () => {
    it('returns true for http://localhost:4400', () => {
      expect(isLocalhostUrl('http://localhost:4400')).toBe(true);
    });

    it('returns true for http://localhost:4400/', () => {
      expect(isLocalhostUrl('http://localhost:4400/')).toBe(true);
    });

    it('returns true for http://localhost (no port)', () => {
      expect(isLocalhostUrl('http://localhost')).toBe(true);
    });

    it('returns true for https://localhost:443', () => {
      expect(isLocalhostUrl('https://localhost:443')).toBe(true);
    });

    it('returns true for http://127.0.0.1:4400', () => {
      expect(isLocalhostUrl('http://127.0.0.1:4400')).toBe(true);
    });

    it('returns true for http://127.0.0.1', () => {
      expect(isLocalhostUrl('http://127.0.0.1')).toBe(true);
    });

    it('returns true for http://[::1]:4400', () => {
      expect(isLocalhostUrl('http://[::1]:4400')).toBe(true);
    });

    it('returns true for http://0.0.0.0:4400', () => {
      expect(isLocalhostUrl('http://0.0.0.0:4400')).toBe(true);
    });

    it('returns true for http://0.0.0.0 (no port)', () => {
      expect(isLocalhostUrl('http://0.0.0.0')).toBe(true);
    });

    it('returns true for http://0.0.0.0:4400/', () => {
      expect(isLocalhostUrl('http://0.0.0.0:4400/')).toBe(true);
    });

    it('returns true for case-insensitive LOCALHOST', () => {
      expect(isLocalhostUrl('http://LOCALHOST:4400')).toBe(true);
    });

    it('returns false for http://192.168.1.100:4400', () => {
      expect(isLocalhostUrl('http://192.168.1.100:4400')).toBe(false);
    });

    it('returns false for https://gw.example.com', () => {
      expect(isLocalhostUrl('https://gw.example.com')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isLocalhostUrl('')).toBe(false);
    });

    it('returns false for non-URL string', () => {
      expect(isLocalhostUrl('not-a-url')).toBe(false);
    });

    it('returns false for URL containing localhost in path only', () => {
      expect(isLocalhostUrl('http://example.com/localhost')).toBe(false);
    });
  });

  describe('isRealDeviceRuntime', () => {
    afterEach(() => {
      delete (window as any).flutter_inappwebview;
    });

    it('returns false when flutter_inappwebview is absent (browser dev mode)', () => {
      delete (window as any).flutter_inappwebview;
      expect(isRealDeviceRuntime()).toBe(false);
    });

    it('returns true when flutter_inappwebview is present (Even App WebView)', () => {
      (window as any).flutter_inappwebview = {};
      expect(isRealDeviceRuntime()).toBe(true);
    });
  });

  describe('localhostWarning', () => {
    afterEach(() => {
      delete (window as any).flutter_inappwebview;
    });

    it('returns empty string for non-localhost URL', () => {
      (window as any).flutter_inappwebview = {};
      expect(localhostWarning('https://gw.example.com')).toBe('');
    });

    it('returns empty string for localhost in dev mode (browser)', () => {
      delete (window as any).flutter_inappwebview;
      expect(localhostWarning('http://localhost:4400')).toBe('');
    });

    it('returns warning for localhost on real device', () => {
      (window as any).flutter_inappwebview = {};
      const warning = localhostWarning('http://localhost:4400');
      expect(warning).toContain('localhost');
      expect(warning).toContain('phone');
      expect(warning).toContain('server');
    });

    it('returns warning for 127.0.0.1 on real device', () => {
      (window as any).flutter_inappwebview = {};
      const warning = localhostWarning('http://127.0.0.1:4400');
      expect(warning).toContain('localhost');
      expect(warning).toContain('phone');
    });

    it('returns warning for 0.0.0.0 on real device', () => {
      (window as any).flutter_inappwebview = {};
      const warning = localhostWarning('http://0.0.0.0:4400');
      expect(warning).toContain('localhost');
      expect(warning).toContain('phone');
    });

    it('returns empty string for empty URL', () => {
      (window as any).flutter_inappwebview = {};
      expect(localhostWarning('')).toBe('');
    });
  });
});
