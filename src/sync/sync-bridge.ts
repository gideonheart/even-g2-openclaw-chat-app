// ── Sync bridge ────────────────────────────────────────────
// Cross-context message passing with BroadcastChannel primary
// and localStorage fallback.

import type { SyncBridge, SyncOrigin } from './sync-types';

export function createSyncBridge(_origin?: SyncOrigin): SyncBridge {
  throw new Error('Not implemented');
}
