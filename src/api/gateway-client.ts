import type {
  AppSettings,
  ConnectionStatus,
  GatewayHealthState,
  SSEEvent,
  VoiceTurnChunk,
  VoiceTurnRequest,
} from '../types';

// ── SSE line parser (no native EventSource — works with fetch) ──

export function parseSSELines(raw: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  let current: Partial<SSEEvent> = {};

  for (const line of raw.split(/\r?\n/)) {
    if (line === '') {
      // Blank line = event boundary
      if (current.data !== undefined) {
        events.push({
          event: current.event || 'message',
          data: current.data,
          id: current.id,
        });
      }
      current = {};
      continue;
    }

    if (line.startsWith(':')) continue; // SSE comment

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const field = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1).trimStart();

    if (field === 'data') {
      current.data = current.data !== undefined ? current.data + '\n' + value : value;
    } else if (field === 'event') {
      current.event = value;
    } else if (field === 'id') {
      current.id = value;
    }
  }

  // Flush final event if present (no trailing blank line)
  if (current.data !== undefined) {
    events.push({
      event: current.event || 'message',
      data: current.data,
      id: current.id,
    });
  }

  return events;
}

// ── Gateway client ───────────────────────────────────────────

export type GatewayEventHandler = (chunk: VoiceTurnChunk) => void;
export type StatusChangeHandler = (status: ConnectionStatus) => void;

export interface GatewayClientOptions {
  /** Health check interval in ms (default 15000) */
  heartbeatIntervalMs?: number;
  /** Max reconnection attempts before giving up (default 5) */
  maxReconnectAttempts?: number;
  /** Base delay for exponential backoff in ms (default 1000) */
  reconnectBaseDelayMs?: number;
}

const DEFAULT_OPTIONS: Required<GatewayClientOptions> = {
  heartbeatIntervalMs: 15000,
  maxReconnectAttempts: 5,
  reconnectBaseDelayMs: 1000,
};

export function createGatewayClient(options: GatewayClientOptions = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let abortController: AbortController | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const health: GatewayHealthState = {
    status: 'disconnected',
    lastHeartbeat: null,
    reconnectAttempts: 0,
    latencyMs: null,
  };

  const eventHandlers: Set<GatewayEventHandler> = new Set();
  const statusHandlers: Set<StatusChangeHandler> = new Set();

  function setStatus(status: ConnectionStatus): void {
    health.status = status;
    for (const handler of statusHandlers) {
      handler(status);
    }
  }

  function onChunk(handler: GatewayEventHandler): () => void {
    eventHandlers.add(handler);
    return () => eventHandlers.delete(handler);
  }

  function onStatusChange(handler: StatusChangeHandler): () => void {
    statusHandlers.add(handler);
    return () => statusHandlers.delete(handler);
  }

  function emitChunk(chunk: VoiceTurnChunk): void {
    for (const handler of eventHandlers) {
      handler(chunk);
    }
  }

  // ── Health check ──────────────────────────────────────────

  async function checkHealth(gatewayUrl: string): Promise<boolean> {
    const start = Date.now();
    try {
      const resp = await fetch(`${gatewayUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      health.latencyMs = Date.now() - start;
      health.lastHeartbeat = Date.now();
      return resp.ok;
    } catch {
      health.latencyMs = null;
      return false;
    }
  }

  function startHeartbeat(gatewayUrl: string): void {
    stopHeartbeat();
    heartbeatTimer = setInterval(async () => {
      const ok = await checkHealth(gatewayUrl);
      if (!ok && health.status === 'connected') {
        setStatus('error');
      } else if (ok && health.status === 'error') {
        setStatus('connected');
        health.reconnectAttempts = 0;
      }
    }, opts.heartbeatIntervalMs);
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  // ── Voice turn (audio upload + SSE stream) ─────────────────

  async function sendVoiceTurn(
    settings: AppSettings,
    request: VoiceTurnRequest,
  ): Promise<void> {
    if (!settings.gatewayUrl) {
      emitChunk({ type: 'error', error: 'Gateway URL not configured' });
      return;
    }

    // Cancel any in-progress request
    abort();

    abortController = new AbortController();
    setStatus('connecting');

    const formData = new FormData();
    formData.append('audio', request.audio, 'recording.webm');
    formData.append('sessionId', request.sessionId);
    formData.append('sttProvider', request.sttProvider);

    try {
      const resp = await fetch(`${settings.gatewayUrl}/voice/turn`, {
        method: 'POST',
        body: formData,
        headers: {
          ...(settings.sessionKey ? { 'X-Session-Key': settings.sessionKey } : {}),
        },
        signal: abortController.signal,
      });

      if (!resp.ok) {
        emitChunk({
          type: 'error',
          error: `Gateway returned ${resp.status}: ${resp.statusText}`,
        });
        setStatus('error');
        return;
      }

      setStatus('connected');
      health.reconnectAttempts = 0;

      // Stream SSE response via ReadableStream
      const reader = resp.body?.getReader();
      if (!reader) {
        emitChunk({ type: 'error', error: 'No response body stream' });
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events (terminated by double newline)
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const events = parseSSELines(part + '\n\n');
          for (const evt of events) {
            try {
              const chunk = JSON.parse(evt.data) as VoiceTurnChunk;
              emitChunk(chunk);
            } catch {
              // Non-JSON SSE data, emit as raw response delta
              emitChunk({ type: 'response_delta', text: evt.data });
            }
          }
        }
      }

      // Flush remaining buffer
      if (buffer.trim()) {
        const events = parseSSELines(buffer);
        for (const evt of events) {
          try {
            const chunk = JSON.parse(evt.data) as VoiceTurnChunk;
            emitChunk(chunk);
          } catch {
            emitChunk({ type: 'response_delta', text: evt.data });
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return; // Intentional cancellation
      }

      const message = err instanceof Error ? err.message : 'Unknown error';
      emitChunk({ type: 'error', error: message });

      // Auto-reconnect with exponential backoff
      if (health.reconnectAttempts < opts.maxReconnectAttempts) {
        health.reconnectAttempts++;
        setStatus('connecting');
        const delay = opts.reconnectBaseDelayMs * Math.pow(2, health.reconnectAttempts - 1);
        await new Promise((r) => setTimeout(r, delay));
        // Actually retry the request (recursive call)
        return sendVoiceTurn(settings, request);
      } else {
        setStatus('error');
      }
    }
  }

  // ── Abort / cleanup ────────────────────────────────────────

  function abort(): void {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  }

  function destroy(): void {
    abort();
    stopHeartbeat();
    setStatus('disconnected');
    eventHandlers.clear();
    statusHandlers.clear();
  }

  function getHealth(): Readonly<GatewayHealthState> {
    return { ...health };
  }

  return {
    sendVoiceTurn,
    checkHealth,
    startHeartbeat,
    stopHeartbeat,
    onChunk,
    onStatusChange,
    abort,
    destroy,
    getHealth,
  };
}

export type GatewayClient = ReturnType<typeof createGatewayClient>;
