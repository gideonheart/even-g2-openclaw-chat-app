import type {
  AppSettings,
  ConnectionStatus,
  GatewayHealthState,
  TextTurnRequest,
  VoiceTurnChunk,
  VoiceTurnRequest,
} from '../types';

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

  // ── Last event sequence tracking (for resume sync / replay) ──
  // Only updated via setLastSeq() after processing replay events.
  // Normal SSE streams do not carry seq numbers.
  let lastEventSeq: number | null = null;
  try {
    const stored = localStorage.getItem('openclaw-last-event-seq');
    if (stored != null) lastEventSeq = Number(stored) || null;
  } catch { /* localStorage unavailable */ }

  function getLastSeq(): number | null {
    return lastEventSeq;
  }

  function setLastSeq(seq: number): void {
    lastEventSeq = seq;
    try { localStorage.setItem('openclaw-last-event-seq', String(seq)); } catch { /* */ }
  }

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

  async function emitFromGatewayReply(reply: GatewayReply): Promise<void> {
    if (reply.transcript) {
      emitChunk({ type: 'transcript', text: reply.transcript, turnId: reply.turnId });
      // Yield: let transcript propagate to glasses display before response lifecycle.
      // The display controller commits the user message synchronously on this chunk,
      // and the bridge.textContainerUpgrade call needs a microtask boundary to flush
      // to the Even SDK before response_start overwrites the display state.
      await Promise.resolve();
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
   * (TypeError from fetch) which mean the gateway is genuinely unreachable.
   */
  class GatewayAppError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'GatewayAppError';
    }
  }

  /**
   * Shared error handler for sendVoiceTurn and sendTextTurn catch blocks.
   * Classifies errors into three categories:
   *
   * 1. DOMException (AbortError) -- request was cancelled by a newer request.
   *    Silent. No error chunk, no status change.
   *
   * 2. GatewayAppError (4xx/5xx HTTP response) -- the gateway IS reachable,
   *    but the request was rejected by the server.  Status stays 'connected'
   *    because the gateway responded; only the request failed.
   *
   * 3. Everything else (TypeError from fetch, CORS block, network failure) --
   *    the gateway is genuinely unreachable.  Status → 'error'.
   */
  function handleTurnError(err: unknown): void {
    if (err instanceof DOMException && err.name === 'AbortError') {
      // Manual abort -- user started a new request. Silent, no error shown.
      return;
    } else if (err instanceof GatewayAppError) {
      emitChunk({ type: 'error', error: err.message });
      setStatus('connected');
    } else {
      emitChunk({ type: 'error', error: err instanceof Error ? err.message : 'Gateway request failed' });
      setStatus('error');
    }
  }

  /**
   * Parse an SSE (Server-Sent Events) response body and emit VoiceTurnChunks
   * as each event arrives from the server.
   *
   * SSE format:
   *   event: <type>\n
   *   data: <json>\n
   *   \n
   *
   * Event types mapped to VoiceTurnChunk:
   *   transcript      -> { type: 'transcript', text, turnId }
   *   assistant_delta -> { type: 'response_start' } (first delta only), then { type: 'response_delta', text, turnId }
   *   done            -> { type: 'response_end', turnId }
   *   error           -> { type: 'error', error }
   */
  async function parseServerSentEventsFromResponse(
    response: Response,
    emitChunkCallback: (chunk: VoiceTurnChunk) => void,
  ): Promise<void> {
    if (!response.body) {
      emitChunkCallback({ type: 'error', error: 'SSE response has no body' });
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEventType = '';
    let hasEmittedResponseStart = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines from the buffer
        const lines = buffer.split('\n');
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEventType = line.slice('event: '.length).trim();
          } else if (line.startsWith('data: ')) {
            const jsonPayload = line.slice('data: '.length);
            if (!currentEventType) continue;

            try {
              const parsedData = JSON.parse(jsonPayload);
              handleServerSentEvent(
                currentEventType,
                parsedData,
                emitChunkCallback,
                hasEmittedResponseStart,
              );
              if (currentEventType === 'assistant_delta') {
                hasEmittedResponseStart = true;
              }
            } catch {
              // Malformed JSON -- skip this event
            }
            currentEventType = '';
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Map a single SSE event to one or more VoiceTurnChunk emissions.
   */
  function handleServerSentEvent(
    eventType: string,
    parsedData: Record<string, unknown>,
    emitChunkCallback: (chunk: VoiceTurnChunk) => void,
    responseStartAlreadyEmitted: boolean,
  ): void {
    switch (eventType) {
      case 'transcript':
        emitChunkCallback({
          type: 'transcript',
          text: parsedData.transcript as string,
          turnId: parsedData.turnId as string,
        });
        break;

      case 'assistant_delta':
        if (!responseStartAlreadyEmitted) {
          emitChunkCallback({ type: 'response_start', turnId: parsedData.turnId as string | undefined });
        }
        emitChunkCallback({
          type: 'response_delta',
          text: parsedData.text as string,
          turnId: parsedData.turnId as string | undefined,
        });
        break;

      case 'done':
        emitChunkCallback({
          type: 'response_end',
          turnId: (parsedData.turnId as string) ?? undefined,
        });
        break;

      case 'error':
        emitChunkCallback({
          type: 'error',
          error: parsedData.error as string,
        });
        break;
    }
  }

  async function sendVoiceTurn(settings: AppSettings, request: VoiceTurnRequest): Promise<void> {
    if (!settings.gatewayUrl) {
      emitChunk({ type: 'error', error: 'Gateway URL not configured' });
      return;
    }

    abort();
    abortController = new AbortController();

    try {
      const requestHeaders: Record<string, string> = {
        'Content-Type': request.audio.type || 'audio/wav',
        ...(settings.sessionKey ? { 'X-Session-Key': settings.sessionKey } : {}),
      };

      const response = await fetch(`${settings.gatewayUrl}/api/voice/turn`, {
        method: 'POST',
        body: request.audio,
        headers: requestHeaders,
        signal: abortController!.signal,
      });

      if (!response.ok) {
        throw new GatewayAppError(await readGatewayError(response));
      }

      setStatus('connected');
      health.reconnectAttempts = 0;

      // Check content type to determine response format.
      // SSE (text/event-stream) = new streaming format.
      // JSON (application/json) = legacy single-response format (backward compat).
      const contentType = response.headers.get('content-type') ?? '';

      if (contentType.startsWith('text/event-stream')) {
        await parseServerSentEventsFromResponse(response, emitChunk);
      } else {
        // JSON fallback for backward compatibility during rollout
        const reply = (await response.json()) as GatewayReply;
        await emitFromGatewayReply(reply);
      }
    } catch (err) {
      handleTurnError(err);
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

    try {
      const reply = await postTextTurn(settings, request);
      setStatus('connected');
      health.reconnectAttempts = 0;
      await emitFromGatewayReply(reply);
    } catch (err) {
      handleTurnError(err);
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
    getLastSeq,
    setLastSeq,
  };
}

export type GatewayClient = ReturnType<typeof createGatewayClient>;
