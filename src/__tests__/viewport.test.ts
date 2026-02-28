import { describe, it, expect } from 'vitest';
import {
  serializeMessages,
  renderViewport,
  scrollUp,
  scrollDown,
  MAX_VIEWPORT_CHARS,
  type ChatMessage,
  type ViewportState,
} from '../display/viewport';

// ── helpers ────────────────────────────────────────────────

function msg(
  role: 'user' | 'assistant',
  text: string,
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
    complete: true,
    timestamp: Date.now(),
    ...overrides,
  };
}

function state(
  messages: ChatMessage[],
  overrides: Partial<ViewportState> = {},
): ViewportState {
  return { messages, scrollOffset: 0, autoScroll: true, ...overrides };
}

// ── serializeMessages ──────────────────────────────────────

describe('serializeMessages', () => {
  it('returns empty string for empty array', () => {
    expect(serializeMessages([])).toBe('');
  });

  it('prefixes user messages with "> "', () => {
    expect(serializeMessages([msg('user', 'hello')])).toBe('> hello');
  });

  it('renders assistant messages without prefix', () => {
    expect(serializeMessages([msg('assistant', 'hi')])).toBe('hi');
  });

  it('separates messages with blank line', () => {
    const result = serializeMessages([
      msg('user', 'hello'),
      msg('assistant', 'hi'),
    ]);
    expect(result).toBe('> hello\n\nhi');
  });

  it('appends " ..." suffix for incomplete messages', () => {
    const result = serializeMessages([
      msg('assistant', 'thinking', { complete: false }),
    ]);
    expect(result).toBe('thinking ...');
  });

  it('does not append suffix for complete messages', () => {
    const result = serializeMessages([
      msg('assistant', 'done', { complete: true }),
    ]);
    expect(result).toBe('done');
  });

  it('handles mixed complete and incomplete messages', () => {
    const result = serializeMessages([
      msg('user', 'question'),
      msg('assistant', 'partial answer', { complete: false }),
    ]);
    expect(result).toBe('> question\n\npartial answer ...');
  });
});

// ── renderViewport ─────────────────────────────────────────

describe('renderViewport', () => {
  it('returns empty string for empty messages', () => {
    expect(renderViewport(state([]))).toBe('');
  });

  it('with scrollOffset=0 shows latest messages', () => {
    const s = state([
      msg('user', 'first'),
      msg('assistant', 'second'),
      msg('user', 'third'),
    ]);
    const rendered = renderViewport(s);
    expect(rendered).toContain('> third');
  });

  it('truncates output to MAX_VIEWPORT_CHARS', () => {
    // Create many long messages that exceed the char limit
    const longMessages = Array.from({ length: 50 }, (_, i) =>
      msg('assistant', `Message ${i}: ${'x'.repeat(200)}`),
    );
    const result = renderViewport(state(longMessages));
    expect(result.length).toBeLessThanOrEqual(MAX_VIEWPORT_CHARS);
  });

  it('with positive scrollOffset shows older messages', () => {
    const msgs = [
      msg('user', 'oldest'),
      msg('assistant', 'middle'),
      msg('user', 'newest'),
    ];
    // scrollOffset=1 should skip the newest message
    const result = renderViewport(state(msgs, { scrollOffset: 1 }));
    expect(result).toContain('middle');
    expect(result).not.toContain('> newest');
  });

  it('renders a single message correctly', () => {
    const result = renderViewport(state([msg('user', 'hello')]));
    expect(result).toBe('> hello');
  });

  it('renders incomplete messages with streaming indicator', () => {
    const result = renderViewport(
      state([msg('assistant', 'typing', { complete: false })]),
    );
    expect(result).toBe('typing ...');
  });
});

// ── scrollUp ───────────────────────────────────────────────

describe('scrollUp', () => {
  it('increments scrollOffset by 1', () => {
    const s = state([msg('user', 'a'), msg('user', 'b')]);
    const result = scrollUp(s);
    expect(result.scrollOffset).toBe(1);
  });

  it('sets autoScroll to false', () => {
    const s = state([msg('user', 'a'), msg('user', 'b')]);
    const result = scrollUp(s);
    expect(result.autoScroll).toBe(false);
  });

  it('clamps at messages.length - 1', () => {
    const msgs = [msg('user', 'a'), msg('user', 'b')];
    const s = state(msgs, { scrollOffset: 1 }); // already at max
    const result = scrollUp(s);
    expect(result.scrollOffset).toBe(1); // stays clamped
  });

  it('does not mutate original state', () => {
    const s = state([msg('user', 'a'), msg('user', 'b')]);
    const result = scrollUp(s);
    expect(result).not.toBe(s);
    expect(s.scrollOffset).toBe(0);
  });
});

// ── scrollDown ─────────────────────────────────────────────

describe('scrollDown', () => {
  it('decrements scrollOffset by 1', () => {
    const msgs = [msg('user', 'a'), msg('user', 'b')];
    const s = state(msgs, { scrollOffset: 1, autoScroll: false });
    const result = scrollDown(s);
    expect(result.scrollOffset).toBe(0);
  });

  it('sets autoScroll to true when reaching offset 0', () => {
    const msgs = [msg('user', 'a'), msg('user', 'b')];
    const s = state(msgs, { scrollOffset: 1, autoScroll: false });
    const result = scrollDown(s);
    expect(result.autoScroll).toBe(true);
  });

  it('clamps at 0', () => {
    const s = state([msg('user', 'a')]);
    const result = scrollDown(s);
    expect(result.scrollOffset).toBe(0);
  });

  it('keeps autoScroll false when not at offset 0', () => {
    const msgs = [msg('user', 'a'), msg('user', 'b'), msg('user', 'c')];
    const s = state(msgs, { scrollOffset: 2, autoScroll: false });
    const result = scrollDown(s);
    expect(result.scrollOffset).toBe(1);
    expect(result.autoScroll).toBe(false);
  });

  it('does not mutate original state', () => {
    const msgs = [msg('user', 'a'), msg('user', 'b')];
    const s = state(msgs, { scrollOffset: 1 });
    const result = scrollDown(s);
    expect(result).not.toBe(s);
    expect(s.scrollOffset).toBe(1);
  });
});
