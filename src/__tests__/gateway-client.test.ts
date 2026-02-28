import { describe, it, expect } from 'vitest';
import { parseSSELines, createGatewayClient } from '../api/gateway-client';

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
});
