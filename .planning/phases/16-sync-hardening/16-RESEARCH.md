# Phase 16: Sync Hardening - Research

**Researched:** 2026-02-28
**Domain:** Cross-context sync drift detection and IDB-based reconciliation for BroadcastChannel + localStorage sync bridge
**Confidence:** HIGH

## Summary

Phase 16 adds sync hardening to the existing BroadcastChannel/localStorage sync bridge between glasses and hub contexts. The core insight from the architecture research is that both contexts share the same IndexedDB database on the same origin, so sync drift is purely a presentation-layer problem -- the ground truth in IDB is always consistent. The hardening strategy is: (1) add sequence numbers to detect message loss, (2) add a heartbeat with message count to detect state divergence, and (3) reconcile drift by re-reading from IDB (not by building a complex sync protocol).

The existing codebase already has all the building blocks: `SyncBridge` interface with `postMessage`/`onMessage`/`destroy`, typed `SyncMessage` discriminated union, `ConversationStore` with `getMessages()`, and the `AppEventMap` event bus. Phase 16 adds three new things: a `countMessages()` method on ConversationStore (uses O(1) IDB index count), a `SyncMonitor` that wraps the bridge to track sequence numbers and heartbeat, and a `DriftReconciler` that re-reads IDB and emits reconciliation events.

**Primary recommendation:** Implement SyncMonitor as an observer-wrapper around SyncBridge (intercept postMessage/onMessage without modifying the bridge). Use IDB `index.count(key)` for O(1) message counting. Reconciliation = re-read all messages from IDB via existing `store.getMessages()` and emit a bus event that existing UI code already handles (glasses: `switchToSession`-style reload, hub: `loadLiveConversation`).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| RES-09 | Sync sequence numbering -- add optional seq field to SyncMessage, each context maintains monotonic counter, detect gaps | Add `seq?: number` to SyncMessage union (backward-compatible optional field). SyncMonitor maintains per-context counter and gap detection. See Architecture Pattern 1 (Observer-Wrapper). |
| RES-10 | Sync heartbeat -- send sync:heartbeat every 10s with active conversation message count, detect peer disconnection after 30s silence | New `sync:heartbeat` SyncMessage variant. Uses `countMessages()` (new ConversationStore method using IDB index.count). SyncMonitor manages setInterval timer and last-received timestamp. |
| RES-11 | Drift reconciliation via IDB re-read -- when heartbeat reveals count mismatch, re-read from IDB and re-render | DriftReconciler calls `store.getMessages()` to get fresh data. Emits `sync:reconciled` on bus. UI handlers re-render from IDB data. No complex diff -- full re-read is cheap (scoped to one conversation). |
| RES-12 | IDB-as-truth sync design -- all sync hardening must work without BroadcastChannel, BC is optional "hurry up" notification | Design validates: countMessages reads IDB directly, reconciliation reads IDB directly. BC heartbeat is the trigger but IDB is the authority. If BC is unavailable, heartbeat doesn't fire, but no data inconsistency results (both contexts write to same IDB). |
| RES-20 | New AppEventMap events (sync events only) -- add sync:drift-detected, sync:reconciled | Two new event types added to AppEventMap. Both are additive (no breaking changes). sync:drift-detected carries localCount/remoteCount/conversationId. sync:reconciled carries action and conversationId. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native IndexedDB | Browser built-in | IDB `index.count(key)` for O(1) message counting, `index.getAll(key)` for message re-read | Already used throughout codebase. count() on the existing `by-conversation` index is O(1) -- no cursor scan needed. |
| BroadcastChannel | Browser built-in | Primary transport for heartbeat messages | Already used by existing SyncBridge. Heartbeat adds one more message type. |
| setInterval/clearInterval | Browser built-in | 10-second heartbeat timer | Standard timer API. No external scheduler needed for a simple periodic task. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| fake-indexeddb | ^6.2.5 (installed) | Testing countMessages and reconciliation with real IDB transactions | All unit tests that touch IDB operations |
| Vitest | ^3.0 (installed) | Test runner for sync-monitor and drift-reconciler tests | `vitest run` for all tests |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| IDB index.count() | getAll().length | count() is O(1) on the index vs O(n) deserialization. Use count(). |
| Full message re-read on drift | Diffing protocol (send missing message IDs) | Re-reading one conversation is <1ms for typical sizes. Complex diffing adds code for negligible performance gain. Use full re-read per Pitfall P6 guidance. |
| setInterval heartbeat | requestIdleCallback | requestIdleCallback timing is unpredictable. setInterval is fine for 10s cadence on a non-performance-critical periodic check. |
| Separate SyncMonitor module | Inline monitoring in SyncBridge | SyncBridge is unchanged (follows Open/Closed principle). SyncMonitor wraps it as observer. Easier to test, no risk of breaking existing sync. |

**Installation:**
```bash
# No new packages needed. Zero new dependencies.
```

## Architecture Patterns

### Recommended Project Structure

```
src/
  sync/
    sync-bridge.ts          # UNCHANGED -- existing BroadcastChannel/localStorage bridge
    sync-types.ts           # MODIFIED -- add seq field, heartbeat variant, SyncMonitor/DriftReconciler interfaces
    sync-monitor.ts         # NEW -- observer-wrapper for sequence tracking + heartbeat
    drift-reconciler.ts     # NEW -- IDB-based drift detection and re-read reconciliation
  persistence/
    conversation-store.ts   # MODIFIED -- add countMessages() method
    types.ts                # MODIFIED -- add countMessages() to ConversationStore interface
  types.ts                  # MODIFIED -- add sync:drift-detected and sync:reconciled to AppEventMap
  glasses-main.ts           # MODIFIED -- create SyncMonitor, wire DriftReconciler, start heartbeat
  hub-main.ts               # MODIFIED -- create SyncMonitor, wire DriftReconciler, start heartbeat
  __tests__/
    sync-monitor.test.ts    # NEW -- sequence gap detection, heartbeat timing, stats
    drift-reconciler.test.ts # NEW -- drift detection via count mismatch, reconciliation re-read
```

### Pattern 1: Observer-Wrapper for SyncMonitor

**What:** SyncMonitor wraps an existing SyncBridge to observe message traffic without modifying the bridge itself. It intercepts `postMessage` to attach sequence numbers and `onMessage` to track received sequences.

**When to use:** When you need to add monitoring to an existing interface without changing its contract.

**Example:**
```typescript
// sync-monitor.ts
export function createSyncMonitor(opts: {
  bridge: SyncBridge;
  store: ConversationStore;
  bus: EventBus<AppEventMap>;
  origin: SyncOrigin;
  getActiveConversationId: () => string;
}): SyncMonitor {
  const { bridge, store, bus, origin, getActiveConversationId } = opts;
  let localSeq = 0;
  let lastRemoteSeq = -1;
  let lastReceivedAt = 0;
  let sequenceGaps = 0;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // Wrap postMessage to attach sequence number
  function send(msg: SyncMessage): void {
    localSeq++;
    bridge.postMessage({ ...msg, seq: localSeq });
  }

  // Subscribe to incoming messages for tracking
  const unsub = bridge.onMessage((msg) => {
    if (msg.origin === origin) return; // own echoes filtered upstream
    lastReceivedAt = Date.now();
    if (msg.seq !== undefined) {
      if (lastRemoteSeq >= 0 && msg.seq > lastRemoteSeq + 1) {
        sequenceGaps += (msg.seq - lastRemoteSeq - 1);
      }
      lastRemoteSeq = msg.seq;
    }
  });

  // ...heartbeat and stats logic
}
```

### Pattern 2: IDB-as-Truth Reconciliation

**What:** When drift is detected (message count mismatch between heartbeat and local count), reconciliation re-reads all messages from IDB using the existing `store.getMessages()` method. The UI layer re-renders from the fresh data.

**When to use:** When both contexts share the same database and presentation drift is the only problem.

**Example:**
```typescript
// drift-reconciler.ts
export function createDriftReconciler(opts: {
  store: ConversationStore;
  bus: EventBus<AppEventMap>;
  origin: SyncOrigin;
}): DriftReconciler {
  const { store, bus, origin } = opts;

  async function detectAndReconcile(
    conversationId: string,
    remoteCount: number,
  ): Promise<boolean> {
    const localCount = await store.countMessages(conversationId);
    if (localCount === remoteCount) return false;

    bus.emit('sync:drift-detected', {
      localCount,
      remoteCount,
      conversationId,
    });

    // Re-read from IDB (the single source of truth)
    bus.emit('sync:reconciled', {
      conversationId,
      action: 'full-reload' as const,
    });

    return true;
  }

  // ...
}
```

### Pattern 3: Heartbeat with Periodic IDB Count

**What:** Every 10 seconds, each context counts messages in the active conversation via `store.countMessages()` and broadcasts the count via `sync:heartbeat` message.

**When to use:** To detect drift between contexts that share the same database.

**Example:**
```typescript
// Inside SyncMonitor
function startHeartbeat(): void {
  heartbeatTimer = setInterval(async () => {
    const conversationId = getActiveConversationId();
    if (!conversationId) return;
    const messageCount = await store.countMessages(conversationId);
    send({
      type: 'sync:heartbeat',
      origin,
      conversationId,
      messageCount,
    });
  }, 10_000);
}
```

### Anti-Patterns to Avoid

- **Building an ACK protocol:** ACK-based delivery adds round-trip latency to every sync message. Since both contexts share IDB, lost sync messages don't cause data loss -- only stale DOM. The 10s heartbeat comparison is sufficient. (Source: ARCHITECTURE.md research)
- **Hub writing messages received via sync to IDB:** The single-writer-per-origin pattern (glasses write voice messages, hub writes text messages) must be preserved. If both contexts write, duplicate messages with different UUIDs appear. (Source: Pitfall P6)
- **Polling IDB for changes:** IDB has no change notification API. Polling wastes battery and CPU. Trust the event bus for normal flow; heartbeat catches any missed events. (Source: ARCHITECTURE.md anti-pattern)
- **Complex message diffing:** Sending lists of message IDs to find missing ones adds protocol complexity. Re-reading one conversation from IDB is <1ms typical. Full re-read is cheaper than diff logic.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Message counting | Cursor scan counting all messages | `IDBIndex.count(key)` on `by-conversation` index | O(1) vs O(n). The index already exists. Browser engines optimize count() to a B-tree lookup. |
| Message diffing for reconciliation | Send-receive of message ID sets, compute missing | `store.getMessages(conversationId)` + full re-render | One conversation typically has <100 messages. Full re-read is <1ms. Diffing is engineering overhead for zero user benefit. |
| Sync delivery guarantees | ACK/NACK protocol, retry queues, message deduplication | Heartbeat comparison every 10s + IDB re-read on mismatch | IDB is shared. Both contexts always have the same ground truth. BC is just a "hurry up" notification. |
| Sequence number persistence | Save seq counters to localStorage | In-memory counters, reset on boot | Sequence gaps are only meaningful within a session. Boot resets both contexts anyway. |

**Key insight:** The shared IDB database eliminates the hardest problems in distributed sync (conflict resolution, ordering guarantees, delivery semantics). All we need is drift detection and a trigger to re-read from the single source of truth.

## Common Pitfalls

### Pitfall 1: Reconciliation Creates Duplicate Messages (Pitfall P6)

**What goes wrong:** Drift reconciliation causes both contexts to write the same logical message to IDB, creating duplicates with different UUIDs.
**Why it happens:** The single-writer pattern (glasses write voice, hub writes text) gets broken by a "resilience improvement" where the non-author context also saves incoming sync messages.
**How to avoid:** Reconciliation ONLY re-reads and re-renders. It never writes to IDB. The DriftReconciler emits `sync:reconciled` with `action: 'full-reload'` -- the UI layer (existing `switchToSession` / `loadLiveConversation`) handles re-rendering from IDB data.
**Warning signs:** Message count in IDB higher than expected. Same message appears twice in conversation view.

### Pitfall 2: Heartbeat Timer Leaks on Context Teardown

**What goes wrong:** The 10-second setInterval for heartbeat is not cleaned up when glasses WebView closes or hub tab unloads. The timer fires on a destroyed context, causing errors.
**Why it happens:** SyncMonitor.destroy() is not called during the cleanup sequence, or it is called but does not clear the interval.
**How to avoid:** SyncMonitor.destroy() must call clearInterval(heartbeatTimer). Wire SyncMonitor destruction into the existing cleanup sequence in glasses-main.ts (before syncBridge.destroy) and hub-main.ts (beforeunload handler).
**Warning signs:** Console errors after WebView closes. Timer callbacks running on destroyed state.

### Pitfall 3: Sequence Numbers Reset on Boot Causing False Gap Detection

**What goes wrong:** One context reboots (e.g., glasses WebView reloads) and its sequence counter resets to 0. The other context (hub) sees the new seq=1 after previously seeing seq=50 and interprets the gap as 49 lost messages.
**How to avoid:** When receiving a sequence number that is LOWER than the last received, reset the tracking state. This indicates a peer reboot, not message loss. Reset `lastRemoteSeq` to the new value without incrementing `sequenceGaps`.
**Warning signs:** sync:drift-detected fires immediately after one context reboots. Large sequenceGaps count after WebView reload.

### Pitfall 4: Heartbeat Fires During Streaming, Triggers Reconciliation Mid-Response

**What goes wrong:** Glasses are streaming a response (pendingAssistantText accumulating). Heartbeat fires, counts messages in IDB. The hub has already received the heartbeat count. But glasses haven't saved the response yet (it saves on response_end). Hub sees count mismatch and triggers reconciliation, clearing the streaming state.
**How to avoid:** Skip heartbeat comparison when streaming is in progress. The SyncMonitor should accept an `isStreaming` callback or check a streaming flag. Alternatively, add a cooldown: only trigger reconciliation if count mismatch persists across 2 consecutive heartbeats (20s window), which gives streaming time to complete.
**Warning signs:** Streaming responses interrupted by reconciliation. User sees partial response disappear and reappear.

### Pitfall 5: BroadcastChannel Not Available in flutter_inappwebview

**What goes wrong:** On real Even G2 hardware, BroadcastChannel may not be supported in flutter_inappwebview. The heartbeat never fires. The SyncMonitor reports peer as disconnected permanently.
**How to avoid:** The existing SyncBridge already falls back to localStorage. SyncMonitor must work with both transports. `isAlive()` should only be meaningful when at least one heartbeat has been received (don't report "disconnected" when no heartbeat was ever expected). The `transportType` stat should reflect which transport is in use.
**Warning signs:** `isAlive()` returns false on real device even though both contexts are running. Heartbeat messages sent via localStorage storage events.

## Code Examples

### countMessages() Implementation (ConversationStore Extension)

```typescript
// conversation-store.ts -- new method added to factory return
function countMessages(conversationId: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('messages', 'readonly');
    const index = tx.objectStore('messages').index('by-conversation');
    const req = index.count(IDBKeyRange.only(conversationId));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
```

**Why this works:** The `by-conversation` index already exists (created in db.ts schema). `IDBIndex.count(key)` returns the number of records with that key value. This is O(1) on the B-tree index -- no cursor scan, no deserialization. Confirmed in MDN docs: "The count() method of the IDBIndex interface returns an IDBRequest object, and in a separate thread, returns the number of records within a key range."

### SyncMessage Type Extension

```typescript
// sync-types.ts -- additions
export type SyncMessage =
  // ... existing variants unchanged ...
  | { type: 'sync:heartbeat'; origin: SyncOrigin; seq?: number;
      messageCount: number; conversationId: string };

// seq field is optional on ALL existing variants (backward-compatible)
// The actual runtime type has seq added by SyncMonitor.send()
```

### AppEventMap Sync Events

```typescript
// types.ts -- additions to AppEventMap
'sync:drift-detected': {
  localCount: number;
  remoteCount: number;
  conversationId: string;
};
'sync:reconciled': {
  conversationId: string;
  action: 'full-reload';
};
```

### Boot Wiring (Glasses Context)

```typescript
// glasses-main.ts -- additions after syncBridge creation
const syncMonitor = createSyncMonitor({
  bridge: syncBridge,
  store,
  bus,
  origin: 'glasses',
  getActiveConversationId: () => activeConversationId,
});

const driftReconciler = createDriftReconciler({
  store,
  bus,
  origin: 'glasses',
});

// Wire heartbeat response: when drift is detected, re-render
bus.on('sync:drift-detected', async ({ conversationId }) => {
  if (conversationId === activeConversationId) {
    // Re-read from IDB and re-render (same as switchToSession reload logic)
    renderer.destroy();
    await renderer.init();
    const messages = await store.getMessages(conversationId);
    for (const msg of messages) {
      if (msg.role === 'user') renderer.addUserMessage(msg.text);
      else {
        renderer.startStreaming();
        renderer.appendStreamChunk(msg.text);
        renderer.endStreaming();
      }
    }
  }
});

// Start heartbeat after boot is complete
syncMonitor.startHeartbeat();

// Cleanup: add syncMonitor.destroy() BEFORE syncBridge.destroy()
```

### Boot Wiring (Hub Context)

```typescript
// hub-main.ts -- additions in initPersistence()
const syncMonitor = createSyncMonitor({
  bridge: syncBridge,
  store: conversationStore,
  bus: null, // hub has no event bus (uses console)
  origin: 'hub',
  getActiveConversationId: () => mgr.getActiveSessionId() ?? '',
});

const driftReconciler = createDriftReconciler({
  store: conversationStore,
  bus: null,
  origin: 'hub',
});

// Wire: on sync:drift-detected, call loadLiveConversation()
// (loadLiveConversation already re-reads all messages from IDB)

syncMonitor.startHeartbeat();

// Return syncMonitor with persistence result for cleanup
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ACK-based sync protocols for cross-tab communication | Shared-storage-as-truth with event notification | Standard since SharedWorker/BroadcastChannel standardization | Eliminates need for complex delivery guarantees when storage is shared |
| BroadcastChannel only | BroadcastChannel + localStorage fallback | Already implemented in codebase | Works across all browser environments including restricted WebViews |

**Deprecated/outdated:**
- None relevant. The browser APIs used (IndexedDB, BroadcastChannel, localStorage) are all stable and current.

## Open Questions

1. **Hub EventBus**
   - What we know: The hub context does not use the `EventBus<AppEventMap>` pattern -- it uses module-level functions and console.log directly. Glasses use the event bus extensively.
   - What's unclear: Should DriftReconciler for hub context emit bus events (requires creating a hub bus), or use a callback pattern?
   - Recommendation: Use a callback pattern for hub (`onDriftDetected: () => loadLiveConversation()`). Creating a hub event bus is a larger refactor that is out of scope for Phase 16. SyncMonitor/DriftReconciler should accept optional bus (or callback) to work in both contexts.

2. **Heartbeat During Streaming**
   - What we know: During streaming, message count in IDB may be temporarily lower than expected (response not yet saved). A heartbeat during this window would report a count mismatch.
   - What's unclear: Exact timing -- how often does this cause false positives in practice?
   - Recommendation: Use "2 consecutive mismatch" rule: only trigger reconciliation if the count mismatch persists across 2 consecutive heartbeats (20s). Streaming typically completes within 10-15s, so one heartbeat mismatch during streaming is ignored.

3. **SyncMonitor.send() vs Direct Bridge Usage**
   - What we know: Currently, auto-save.ts and sessions.ts call `syncBridge.postMessage()` directly. SyncMonitor wraps the bridge to add seq numbers.
   - What's unclear: Should all existing callers switch to `syncMonitor.send()`, or should SyncMonitor intercept at the bridge level?
   - Recommendation: SyncMonitor should intercept at the bridge level by wrapping postMessage. This way existing callers don't need to change. SyncMonitor returns a wrapped SyncBridge that is used in place of the raw bridge during boot wiring. The wrapper delegates to the real bridge with seq attached.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/sync/sync-bridge.ts`, `src/sync/sync-types.ts`, `src/persistence/conversation-store.ts`, `src/persistence/db.ts` (line-by-line review)
- `.planning/research/ARCHITECTURE.md` -- SyncMonitor and DriftReconciler designs, boot wiring plans
- `.planning/research/PITFALLS.md` -- Pitfall P3 (BroadcastChannel in flutter_inappwebview), Pitfall P6 (reconciliation creates duplicates)
- MDN: IDBIndex.count() -- "returns the number of records within a key range" (O(1) on index)

### Secondary (MEDIUM confidence)
- `.planning/research/STACK.md` -- confirms zero new runtime dependencies, existing test infrastructure
- IndexedDB specification (W3C) -- count() on index is efficient per spec, but actual performance is implementation-dependent (Chrome/WebKit both use B-tree indexes)

### Tertiary (LOW confidence)
- None. All findings verified against codebase source code and research documents.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies, all browser built-ins already used in codebase
- Architecture: HIGH -- ARCHITECTURE.md research provides detailed SyncMonitor/DriftReconciler design, verified against current source code
- Pitfalls: HIGH -- P3 and P6 directly relevant, verified against codebase patterns and documented in PITFALLS.md

**Research date:** 2026-02-28
**Valid until:** 2026-03-30 (stable browser APIs, no fast-moving dependencies)
