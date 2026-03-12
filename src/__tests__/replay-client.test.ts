import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchSessionReplay, fetchTurnReplay, replayEventsAsChunks } from '../api/replay-client';
import type { ReplayEvent, VoiceTurnChunk } from '../types';

// ── Helpers ──────────────────────────────────────────────────

function makeEvent(overrides: Partial<ReplayEvent> = {}): ReplayEvent {
  return {
    turnId: 't1',
    sessionKey: 'sess-1',
    seq: 1,
    type: 'transcript',
    payload: { transcript: 'hello' },
    timestamp: Date.now(),
    ...overrides,
  };
}

// ── fetchSessionReplay ──────────────────────────────────────

describe('fetchSessionReplay', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches from the correct endpoint and returns parsed events', async () => {
    const events: ReplayEvent[] = [makeEvent({ seq: 1 }), makeEvent({ seq: 2 })];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(events),
    });

    const result = await fetchSessionReplay('https://gw.test', 'sess-1');

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://gw.test/api/sessions/sess-1/events');
    expect(result).toEqual(events);
  });

  it('appends ?afterSeq=N when afterSeq is provided', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });

    await fetchSessionReplay('https://gw.test', 'sess-1', 42);

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://gw.test/api/sessions/sess-1/events?afterSeq=42');
  });

  it('does not append ?afterSeq when afterSeq is undefined', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });

    await fetchSessionReplay('https://gw.test', 'sess-1');

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).not.toContain('afterSeq');
  });

  it('appends ?afterSeq=0 when afterSeq is 0 (falsy but valid)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });

    await fetchSessionReplay('https://gw.test', 'sess-1', 0);

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://gw.test/api/sessions/sess-1/events?afterSeq=0');
  });

  it('returns empty array on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network down'));

    const result = await fetchSessionReplay('https://gw.test', 'sess-1');

    expect(result).toEqual([]);
  });

  it('returns empty array on non-ok response (e.g. 500)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const result = await fetchSessionReplay('https://gw.test', 'sess-1');

    expect(result).toEqual([]);
  });

  it('uses AbortSignal.timeout for request timeout', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });

    await fetchSessionReplay('https://gw.test', 'sess-1');

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

// ── fetchTurnReplay ─────────────────────────────────────────

describe('fetchTurnReplay', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches from the correct turn endpoint and returns parsed events', async () => {
    const events: ReplayEvent[] = [makeEvent({ seq: 5 })];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(events),
    });

    const result = await fetchTurnReplay('https://gw.test', 'turn-abc');

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://gw.test/api/turns/turn-abc/events');
    expect(result).toEqual(events);
  });

  it('appends ?afterSeq=N when afterSeq is provided', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });

    await fetchTurnReplay('https://gw.test', 'turn-abc', 10);

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://gw.test/api/turns/turn-abc/events?afterSeq=10');
  });

  it('returns empty array on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await fetchTurnReplay('https://gw.test', 'turn-abc');

    expect(result).toEqual([]);
  });

  it('returns empty array on non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    const result = await fetchTurnReplay('https://gw.test', 'turn-abc');

    expect(result).toEqual([]);
  });
});

// ── replayEventsAsChunks ────────────────────────────────────

describe('replayEventsAsChunks', () => {
  it('maps transcript event to transcript chunk', () => {
    const events: ReplayEvent[] = [
      makeEvent({ type: 'transcript', payload: { transcript: 'Hello world' }, turnId: 't1', seq: 1 }),
    ];
    const chunks: VoiceTurnChunk[] = [];

    replayEventsAsChunks(events, (chunk) => chunks.push(chunk));

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ type: 'transcript', text: 'Hello world', turnId: 't1' });
  });

  it('maps assistant_delta events with response_start before first delta', () => {
    const events: ReplayEvent[] = [
      makeEvent({ type: 'assistant_delta', payload: { text: 'Hi ' }, turnId: 't1', seq: 1 }),
      makeEvent({ type: 'assistant_delta', payload: { text: 'there' }, turnId: 't1', seq: 2 }),
    ];
    const chunks: VoiceTurnChunk[] = [];

    replayEventsAsChunks(events, (chunk) => chunks.push(chunk));

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ type: 'response_start', turnId: 't1' });
    expect(chunks[1]).toEqual({ type: 'response_delta', text: 'Hi ', turnId: 't1' });
    expect(chunks[2]).toEqual({ type: 'response_delta', text: 'there', turnId: 't1' });
  });

  it('maps done event to response_end chunk', () => {
    const events: ReplayEvent[] = [
      makeEvent({ type: 'done', payload: {}, turnId: 't1', seq: 5 }),
    ];
    const chunks: VoiceTurnChunk[] = [];

    replayEventsAsChunks(events, (chunk) => chunks.push(chunk));

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ type: 'response_end', turnId: 't1' });
  });

  it('maps error event to error chunk', () => {
    const events: ReplayEvent[] = [
      makeEvent({ type: 'error', payload: { error: 'STT failed' }, turnId: 't1', seq: 3 }),
    ];
    const chunks: VoiceTurnChunk[] = [];

    replayEventsAsChunks(events, (chunk) => chunks.push(chunk));

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ type: 'error', error: 'STT failed' });
  });

  it('returns highest seq number seen', () => {
    const events: ReplayEvent[] = [
      makeEvent({ seq: 3 }),
      makeEvent({ seq: 7 }),
      makeEvent({ seq: 5 }),
    ];

    const result = replayEventsAsChunks(events, () => {});

    expect(result).toBe(7);
  });

  it('returns -1 for empty events array', () => {
    const result = replayEventsAsChunks([], () => {});

    expect(result).toBe(-1);
  });

  it('multi-turn replay emits response_start per turn (tracks per-turnId)', () => {
    const events: ReplayEvent[] = [
      makeEvent({ type: 'assistant_delta', payload: { text: 'A' }, turnId: 't1', seq: 1 }),
      makeEvent({ type: 'done', payload: {}, turnId: 't1', seq: 2 }),
      makeEvent({ type: 'assistant_delta', payload: { text: 'B' }, turnId: 't2', seq: 3 }),
      makeEvent({ type: 'assistant_delta', payload: { text: 'C' }, turnId: 't2', seq: 4 }),
      makeEvent({ type: 'done', payload: {}, turnId: 't2', seq: 5 }),
    ];
    const chunks: VoiceTurnChunk[] = [];

    replayEventsAsChunks(events, (chunk) => chunks.push(chunk));

    // t1: response_start + delta A + done
    // t2: response_start + delta B + delta C + done
    expect(chunks).toHaveLength(7);
    expect(chunks[0]).toEqual({ type: 'response_start', turnId: 't1' });
    expect(chunks[1]).toEqual({ type: 'response_delta', text: 'A', turnId: 't1' });
    expect(chunks[2]).toEqual({ type: 'response_end', turnId: 't1' });
    expect(chunks[3]).toEqual({ type: 'response_start', turnId: 't2' });
    expect(chunks[4]).toEqual({ type: 'response_delta', text: 'B', turnId: 't2' });
    expect(chunks[5]).toEqual({ type: 'response_delta', text: 'C', turnId: 't2' });
    expect(chunks[6]).toEqual({ type: 'response_end', turnId: 't2' });
  });

  it('unknown event type is silently skipped', () => {
    const events: ReplayEvent[] = [
      makeEvent({ type: 'unknown_type', payload: { data: 'xyz' }, seq: 1 }),
      makeEvent({ type: 'transcript', payload: { transcript: 'hello' }, seq: 2 }),
    ];
    const chunks: VoiceTurnChunk[] = [];

    replayEventsAsChunks(events, (chunk) => chunks.push(chunk));

    // Only transcript is emitted, unknown type is skipped
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('transcript');
  });

  it('full turn replay: transcript + deltas + done', () => {
    const events: ReplayEvent[] = [
      makeEvent({ type: 'transcript', payload: { transcript: 'What time is it?' }, turnId: 't1', seq: 1 }),
      makeEvent({ type: 'assistant_delta', payload: { text: 'It is ' }, turnId: 't1', seq: 2 }),
      makeEvent({ type: 'assistant_delta', payload: { text: '3pm.' }, turnId: 't1', seq: 3 }),
      makeEvent({ type: 'done', payload: {}, turnId: 't1', seq: 4 }),
    ];
    const chunks: VoiceTurnChunk[] = [];

    const highestSeq = replayEventsAsChunks(events, (chunk) => chunks.push(chunk));

    expect(chunks).toHaveLength(5);
    expect(chunks[0]).toEqual({ type: 'transcript', text: 'What time is it?', turnId: 't1' });
    expect(chunks[1]).toEqual({ type: 'response_start', turnId: 't1' });
    expect(chunks[2]).toEqual({ type: 'response_delta', text: 'It is ', turnId: 't1' });
    expect(chunks[3]).toEqual({ type: 'response_delta', text: '3pm.', turnId: 't1' });
    expect(chunks[4]).toEqual({ type: 'response_end', turnId: 't1' });
    expect(highestSeq).toBe(4);
  });

  it('non-sequential seq values: returns the max regardless of order', () => {
    const events: ReplayEvent[] = [
      makeEvent({ seq: 100 }),
      makeEvent({ seq: 50 }),
      makeEvent({ seq: 200 }),
      makeEvent({ seq: 75 }),
    ];

    const result = replayEventsAsChunks(events, () => {});

    expect(result).toBe(200);
  });
});
