// ── Core domain types ──────────────────────────────────────

export interface AppSettings {
  gatewayUrl: string;
  sessionKey: string;
  sttProvider: SttProvider;
  apiKey: string;
}

export type SttProvider = 'whisperx' | 'openai' | 'custom';

export const STT_LABELS: Record<SttProvider, string> = {
  whisperx: 'WhisperX',
  openai: 'OpenAI Whisper',
  custom: 'Custom',
};

export interface Session {
  id: string;
  name: string;
  desc: string;
}

export interface LogEntry {
  id: number;
  level: LogLevel;
  msg: string;
  cid: string | null;
  time: Date;
}

export type LogLevel = 'info' | 'warn' | 'error';

export interface DiagnosticsPayload {
  timestamp: string;
  settings: { gatewayUrl: string; sttProvider: string };
  activeSession: string;
  glassesConnected: boolean;
  logs: Array<{
    level: LogLevel;
    msg: string;
    time: string;
    cid: string | null;
  }>;
}

export interface FieldConfig {
  label: string;
  type: 'url' | 'password' | 'select';
  placeholder?: string;
  help: string;
  validate: (value: string) => string;
  secret: boolean;
  options?: Array<{ value: string; label: string }>;
}

// ── Gateway API types ──────────────────────────────────────

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface GatewayHealthState {
  status: ConnectionStatus;
  lastHeartbeat: number | null;
  reconnectAttempts: number;
  latencyMs: number | null;
}

export interface SSEEvent {
  event: string;
  data: string;
  id?: string;
}

export interface VoiceTurnRequest {
  sessionId: string;
  audio: Blob;
  sttProvider: SttProvider;
}

export interface VoiceTurnChunk {
  type: 'transcript' | 'response_start' | 'response_delta' | 'response_end' | 'error';
  text?: string;
  error?: string;
  turnId?: string;
}
