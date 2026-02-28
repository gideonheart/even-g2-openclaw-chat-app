// ── Drift reconciler ───────────────────────────────────────
// Detects message count mismatch between local IDB and remote heartbeat.
// Uses 2-consecutive-mismatch rule to avoid false positives during streaming.
// Callback pattern (not bus) for portability across glasses and hub contexts.

import type { DriftReconciler } from './sync-types';

export function createDriftReconciler(opts: {
  store: { countMessages(conversationId: string): Promise<number> };
  onDriftDetected?: (info: { localCount: number; remoteCount: number; conversationId: string }) => void;
  onReconciled?: (info: { conversationId: string; action: 'full-reload' }) => void;
}): DriftReconciler {
  const { store, onDriftDetected, onReconciled } = opts;

  let consecutiveMismatches = 0;
  let lastMismatchConvId = '';

  async function handleHeartbeat(conversationId: string, remoteCount: number): Promise<boolean> {
    const localCount = await store.countMessages(conversationId);

    if (localCount === remoteCount) {
      consecutiveMismatches = 0;
      return false;
    }

    // Conversation changed -- reset counter
    if (conversationId !== lastMismatchConvId) {
      consecutiveMismatches = 0;
      lastMismatchConvId = conversationId;
    }

    consecutiveMismatches += 1;

    if (consecutiveMismatches >= 2) {
      if (onDriftDetected) {
        onDriftDetected({ localCount, remoteCount, conversationId });
      }
      if (onReconciled) {
        onReconciled({ conversationId, action: 'full-reload' });
      }
      consecutiveMismatches = 0;
      return true;
    }

    return false;
  }

  function destroy(): void {
    consecutiveMismatches = 0;
    lastMismatchConvId = '';
  }

  return { handleHeartbeat, destroy };
}
