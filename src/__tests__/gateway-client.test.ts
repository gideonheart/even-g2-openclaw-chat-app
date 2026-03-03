import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGatewayClient } from '../api/gateway-client';
import type { AppSettings, VoiceTurnRequest, TextTurnRequest, VoiceTurnChunk } from '../types';

describe('gateway-client', () => {
  describe('createGatewayClient', () => {
    it('creates a client with default health state', () => {
      const client = createGatewayClient();
      const health = client.getHealth();
      expect(health.status).toBe('disconnected');
      expect(health.lastHeartbeat).toBeNull();
      expect(health.reconnectAttempts).toBe(0);
      expect(health.latencyMs).toBeNull();
    });

    it('supports event subscription and unsubscription', () => {
      const client = createGatewayClient();
      const chunks: unknown[] = [];
      const unsub = client.onChunk((chunk) => chunks.push(chunk));

      // Unsubscribe should return cleanly
      expect(typeof unsub).toBe('function');
      unsub();
    });

    it('supports status change subscription', () => {
      const client = createGatewayClient();
      const statuses: string[] = [];
      const unsub = client.onStatusChange((s) => statuses.push(s));

      expect(typeof unsub).toBe('function');
      unsub();
    });

    it('can be destroyed without error', () => {
      const client = createGatewayClient();
      expect(() => client.destroy()).not.toThrow();
    });

    it('reports disconnected after destroy', () => {
      const client = createGatewayClient();
      const statuses: string[] = [];
      client.onStatusChange((s) => statuses.push(s));
      client.destroy();
      expect(statuses).toContain('disconnected');
    });
  });

  describe('checkHealth', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('fetches /readyz (not /healthz)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ready', checks: { stt: { healthy: true }, openclaw: { healthy: true } } }),
      });

      const client = createGatewayClient();
      await client.checkHealth('https://gw.test');

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('https://gw.test/readyz');
      expect(url).not.toContain('/healthz');
    });

    it('populates readyz detail fields from 200 JSON response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          status: 'ready',
          checks: { stt: { healthy: true }, openclaw: { healthy: true } },
        }),
      });

      const client = createGatewayClient();
      const result = await client.checkHealth('https://gw.test');

      expect(result).toBe(true);
      const health = client.getHealth();
      expect(health.readyStatus).toBe('ready');
      expect(health.sttReady).toBe(true);
      expect(health.openclawReady).toBe(true);
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
      expect(health.lastHeartbeat).toBeGreaterThan(0);
    });

    it('returns true on 503 response (gateway is reachable) and parses body', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({
          status: 'not_ready',
          checks: { stt: { healthy: true }, openclaw: { healthy: false } },
        }),
      });

      const client = createGatewayClient();
      const result = await client.checkHealth('https://gw.test');

      // Any HTTP response means the gateway is reachable
      expect(result).toBe(true);
      const health = client.getHealth();
      expect(health.readyStatus).toBe('not_ready');
      expect(health.sttReady).toBe(true);
      expect(health.openclawReady).toBe(false);
    });

    it('clears detail fields on non-JSON response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      });

      const client = createGatewayClient();
      const result = await client.checkHealth('https://gw.test');

      expect(result).toBe(true);
      const health = client.getHealth();
      expect(health.readyStatus).toBeUndefined();
      expect(health.sttReady).toBeUndefined();
      expect(health.openclawReady).toBeUndefined();
    });

    it('returns false on network error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network down'));

      const client = createGatewayClient();
      const result = await client.checkHealth('https://gw.test');

      expect(result).toBe(false);
      expect(client.getHealth().latencyMs).toBeNull();
    });
  });

  describe('sendVoiceTurn', () => {
    const testSettings: AppSettings = {
      gatewayUrl: 'https://gw.test',
      sessionKey: 'key-123',
      sttProvider: 'whisperx',
      apiKey: 'ak-test',
    };

    const testRequest: VoiceTurnRequest = {
      sessionId: 'sess-1',
      audio: new Blob(['audio-data'], { type: 'audio/webm' }),
      sttProvider: 'whisperx',
    };

    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('successful voice turn emits chunks from JSON gateway reply', async () => {
      const gatewayReply = {
        turnId: 't1',
        transcript: 'Hello there',
        assistant: { fullText: 'hi' },
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(gatewayReply),
      });

      const client = createGatewayClient({ reconnectBaseDelayMs: 1 });
      const chunks: VoiceTurnChunk[] = [];
      const statuses: string[] = [];
      client.onChunk((c) => chunks.push(c));
      client.onStatusChange((s) => statuses.push(s));

      await client.sendVoiceTurn(testSettings, testRequest);

      expect(chunks).toHaveLength(4);
      expect(chunks[0]).toEqual({ type: 'transcript', text: 'Hello there', turnId: 't1' });
      expect(chunks[1]).toEqual({ type: 'response_start', turnId: 't1' });
      expect(chunks[2]).toEqual({ type: 'response_delta', text: 'hi', turnId: 't1' });
      expect(chunks[3]).toEqual({ type: 'response_end', turnId: 't1' });
      expect(statuses).toContain('connected');
      expect(client.getHealth().reconnectAttempts).toBe(0);
    });

    it('successful voice turn without transcript emits 3 chunks (backward compat)', async () => {
      const gatewayReply = {
        turnId: 't1',
        assistant: { fullText: 'hi' },
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(gatewayReply),
      });

      const client = createGatewayClient({ reconnectBaseDelayMs: 1 });
      const chunks: VoiceTurnChunk[] = [];
      client.onChunk((c) => chunks.push(c));

      await client.sendVoiceTurn(testSettings, testRequest);

      expect(chunks).toHaveLength(3);
      expect(chunks[0].type).toBe('response_start');
      expect(chunks[1].type).toBe('response_delta');
      expect(chunks[2].type).toBe('response_end');
    });

    it('emits error on network failure', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network down'));

      const client = createGatewayClient({
        maxReconnectAttempts: 2,
        reconnectBaseDelayMs: 1,
      });
      const statuses: string[] = [];
      const chunks: VoiceTurnChunk[] = [];
      client.onStatusChange((s) => statuses.push(s));
      client.onChunk((c) => chunks.push(c));

      await client.sendVoiceTurn(testSettings, testRequest);

      // Should end in error state
      expect(client.getHealth().status).toBe('error');
      const errorChunks = chunks.filter((c) => c.type === 'error');
      expect(errorChunks.length).toBe(1);
      expect(errorChunks[0].error).toContain('Network down');
      expect(statuses[statuses.length - 1]).toBe('error');
    });

    it('does not retry on TimeoutError and emits timeout error chunk', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(
        new DOMException('signal timed out', 'TimeoutError'),
      );

      const client = createGatewayClient({
        maxReconnectAttempts: 3,
        reconnectBaseDelayMs: 1,
      });
      const chunks: VoiceTurnChunk[] = [];
      const statuses: string[] = [];
      client.onChunk((c) => chunks.push(c));
      client.onStatusChange((s) => statuses.push(s));

      await client.sendVoiceTurn(testSettings, testRequest);

      // Exactly one error chunk with timeout message
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({ type: 'error', error: 'Request timed out. Tap to retry.' });
      // No retry -- fetch called only once
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      // Status ends in error
      expect(statuses[statuses.length - 1]).toBe('error');
      // reconnectAttempts should not have been incremented
      expect(client.getHealth().reconnectAttempts).toBe(0);
    });

    it('emits error on AbortError', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(
        new DOMException('Aborted', 'AbortError'),
      );

      const client = createGatewayClient({
        maxReconnectAttempts: 3,
        reconnectBaseDelayMs: 1,
      });
      const chunks: VoiceTurnChunk[] = [];
      client.onChunk((c) => chunks.push(c));

      await client.sendVoiceTurn(testSettings, testRequest);

      // AbortError is treated as timeout in the current implementation
      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe('error');
      expect(client.getHealth().reconnectAttempts).toBe(0);
    });

    it('emits error on non-ok response (no JSON body) but stays connected', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
      });

      const client = createGatewayClient({ reconnectBaseDelayMs: 1 });
      const chunks: VoiceTurnChunk[] = [];
      const statuses: string[] = [];
      client.onChunk((c) => chunks.push(c));
      client.onStatusChange((s) => statuses.push(s));

      await client.sendVoiceTurn(testSettings, testRequest);

      const errorChunks = chunks.filter((c) => c.type === 'error');
      expect(errorChunks).toHaveLength(1);
      expect(errorChunks[0].error).toContain('502');
      // Gateway responded (even with error) -- it IS reachable
      expect(statuses[statuses.length - 1]).toBe('connected');
    });

    it('surfaces gateway JSON error message on non-ok response and stays connected', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: '',
        json: () => Promise.resolve({
          error: 'Transcription returned empty text. The audio may be silent or too short.',
          code: 'STT_TRANSCRIPTION_FAILED',
        }),
      });

      const client = createGatewayClient({ reconnectBaseDelayMs: 1 });
      const chunks: VoiceTurnChunk[] = [];
      const statuses: string[] = [];
      client.onChunk((c) => chunks.push(c));
      client.onStatusChange((s) => statuses.push(s));

      await client.sendVoiceTurn(testSettings, testRequest);

      const errorChunks = chunks.filter((c) => c.type === 'error');
      expect(errorChunks).toHaveLength(1);
      expect(errorChunks[0].error).toBe(
        'Transcription returned empty text. The audio may be silent or too short.',
      );
      // Gateway responded with a meaningful error -- it IS reachable
      expect(statuses[statuses.length - 1]).toBe('connected');
    });

    it('sends correct request format', async () => {
      const gatewayReply = {
        turnId: 't1',
        assistant: { fullText: 'response' },
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(gatewayReply),
      });

      const client = createGatewayClient();
      await client.sendVoiceTurn(testSettings, testRequest);

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('https://gw.test/api/voice/turn');
      expect(init.method).toBe('POST');
      // Body should be the audio blob
      expect(init.body).toBeInstanceOf(Blob);
      // Content-Type should match audio type
      expect(init.headers['Content-Type']).toBe('audio/webm');
      expect(init.headers['X-Session-Key']).toBe('key-123');
    });

    it('voice turn timeout scales with audio blob size (large blob does not timeout at 30s)', async () => {
      vi.useFakeTimers();
      try {
        // Simulate a 30-second recording: 30 * 32000 bytes PCM + 44 WAV header
        const largeBlob = new Blob([new ArrayBuffer(30 * 32_000 + 44)], { type: 'audio/wav' });
        const largeRequest: VoiceTurnRequest = {
          sessionId: 'sess-1',
          audio: largeBlob,
          sttProvider: 'whisperx',
        };

        // Fetch that resolves only after 60s (well past the old 30s timeout but
        // within the new scaled timeout of 60 + 30 = 90s)
        let resolveFetch!: (value: unknown) => void;
        globalThis.fetch = vi.fn().mockImplementation(() =>
          new Promise((resolve) => { resolveFetch = resolve; }),
        );

        const client = createGatewayClient({ reconnectBaseDelayMs: 1 });
        const chunks: VoiceTurnChunk[] = [];
        client.onChunk((c) => chunks.push(c));

        const turnPromise = client.sendVoiceTurn(testSettings, largeRequest);

        // Advance 35s -- old timeout (30s) would have fired, new timeout should not
        await vi.advanceTimersByTimeAsync(35_000);
        expect(chunks.filter((c) => c.type === 'error')).toHaveLength(0);

        // Resolve the fetch at 35s
        resolveFetch({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ turnId: 't1', assistant: { fullText: 'done' } }),
        });

        await turnPromise;
        expect(chunks.filter((c) => c.type === 'response_end')).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('voice turn with small audio blob uses base timeout of 60s', async () => {
      vi.useFakeTimers();
      try {
        // Small blob: 1 second of audio
        const smallBlob = new Blob([new ArrayBuffer(32_000 + 44)], { type: 'audio/wav' });
        const smallRequest: VoiceTurnRequest = {
          sessionId: 'sess-1',
          audio: smallBlob,
          sttProvider: 'whisperx',
        };

        // Fetch that respects the abort signal (rejects when aborted)
        globalThis.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          return new Promise((_resolve, reject) => {
            if (init?.signal) {
              init.signal.addEventListener('abort', () => {
                reject(init.signal!.reason ?? new DOMException('Aborted', 'AbortError'));
              });
            }
          });
        });

        const client = createGatewayClient({ reconnectBaseDelayMs: 1 });
        const chunks: VoiceTurnChunk[] = [];
        client.onChunk((c) => chunks.push(c));

        const turnPromise = client.sendVoiceTurn(testSettings, smallRequest);

        // At 59s -- should NOT have timed out (base=60s + 1s audio = 61s total)
        await vi.advanceTimersByTimeAsync(59_000);
        expect(chunks.filter((c) => c.type === 'error')).toHaveLength(0);

        // At 62s -- should have timed out (61s timeout)
        await vi.advanceTimersByTimeAsync(3_000);
        expect(chunks.filter((c) => c.type === 'error')).toHaveLength(1);
        expect(chunks.find((c) => c.type === 'error')?.error).toContain('timed out');

        await turnPromise;
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('sendTextTurn', () => {
    const testSettings: AppSettings = {
      gatewayUrl: 'https://gw.test',
      sessionKey: 'key-123',
      sttProvider: 'whisperx',
      apiKey: 'ak-test',
    };

    const testTextRequest: TextTurnRequest = {
      sessionId: 'sess-1',
      text: 'Hello, assistant!',
    };

    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('POSTs to /api/text/turn with JSON body and Content-Type header', async () => {
      const gatewayReply = {
        turnId: 't1',
        assistant: { fullText: 'Hi there' },
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(gatewayReply),
      });

      const client = createGatewayClient();
      await client.sendTextTurn(testSettings, testTextRequest);

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('https://gw.test/api/text/turn');
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(init.headers['X-Session-Key']).toBe('key-123');
      const body = JSON.parse(init.body);
      expect(body).toEqual({ text: 'Hello, assistant!' });
    });

    it('emits chunks from the JSON gateway reply', async () => {
      const gatewayReply = {
        turnId: 't1',
        transcript: 'Hello, assistant!',
        assistant: { fullText: 'Hi there' },
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(gatewayReply),
      });

      const client = createGatewayClient();
      const chunks: VoiceTurnChunk[] = [];
      client.onChunk((c) => chunks.push(c));

      await client.sendTextTurn(testSettings, testTextRequest);

      expect(chunks).toHaveLength(4);
      expect(chunks[0]).toEqual({ type: 'transcript', text: 'Hello, assistant!', turnId: 't1' });
      expect(chunks[1]).toEqual({ type: 'response_start', turnId: 't1' });
      expect(chunks[2]).toEqual({ type: 'response_delta', text: 'Hi there', turnId: 't1' });
      expect(chunks[3]).toEqual({ type: 'response_end', turnId: 't1' });
    });

    it('emits 3 chunks without transcript (backward compat)', async () => {
      const gatewayReply = {
        turnId: 't1',
        assistant: { fullText: 'Hi there' },
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(gatewayReply),
      });

      const client = createGatewayClient();
      const chunks: VoiceTurnChunk[] = [];
      client.onChunk((c) => chunks.push(c));

      await client.sendTextTurn(testSettings, testTextRequest);

      expect(chunks).toHaveLength(3);
      expect(chunks[0].type).toBe('response_start');
      expect(chunks[1].type).toBe('response_delta');
      expect(chunks[2].type).toBe('response_end');
    });

    it('emits an error chunk when gateway URL is not configured', async () => {
      const client = createGatewayClient();
      const chunks: VoiceTurnChunk[] = [];
      client.onChunk((c) => chunks.push(c));

      const noUrlSettings: AppSettings = {
        ...testSettings,
        gatewayUrl: '',
      };

      await client.sendTextTurn(noUrlSettings, testTextRequest);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({ type: 'error', error: 'Gateway URL not configured' });
    });

    it('aborts the previous request before starting a new one', async () => {
      const gatewayReply = {
        turnId: 't1',
        assistant: { fullText: 'Response' },
      };

      // Track abort signals
      const abortSignals: AbortSignal[] = [];
      let fetchCount = 0;

      globalThis.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        fetchCount++;
        if (init?.signal) abortSignals.push(init.signal);
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve(gatewayReply),
        });
      });

      const client = createGatewayClient();

      // First request
      await client.sendTextTurn(testSettings, testTextRequest);
      // Second request should abort the first controller
      await client.sendTextTurn(testSettings, testTextRequest);

      expect(fetchCount).toBe(2);
      // The first request's signal should have been aborted by the second call
      expect(abortSignals[0].aborted).toBe(true);
    });

    it('emits error chunk on gateway failure (no JSON body) but stays connected', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
      });

      const client = createGatewayClient();
      const chunks: VoiceTurnChunk[] = [];
      const statuses: string[] = [];
      client.onChunk((c) => chunks.push(c));
      client.onStatusChange((s) => statuses.push(s));

      await client.sendTextTurn(testSettings, testTextRequest);

      const errorChunks = chunks.filter((c) => c.type === 'error');
      expect(errorChunks).toHaveLength(1);
      expect(errorChunks[0].error).toContain('502');
      // Gateway responded (even with error) -- it IS reachable
      expect(statuses[statuses.length - 1]).toBe('connected');
    });

    it('surfaces gateway JSON error message on non-ok response and stays connected', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: '',
        json: () => Promise.resolve({
          error: 'Text must not be empty',
          code: 'INVALID_CONFIG',
        }),
      });

      const client = createGatewayClient();
      const chunks: VoiceTurnChunk[] = [];
      const statuses: string[] = [];
      client.onChunk((c) => chunks.push(c));
      client.onStatusChange((s) => statuses.push(s));

      await client.sendTextTurn(testSettings, testTextRequest);

      const errorChunks = chunks.filter((c) => c.type === 'error');
      expect(errorChunks).toHaveLength(1);
      expect(errorChunks[0].error).toBe('Text must not be empty');
      // Gateway responded with a meaningful error -- it IS reachable
      expect(statuses[statuses.length - 1]).toBe('connected');
    });
  });
});
