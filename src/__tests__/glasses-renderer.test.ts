// ── Tests for GlassesRenderer service ───────────────────────
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGlassesRenderer, type GlassesRenderer } from '../display/glasses-renderer';
import { createEventBus } from '../events';
import type { AppEventMap } from '../types';
import type { BridgeService, PageContainerConfig } from '../bridge/bridge-types';

// ── Mock bridge (simple vi.fn() stubs) ──────────────────────

function createMockBridge(): BridgeService & {
  textContainerUpgrade: ReturnType<typeof vi.fn>;
  rebuildPageContainer: ReturnType<typeof vi.fn>;
} {
  return {
    init: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    destroy: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    startAudio: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    stopAudio: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    textContainerUpgrade: vi.fn().mockResolvedValue(true),
    rebuildPageContainer: vi.fn().mockResolvedValue(true),
  };
}

describe('GlassesRenderer', () => {
  let bridge: ReturnType<typeof createMockBridge>;
  let bus: ReturnType<typeof createEventBus<AppEventMap>>;
  let renderer: GlassesRenderer;

  beforeEach(() => {
    vi.useFakeTimers();
    bridge = createMockBridge();
    bus = createEventBus<AppEventMap>();
    renderer = createGlassesRenderer({ bridge, bus });
  });

  afterEach(() => {
    renderer.destroy();
    vi.useRealTimers();
  });

  // ── init ──────────────────────────────────────────────────

  it('init() calls rebuildPageContainer with 2-container layout', async () => {
    await renderer.init();

    expect(bridge.rebuildPageContainer).toHaveBeenCalledOnce();
    const config = bridge.rebuildPageContainer.mock.calls[0][0] as PageContainerConfig;
    expect(config.containerTotalNum).toBe(2);
    expect(config.textObject).toHaveLength(2);

    // Verify container names
    const names = config.textObject.map((t) => t.containerName);
    expect(names).toEqual(['status', 'chat']);

    // Verify all containers have isEventCapture=0
    for (const container of config.textObject) {
      expect(container.isEventCapture).toBe(0);
    }
  });

  it('init() starts icon animator and sets idle icon', async () => {
    await renderer.init();

    // Icon animator fires an immediate tick on setState('idle')
    // which calls textContainerUpgrade on containerID=1
    expect(bridge.textContainerUpgrade).toHaveBeenCalled();
    const firstCall = bridge.textContainerUpgrade.mock.calls[0];
    expect(firstCall[0]).toBe(1); // containerID for status
    expect(typeof firstCall[1]).toBe('string'); // Unicode icon text
  });

  // ── addUserMessage ────────────────────────────────────────

  it('addUserMessage appends message and renders viewport to chat container', async () => {
    await renderer.init();
    bridge.textContainerUpgrade.mockClear();

    renderer.addUserMessage('Hello world');

    expect(bridge.textContainerUpgrade).toHaveBeenCalled();
    // Find the call to containerID=2 (chat)
    const chatCall = bridge.textContainerUpgrade.mock.calls.find(
      (c: unknown[]) => c[0] === 2,
    );
    expect(chatCall).toBeDefined();
    expect(chatCall![1]).toContain('> Hello world');
  });

  // ── streaming ─────────────────────────────────────────────

  it('startStreaming + appendStreamChunk + wait 200ms -> flushes to display', async () => {
    await renderer.init();
    bridge.textContainerUpgrade.mockClear();

    renderer.startStreaming();
    renderer.appendStreamChunk('Hello ');
    renderer.appendStreamChunk('world');

    // Before flush interval fires, no chat update yet
    const chatCallsBefore = bridge.textContainerUpgrade.mock.calls.filter(
      (c: unknown[]) => c[0] === 2,
    );
    expect(chatCallsBefore).toHaveLength(0);

    // Advance past the 200ms flush interval
    vi.advanceTimersByTime(200);

    const chatCallsAfter = bridge.textContainerUpgrade.mock.calls.filter(
      (c: unknown[]) => c[0] === 2,
    );
    expect(chatCallsAfter.length).toBeGreaterThanOrEqual(1);
    const lastChatCall = chatCallsAfter[chatCallsAfter.length - 1];
    expect(lastChatCall[1]).toContain('Hello world');
  });

  it('endStreaming does final flush and marks message complete', async () => {
    await renderer.init();
    bridge.textContainerUpgrade.mockClear();

    renderer.startStreaming();
    renderer.appendStreamChunk('Final text');

    // End streaming before flush interval fires -- should do final flush
    renderer.endStreaming();

    const chatCalls = bridge.textContainerUpgrade.mock.calls.filter(
      (c: unknown[]) => c[0] === 2,
    );
    expect(chatCalls.length).toBeGreaterThanOrEqual(1);
    const lastCall = chatCalls[chatCalls.length - 1];
    // After endStreaming, message is complete so no " ..." suffix
    expect(lastCall[1]).toContain('Final text');
    expect(lastCall[1]).not.toContain(' ...');
  });

  it('streaming shows " ..." suffix for incomplete messages', async () => {
    await renderer.init();
    bridge.textContainerUpgrade.mockClear();

    renderer.startStreaming();
    renderer.appendStreamChunk('Thinking');

    // Flush interval fires
    vi.advanceTimersByTime(200);

    const chatCalls = bridge.textContainerUpgrade.mock.calls.filter(
      (c: unknown[]) => c[0] === 2,
    );
    expect(chatCalls.length).toBeGreaterThanOrEqual(1);
    const lastCall = chatCalls[chatCalls.length - 1];
    expect(lastCall[1]).toContain('Thinking ...');
  });

  // ── scroll ────────────────────────────────────────────────

  it('scrollUp/scrollDown adjust viewport and re-render', async () => {
    await renderer.init();

    // Add multiple messages
    renderer.addUserMessage('Message 1');
    renderer.addUserMessage('Message 2');
    renderer.addUserMessage('Message 3');
    bridge.textContainerUpgrade.mockClear();

    // Scroll up
    renderer.scrollUp();
    const upCalls = bridge.textContainerUpgrade.mock.calls.filter(
      (c: unknown[]) => c[0] === 2,
    );
    expect(upCalls).toHaveLength(1);

    bridge.textContainerUpgrade.mockClear();

    // Scroll down
    renderer.scrollDown();
    const downCalls = bridge.textContainerUpgrade.mock.calls.filter(
      (c: unknown[]) => c[0] === 2,
    );
    expect(downCalls).toHaveLength(1);
  });

  // ── hide/wake ─────────────────────────────────────────────

  it('hide() calls rebuildPageContainer with blank layout', async () => {
    await renderer.init();
    bridge.rebuildPageContainer.mockClear();

    await renderer.hide();

    expect(bridge.rebuildPageContainer).toHaveBeenCalledOnce();
    const config = bridge.rebuildPageContainer.mock.calls[0][0] as PageContainerConfig;
    expect(config.containerTotalNum).toBe(1);
    expect(config.textObject).toHaveLength(1);
    expect(config.textObject[0].containerName).toBe('blank');
    expect(config.textObject[0].content).toBe('');
    expect(renderer.isHidden()).toBe(true);
  });

  it('wake() calls rebuildPageContainer with 2-container layout and re-renders', async () => {
    await renderer.init();
    renderer.addUserMessage('Persisted message');
    await renderer.hide();
    bridge.rebuildPageContainer.mockClear();
    bridge.textContainerUpgrade.mockClear();

    await renderer.wake();

    expect(bridge.rebuildPageContainer).toHaveBeenCalledOnce();
    const config = bridge.rebuildPageContainer.mock.calls[0][0] as PageContainerConfig;
    expect(config.containerTotalNum).toBe(2);
    expect(renderer.isHidden()).toBe(false);

    // Re-renders the chat viewport with existing messages
    const chatCalls = bridge.textContainerUpgrade.mock.calls.filter(
      (c: unknown[]) => c[0] === 2,
    );
    expect(chatCalls.length).toBeGreaterThanOrEqual(1);
    expect(chatCalls[0][1]).toContain('Persisted message');
  });

  // ── setIconState ──────────────────────────────────────────

  it('setIconState updates status container text', async () => {
    await renderer.init();
    bridge.textContainerUpgrade.mockClear();

    renderer.setIconState('recording');

    // Icon animator fires immediate tick on setState
    const statusCalls = bridge.textContainerUpgrade.mock.calls.filter(
      (c: unknown[]) => c[0] === 1,
    );
    expect(statusCalls.length).toBeGreaterThanOrEqual(1);
  });

  // ── showWelcome ────────────────────────────────────────────

  it('showWelcome writes "Tap to ask" to chat container', async () => {
    await renderer.init();
    bridge.textContainerUpgrade.mockClear();

    renderer.showWelcome();

    const chatCalls = bridge.textContainerUpgrade.mock.calls.filter(
      (c: unknown[]) => c[0] === 2,
    );
    expect(chatCalls).toHaveLength(1);
    expect(chatCalls[0][1]).toBe('Tap to ask');
  });

  it('showWelcome is no-op after first call', async () => {
    await renderer.init();
    renderer.showWelcome();
    bridge.textContainerUpgrade.mockClear();

    renderer.showWelcome();

    const chatCalls = bridge.textContainerUpgrade.mock.calls.filter(
      (c: unknown[]) => c[0] === 2,
    );
    expect(chatCalls).toHaveLength(0);
  });

  it('showWelcome is no-op after addUserMessage', async () => {
    await renderer.init();
    renderer.addUserMessage('Hello');
    bridge.textContainerUpgrade.mockClear();

    renderer.showWelcome();

    const chatCalls = bridge.textContainerUpgrade.mock.calls.filter(
      (c: unknown[]) => c[0] === 2,
    );
    expect(chatCalls).toHaveLength(0);
  });

  // ── showConfigRequired ─────────────────────────────────────

  it('showConfigRequired writes blocking message to chat container', async () => {
    await renderer.init();
    bridge.textContainerUpgrade.mockClear();

    renderer.showConfigRequired();

    const chatCalls = bridge.textContainerUpgrade.mock.calls.filter(
      (c: unknown[]) => c[0] === 2,
    );
    expect(chatCalls).toHaveLength(1);
    expect(chatCalls[0][1]).toBe('Set Gateway URL in companion app Settings');
  });

  // ── showError ───────────────────────────────────────────────

  it('showError appends error message as assistant chat bubble', async () => {
    await renderer.init();
    bridge.textContainerUpgrade.mockClear();

    renderer.showError('Request timed out. Tap to retry.');

    const chatCalls = bridge.textContainerUpgrade.mock.calls.filter(
      (c: unknown[]) => c[0] === 2,
    );
    expect(chatCalls.length).toBeGreaterThanOrEqual(1);
    const chatText = chatCalls[chatCalls.length - 1][1] as string;
    expect(chatText).toContain('[Error] Request timed out. Tap to retry.');
  });

  it('showError message has role assistant and is complete', async () => {
    await renderer.init();
    bridge.textContainerUpgrade.mockClear();

    renderer.showError('test error');

    // The error should render as a non-streaming (complete) message
    // Verify it doesn't have the " ..." streaming suffix
    const chatCalls = bridge.textContainerUpgrade.mock.calls.filter(
      (c: unknown[]) => c[0] === 2,
    );
    expect(chatCalls.length).toBeGreaterThanOrEqual(1);
    const chatText = chatCalls[chatCalls.length - 1][1] as string;
    expect(chatText).toContain('[Error] test error');
    expect(chatText).not.toContain(' ...');
  });

  // ── turn buffer limit ─────────────────────────────────────

  it('addUserMessage trims old messages when buffer exceeds MAX_TURNS pairs', async () => {
    await renderer.init();

    // Add 8 turn pairs (16 messages) plus streaming
    for (let i = 0; i < 8; i++) {
      renderer.addUserMessage(`User ${i}`);
      renderer.startStreaming();
      renderer.appendStreamChunk(`Bot ${i}`);
      renderer.endStreaming();
    }

    bridge.textContainerUpgrade.mockClear();

    // Adding one more user message should trim the oldest pair
    renderer.addUserMessage('User 8');

    // The viewport should not contain the first message
    const chatCalls = bridge.textContainerUpgrade.mock.calls.filter(
      (c: unknown[]) => c[0] === 2,
    );
    expect(chatCalls.length).toBeGreaterThanOrEqual(1);
    const chatText = chatCalls[chatCalls.length - 1][1];
    expect(chatText).not.toContain('User 0');
    expect(chatText).toContain('User 8');
  });

  // ── auto-scroll reset ──────────────────────────────────────

  it('endStreaming resets auto-scroll to true', async () => {
    await renderer.init();

    renderer.addUserMessage('Test');
    renderer.startStreaming();
    renderer.appendStreamChunk('Response');

    // Scroll up pauses auto-scroll
    renderer.scrollUp();

    // End streaming should reset auto-scroll
    renderer.endStreaming();
    bridge.textContainerUpgrade.mockClear();

    // Next startStreaming + appendStreamChunk + flush should auto-scroll (render)
    renderer.startStreaming();
    renderer.appendStreamChunk('New response');
    vi.advanceTimersByTime(200);

    const chatCalls = bridge.textContainerUpgrade.mock.calls.filter(
      (c: unknown[]) => c[0] === 2,
    );
    expect(chatCalls.length).toBeGreaterThanOrEqual(1);
  });

  // ── CHAT-07: 2000-char limit ──────────────────────────────

  it('no textContainerUpgrade call exceeds 2000 characters', async () => {
    await renderer.init();
    bridge.textContainerUpgrade.mockClear();

    // Add a very long user message
    const longText = 'A'.repeat(2500);
    renderer.addUserMessage(longText);

    // Start streaming with a lot of text
    renderer.startStreaming();
    renderer.appendStreamChunk('B'.repeat(2500));
    vi.advanceTimersByTime(200);
    renderer.endStreaming();

    // Check all textContainerUpgrade calls to containerID=2 (chat)
    for (const call of bridge.textContainerUpgrade.mock.calls) {
      if (call[0] === 2) {
        expect((call[1] as string).length).toBeLessThanOrEqual(2000);
      }
    }
  });

  // ── isHidden ──────────────────────────────────────────────

  it('isHidden returns false initially, true after hide, false after wake', async () => {
    await renderer.init();

    expect(renderer.isHidden()).toBe(false);

    await renderer.hide();
    expect(renderer.isHidden()).toBe(true);

    await renderer.wake();
    expect(renderer.isHidden()).toBe(false);
  });

  // ── destroy ───────────────────────────────────────────────

  it('destroy cleans up timers and state', async () => {
    await renderer.init();
    renderer.startStreaming();
    renderer.appendStreamChunk('test');

    renderer.destroy();

    // After destroy, advancing timers should not cause more calls
    bridge.textContainerUpgrade.mockClear();
    vi.advanceTimersByTime(1000);
    const chatCalls = bridge.textContainerUpgrade.mock.calls.filter(
      (c: unknown[]) => c[0] === 2,
    );
    expect(chatCalls).toHaveLength(0);
  });
});
