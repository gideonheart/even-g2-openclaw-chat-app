import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHubErrorPresenter } from '../hub-error-presenter';

// ── Map-based event bus mock ──────────────────────────────
type Handler = (...args: unknown[]) => void;

function createMockBus() {
  const listeners = new Map<string, Set<Handler>>();

  function on(event: string, handler: Handler): () => void {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(handler);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      listeners.get(event)!.delete(handler);
    };
  }

  function emit(event: string, payload: unknown): void {
    const set = listeners.get(event);
    if (!set) return;
    for (const handler of set) handler(payload);
  }

  return { on, emit, listeners };
}

describe('createHubErrorPresenter', () => {
  let bus: ReturnType<typeof createMockBus>;
  let showToast: ReturnType<typeof vi.fn>;
  let showBanner: ReturnType<typeof vi.fn>;
  let hideBanner: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = createMockBus();
    showToast = vi.fn();
    showBanner = vi.fn();
    hideBanner = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function create() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return createHubErrorPresenter({ bus: bus as any, showToast, showBanner, hideBanner });
  }

  describe('persistence:error -- toast for recoverable', () => {
    it('emits 5000ms toast for recoverable error (write-failed)', () => {
      create();
      bus.emit('persistence:error', { type: 'write-failed', recoverable: true });
      expect(showToast).toHaveBeenCalledWith('Could not save message', 5000);
    });

    it('emits 5000ms toast for recoverable database-closed', () => {
      create();
      bus.emit('persistence:error', { type: 'database-closed', recoverable: true });
      expect(showToast).toHaveBeenCalledWith('Data connection lost', 5000);
    });
  });

  describe('persistence:error -- banner for non-recoverable', () => {
    it('shows banner for non-recoverable error', () => {
      create();
      bus.emit('persistence:error', { type: 'quota-exceeded', recoverable: false });
      expect(showBanner).toHaveBeenCalledWith(
        expect.stringContaining('Storage full'),
        'err',
      );
    });

    it('two sequential non-recoverable errors both call showBanner', () => {
      create();
      bus.emit('persistence:error', { type: 'quota-exceeded', recoverable: false });
      bus.emit('persistence:error', { type: 'write-failed', recoverable: false });
      expect(showBanner).toHaveBeenCalledTimes(2);
    });
  });

  describe('fsm:watchdog-reset -- toast', () => {
    it('emits 5000ms toast', () => {
      create();
      bus.emit('fsm:watchdog-reset', { previousState: 'thinking', elapsed: 45000 });
      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining('timed out'),
        5000,
      );
    });
  });

  describe('destroy()', () => {
    it('unsubscribes all bus handlers', () => {
      const presenter = create();
      // Both events should have listeners
      expect(bus.listeners.get('persistence:error')!.size).toBe(1);
      expect(bus.listeners.get('fsm:watchdog-reset')!.size).toBe(1);

      presenter.destroy();

      // All handlers unsubscribed
      expect(bus.listeners.get('persistence:error')!.size).toBe(0);
      expect(bus.listeners.get('fsm:watchdog-reset')!.size).toBe(0);
    });
  });
});
