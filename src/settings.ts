import type { AppSettings, FieldConfig, SttProvider } from './types';

// ── Constants ────────────────────────────────────────────────

export const STORAGE_KEY = 'even-openclaw-settings';

export const DEFAULT_SETTINGS: AppSettings = {
  gatewayUrl: '',
  sessionKey: '',
  sttProvider: 'whisperx',
  apiKey: '',
};

export const FIELD_CONFIG: Record<string, FieldConfig> = {
  gatewayUrl: {
    label: 'Gateway URL',
    type: 'url',
    placeholder: 'http://your-server:4400',
    help: 'OpenClaw voice gateway endpoint (use server IP/hostname, not localhost)',
    validate: (v: string) =>
      !v || /^https?:\/\/.+/.test(v) ? '' : 'Must be a valid http(s):// URL',
    secret: false,
  },
  sessionKey: {
    label: 'Session key',
    type: 'password',
    placeholder: 'Enter session key',
    help: 'Identifies your OpenClaw session',
    validate: () => '',
    secret: true,
  },
  sttProvider: {
    label: 'STT provider',
    type: 'select',
    options: [
      { value: 'whisperx', label: 'WhisperX' },
      { value: 'openai', label: 'OpenAI Whisper' },
      { value: 'custom', label: 'Custom endpoint' },
    ],
    help: 'Speech-to-text engine for voice transcription',
    validate: () => '',
    secret: false,
  },
  apiKey: {
    label: 'Provider API key',
    type: 'password',
    placeholder: 'Enter API key',
    help: 'API key for the selected STT provider (optional)',
    validate: () => '',
    secret: true,
  },
};

// ── Settings store ───────────────────────────────────────────

export function loadSettings(storage: Storage = localStorage): AppSettings {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch (e) {
    console.warn('Failed to load settings', e);
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(
  settings: AppSettings,
  storage: Storage = localStorage,
): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function exportSettingsJson(settings: AppSettings): string {
  const exported: Partial<AppSettings> = { ...settings };
  // Exclude secrets by default
  delete exported.sessionKey;
  delete exported.apiKey;
  return JSON.stringify(exported, null, 2);
}

export function importSettingsJson(
  json: string,
  current: AppSettings,
): AppSettings {
  const imported = JSON.parse(json) as Partial<AppSettings>;
  if (typeof imported !== 'object' || imported === null) {
    throw new Error('Invalid format');
  }
  const merged = { ...current };
  if (imported.gatewayUrl !== undefined) merged.gatewayUrl = imported.gatewayUrl;
  if (imported.sttProvider !== undefined) {
    merged.sttProvider = imported.sttProvider as SttProvider;
  }
  if (imported.sessionKey !== undefined) merged.sessionKey = imported.sessionKey;
  if (imported.apiKey !== undefined) merged.apiKey = imported.apiKey;
  return merged;
}

export function validateField(fieldId: string, value: string): string {
  const config = FIELD_CONFIG[fieldId];
  if (!config) return 'Unknown field';
  return config.validate(value);
}

export function maskSecret(value: string): string {
  return value ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : 'Not set';
}

// ── Localhost detection ─────────────────────────────────────

const LOOPBACK_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;

/**
 * Returns true when the gateway URL points to a loopback address
 * (localhost, 127.0.0.1, or [::1]).
 */
export function isLocalhostUrl(url: string): boolean {
  return LOOPBACK_RE.test(url);
}

/**
 * Returns true when the current runtime is a real device WebView
 * (Even App injects window.flutter_inappwebview).
 * In dev mode (plain browser) localhost is expected and valid.
 */
export function isRealDeviceRuntime(): boolean {
  return typeof (window as any).flutter_inappwebview !== 'undefined';
}

/**
 * If the gateway URL is localhost AND we're running on a real device,
 * returns an actionable warning string.  Otherwise returns ''.
 */
export function localhostWarning(url: string): string {
  if (!url) return '';
  if (!isLocalhostUrl(url)) return '';
  if (!isRealDeviceRuntime()) return '';
  return 'localhost points to the phone, not the server. Use the server IP/hostname instead.';
}
