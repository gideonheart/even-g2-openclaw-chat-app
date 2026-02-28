import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDriftReconciler } from '../sync/drift-reconciler';

// ── Mocks ──────────────────────────────────────────────────

function createMockStore(countResult = 0) {
  return {
    countMessages: vi.fn().mockResolvedValue(countResult),
  };
}

// ── Tests ──────────────────────────────────────────────────

describe('DriftReconciler', () => {
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    store = createMockStore(5);
  });

  it('no drift when counts match', async () => {
    const onDriftDetected = vi.fn();
    const onReconciled = vi.fn();

    const reconciler = createDriftReconciler({ store, onDriftDetected, onReconciled });

    const result = await reconciler.handleHeartbeat('conv-1', 5);

    expect(result).toBe(false);
    expect(onDriftDetected).not.toHaveBeenCalled();
    expect(onReconciled).not.toHaveBeenCalled();

    reconciler.destroy();
  });

  it('single mismatch does NOT trigger reconciliation', async () => {
    const onDriftDetected = vi.fn();
    const onReconciled = vi.fn();

    const reconciler = createDriftReconciler({ store, onDriftDetected, onReconciled });

    const result = await reconciler.handleHeartbeat('conv-1', 7);

    expect(result).toBe(false);
    expect(onDriftDetected).not.toHaveBeenCalled();
    expect(onReconciled).not.toHaveBeenCalled();

    reconciler.destroy();
  });

  it('two consecutive mismatches trigger reconciliation', async () => {
    const onDriftDetected = vi.fn();
    const onReconciled = vi.fn();

    const reconciler = createDriftReconciler({ store, onDriftDetected, onReconciled });

    const first = await reconciler.handleHeartbeat('conv-1', 7);
    expect(first).toBe(false);

    const second = await reconciler.handleHeartbeat('conv-1', 7);
    expect(second).toBe(true);
    expect(onDriftDetected).toHaveBeenCalledWith({
      localCount: 5,
      remoteCount: 7,
      conversationId: 'conv-1',
    });
    expect(onReconciled).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      action: 'full-reload',
    });

    reconciler.destroy();
  });

  it('mismatch followed by match resets counter', async () => {
    const onDriftDetected = vi.fn();
    const onReconciled = vi.fn();

    const reconciler = createDriftReconciler({ store, onDriftDetected, onReconciled });

    // First: mismatch (local=5, remote=7)
    await reconciler.handleHeartbeat('conv-1', 7);

    // Second: match (local returns 7 now, remote=7)
    store.countMessages.mockResolvedValue(7);
    await reconciler.handleHeartbeat('conv-1', 7);

    // Third: mismatch again (local=7, remote=9)
    const result = await reconciler.handleHeartbeat('conv-1', 9);
    expect(result).toBe(false); // first mismatch, not second

    expect(onDriftDetected).not.toHaveBeenCalled();
    expect(onReconciled).not.toHaveBeenCalled();

    reconciler.destroy();
  });

  it('different conversation ID resets mismatch counter', async () => {
    const onDriftDetected = vi.fn();
    const onReconciled = vi.fn();

    const reconciler = createDriftReconciler({ store, onDriftDetected, onReconciled });

    // Mismatch on convA
    await reconciler.handleHeartbeat('conv-a', 7);

    // Mismatch on convB -- different conversation, counter resets
    const result = await reconciler.handleHeartbeat('conv-b', 7);
    expect(result).toBe(false);

    expect(onDriftDetected).not.toHaveBeenCalled();
    expect(onReconciled).not.toHaveBeenCalled();

    reconciler.destroy();
  });

  it('works with zero callbacks', async () => {
    const reconciler = createDriftReconciler({ store });

    await reconciler.handleHeartbeat('conv-1', 7);
    // Should not throw even with no callbacks
    await reconciler.handleHeartbeat('conv-1', 7);

    reconciler.destroy();
  });

  it('destroy clears internal state', async () => {
    const onDriftDetected = vi.fn();
    const onReconciled = vi.fn();

    const reconciler = createDriftReconciler({ store, onDriftDetected, onReconciled });

    // First mismatch
    await reconciler.handleHeartbeat('conv-1', 7);

    // Destroy resets state
    reconciler.destroy();

    // After destroy, mismatch on same conversation does not trigger (counter was reset)
    const result = await reconciler.handleHeartbeat('conv-1', 7);
    expect(result).toBe(false);
    expect(onDriftDetected).not.toHaveBeenCalled();

    reconciler.destroy();
  });
});
