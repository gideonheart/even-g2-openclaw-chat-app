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

// ── Feature flags ────────────────────────────────────────────

/** When true, limit rendered text to fit the visible container area
 *  (no firmware scrolling). When false, use the full 1800-char budget
 *  (firmware handles overflow scroll, starts at top). */
export const FIT_TO_SCREEN = true;

// ── Separator variants (quick-43) ────────────────────────────

interface SeparatorVariant {
  id: string;
  label: string;
  separator: string;
}

export const SEPARATOR_VARIANTS: readonly SeparatorVariant[] = [
  { id: 'off',      label: 'Off',              separator: '' },
  { id: 'dots',     label: 'Dots .........',   separator: '.........' },
  { id: 'ellipsis', label: 'Ellipsis ……………',  separator: '……………' },
  { id: 'short',    label: 'Line ───',         separator: '───' },
  { id: 'long',     label: 'Line ─────────',   separator: '─────────' },
] as const;

let currentVariantIndex = 0;

/** Cycle to the next separator variant, wrapping around. Returns the new variant's label. */
export function cycleSeparatorStyle(): string {
  currentVariantIndex = (currentVariantIndex + 1) % SEPARATOR_VARIANTS.length;
  return SEPARATOR_VARIANTS[currentVariantIndex].label;
}

/** Character cost of the current separator between messages.
 *  Off = 2 (for '\n\n'), otherwise separator.length + 2 (for '\n' + sep + '\n'). */
export function getSeparatorOverhead(): number {
  const sep = SEPARATOR_VARIANTS[currentVariantIndex].separator;
  return sep.length === 0 ? 2 : sep.length + 2;
}

/** Reset separator to Off (index 0). Used in tests for isolation. */
export function resetSeparatorStyle(): void {
  currentVariantIndex = 0;
}

// ── Constants ──────────────────────────────────────────────

/** Hard character limit to stay safely under the 2000-char SDK limit. */
export const MAX_VIEWPORT_CHARS = 1800;

/** Approximate character limit that fits in the 256px chat container
 *  without triggering firmware overflow scroll.
 *  576px width ≈ ~28-32 chars/line at default font; 256px height ≈ ~7 lines.
 *  Conservative estimate: 7 lines × 28 chars = ~196 chars.
 *  Tunable constant — adjust after on-device testing. */
export const MAX_VISIBLE_CHARS = 200;

/** Resolved char limit — the ONE value every renderer should use.
 *  Eliminates repeated FIT_TO_SCREEN ternaries across modules. */
export const EFFECTIVE_CHAR_LIMIT = FIT_TO_SCREEN ? MAX_VISIBLE_CHARS : MAX_VIEWPORT_CHARS;

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
    .join((() => {
      const sep = SEPARATOR_VARIANTS[currentVariantIndex].separator;
      return sep ? `\n${sep}\n` : '\n\n';
    })());
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
    const addedLength = visibleMessages.length > 0 ? line.length + getSeparatorOverhead() : line.length;

    if (totalLength + addedLength > EFFECTIVE_CHAR_LIMIT && visibleMessages.length > 0) {
      break;
    }

    visibleMessages.unshift(m);
    totalLength += addedLength;
  }

  const text = serializeMessages(visibleMessages);

  // Hard truncation safety net
  if (text.length > EFFECTIVE_CHAR_LIMIT) {
    return text.slice(text.length - EFFECTIVE_CHAR_LIMIT);
  }

  return text;
}

// ASSUMPTION(quick-26): scrollUp()/scrollDown() are the ONLY scroll entry
// points from the Even G2 bridge. The integer scrollOffset model assumes
// discrete step scrolling. If the Even SDK ever adds inertial scrolling
// or fractional offsets, the `scrollOffset === 0` check in glasses-renderer
// endStreaming() could produce false positives. Review if bridge API changes.

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
