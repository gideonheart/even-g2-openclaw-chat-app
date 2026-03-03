// ── GlassesRenderer service ─────────────────────────────────
// Owns all SDK display calls: page layout, text container upgrades,
// icon animation, streaming flush, scroll, and hide/wake.
// No SDK imports -- delegates to BridgeService interface.

import type { BridgeService, PageContainerConfig, TextContainerConfig } from '../bridge/bridge-types';
import type { EventBus } from '../events';
import type { AppEventMap, IconState } from '../types';
import { createIconAnimator } from './icon-animator';
import type { IconAnimator } from './icon-animator';
import {
  renderViewport,
  scrollUp as vpScrollUp,
  scrollDown as vpScrollDown,
  MAX_VIEWPORT_CHARS,
} from './viewport';
import type { ViewportState, ChatMessage } from './viewport';

// ── Layout constants ──────────────────────────────────────

const STATUS_CONTAINER: TextContainerConfig = {
  xPosition: 0,
  yPosition: 0,
  width: 576,
  height: 30,
  containerID: 1,
  containerName: 'status',
  isEventCapture: 0,
  content: '',
};

const CHAT_CONTAINER: TextContainerConfig = {
  xPosition: 0,
  yPosition: 34,
  width: 576,
  height: 256,
  containerID: 2,
  containerName: 'chat',
  isEventCapture: 1,
  content: '',
};

const CHAT_LAYOUT: PageContainerConfig = {
  containerTotalNum: 2,
  textObject: [STATUS_CONTAINER, CHAT_CONTAINER],
};

const BLANK_LAYOUT: PageContainerConfig = {
  containerTotalNum: 1,
  textObject: [
    {
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 288,
      containerID: 1,
      containerName: 'blank',
      isEventCapture: 1,
      content: '',
    },
  ],
};

/** Streaming flush cadence in ms (CHAT-03). */
const FLUSH_INTERVAL_MS = 200;

/** Maximum number of turn pairs to keep in display buffer. */
const MAX_TURNS = 8;

// ── Public interface ──────────────────────────────────────

export interface GlassesRenderer {
  init(): Promise<void>;
  destroy(): void;
  setIconState(state: IconState): void;
  addUserMessage(text: string): void;
  startStreaming(): void;
  appendStreamChunk(text: string): void;
  endStreaming(): void;
  scrollUp(): void;
  scrollDown(): void;
  hide(): Promise<void>;
  wake(): Promise<void>;
  isHidden(): boolean;
  showWelcome(): void;
  showConfigRequired(): void;
  showError(message: string): void;
  showMenuOverlay(text: string): void;
  restoreConversation(): void;
  /** Expose icon animator for error presenter pause/resume (Phase 18). */
  getIconAnimator(): { stop(): void; start(): void } | null;
}

// ── Factory ───────────────────────────────────────────────

export function createGlassesRenderer(opts: {
  bridge: BridgeService;
  bus: EventBus<AppEventMap>;
}): GlassesRenderer {
  const { bridge } = opts;
  let nextMsgId = 1;

  // ── Internal state ──────────────────────────────────────
  let viewport: ViewportState = {
    messages: [],
    scrollOffset: 0,
    autoScroll: true,
  };
  let hidden = false;
  let streamBuffer = '';
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  let welcomeShown = false;
  let iconAnimator: IconAnimator | null = null;

  // ── Helpers ─────────────────────────────────────────────

  function renderAndPush(): void {
    const text = renderViewport(viewport);
    // CHAT-07: enforce 2000-char limit (MAX_VIEWPORT_CHARS is 1800, so this is a safety net)
    const safeText = text.length > MAX_VIEWPORT_CHARS ? text.slice(text.length - MAX_VIEWPORT_CHARS) : text;
    bridge.textContainerUpgrade(2, safeText);
  }

  function flushStreamBuffer(): void {
    if (streamBuffer.length === 0) return;

    // Append buffered text to the current (last) assistant message
    const msgs = viewport.messages;
    const last = msgs[msgs.length - 1];
    if (last && last.role === 'assistant' && !last.complete) {
      last.text += streamBuffer;
    }
    streamBuffer = '';

    // Auto-scroll to bottom when streaming
    if (viewport.autoScroll) {
      viewport.scrollOffset = 0;
    }

    renderAndPush();
  }

  function startFlushTimer(): void {
    if (flushTimer) return;
    flushTimer = setInterval(flushStreamBuffer, FLUSH_INTERVAL_MS);
  }

  function stopFlushTimer(): void {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
  }

  function trimTurnBuffer(): void {
    while (viewport.messages.length >= MAX_TURNS * 2) {
      viewport.messages.shift();
    }
  }

  // ── Public methods ──────────────────────────────────────

  async function init(): Promise<void> {
    await bridge.rebuildPageContainer(CHAT_LAYOUT);

    // Create icon animator that pushes to status text container (containerID=1)
    iconAnimator = createIconAnimator((text: string) =>
      bridge.textContainerUpgrade(1, text),
    );
    iconAnimator.setState('idle');
    iconAnimator.start();
  }

  function destroy(): void {
    iconAnimator?.stop();
    iconAnimator = null;
    stopFlushTimer();
    streamBuffer = '';
    viewport = { messages: [], scrollOffset: 0, autoScroll: true };
    hidden = false;
    welcomeShown = false;
  }

  function setIconState(state: IconState): void {
    iconAnimator?.setState(state);
  }

  function addUserMessage(text: string): void {
    trimTurnBuffer();
    welcomeShown = true;

    const msg: ChatMessage = {
      id: `msg-${nextMsgId++}`,
      role: 'user',
      text,
      complete: true,
      timestamp: Date.now(),
    };
    viewport.messages.push(msg);

    if (viewport.autoScroll) {
      viewport.scrollOffset = 0;
      renderAndPush();
    }
  }

  function startStreaming(): void {
    trimTurnBuffer();

    const msg: ChatMessage = {
      id: `msg-${nextMsgId++}`,
      role: 'assistant',
      text: '',
      complete: false,
      timestamp: Date.now(),
    };
    viewport.messages.push(msg);
    streamBuffer = '';
    startFlushTimer();
  }

  function appendStreamChunk(text: string): void {
    streamBuffer += text;
  }

  function endStreaming(): void {
    stopFlushTimer();

    // Final flush of remaining buffer
    flushStreamBuffer();

    // Mark the last assistant message complete
    const msgs = viewport.messages;
    const last = msgs[msgs.length - 1];
    if (last && last.role === 'assistant') {
      last.complete = true;
    }

    // Only reset auto-scroll if user is already at the bottom (scrollOffset === 0).
    // If user manually scrolled up (scrollOffset > 0), preserve their position --
    // they will re-enable auto-scroll by scrolling back down to offset 0.
    if (viewport.scrollOffset === 0) {
      viewport.autoScroll = true;
    }

    // Re-render with the complete marker
    renderAndPush();
  }

  function scrollUpFn(): void {
    viewport = vpScrollUp(viewport);
    renderAndPush();
  }

  function scrollDownFn(): void {
    viewport = vpScrollDown(viewport);
    renderAndPush();
  }

  async function hideFn(): Promise<void> {
    iconAnimator?.stop();
    await bridge.rebuildPageContainer(BLANK_LAYOUT);
    hidden = true;
  }

  async function wake(): Promise<void> {
    await bridge.rebuildPageContainer(CHAT_LAYOUT);
    iconAnimator?.start();
    hidden = false;

    // Re-render current state
    renderAndPush();
  }

  function isHiddenFn(): boolean {
    return hidden;
  }

  function showWelcome(): void {
    if (!welcomeShown) {
      bridge.textContainerUpgrade(2, 'Tap to ask');
      welcomeShown = true;
    }
  }

  function showConfigRequired(): void {
    bridge.textContainerUpgrade(2, 'Set Gateway URL in companion app Settings');
  }

  function showError(message: string): void {
    trimTurnBuffer();
    const msg: ChatMessage = {
      id: `msg-${nextMsgId++}`,
      role: 'assistant',
      text: `[Error] ${message}`,
      complete: true,
      timestamp: Date.now(),
    };
    viewport.messages.push(msg);
    if (viewport.autoScroll) {
      viewport.scrollOffset = 0;
    }
    renderAndPush();
  }

  function showMenuOverlay(text: string): void {
    stopFlushTimer();
    bridge.textContainerUpgrade(2, text);
  }

  function restoreConversation(): void {
    renderAndPush();
  }

  function getIconAnimatorFn(): { stop(): void; start(): void } | null {
    return iconAnimator;
  }

  return {
    init,
    destroy,
    setIconState,
    addUserMessage,
    startStreaming,
    appendStreamChunk,
    endStreaming,
    scrollUp: scrollUpFn,
    scrollDown: scrollDownFn,
    hide: hideFn,
    wake,
    isHidden: isHiddenFn,
    showWelcome,
    showConfigRequired,
    showError,
    showMenuOverlay,
    restoreConversation,
    getIconAnimator: getIconAnimatorFn,
  };
}
