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
        headers: new Headers({ 'content-type': 'application/json' }),
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
      expect(statuses).toEqual(['connected']);
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
        headers: new Headers({ 'content-type': 'application/json' }),
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

      // Should end in error state (no 'connecting' before it)
      expect(client.getHealth().status).toBe('error');
      const errorChunks = chunks.filter((c) => c.type === 'error');
      expect(errorChunks.length).toBe(1);
      expect(errorChunks[0].error).toContain('Network down');
      expect(statuses).toEqual(['error']);
    });

    it('silently handles AbortError from manual abort (no error chunk)', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(
        new DOMException('Aborted', 'AbortError'),
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

      // AbortError is silent -- no error chunk emitted
      expect(chunks).toHaveLength(0);
      // No retry -- fetch called only once
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      // No status change (no 'connecting', no 'error')
      expect(statuses).toEqual([]);
      // reconnectAttempts should not have been incremented
      expect(client.getHealth().reconnectAttempts).toBe(0);
    });

    it('AbortError is handled silently (no error chunk, no status change)', async () => {
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

      // AbortError is silent -- user started a new request
      expect(chunks).toHaveLength(0);
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
        headers: new Headers({ 'content-type': 'application/json' }),
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

    describe('transcript-first rendering guarantee', () => {
      it('transcript chunk is emitted before microtask yield, response chunks after', async () => {
        const gatewayReply = {
          turnId: 't1',
          transcript: 'Hello there',
          assistant: { fullText: 'hi' },
        };

        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve(gatewayReply),
        });

        const client = createGatewayClient();
        let transcriptMicrotaskFlushed = false;

        client.onChunk((chunk) => {
          if (chunk.type === 'transcript') {
            // Schedule a microtask right when transcript arrives.
            // If the yield in emitFromGatewayReply works, this microtask
            // will execute before response_start is emitted.
            queueMicrotask(() => { transcriptMicrotaskFlushed = true; });
          }
          if (chunk.type === 'response_start') {
            // By the time response_start arrives, the microtask scheduled
            // on transcript should have already executed (proving a yield happened).
            expect(transcriptMicrotaskFlushed).toBe(true);
          }
        });

        await client.sendVoiceTurn(testSettings, testRequest);

        // Verify the assertion was actually reached (transcript was present)
        expect(transcriptMicrotaskFlushed).toBe(true);
      });

      it('response chunks still emit normally when no transcript in reply', async () => {
        const gatewayReply = {
          turnId: 't1',
          assistant: { fullText: 'hi' },
        };

        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve(gatewayReply),
        });

        const client = createGatewayClient();
        const chunks: VoiceTurnChunk[] = [];
        client.onChunk((c) => chunks.push(c));

        await client.sendVoiceTurn(testSettings, testRequest);

        // No transcript -- response lifecycle emits immediately with no yield
        expect(chunks).toHaveLength(3);
        expect(chunks[0].type).toBe('response_start');
        expect(chunks[1].type).toBe('response_delta');
        expect(chunks[2].type).toBe('response_end');
      });
    });

    describe('sendVoiceTurn SSE streaming', () => {
      // Helper: build a mock Response with a ReadableStream body for SSE testing
      function createSSEResponse(events: string): Partial<Response> {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
          start(controller) {
            controller.enqueue(encoder.encode(events) as Uint8Array<ArrayBuffer>);
            controller.close();
          },
        });
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'text/event-stream' }),
          body: stream,
        };
      }

      it('SSE: full voice turn emits transcript + response_start + delta + done', async () => {
        const sseBody = [
          'event: transcript',
          'data: {"transcript":"Hello","turnId":"t1"}',
          '',
          'event: assistant_delta',
          'data: {"text":"Hi ","turnId":"t1"}',
          '',
          'event: assistant_delta',
          'data: {"text":"there","turnId":"t1"}',
          '',
          'event: done',
          'data: {"turnId":"t1"}',
          '',
        ].join('\n') + '\n';

        globalThis.fetch = vi.fn().mockResolvedValue(createSSEResponse(sseBody));

        const client = createGatewayClient();
        const chunks: VoiceTurnChunk[] = [];
        client.onChunk((c) => chunks.push(c));

        await client.sendVoiceTurn(testSettings, testRequest);

        expect(chunks).toHaveLength(5);
        expect(chunks[0]).toEqual({ type: 'transcript', text: 'Hello', turnId: 't1' });
        expect(chunks[1]).toEqual({ type: 'response_start', turnId: 't1' });
        expect(chunks[2]).toEqual({ type: 'response_delta', text: 'Hi ', turnId: 't1' });
        expect(chunks[3]).toEqual({ type: 'response_delta', text: 'there', turnId: 't1' });
        expect(chunks[4]).toEqual({ type: 'response_end', turnId: 't1' });
      });

      it('SSE: done event with seq passes seq through to response_end chunk', async () => {
        const sseBody = [
          'event: done',
          'data: {"turnId":"t1","seq":7}',
          '',
        ].join('\n') + '\n';

        globalThis.fetch = vi.fn().mockResolvedValue(createSSEResponse(sseBody));

        const client = createGatewayClient();
        const chunks: VoiceTurnChunk[] = [];
        client.onChunk((c) => chunks.push(c));

        await client.sendVoiceTurn(testSettings, testRequest);

        const endChunks = chunks.filter((c) => c.type === 'response_end');
        expect(endChunks).toHaveLength(1);
        expect(endChunks[0].seq).toBe(7);
      });

      it('SSE: done event without seq does not set seq on response_end chunk', async () => {
        const sseBody = [
          'event: done',
          'data: {"turnId":"t1"}',
          '',
        ].join('\n') + '\n';

        globalThis.fetch = vi.fn().mockResolvedValue(createSSEResponse(sseBody));

        const client = createGatewayClient();
        const chunks: VoiceTurnChunk[] = [];
        client.onChunk((c) => chunks.push(c));

        await client.sendVoiceTurn(testSettings, testRequest);

        const endChunks = chunks.filter((c) => c.type === 'response_end');
        expect(endChunks).toHaveLength(1);
        expect(endChunks[0].seq).toBeUndefined();
      });

      it('SSE: response_start emitted only once (before first assistant_delta)', async () => {
        const sseBody = [
          'event: assistant_delta',
          'data: {"text":"A","turnId":"t1"}',
          '',
          'event: assistant_delta',
          'data: {"text":"B","turnId":"t1"}',
          '',
          'event: assistant_delta',
          'data: {"text":"C","turnId":"t1"}',
          '',
          'event: done',
          'data: {"turnId":"t1"}',
          '',
        ].join('\n') + '\n';

        globalThis.fetch = vi.fn().mockResolvedValue(createSSEResponse(sseBody));

        const client = createGatewayClient();
        const chunks: VoiceTurnChunk[] = [];
        client.onChunk((c) => chunks.push(c));

        await client.sendVoiceTurn(testSettings, testRequest);

        const responseStartChunks = chunks.filter((c) => c.type === 'response_start');
        const responseDeltaChunks = chunks.filter((c) => c.type === 'response_delta');
        expect(responseStartChunks).toHaveLength(1);
        expect(responseDeltaChunks).toHaveLength(3);
      });

      it('SSE: malformed JSON in data line is silently skipped', async () => {
        const sseBody = [
          'event: transcript',
          'data: {"transcript":"Hello","turnId":"t1"}',
          '',
          'event: assistant_delta',
          'data: {invalid json}',
          '',
          'event: done',
          'data: {"turnId":"t1"}',
          '',
        ].join('\n') + '\n';

        globalThis.fetch = vi.fn().mockResolvedValue(createSSEResponse(sseBody));

        const client = createGatewayClient();
        const chunks: VoiceTurnChunk[] = [];
        client.onChunk((c) => chunks.push(c));

        await client.sendVoiceTurn(testSettings, testRequest);

        // Only transcript and done should emit; malformed delta is skipped
        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toEqual({ type: 'transcript', text: 'Hello', turnId: 't1' });
        expect(chunks[1]).toEqual({ type: 'response_end', turnId: 't1' });
        // No error chunk emitted for malformed JSON
        expect(chunks.filter((c) => c.type === 'error')).toHaveLength(0);
      });

      it('SSE: event split across multiple stream chunks is reassembled', async () => {
        const encoder = new TextEncoder();
        // Split the SSE event mid-line: first chunk ends with "event: trans",
        // second chunk starts with "cript\n..."
        const fullSSE = 'event: transcript\ndata: {"transcript":"Split","turnId":"t1"}\n\nevent: done\ndata: {"turnId":"t1"}\n\n';
        const splitAt = 'event: trans'.length;
        const part1 = fullSSE.slice(0, splitAt);
        const part2 = fullSSE.slice(splitAt);

        const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
          start(controller) {
            controller.enqueue(encoder.encode(part1) as Uint8Array<ArrayBuffer>);
            // Enqueue second part in next microtask to simulate chunked delivery
            queueMicrotask(() => {
              controller.enqueue(encoder.encode(part2) as Uint8Array<ArrayBuffer>);
              controller.close();
            });
          },
        });

        const sseResponse: Partial<Response> = {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'text/event-stream' }),
          body: stream,
        };

        globalThis.fetch = vi.fn().mockResolvedValue(sseResponse);

        const client = createGatewayClient();
        const chunks: VoiceTurnChunk[] = [];
        client.onChunk((c) => chunks.push(c));

        await client.sendVoiceTurn(testSettings, testRequest);

        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toEqual({ type: 'transcript', text: 'Split', turnId: 't1' });
        expect(chunks[1]).toEqual({ type: 'response_end', turnId: 't1' });
      });

      it('SSE: null response body emits error chunk', async () => {
        const nullBodyResponse: Partial<Response> = {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'text/event-stream' }),
          body: null,
        };

        globalThis.fetch = vi.fn().mockResolvedValue(nullBodyResponse);

        const client = createGatewayClient();
        const chunks: VoiceTurnChunk[] = [];
        client.onChunk((c) => chunks.push(c));

        await client.sendVoiceTurn(testSettings, testRequest);

        expect(chunks).toHaveLength(1);
        expect(chunks[0].type).toBe('error');
        expect(chunks[0].error).toContain('no body');
      });

      it('SSE: error event emits error chunk', async () => {
        const sseBody = [
          'event: error',
          'data: {"error":"STT failed"}',
          '',
        ].join('\n') + '\n';

        globalThis.fetch = vi.fn().mockResolvedValue(createSSEResponse(sseBody));

        const client = createGatewayClient();
        const chunks: VoiceTurnChunk[] = [];
        client.onChunk((c) => chunks.push(c));

        await client.sendVoiceTurn(testSettings, testRequest);

        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toEqual({ type: 'error', error: 'STT failed' });
      });
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
      // Gateway responded (even with error) -- it IS reachable, no 'connecting' before it
      expect(statuses).toEqual(['connected']);
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
      // Gateway responded with a meaningful error -- it IS reachable, no 'connecting' before it
      expect(statuses).toEqual(['connected']);
    });

    describe('transcript-first rendering guarantee', () => {
      it('transcript chunk is emitted before microtask yield, response chunks after', async () => {
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
        let transcriptMicrotaskFlushed = false;

        client.onChunk((chunk) => {
          if (chunk.type === 'transcript') {
            queueMicrotask(() => { transcriptMicrotaskFlushed = true; });
          }
          if (chunk.type === 'response_start') {
            // Microtask scheduled on transcript must have flushed before response_start
            expect(transcriptMicrotaskFlushed).toBe(true);
          }
        });

        await client.sendTextTurn(testSettings, testTextRequest);

        expect(transcriptMicrotaskFlushed).toBe(true);
      });
    });
  });

  describe('lastEventSeq tracking', () => {
    beforeEach(() => {
      // Clear any stored seq value between tests
      try { localStorage.removeItem('openclaw-last-event-seq'); } catch { /* */ }
    });

    afterEach(() => {
      try { localStorage.removeItem('openclaw-last-event-seq'); } catch { /* */ }
    });

    it('getLastSeq returns null initially (no localStorage value)', () => {
      const client = createGatewayClient();
      expect(client.getLastSeq()).toBeNull();
    });

    it('setLastSeq updates the value and persists to localStorage', () => {
      const client = createGatewayClient();
      client.setLastSeq(42);

      expect(client.getLastSeq()).toBe(42);
      expect(localStorage.getItem('openclaw-last-event-seq')).toBe('42');
    });

    it('getLastSeq reads from localStorage on construction', () => {
      localStorage.setItem('openclaw-last-event-seq', '99');
      const client = createGatewayClient();

      expect(client.getLastSeq()).toBe(99);
    });

    it('destroy does not clear lastEventSeq from localStorage', () => {
      const client = createGatewayClient();
      client.setLastSeq(77);
      client.destroy();

      // localStorage value should persist across boot cycles
      expect(localStorage.getItem('openclaw-last-event-seq')).toBe('77');
    });

    it('setLastSeq overwrites previous value', () => {
      const client = createGatewayClient();
      client.setLastSeq(10);
      client.setLastSeq(20);

      expect(client.getLastSeq()).toBe(20);
      expect(localStorage.getItem('openclaw-last-event-seq')).toBe('20');
    });

    it('handles non-numeric localStorage value gracefully (returns null)', () => {
      localStorage.setItem('openclaw-last-event-seq', 'not-a-number');
      const client = createGatewayClient();

      // NaN is falsy, so || null returns null
      expect(client.getLastSeq()).toBeNull();
    });
  });
});
