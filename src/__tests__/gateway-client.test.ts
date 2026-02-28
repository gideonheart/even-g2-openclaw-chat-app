import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseSSELines, createGatewayClient } from '../api/gateway-client';
import type { AppSettings, VoiceTurnRequest, VoiceTurnChunk } from '../types';

describe('gateway-client', () => {
  describe('parseSSELines', () => {
    it('parses a single SSE event', () => {
      const raw = 'data: {"type":"response_delta","text":"hello"}\n\n';
      const events = parseSSELines(raw);
      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('message');
      expect(events[0].data).toBe('{"type":"response_delta","text":"hello"}');
    });

    it('parses multiple SSE events', () => {
      const raw =
        'data: {"type":"response_start"}\n\n' +
        'data: {"type":"response_delta","text":"hi"}\n\n' +
        'data: {"type":"response_end"}\n\n';
      const events = parseSSELines(raw);
      expect(events).toHaveLength(3);
    });

    it('handles named events', () => {
      const raw = 'event: heartbeat\ndata: ping\n\n';
      const events = parseSSELines(raw);
      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('heartbeat');
      expect(events[0].data).toBe('ping');
    });

    it('handles event IDs', () => {
      const raw = 'id: 42\ndata: test\n\n';
      const events = parseSSELines(raw);
      expect(events[0].id).toBe('42');
    });

    it('ignores SSE comments', () => {
      const raw = ': this is a comment\ndata: actual data\n\n';
      const events = parseSSELines(raw);
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('actual data');
    });

    it('handles multiline data', () => {
      const raw = 'data: line1\ndata: line2\n\n';
      const events = parseSSELines(raw);
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('line1\nline2');
    });

    it('returns empty array for empty input', () => {
      expect(parseSSELines('')).toHaveLength(0);
    });

    it('handles trailing data without double newline', () => {
      const raw = 'data: partial';
      const events = parseSSELines(raw);
      // Should still flush partial event
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('partial');
    });

    it('handles \\r\\n line endings', () => {
      const raw = 'data: hello\r\n\r\n';
      const events = parseSSELines(raw);
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('hello');
    });
  });

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

    function createSSEStream(events: string[]): ReadableStream<Uint8Array> {
      const encoder = new TextEncoder();
      return new ReadableStream({
        start(controller) {
          for (const evt of events) {
            controller.enqueue(encoder.encode(evt));
          }
          controller.close();
        },
      });
    }

    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('successful voice turn streams SSE chunks to handler', async () => {
      const sseData = [
        'data: {"type":"response_start","turnId":"t1"}\n\n',
        'data: {"type":"response_delta","text":"hi"}\n\n',
        'data: {"type":"response_end"}\n\n',
      ];

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: createSSEStream(sseData),
      });

      const client = createGatewayClient({ reconnectBaseDelayMs: 1 });
      const chunks: VoiceTurnChunk[] = [];
      const statuses: string[] = [];
      client.onChunk((c) => chunks.push(c));
      client.onStatusChange((s) => statuses.push(s));

      await client.sendVoiceTurn(testSettings, testRequest);

      expect(chunks).toHaveLength(3);
      expect(chunks[0].type).toBe('response_start');
      expect(chunks[1].type).toBe('response_delta');
      expect(chunks[1].text).toBe('hi');
      expect(chunks[2].type).toBe('response_end');
      expect(statuses).toContain('connected');
      expect(client.getHealth().reconnectAttempts).toBe(0);
    });

    it('retries on network error and succeeds on second attempt', async () => {
      const sseData = ['data: {"type":"response_end"}\n\n'];
      let callCount = 0;

      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('Network failure'));
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          body: createSSEStream(sseData),
        });
      });

      const client = createGatewayClient({
        maxReconnectAttempts: 3,
        reconnectBaseDelayMs: 1,
      });
      const statuses: string[] = [];
      const chunks: VoiceTurnChunk[] = [];
      client.onStatusChange((s) => statuses.push(s));
      client.onChunk((c) => chunks.push(c));

      await client.sendVoiceTurn(testSettings, testRequest);

      // fetch called twice: first fails, second succeeds
      expect(callCount).toBe(2);
      // Status transitions: connecting (1st attempt) -> connecting (retry) -> connecting (2nd sendVoiceTurn call via abort()) -> connected
      expect(statuses).toContain('connecting');
      expect(statuses).toContain('connected');
      // reconnectAttempts resets on success
      expect(client.getHealth().reconnectAttempts).toBe(0);
      // The error chunk from the failed attempt + successful response
      const errorChunks = chunks.filter((c) => c.type === 'error');
      expect(errorChunks.length).toBeGreaterThanOrEqual(1);
    });

    it('gives up after maxReconnectAttempts and sets status to error', async () => {
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
      // Error chunks emitted for each attempt (initial + 2 retries = 3 total calls)
      const errorChunks = chunks.filter((c) => c.type === 'error');
      expect(errorChunks.length).toBeGreaterThanOrEqual(2);
      // Last status should be error
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

    it('does not retry on AbortError', async () => {
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

      // No error chunk emitted, no retry
      expect(chunks).toHaveLength(0);
      expect(client.getHealth().reconnectAttempts).toBe(0);
    });
  });
});
