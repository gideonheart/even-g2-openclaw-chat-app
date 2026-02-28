import type { DiagnosticsPayload, LogEntry, LogLevel } from './types';

// ── Log store (in-memory ring buffer) ────────────────────────

export const MAX_LOGS = 200;

export function createLogStore() {
  const logs: LogEntry[] = [];
  let idCounter = 0;

  function add(level: LogLevel, msg: string, cid: string | null = null): LogEntry {
    const entry: LogEntry = {
      id: ++idCounter,
      level,
      msg,
      cid,
      time: new Date(),
    };
    logs.unshift(entry);
    if (logs.length > MAX_LOGS) logs.pop();
    return entry;
  }

  function getAll(): readonly LogEntry[] {
    return logs;
  }

  function filter(level: LogLevel | 'all'): LogEntry[] {
    if (level === 'all') return [...logs];
    return logs.filter((l) => l.level === level);
  }

  function clear(): void {
    logs.length = 0;
    idCounter = 0;
  }

  function count(): number {
    return logs.length;
  }

  return { add, getAll, filter, clear, count };
}

export type LogStore = ReturnType<typeof createLogStore>;

// ── Diagnostics export ───────────────────────────────────────

export function buildDiagnostics(
  logStore: LogStore,
  activeSession: string,
  glassesConnected: boolean,
  settings: { gatewayUrl: string; sttProvider: string },
): DiagnosticsPayload {
  const logs = logStore.getAll();
  return {
    timestamp: new Date().toISOString(),
    settings: { gatewayUrl: settings.gatewayUrl, sttProvider: settings.sttProvider },
    activeSession,
    glassesConnected,
    logs: logs.slice(0, 50).map((l) => ({
      level: l.level,
      msg: l.msg,
      time: l.time.toISOString(),
      cid: l.cid,
    })),
  };
}
