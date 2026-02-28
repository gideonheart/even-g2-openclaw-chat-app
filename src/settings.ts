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
    placeholder: 'https://your-gateway.example.com',
    help: 'OpenClaw voice gateway endpoint',
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
