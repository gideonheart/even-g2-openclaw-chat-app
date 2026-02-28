# Architecture Research: v1.3 Resilience & Error UX Integration

**Domain:** Resilience hardening (write verification, orphan detection, integrity checks, sync drift detection, error propagation, error UX) integrated into existing Even G2 OpenClaw Chat App
**Researched:** 2026-02-28
**Confidence:** HIGH (based on line-by-line source analysis of all 60 source files, full understanding of existing module boundaries, event flow, and boot sequence)

---

## Existing Error Surface Analysis

Before designing resilience architecture, every existing failure mode must be catalogued. The v1.2 codebase has seven distinct failure surfaces:

| # | Failure Surface | Current Code Location | Current Behavior | Consequence |
|---|----------------|----------------------|-----------------|-------------|
| 1 | IndexedDB write (addMessage) | `auto-save.ts` line 36-52: `saveWithRetry()` with MAX_RETRIES=3 | Retries 3x with 500ms backoff, emits `persistence:warning` on final failure | Messages silently lost. User sees "Messages may not be saved" once, then never again (`warningShown` guard in `glasses-main.ts` line 218-223) |
| 2 | IndexedDB read (boot-restore) | `boot-restore.ts` line 75: catch-all returns empty result | Creates new conversation with random UUID, sets `error` field | User sees "Previous conversation couldn't be restored" for 2s, then boots clean. Old data is unreachable but still in IDB |
| 3 | BroadcastChannel delivery | `sync-bridge.ts` line 25-27: `postMessage()` is fire-and-forget | No ACK, no sequence tracking, no retry | Hub and glasses DOM state drift apart silently. Both still write to same IDB, so ground truth is fine, but display diverges |
| 4 | SSE mid-stream failure | `gateway-client.ts` line 213-244: `handleTurnError()` | Emits error chunk, which auto-save discards pending text (line 153-163) and FSM resets (gesture-handler.ts line 127-131) | Partial assistant response is lost. User gets error message via `renderer.showError()` but no recovery option |
| 5 | Cascade delete failure | `session-store.ts` line 22-44: cursor-based delete in single tx | If WebView closes mid-transaction, tx rolls back (IDB guarantees atomicity) | No orphans from partial deletes. But if the conversation record is manually deleted outside the app, messages become orphaned |
| 6 | Session pointer (localStorage) | `boot-restore.ts` line 44-47: reads `ACTIVE_CONVERSATION_KEY` | Points to conversation ID. If conversation was deleted by other context, `getConversation` returns undefined | Falls through to `getLastConversation()` (line 51), which works. But wastes one IDB read. Not truly broken, just wasteful |
| 7 | Hub persistence silent failure | `hub-main.ts` line 823: `.catch(() => {})` on addMessage | Silent swallow of save errors | Hub user thinks message is persisted, but it may not be. No `persistence:warning` emitted on hub side |

**Key insight:** The existing architecture is fundamentally sound because IDB transaction atomicity prevents data corruption. The real problems are (a) silent data loss when writes fail without user notification, (b) DOM/display drift when sync messages are lost, and (c) no proactive detection of accumulated problems (orphans, dangling pointers, quota pressure).

**Key architectural advantage:** Both glasses and hub contexts share the same IDB database (same origin). This means sync drift is purely a presentation-layer problem -- the ground truth in IDB is always consistent. Resilience features wrap existing operations, not replace them.

---

## System Overview: v1.3 Resilience Integration Map

```
+-------------------------------------------------------------------------+
|                    EXISTING LAYERS (Unchanged)                          |
|  L0: EventBus + Settings                                               |
|  L1: Bridge (SDK/Mock)                                                  |
|  L2: AudioCapture + PCM wiring                                          |
|  L3: GestureHandler + FSM                                               |
|  L4: DisplayController + GlassesRenderer                                |
|  L5: GatewayClient + VoiceLoopController                                |
+-------------------------------------------------------------------------+
|                                                                         |
|  MODIFIED: Persistence Layer                                            |
|  +------------------------+   +--------------------+                    |
|  | ConversationStore      |   | SessionStore       |                    |
|  |  + verifyMessage()     |   |  (unchanged)       |                    |
|  |  + countMessages()     |   +--------------------+                    |
|  |  + getOrphanMessages() |                                             |
|  +------------------------+                                             |
|                                                                         |
|  MODIFIED: Auto-save + Boot                                             |
|  +------------------------+   +--------------------+                    |
|  | AutoSave               |   | boot-restore       |                    |
|  |  + verify first write  |   |  + integrity param |                    |
|  |  + error escalation    |   |  + pointer validate |                   |
|  +------------------------+   +--------------------+                    |
|                                                                         |
|  NEW: Integrity Layer                                                   |
|  +------------------------+   +--------------------+                    |
|  | IntegrityChecker       |   | StorageHealth      |                    |
|  |  check() -> report     |   |  getQuota()        |                    |
|  |  repairOrphans(ids)    |   |  requestPersist()  |                    |
|  +------------------------+   +--------------------+                    |
|                                                                         |
|  NEW: Sync Hardening Layer                                              |
|  +------------------------+   +--------------------+                    |
|  | SyncMonitor            |   | DriftReconciler    |                    |
|  |  trackSend/Receive     |   |  detectDrift()     |                    |
|  |  getStats()            |   |  reconcile()       |                    |
|  |  isAlive(timeout)      |   |  (re-reads from    |                   |
|  +------------------------+   |   IDB, not CRDT)   |                    |
|                               +--------------------+                    |
|                                                                         |
|  NEW: Error UX Layer                                                    |
|  +------------------------+   +--------------------+                    |
|  | ErrorPresenter         |   | HealthIndicator    |                    |
|  |  glasses: hint bar     |   |  computeHealth()   |                    |
|  |  hub: toast + banner   |   |  (pure function)   |                    |
|  +------------------------+   +--------------------+                    |
+-------------------------------------------------------------------------+
```

---

## Component Boundaries: New vs Modified

### New Components (6 modules)

| Component | File | Responsibility | Pattern | Dependencies |
|-----------|------|---------------|---------|--------------|
| IntegrityChecker | `persistence/integrity-checker.ts` | Referential integrity validation + orphan detection/cleanup | Factory/closure, side-effect (IDB) | IDBDatabase |
| StorageHealth | `persistence/storage-health.ts` | Quota monitoring, eviction detection, persistence requests | Factory/closure, side-effect (Storage API) | None (browser APIs only) |
| SyncMonitor | `sync/sync-monitor.ts` | Track message delivery, detect loss via sequence numbers | Factory/closure, mixed | SyncBridge |
| DriftReconciler | `sync/drift-reconciler.ts` | Detect state divergence via message count, full-sync recovery | Factory/closure, side-effect | ConversationStore, SyncBridge, EventBus |
| ErrorPresenter | `errors/error-presenter.ts` | Map error events to user-visible feedback per context | Factory/closure, side-effect (DOM/renderer) | EventBus, GlassesRenderer (glasses) or DOM callbacks (hub) |
| HealthIndicator | `errors/health-indicator.ts` | Aggregate health from storage/sync/gateway into status model | Pure function (no closure state needed) | None (receives data as args) |

### Modified Components (6 modules)

| Component | File | What Changes | Backward Compatible |
|-----------|------|-------------|-------------------|
| ConversationStore | `persistence/conversation-store.ts` | Add `verifyMessage()`, `getOrphanMessages()`, `countMessages()` to factory return | YES -- additive only, no existing method signatures change |
| ConversationStore interface | `persistence/types.ts` | Add 3 new methods to `ConversationStore` interface | YES -- additive union extension |
| AutoSave | `persistence/auto-save.ts` | Verify first write, escalate errors to `persistence:error` | YES -- existing save flow preserved, new behavior opt-in via `verifyFirstWrite` option |
| boot-restore | `persistence/boot-restore.ts` | Accept optional `IntegrityReport`, use it to skip dangling pointer | YES -- new param is optional |
| AppEventMap | `types.ts` | Add 4 new event types for resilience | YES -- additive to existing union |
| SyncMessage | `sync/sync-types.ts` | Add `sync:heartbeat` variant, optional `seq` field on all variants | YES -- optional field, new variant |

### Unchanged Components

EventBus, SyncBridge, SessionStore, SessionManager, GatewayClient, VoiceLoopController, GestureFSM, GestureHandler, Viewport, GlassesRenderer, DisplayController, MenuController, AudioCapture, BridgeMock, EvenBridge, IconAnimator, CommandMenu, Settings, Logs, Utils.

These modules already emit the events and expose the interfaces needed. Resilience features observe and wrap them.

---

## Detailed Component Design

### 1. IntegrityChecker (`persistence/integrity-checker.ts`)

**Purpose:** Detect and repair referential integrity violations in IndexedDB.

**Integration point:** Called from `boot-restore.ts` during the existing restore flow, after `openDB()` succeeds but before `restoreOrCreateConversation()` runs.

```typescript
export interface IntegrityReport {
  orphanMessageIds: string[];       // Messages whose conversationId has no matching conversation
  danglingPointer: boolean;         // localStorage active session points to non-existent conversation
  conversationCount: number;
  messageCount: number;
  checkedAt: number;
}

export interface IntegrityChecker {
  /** Read-only scan. Does not modify data. */
  check(): Promise<IntegrityReport>;
  /** Delete orphan messages by ID. Returns count deleted. */
  repairOrphans(orphanIds: string[]): Promise<number>;
}

export function createIntegrityChecker(db: IDBDatabase): IntegrityChecker;
```

**Implementation approach:**

1. `check()` opens a single read-only transaction across both `conversations` and `messages` object stores.
2. Loads all conversation keys into a `Set<string>`.
3. Iterates all messages via cursor, checking if `conversationId` exists in the set.
4. Reads `localStorage.getItem('openclaw-active-conversation')` and checks against conversation set.
5. Returns report without modifying anything.

`repairOrphans()` opens a read-write transaction and deletes messages by ID using `store.delete(id)`.

**Why separate check/repair:**
- Read-only detection is safe to run every boot with zero risk
- Repair requires explicit opt-in to avoid accidental data deletion
- Report object is consumed by boot-restore (dangling pointer) and health UI (orphan count)
- Makes testing deterministic: inject known orphans, assert detection, then test repair separately

**Boot latency:** Single transaction, two `getAllKeys()` calls + one cursor scan. At typical data sizes (< 1000 messages), completes in < 10ms. Runs during the existing "Connecting..." splash.

### 2. StorageHealth (`persistence/storage-health.ts`)

**Purpose:** Monitor IndexedDB storage quota and eviction risk. Request persistent storage.

**Integration point:** Called during boot after IntegrityChecker, and on-demand from hub health page.

```typescript
export interface StorageQuota {
  usageBytes: number;
  quotaBytes: number;
  percentUsed: number;
  isPersisted: boolean;
  isAvailable: boolean;       // false if Storage API is unavailable
}

export interface StorageHealthService {
  getQuota(): Promise<StorageQuota>;
  requestPersistence(): Promise<boolean>;
}

export function createStorageHealth(): StorageHealthService;
```

**Implementation:**
- `getQuota()` uses `navigator.storage.estimate()` + `navigator.storage.persisted()`.
- Falls back to `{ isAvailable: false }` when Storage API is unavailable (flutter_inappwebview may not expose it).
- `requestPersistence()` calls `navigator.storage.persist()`. WebKit grants persistence automatically for installed web apps; Android requires user gesture or has heuristics based on engagement.

**Why this exists:** IndexedDB eviction is the most catastrophic silent failure. On iOS Safari, "best effort" storage can be evicted after 7 days of inactivity. Requesting persistent storage is the only browser-native protection. Quota monitoring enables proactive warnings before eviction pressure triggers data loss.

### 3. ConversationStore Extensions

**Purpose:** Add verification and counting capabilities to the existing store.

**Integration point:** Three new methods added to the factory return in `conversation-store.ts`. Three new method signatures added to `ConversationStore` interface in `persistence/types.ts`.

```typescript
// Added to ConversationStore interface:
verifyMessage(messageId: string): Promise<boolean>;
countMessages(conversationId: string): Promise<number>;
getOrphanMessages(): Promise<string[]>;
```

**Critical design decision -- why verification is a separate method, not inline in `addMessage()`:**

The existing `addMessage()` (line 169-196) uses a single IDB transaction that writes both the message and updates the conversation's `updatedAt`. The transaction's `oncomplete` handler already provides the IDB guarantee that the write is durable. Adding a read-back inside the same transaction is redundant.

Instead, `verifyMessage()` is a separate read-only transaction. Its purpose is to detect a different failure class: when `addMessage` resolved successfully (oncomplete fired) but the data was subsequently evicted or corrupted. This catches:
- Storage eviction between oncomplete and verify
- IDB corruption (extremely rare but devastating)
- Browser bugs where oncomplete fires prematurely

**When to verify:** Only the first message in each conversation session. This confirms storage is working at the start. Subsequent saves skip verification for performance.

### 4. Auto-Save Resilience Enhancement

**Purpose:** Upgrade fire-and-forget saves with verification and escalating error feedback.

**Integration point:** Modifies `persistence/auto-save.ts`. The existing `saveWithRetry()` gets enhanced error reporting.

**Changes to existing code:**

1. New optional `verifyFirstWrite` field in `AutoSaveOptions` (default: `true`).
2. After the first successful `addMessage()`, call `store.verifyMessage(id)`. If verify fails, emit `persistence:error` with `{ type: 'verify-failed', recoverable: false }`.
3. On final retry exhaustion, emit `persistence:error` instead of `persistence:warning`.

**Error escalation model:**

```
Save attempt 1 fails -> retry (existing behavior, silent)
Save attempt 2 fails -> retry (existing behavior, silent)
Save attempt 3 fails -> retry (existing behavior, silent)
Save attempt 4 fails -> emit 'persistence:error' { type: 'write-failed', recoverable: false }

First write verify fails -> emit 'persistence:error' { type: 'verify-failed', recoverable: false }
                          -> skip verification for rest of session (storage is suspect)
```

**Fix for hub persistence silence (Error Surface #7):** The hub's `handleHubChunk` and `handleTextSubmit` in `hub-main.ts` currently swallow save errors silently. The enhanced auto-save pattern should be reused in hub context, or at minimum, hub should emit `persistence:warning` on its `.catch()` paths.

### 5. New Event Types (AppEventMap)

```typescript
// Added to AppEventMap in types.ts:

'persistence:error': {
  type: 'write-failed' | 'verify-failed' | 'integrity-violation' | 'quota-warning';
  message: string;
  conversationId?: string;
  recoverable: boolean;
};

'sync:drift-detected': {
  localCount: number;
  remoteCount: number;
  conversationId: string;
};

'sync:reconciled': {
  conversationId: string;
  action: 'full-reload' | 'noop';
};

'health:status-change': {
  component: 'storage' | 'sync' | 'gateway';
  status: 'ok' | 'degraded' | 'error';
  detail: string;
};
```

All additive. Existing event subscribers are unaffected.

### 6. SyncMonitor (`sync/sync-monitor.ts`)

**Purpose:** Track cross-context message delivery and detect message loss.

**Integration point:** Observes SyncBridge traffic without modifying it. Wraps `postMessage` and `onMessage` with tracking.

```typescript
export interface SyncStats {
  messagesSent: number;
  messagesReceived: number;
  lastSentAt: number | null;
  lastReceivedAt: number | null;
  sequenceGaps: number;
  transportType: 'broadcast-channel' | 'localstorage';
}

export interface SyncMonitor {
  trackSend(msg: SyncMessage): void;
  trackReceive(msg: SyncMessage): void;
  getStats(): SyncStats;
  isAlive(timeoutMs: number): boolean;
  destroy(): void;
}

export function createSyncMonitor(bridge: SyncBridge): SyncMonitor;
```

**Sequence numbering approach:**

Add optional `seq?: number` field to all existing SyncMessage variants (backward-compatible). Both contexts maintain a monotonically increasing counter. When a receiver sees a gap (receives seq 5 then seq 8), it increments `sequenceGaps` and knows messages 6-7 were lost.

**New SyncMessage variant -- heartbeat:**

```typescript
| { type: 'sync:heartbeat'; origin: SyncOrigin; seq?: number;
    messageCount: number; conversationId: string }
```

Sent every 10s. Includes total message count for the active conversation. The receiver compares against its own `countMessages()` -- mismatch triggers drift detection.

**Why NOT an ACK protocol:** ACK-based delivery adds round-trip latency to every sync message. Since both contexts share the same IDB, lost sync messages don't cause data loss -- only stale DOM. A 10s heartbeat comparison is sufficient to catch drift within an acceptable window.

**Same-context detection:** In production Even App, glasses and hub run in the same WebView (single JavaScript runtime). BroadcastChannel is only needed for dev-mode (separate browser tabs). SyncMonitor should detect same-context mode (check if `window.__evenGlassesContext` or similar flag is set) and skip heartbeat-based drift detection, since the shared event bus already provides reliable delivery.

### 7. DriftReconciler (`sync/drift-reconciler.ts`)

**Purpose:** When sync drift is detected, reconcile by re-reading from IDB (the single source of truth).

```typescript
export interface DriftReconciler {
  detectDrift(conversationId: string, remoteCount: number): Promise<boolean>;
  reconcile(conversationId: string): Promise<void>;
  destroy(): void;
}

export function createDriftReconciler(opts: {
  store: ConversationStore;
  syncBridge: SyncBridge;
  bus: EventBus<AppEventMap>;
  origin: SyncOrigin;
}): DriftReconciler;
```

**Reconciliation strategy:**

1. Detecting context calls `store.countMessages(conversationId)` and compares with remote count from heartbeat.
2. If counts differ, `reconcile()` re-reads all messages from IDB for the conversation.
3. Emits `sync:reconciled` on the bus with `{ action: 'full-reload' }`.
4. The UI layer (glasses-main's `switchToSession` or hub's `loadLiveConversation`) re-renders from fresh IDB data.

**Why NOT CRDT or vector clocks:**
- Both contexts write to the same IDB instance (same origin) -- there are no true conflicts.
- Messages are append-only (no edits, no out-of-order).
- Session operations are idempotent.
- The actual failure mode is "DOM doesn't reflect IDB" -- solved by re-read, not conflict resolution.

### 8. ErrorPresenter (`errors/error-presenter.ts`)

**Purpose:** Map error events to user-visible feedback appropriate for each context.

**Two factory variants:**

```typescript
// Glasses context -- uses renderer's existing showError() + hint bar
export function createGlassesErrorPresenter(opts: {
  bus: EventBus<AppEventMap>;
  renderer: GlassesRenderer;
}): ErrorPresenter;

// Hub context -- uses toast for transient, banner for persistent
export function createHubErrorPresenter(opts: {
  bus: EventBus<AppEventMap>;
  showToast: (msg: string) => void;
  showBanner: (msg: string, action?: { label: string; handler: () => void }) => void;
  hideBanner: () => void;
}): ErrorPresenter;
```

**Error-to-UX mapping table:**

| Error Event | Glasses Display | Hub Display | Duration |
|------------|----------------|-------------|----------|
| `persistence:error` (write-failed) | `renderer.showError("Save failed")` | Toast: "Message may not be saved" | 3s / 5s |
| `persistence:error` (verify-failed) | `renderer.showError("Storage issue")` | Banner: "Storage issue detected" + "Check" action button | Until dismissed |
| `persistence:error` (quota-warning) | `renderer.showError("Storage full")` | Banner: "Storage 90%+ full" + "Manage" action | Until dismissed |
| `persistence:error` (integrity-violation) | (silent -- auto-repair on glasses) | Banner: "Data repair in progress" | Until repair completes |
| `sync:drift-detected` | (silent -- auto-reconcile) | Toast: "Syncing with glasses..." | 3s |
| `gateway:status` error | Existing: icon state + showError | Toast: "Connection lost" | 5s |
| `health:status-change` | (glasses don't show health) | Health page status dots update | Persistent |

**Design constraints for glasses error UX:**
1. **576x288 display** -- no room for error dialogs. Only the chat container (256px height) or status bar (30px) available.
2. **Gesture-only input** -- no "dismiss" button possible. Auto-clear is mandatory.
3. **Never block voice loop** -- user must always be able to tap-to-talk regardless of errors.
4. **One error at a time** -- `renderer.showError()` appends as assistant-role message. New errors push old ones up via viewport scrolling.
5. **Existing `showError` reuse** -- the renderer already has `showError(message)` (line 284-298) that creates a `[Error] ${message}` chat bubble. This is the right UX for glasses.

### 9. HealthIndicator (`errors/health-indicator.ts`)

**Purpose:** Aggregate health signals into a unified status model for the hub health page.

**This is a pure function, not a service:**

```typescript
export type HealthLevel = 'ok' | 'degraded' | 'error';

export interface SystemHealth {
  storage: { level: HealthLevel; detail: string; quota?: StorageQuota };
  sync: { level: HealthLevel; detail: string; stats?: SyncStats };
  gateway: { level: HealthLevel; detail: string };
  overall: HealthLevel;  // worst of the three
  lastChecked: number;
}

export function computeSystemHealth(opts: {
  storageQuota: StorageQuota | null;
  integrityReport: IntegrityReport | null;
  syncStats: SyncStats | null;
  gatewayHealth: GatewayHealthState;
}): SystemHealth;
```

**Health level logic:**

| Component | OK | Degraded | Error |
|-----------|-----|---------|-------|
| Storage | quota < 80%, no orphans, persisted | quota 80-95%, orphans found, or not persisted | quota > 95%, verify failed, IDB unavailable |
| Sync | Message received in last 30s, no sequence gaps | No message in 30-60s, or gaps detected | No message in > 60s (if glasses should be connected) |
| Gateway | `status === 'connected'`, heartbeat recent | `status === 'connecting'` or reconnecting | `status === 'error'` with max reconnects exhausted |

Overall = worst(storage, sync, gateway).

**Integration with existing health page:** The hub already has `buildHealthViewModel()` in `app-wiring.ts` (line 111-135) that produces `HealthDotState` ('ok' | 'off'). The new `computeSystemHealth` replaces this with a richer model that includes 'degraded'. The existing health page DOM structure (dot + label per row) supports this with an additional CSS class.

---

## Data Flow Changes

### Enhanced Boot Flow (glasses-main.ts)

```
EXISTING:                              WITH v1.3 ADDITIONS:

L0: createEventBus()                   L0: createEventBus()
    loadSettings()                         loadSettings()
    |                                      |
    v                                      v
openDB()                              openDB()
createConversationStore(db)            createConversationStore(db)
createSessionStore(db, store)          createSessionStore(db, store)
    |                                      |
    |                                      v
    |                                  createIntegrityChecker(db)          <-- NEW
    |                                  integrityChecker.check()            <-- NEW
    |                                      |
    |                                      v
    |                                  createStorageHealth()               <-- NEW
    |                                  storageHealth.getQuota()            <-- NEW
    |                                  storageHealth.requestPersistence()  <-- NEW (if not persisted)
    |                                      |
    v                                      v
restoreOrCreateConversation({store})   restoreOrCreateConversation({store, integrityReport})
    |                                      |
    v                                      v
createSyncBridge()                     createSyncBridge()
    |                                      |
    |                                      v
    |                                  createSyncMonitor(syncBridge)       <-- NEW
    |                                  createDriftReconciler(...)          <-- NEW
    |                                      |
    v                                      v
L1: bridge.init()                      L1: bridge.init()
    ...                                    ...
L4: renderer.init()                    L4: renderer.init()
    |                                      |
    |                                      v
    |                                  createGlassesErrorPresenter(...)    <-- NEW (after renderer ready)
    |                                      |
    v                                      v
L5: createGatewayClient()             L5: createGatewayClient()
    createVoiceLoopController()            createVoiceLoopController()
    createAutoSave()                       createAutoSave({verifyFirstWrite: true})
    |                                      |
    |                                      v
    |                                  Start sync heartbeat interval       <-- NEW
    v                                      v
    gateway.checkHealth()                  gateway.checkHealth()
```

**Boot latency impact:** IntegrityChecker.check() takes < 10ms for < 1000 messages. StorageHealth.getQuota() is < 5ms. Total added: < 20ms. This runs during the existing "Connecting..." splash phase which already has ~1s of visible activity.

**Cleanup extension:** The `cleanup()` function in glasses-main.ts (line 248-264) needs to destroy the new modules in reverse order:
```
// Added to cleanup() in reverse init order:
syncMonitor.destroy();      // after syncBridge.destroy()
driftReconciler.destroy();  // after syncMonitor
errorPresenter.destroy();   // after displayController
// IntegrityChecker and StorageHealth have no destroy() -- they're one-shot
```

### Enhanced Hub Boot Flow (hub-main.ts)

The `initPersistence()` function (line 932-986) gains:
- IntegrityChecker run
- StorageHealth check
- SyncMonitor creation
- DriftReconciler creation
- Returns additional objects for health page consumption

The `initHub()` function (line 889-930) gains:
- `createHubErrorPresenter(bus, showToast, showBanner, hideBanner)`
- Health page enhancement with storage/sync/integrity indicators
- Fix for silent hub persistence failures (Error Surface #7)

### Message Save Flow Enhancement

```
EXISTING (auto-save.ts):                    WITH v1.3:

gateway:chunk 'transcript'                  gateway:chunk 'transcript'
    |                                           |
    v                                           v
saveWithRetry(addMessage())                 saveWithRetry(addMessage())
    |                                           |
    +-- success:                                +-- success:
    |     postMessage to sync                   |     |
    |                                           |     +-- if firstMessage && verifyFirstWrite:
    |                                           |     |     verifyMessage(id)
    |                                           |     |       +-- pass: postMessage to sync
    |                                           |     |       +-- fail: emit persistence:error
    |                                           |     |              {type:'verify-failed'}
    |                                           |     +-- else: postMessage to sync
    |                                           |
    +-- fail after retries:                     +-- fail after retries:
          emit persistence:warning                    emit persistence:error          <-- ESCALATED
                                                      {type:'write-failed',
                                                       recoverable:false}
```

### Sync Heartbeat Flow (New)

```
Every 10 seconds (both contexts, if sync bridge active):

SyncMonitor
    |
    +-- store.countMessages(activeConversationId)
    |
    +-- syncBridge.postMessage({ type: 'sync:heartbeat',
    |       origin, seq: nextSeq++, messageCount,
    |       conversationId: activeConversationId })
    |
    +-- (other context receives heartbeat)
          |
          +-- syncMonitor.trackReceive(msg)
          |
          +-- driftReconciler.detectDrift(msg.conversationId, msg.messageCount)
          |
          +-- If drift detected:
                |
                +-- bus.emit('sync:drift-detected', {...})
                |
                +-- driftReconciler.reconcile(conversationId)
                |     (re-reads all messages from IDB)
                |
                +-- bus.emit('sync:reconciled', { action: 'full-reload' })
                |
                +-- UI subscribes to sync:reconciled and re-renders
```

### Error Event Propagation Flow (New)

```
Error originates at:
    persistence:error    --+
    sync:drift-detected  --+--> EventBus
    gateway:status       --+        |
    health:status-change --+        |
                                    v
                            ErrorPresenter.onBusEvent()
                                    |
                          +-------- +--------+
                          |                  |
                     Glasses ctx         Hub ctx
                          |                  |
                  renderer.showError()   showToast() or
                  (chat bubble,          showBanner()
                   auto-scrolls up)      (with action btn)
                          |                  |
                  3s auto-clear          5s auto-clear
                  (only for transient)   (toast) or
                                         persistent (banner)
```

---

## SyncMessage Extensions (sync-types.ts)

```typescript
// All existing variants gain optional seq field:
export type SyncMessage =
  | { type: 'session:created'; origin: SyncOrigin;
      session: { id: string; name: string }; seq?: number }
  | { type: 'session:renamed'; origin: SyncOrigin;
      sessionId: string; name: string; seq?: number }
  | { type: 'session:deleted'; origin: SyncOrigin;
      sessionId: string; seq?: number }
  | { type: 'session:switched'; origin: SyncOrigin;
      sessionId: string; seq?: number }
  | { type: 'message:added'; origin: SyncOrigin;
      conversationId: string; role: string; text: string; seq?: number }
  | { type: 'conversation:named'; origin: SyncOrigin;
      conversationId: string; name: string; seq?: number }
  | { type: 'streaming:start'; origin: SyncOrigin;
      conversationId: string; seq?: number }
  | { type: 'streaming:end'; origin: SyncOrigin;
      conversationId: string; seq?: number }
  // NEW:
  | { type: 'sync:heartbeat'; origin: SyncOrigin;
      seq?: number; messageCount: number; conversationId: string };
```

Backward-compatible: `seq` is optional, new `sync:heartbeat` type is ignored by existing handlers that use `switch` with no `default` case.

---

## Patterns to Follow

### Pattern 1: Observer-Wrapper for Monitoring

SyncMonitor observes SyncBridge traffic without modifying the bridge itself:

```typescript
// Wrap postMessage to track sends
const originalPost = syncBridge.postMessage;
syncBridge.postMessage = (msg: SyncMessage) => {
  syncMonitor.trackSend(msg);
  originalPost.call(syncBridge, msg);
};

// Use onMessage to track receives (already a subscribe pattern)
syncBridge.onMessage((msg) => {
  syncMonitor.trackReceive(msg);
  // existing handlers continue to work
});
```

This follows the existing codebase pattern of wrapping without replacing (similar to how VoiceLoopController wraps GatewayClient events onto the bus).

### Pattern 2: Progressive Error Escalation

```
Attempt 1 fail -> silent retry
Attempt 2 fail -> silent retry
Attempt 3 fail -> silent retry
Attempt 4 fail -> emit 'persistence:error' { type: 'write-failed', recoverable: false }
```

The existing `persistence:warning` event remains for backward compatibility but `persistence:error` carries structured context (`type`, `recoverable`, `conversationId`).

### Pattern 3: Boot-time Detection, On-demand Repair

IntegrityChecker.check() runs every boot (read-only, fast). Repair runs only when:
- Glasses: auto-repair if orphan count > 0 (no UI to ask for confirmation)
- Hub: show in health page with "Repair" action button

### Pattern 4: Separate Detection from Action

All integrity/health checks produce report objects. Report consumers decide what to do:
- `IntegrityReport` -> boot-restore (skip dangling pointer), ErrorPresenter (show warning), HealthIndicator (compute status)
- `StorageQuota` -> ErrorPresenter (show quota warning), HealthIndicator (compute status)
- `SyncStats` -> DriftReconciler (trigger reconcile), HealthIndicator (compute status)

This enables testing each layer independently.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Blocking Voice Loop on Verification

**What:** Making `addMessage()` wait for read-after-write verification before resolving.
**Why bad:** Adds latency to every message save. Streaming response chunks are batched at 200ms -- a verification round-trip would double effective save latency and could cause perceptible stuttering.
**Instead:** Verify asynchronously after save. If verify fails, emit error event. Never block the save pipeline.

### Anti-Pattern 2: Complex Sync Protocols (CRDT/Vector Clocks)

**What:** Implementing conflict resolution between glasses and hub state.
**Why bad:** Both contexts share the same IndexedDB (same origin). There are no real conflicts. Messages are append-only. Session operations are idempotent.
**Instead:** IDB is the single source of truth. Drift = stale DOM. Solution = re-read from IDB and re-render. Zero conflict resolution needed.

### Anti-Pattern 3: Aggressive Auto-cleanup Without User Awareness

**What:** Automatically deleting orphan messages without any feedback.
**Why bad:** If a bug creates false-positive orphan detection, auto-cleanup destroys valid data. Evidence of bugs is destroyed.
**Instead:** Detect on boot, log to health report. On glasses, auto-repair (no UI for orphan management). On hub, show count in health page with explicit "Repair" action.

### Anti-Pattern 4: Retry Storms on Permanent Storage Failure

**What:** Endlessly retrying writes when IDB is genuinely unavailable.
**Why bad:** CPU spin, battery drain on mobile, console noise.
**Instead:** Existing 3-retry with exponential backoff is appropriate. After exhausting retries, emit `persistence:error` with `recoverable: false`. Stop retrying. Only resume if a subsequent `storageHealth.getQuota()` confirms storage is available.

### Anti-Pattern 5: Error Modals on 576x288 Glasses Display

**What:** Showing a dialog or multi-line error UI on the glasses.
**Why bad:** Display fits ~3 lines. Error dialog would obscure conversation. No way to dismiss with 4-gesture input model.
**Instead:** Single-line messages via `renderer.showError()` which creates a chat-bubble-style error. Auto-clears by being scrolled up by subsequent messages. Non-blocking.

### Anti-Pattern 6: Polling IDB for Changes

**What:** Setting up intervals to re-read IDB looking for changes.
**Why bad:** IDB has no change notification API. Polling wastes battery and CPU.
**Instead:** Trust the event bus. Both contexts already emit events when they write. Use sync heartbeat (10s interval) for drift detection, not IDB polling.

---

## BroadcastChannel in flutter_inappwebview

**Finding:** BroadcastChannel is supported in Android WebView 54+ (2016) and WKWebView 15.4+ (2022). flutter_inappwebview delegates to native WebView engines.

**Confidence:** MEDIUM. Support depends on the device's WebView version. Even G2 targets modern devices, so BC is likely available.

**Existing fallback:** `createSyncBridge()` already feature-detects BC and falls back to localStorage `storage` events. The resilience layer should verify this fallback path works correctly under test.

**Production context nuance:** In the real Even App, glasses and hub contexts may run in the same WebView (single JS runtime). If so, BroadcastChannel is unnecessary -- the shared event bus handles everything. SyncMonitor should detect same-context mode and adjust heartbeat behavior accordingly.

---

## File Organization

```
src/
  persistence/
    conversation-store.ts     # MODIFIED: +3 methods (verifyMessage, countMessages, getOrphanMessages)
    auto-save.ts              # MODIFIED: verify first write, escalate errors
    boot-restore.ts           # MODIFIED: accept optional IntegrityReport
    integrity-checker.ts      # NEW: referential integrity scan + repair
    storage-health.ts         # NEW: quota monitoring + persistence request
    types.ts                  # MODIFIED: +3 methods on ConversationStore interface
    db.ts                     # UNCHANGED
    session-store.ts          # UNCHANGED
  sync/
    sync-bridge.ts            # UNCHANGED
    sync-types.ts             # MODIFIED: +heartbeat variant, +optional seq
    sync-monitor.ts           # NEW: delivery tracking + sequence gap detection
    drift-reconciler.ts       # NEW: IDB-based state reconciliation
  errors/                     # NEW DIRECTORY
    error-presenter.ts        # NEW: glasses + hub error UX mapping
    health-indicator.ts       # NEW: pure function health aggregation
  types.ts                    # MODIFIED: +4 AppEventMap events
  glasses-main.ts             # MODIFIED: boot sequence additions + cleanup
  hub-main.ts                 # MODIFIED: initPersistence + error UX + fix silent failures
  __tests__/
    integrity-checker.test.ts # NEW
    storage-health.test.ts    # NEW
    sync-monitor.test.ts      # NEW
    drift-reconciler.test.ts  # NEW
    error-presenter.test.ts   # NEW
    health-indicator.test.ts  # NEW
    auto-save-resilience.test.ts  # NEW (failure scenarios for enhanced auto-save)
    boot-resilience.test.ts   # NEW (corrupt data boot scenarios)
```

**New files:** 6 source modules + 8 test files = 14 files.
**Modified files:** 6 existing source modules.
**New directory:** `src/errors/`

---

## Suggested Build Order

The build order follows the dependency chain between new components. Each phase produces testable, independently shippable increments.

### Phase 1: Foundation -- Integrity & Storage Health

**Build:** IntegrityChecker, StorageHealth, ConversationStore extensions (3 new methods)
**Rationale:** Zero dependencies on other new components. These are detection-only modules that produce report objects. Every subsequent phase depends on "is storage healthy?"
**Test:** Unit tests with fake-indexeddb. Inject known orphans, verify detection. Mock Storage API for quota tests. Test repair separately from detection.

### Phase 2: Write Verification & Auto-Save Hardening

**Build:** ConversationStore.verifyMessage() integration into auto-save, enhanced error events in AppEventMap, persistence:error escalation
**Depends on:** Phase 1 (needs ConversationStore.verifyMessage, persistence:error event type)
**Rationale:** Write verification is the most critical resilience feature -- prevents silent data loss on the primary write path.
**Test:** Unit tests for verify flow. Integration test: write + verify + simulated failure. Test escalation from warning to error.

### Phase 3: Boot Integration

**Build:** Enhanced boot-restore.ts with integrity report, glasses-main.ts boot sequence additions, hub-main.ts initPersistence enhancement
**Depends on:** Phase 1 (IntegrityChecker), Phase 2 (enhanced auto-save)
**Rationale:** Wires phases 1-2 into the real boot lifecycle. Detection meets application startup.
**Test:** Integration: corrupt IDB before boot, verify detection and graceful recovery. Test dangling pointer handling.

### Phase 4: Sync Hardening (parallel with Phase 3)

**Build:** SyncMonitor, DriftReconciler, sync heartbeat, SyncMessage extensions
**Depends on:** Phase 1 (ConversationStore.countMessages for drift comparison)
**Rationale:** Independent from boot integration. Can be built in parallel with Phase 3.
**Test:** Unit tests for sequence gap detection. Integration: simulate message loss via intercepted postMessage, verify drift detection and IDB-based reconciliation.

### Phase 5: Error UX

**Build:** ErrorPresenter (glasses + hub variants), HealthIndicator, hub health page enhancements, hub banner DOM
**Depends on:** Phases 1-4 (consumes all error events emitted by prior phases)
**Rationale:** Presentation layer -- build last so it maps all error signals from phases 1-4 to user-visible feedback.
**Test:** Unit tests for error-to-UX mapping logic. Manual testing on glasses simulator for hint bar behavior. Test one-error-at-a-time constraint.

### Phase 6: Test Coverage & CI

**Build:** Integration test suite for failure scenarios, E2E resilience tests across contexts, CI pipeline configuration
**Depends on:** Phases 1-5 (exercises all resilience features together)
**Rationale:** Comprehensive test coverage comes last because it needs all components. Each prior phase has its own unit tests.
**Test targets:** IDB eviction simulation, BroadcastChannel failure fallback, SSE mid-stream disconnection recovery, boot with corrupted state, sync drift + reconciliation end-to-end.

### Dependency Graph

```
Phase 1: IntegrityChecker, StorageHealth, ConversationStore extensions
    |
    v
Phase 2: Write verification, Auto-save hardening, AppEventMap events
    |
    +-----------+
    |           |
    v           v
Phase 3      Phase 4           <-- CAN RUN IN PARALLEL
Boot         Sync hardening
integration  (SyncMonitor,
             DriftReconciler)
    |           |
    +-----------+
         |
         v
Phase 5: Error UX (ErrorPresenter, HealthIndicator)
         |
         v
Phase 6: Test coverage & CI
```

---

## Scalability Considerations

| Concern | Current (~50 convs) | At 500 conversations | At 5000+ conversations |
|---------|--------------------|--------------------|----------------------|
| Integrity check (boot) | < 10ms | < 50ms | Consider sampling or 24h cache |
| Orphan scan (cursor) | < 10ms | < 100ms | Index on conversationId exists; still fast |
| Sync heartbeat count | IDB `count()`, < 1ms | < 1ms (O(1) on index) | Still fine |
| Storage quota check | Storage API, < 5ms | Same | Same |
| Message verify | Single `get()` by key, < 1ms | Same | Same |
| Drift reconciliation | Re-read one conversation | Same complexity | Same (scoped to one conversation) |

At 5000+ conversations, integrity check full-scan becomes the bottleneck. Mitigation: cache `IntegrityReport.checkedAt` and skip if checked within 24 hours. For v1.3, full scan on every boot is fine.

---

## Sources

- Full line-by-line source analysis of all 60 TypeScript files in the existing v1.2 codebase
- [MDN: Using IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB) -- transaction atomicity guarantees, oncomplete semantics
- [MDN: Storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) -- quota limits, navigator.storage.persist()
- [web.dev: Persistent storage](https://web.dev/articles/persistent-storage) -- persist() API patterns and browser behavior differences
- [WebKit: Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/) -- WebKit eviction behavior, 7-day inactivity threshold
- [CanIWebView: BroadcastChannel](https://caniwebview.com/features/mdn-broadcastchannel/) -- WebView support matrix for BC

---
*Architecture research for: v1.3 Resilience & Error UX*
*Researched: 2026-02-28*
