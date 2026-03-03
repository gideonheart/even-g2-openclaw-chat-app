import type {
  AppSettings,
  ConnectionStatus,
  GatewayHealthState,
  SSEEvent,
  TextTurnRequest,
  VoiceTurnChunk,
  VoiceTurnRequest,
} from '../types';

// ── SSE line parser (kept for tests/backward compatibility) ──

export function parseSSELines(raw: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  let current: Partial<SSEEvent> = {};

  for (const line of raw.split(/\r?\n/)) {
    if (line === '') {
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

    if (line.startsWith(':')) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const field = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1).trimStart();

    if (field === 'data') {
      current.data = current.data !== undefined ? `${current.data}\n${value}` : value;
    } else if (field === 'event') {
      current.event = value;
    } else if (field === 'id') {
      current.id = value;
    }
  }

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
  heartbeatIntervalMs?: number;
  maxReconnectAttempts?: number;
  reconnectBaseDelayMs?: number;
}

const DEFAULT_OPTIONS: Required<GatewayClientOptions> = {
  heartbeatIntervalMs: 15000,
  maxReconnectAttempts: 5,
  reconnectBaseDelayMs: 1000,
};

interface GatewayReply {
  turnId?: string;
  transcript?: string;
  assistant?: {
    fullText?: string;
  };
}

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
    for (const handler of statusHandlers) handler(status);
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
    for (const handler of eventHandlers) handler(chunk);
  }

  async function checkHealth(gatewayUrl: string): Promise<boolean> {
    const start = Date.now();
    try {
      const resp = await fetch(`${gatewayUrl}/readyz`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      health.latencyMs = Date.now() - start;
      health.lastHeartbeat = Date.now();

      // Parse readyz body for detail (best-effort, don't fail on parse errors)
      try {
        const body = await resp.json();
        health.readyStatus = body.status === 'ready' ? 'ready' : 'not_ready';
        health.sttReady = body.checks?.stt?.healthy === true;
        health.openclawReady = body.checks?.openclaw?.healthy === true;
      } catch {
        // Non-JSON response -- clear detail fields
        health.readyStatus = undefined;
        health.sttReady = undefined;
        health.openclawReady = undefined;
      }

      // Any HTTP response (200 or 503) means the gateway is reachable.
      // The readyz body carries the actual readiness detail; the HTTP status
      // alone should NOT determine reachability.  Only a fetch throw (network
      // error / CORS block / timeout) means truly unreachable.
      return true;
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

  const TURN_TIMEOUT_MS = 30_000;

  /**
   * Read the JSON error body from a non-OK gateway response.
   * Gateway returns `{ error: "...", code: "..." }` on 4xx/5xx.
   * Falls back to HTTP status if body cannot be parsed.
   */
  async function readGatewayError(resp: Response): Promise<string> {
    try {
      const body = await resp.json() as { error?: string; code?: string };
      if (body.error) {
        return body.error;
      }
    } catch {
      // Non-JSON body -- fall through to status-based message
    }
    return `Gateway returned ${resp.status}${resp.statusText ? `: ${resp.statusText}` : ''}`;
  }

  function emitFromGatewayReply(reply: GatewayReply): void {
    if (reply.transcript) {
      emitChunk({ type: 'transcript', text: reply.transcript, turnId: reply.turnId });
    }
    emitChunk({ type: 'response_start', turnId: reply.turnId });
    const text = reply.assistant?.fullText?.trim();
    if (text) emitChunk({ type: 'response_delta', text, turnId: reply.turnId });
    emitChunk({ type: 'response_end', turnId: reply.turnId });
  }

  /**
   * Sentinel error subclass for application-level gateway errors (4xx/5xx).
   * The gateway WAS reachable (we got an HTTP response), but the request
   * was rejected by the server.  This is distinct from network errors
   * (TypeError from fetch) and timeouts (DOMException) which mean the
   * gateway is genuinely unreachable.
   */
  class GatewayAppError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'GatewayAppError';
    }
  }

  async function postVoiceTurn(settings: AppSettings, audio: Blob): Promise<GatewayReply> {
    const headers: Record<string, string> = {
      'Content-Type': audio.type || 'audio/wav',
      ...(settings.sessionKey ? { 'X-Session-Key': settings.sessionKey } : {}),
    };

    const resp = await fetch(`${settings.gatewayUrl}/api/voice/turn`, {
      method: 'POST',
      body: audio,
      headers,
      signal: abortController!.signal,
    });

    if (!resp.ok) {
      // Server responded with an error -- gateway IS reachable, request was rejected.
      throw new GatewayAppError(await readGatewayError(resp));
    }

    return (await resp.json()) as GatewayReply;
  }

  async function sendVoiceTurn(settings: AppSettings, request: VoiceTurnRequest): Promise<void> {
    if (!settings.gatewayUrl) {
      emitChunk({ type: 'error', error: 'Gateway URL not configured' });
      return;
    }

    abort();
    abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController?.abort(new DOMException('signal timed out', 'TimeoutError'));
    }, TURN_TIMEOUT_MS);

    setStatus('connecting');

    try {
      const reply = await postVoiceTurn(settings, request.audio);
      clearTimeout(timeoutId);
      setStatus('connected');
      health.reconnectAttempts = 0;
      emitFromGatewayReply(reply);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        emitChunk({ type: 'error', error: 'Request timed out. Tap to retry.' });
        setStatus('error');
      } else if (err instanceof GatewayAppError) {
        // Gateway responded with an error (4xx/5xx) -- it IS reachable.
        // Emit the error for display but keep status as 'connected'.
        emitChunk({ type: 'error', error: err.message });
        setStatus('connected');
      } else {
        // Network error, CORS block, or other fetch failure -- truly unreachable.
        emitChunk({ type: 'error', error: err instanceof Error ? err.message : 'Gateway request failed' });
        setStatus('error');
      }
    }
  }

  async function postTextTurn(settings: AppSettings, request: TextTurnRequest): Promise<GatewayReply> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(settings.sessionKey ? { 'X-Session-Key': settings.sessionKey } : {}),
    };

    const resp = await fetch(`${settings.gatewayUrl}/api/text/turn`, {
      method: 'POST',
      body: JSON.stringify({ text: request.text }),
      headers,
      signal: abortController!.signal,
    });

    if (!resp.ok) {
      // Server responded with an error -- gateway IS reachable, request was rejected.
      throw new GatewayAppError(await readGatewayError(resp));
    }

    return (await resp.json()) as GatewayReply;
  }

  async function sendTextTurn(settings: AppSettings, request: TextTurnRequest): Promise<void> {
    if (!settings.gatewayUrl) {
      emitChunk({ type: 'error', error: 'Gateway URL not configured' });
      return;
    }

    abort();
    abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController?.abort(new DOMException('signal timed out', 'TimeoutError'));
    }, TURN_TIMEOUT_MS);

    setStatus('connecting');

    try {
      const reply = await postTextTurn(settings, request);
      clearTimeout(timeoutId);
      setStatus('connected');
      health.reconnectAttempts = 0;
      emitFromGatewayReply(reply);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        emitChunk({ type: 'error', error: 'Request timed out. Tap to retry.' });
        setStatus('error');
      } else if (err instanceof GatewayAppError) {
        // Gateway responded with an error (4xx/5xx) -- it IS reachable.
        // Emit the error for display but keep status as 'connected'.
        emitChunk({ type: 'error', error: err.message });
        setStatus('connected');
      } else {
        // Network error, CORS block, or other fetch failure -- truly unreachable.
        emitChunk({ type: 'error', error: err instanceof Error ? err.message : 'Gateway request failed' });
        setStatus('error');
      }
    }
  }

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
    sendTextTurn,
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
