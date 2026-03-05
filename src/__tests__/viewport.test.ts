import { describe, it, expect } from 'vitest';
import {
  serializeMessages,
  renderViewport,
  scrollUp,
  scrollDown,
  MAX_VIEWPORT_CHARS,
  MAX_VISIBLE_CHARS,
  FIT_TO_SCREEN,
  EFFECTIVE_CHAR_LIMIT,
  MSG_SEPARATOR,
  SEPARATOR_OVERHEAD,
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

  it('separates messages with ─── separator', () => {
    const result = serializeMessages([
      msg('user', 'hello'),
      msg('assistant', 'hi'),
    ]);
    expect(result).toBe('> hello\n───\nhi');
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
    expect(result).toBe('> question\n───\npartial answer ...');
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

  it('truncates output to effective char limit', () => {
    // Create many long messages that exceed the char limit
    const longMessages = Array.from({ length: 50 }, (_, i) =>
      msg('assistant', `Message ${i}: ${'x'.repeat(200)}`),
    );
    const result = renderViewport(state(longMessages));
    expect(result.length).toBeLessThanOrEqual(EFFECTIVE_CHAR_LIMIT);
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

// ── fit-to-screen (quick-41) ──────────────────────────────────

describe('renderViewport fit-to-screen', () => {
  it('FIT_TO_SCREEN flag is enabled', () => {
    expect(FIT_TO_SCREEN).toBe(true);
  });

  it('MAX_VISIBLE_CHARS is smaller than MAX_VIEWPORT_CHARS', () => {
    expect(MAX_VISIBLE_CHARS).toBeLessThan(MAX_VIEWPORT_CHARS);
  });

  it('limits output to EFFECTIVE_CHAR_LIMIT when FIT_TO_SCREEN is on', () => {
    // Create messages whose combined text exceeds EFFECTIVE_CHAR_LIMIT
    // but would fit within MAX_VIEWPORT_CHARS
    const longMsg = msg('assistant', 'x'.repeat(EFFECTIVE_CHAR_LIMIT + 100));
    const result = renderViewport(state([longMsg]));
    expect(result.length).toBeLessThanOrEqual(EFFECTIVE_CHAR_LIMIT);
  });

  it('shows only the latest messages that fit in the visible area', () => {
    // Each message is ~30 chars including prefix/separator
    const msgs = Array.from({ length: 20 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', `msg-${i}-padding`),
    );
    const result = renderViewport(state(msgs));
    // The output must fit within the visible limit
    expect(result.length).toBeLessThanOrEqual(EFFECTIVE_CHAR_LIMIT);
    // The latest message should be present
    expect(result).toContain('msg-19-padding');
  });
});

// ── scroll anchoring (viewport preservation) ─────────────────

describe('renderViewport scroll anchoring', () => {
  it('with autoScroll=false and scrollOffset>0, new messages do not appear in viewport', () => {
    // Create 5 messages with scrollOffset=2, autoScroll=false
    const msgs = [
      msg('user', 'msg-1'),
      msg('assistant', 'msg-2'),
      msg('user', 'msg-3'),
      msg('assistant', 'msg-4'),
      msg('user', 'msg-5'),
    ];
    const s = state(msgs, { scrollOffset: 2, autoScroll: false });

    // With 5 messages and scrollOffset=2: endIdx = 5 - 2 = 3
    // So viewport shows messages[0..2] = msg-1, msg-2, msg-3
    const rendered1 = renderViewport(s);
    expect(rendered1).toContain('msg-3');
    expect(rendered1).not.toContain('msg-5');

    // Add a 6th message, keep scrollOffset=2
    msgs.push(msg('assistant', 'msg-6'));
    const s2 = state(msgs, { scrollOffset: 2, autoScroll: false });

    // With 6 messages and scrollOffset=2: endIdx = 6 - 2 = 4
    // So viewport shows messages[0..3] = msg-1, msg-2, msg-3, msg-4
    // msg-6 is NOT visible because scrollOffset pushes the window up
    const rendered2 = renderViewport(s2);
    expect(rendered2).toContain('msg-4');
    expect(rendered2).not.toContain('msg-6');
  });
});

// ── message separator (quick-44) ──────────────────────────────

describe('message separator (quick-44)', () => {
  it('MSG_SEPARATOR is short box-drawing line', () => {
    expect(MSG_SEPARATOR).toBe('───');
  });

  it('SEPARATOR_OVERHEAD is separator length + 2 newlines', () => {
    expect(SEPARATOR_OVERHEAD).toBe(MSG_SEPARATOR.length + 2);
  });

  it('serializeMessages joins with ───', () => {
    const result = serializeMessages([
      msg('user', 'hello'),
      msg('assistant', 'hi'),
    ]);
    expect(result).toBe('> hello\n───\nhi');
  });

  it('renderViewport respects separator overhead in budget', () => {
    const msgs = Array.from({ length: 20 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', `msg-${i}-pad`),
    );
    const result = renderViewport(state(msgs));
    expect(result.length).toBeLessThanOrEqual(EFFECTIVE_CHAR_LIMIT);
  });
});
