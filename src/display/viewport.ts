// ── Viewport state management ──────────────────────────────
// Pure functions for chat message serialization, viewport windowing,
// and scroll offset management. No SDK imports -- fully testable.

// ── Types ──────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  complete: boolean;
  timestamp: number;
}

export interface ViewportState {
  messages: ChatMessage[];
  scrollOffset: number; // 0 = latest (bottom), positive = scrolled up
  autoScroll: boolean;  // true when at bottom, new messages auto-scroll
}

// ── Constants ──────────────────────────────────────────────

/** Hard character limit to stay safely under the 2000-char SDK limit. */
export const MAX_VIEWPORT_CHARS = 1800;

// ── Pure functions ─────────────────────────────────────────

/**
 * Serialize an array of chat messages to plain text for the glasses display.
 * - User messages are prefixed with '> ' to simulate right-alignment
 * - Assistant messages have no prefix
 * - Messages are separated by a blank line ('\n\n')
 * - Incomplete messages get ' ...' suffix (streaming indicator)
 */
export function serializeMessages(messages: ChatMessage[]): string {
  if (messages.length === 0) return '';

  return messages
    .map((m) => {
      const prefix = m.role === 'user' ? '> ' : '';
      const suffix = m.complete ? '' : ' ...';
      return `${prefix}${m.text}${suffix}`;
    })
    .join('\n\n');
}

/**
 * Render the visible viewport window as a plain text string.
 * - scrollOffset=0 means show latest messages (bottom of history)
 * - Builds text from the end of the message list, working backwards
 * - Stops when accumulated text exceeds MAX_VIEWPORT_CHARS
 * - Hard-truncates at MAX_VIEWPORT_CHARS to enforce the SDK limit
 */
export function renderViewport(state: ViewportState): string {
  const { messages, scrollOffset } = state;
  if (messages.length === 0) return '';

  // endIdx is the exclusive upper bound (messages up to but not including endIdx)
  const endIdx = Math.max(0, messages.length - scrollOffset);
  if (endIdx <= 0) return '';

  // Build text from bottom up, stopping when we exceed the char limit
  const visibleMessages: ChatMessage[] = [];
  let totalLength = 0;

  for (let i = endIdx - 1; i >= 0; i--) {
    const m = messages[i];
    const prefix = m.role === 'user' ? '> ' : '';
    const suffix = m.complete ? '' : ' ...';
    const line = `${prefix}${m.text}${suffix}`;
    // Account for the separator between messages
    const addedLength = visibleMessages.length > 0 ? line.length + 2 : line.length;

    if (totalLength + addedLength > MAX_VIEWPORT_CHARS && visibleMessages.length > 0) {
      break;
    }

    visibleMessages.unshift(m);
    totalLength += addedLength;
  }

  const text = serializeMessages(visibleMessages);

  // Hard truncation safety net
  if (text.length > MAX_VIEWPORT_CHARS) {
    return text.slice(text.length - MAX_VIEWPORT_CHARS);
  }

  return text;
}

/**
 * Scroll up (toward older messages).
 * - Increments scrollOffset by 1
 * - Clamps at messages.length - 1 (can't scroll past the first message)
 * - Sets autoScroll = false
 */
export function scrollUp(state: ViewportState): ViewportState {
  const maxOffset = Math.max(0, state.messages.length - 1);
  const newOffset = Math.min(state.scrollOffset + 1, maxOffset);
  return {
    ...state,
    scrollOffset: newOffset,
    autoScroll: false,
  };
}

/**
 * Scroll down (toward newer messages).
 * - Decrements scrollOffset by 1
 * - Clamps at 0 (can't scroll past latest)
 * - When scrollOffset reaches 0, sets autoScroll = true
 */
export function scrollDown(state: ViewportState): ViewportState {
  const newOffset = Math.max(0, state.scrollOffset - 1);
  return {
    ...state,
    scrollOffset: newOffset,
    autoScroll: newOffset === 0,
  };
}
