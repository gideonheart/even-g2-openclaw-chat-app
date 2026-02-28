// ── Extracted testable app logic (pure functions, no DOM) ────

import { STT_LABELS } from './types';
import type { AppSettings, LogLevel } from './types';
import { maskSecret } from './settings';
import { truncate } from './utils';
import type { LogStore } from './logs';

// ── App state factory ─────────────────────────────────────

export function createAppState(initialSettings: AppSettings) {
  return {
    settings: initialSettings,
    glassesConnected: false,
    activeSession: '',
    currentLogFilter: 'all' as LogLevel | 'all',
    pendingConfirm: null as (() => void) | null,
    currentEditField: null as string | null,
  };
}

export type AppState = ReturnType<typeof createAppState>;

// ── Logging callback type ─────────────────────────────────

export type LogFn = (level: LogLevel, msg: string, cid?: string | null) => void;

// ── Glasses connection (pure state mutation) ──────────────

export function connectGlasses(
  state: AppState,
  log: LogFn,
): { connected: true; battery: string } {
  state.glassesConnected = true;
  log('info', 'Glasses connected (mock)', 'conn-' + Date.now());
  return { connected: true, battery: '87 %' };
}

export function disconnectGlasses(
  state: AppState,
  log: LogFn,
): { connected: false; battery: string } {
  state.glassesConnected = false;
  log('info', 'Glasses disconnected');
  return { connected: false, battery: '-- %' };
}

// ── Session switching (pure logic) ────────────────────────

export interface SwitchResult {
  switched: boolean;
  reason?: string;
  sessionId?: string;
}

export function switchSession(
  state: AppState,
  sessionId: string,
  log: LogFn,
): SwitchResult {
  if (sessionId === state.activeSession) {
    return { switched: false, reason: 'Already active session' };
  }

  if (!sessionId) {
    return { switched: false, reason: 'No session ID provided' };
  }

  state.activeSession = sessionId;
  log('info', `Session switched to ${sessionId}`, `sess-${Date.now()}`);
  return { switched: true, sessionId };
}

// ── Log filtering (pure delegation) ──────────────────────

export function resolveLogFilter(
  filter: LogLevel | 'all',
  logStore: LogStore,
) {
  return logStore.filter(filter);
}

// ── Settings view model (pure) ───────────────────────────

export interface SettingsViewModel {
  gatewayDisplay: string;
  sessionKeyDisplay: string;
  sttDisplay: string;
  apiKeyDisplay: string;
}

export function buildSettingsViewModel(settings: AppSettings): SettingsViewModel {
  return {
    gatewayDisplay: settings.gatewayUrl ? truncate(settings.gatewayUrl, 30) : 'Not set',
    sessionKeyDisplay: maskSecret(settings.sessionKey),
    sttDisplay: STT_LABELS[settings.sttProvider] || settings.sttProvider,
    apiKeyDisplay: maskSecret(settings.apiKey),
  };
}

// ── Health view model (pure) ─────────────────────────────

export type HealthDotState = 'ok' | 'off';

export interface HealthViewModel {
  gateway: { dot: HealthDotState; label: string };
  stt: { dot: HealthDotState; label: string };
  session: { dot: HealthDotState; label: string };
}

export function buildHealthViewModel(
  settings: AppSettings,
  activeSession: string,
): HealthViewModel {
  const gwOk = !!settings.gatewayUrl;
  const sttOk = !!settings.sttProvider;
  const sessOk = !!activeSession;

  return {
    gateway: {
      dot: gwOk ? 'ok' : 'off',
      label: gwOk ? truncate(settings.gatewayUrl, 35) : 'Not configured',
    },
    stt: {
      dot: sttOk ? 'ok' : 'off',
      label: sttOk
        ? STT_LABELS[settings.sttProvider] || settings.sttProvider
        : 'Not configured',
    },
    session: {
      dot: sessOk ? 'ok' : 'off',
      label: sessOk ? activeSession : 'No session',
    },
  };
}
