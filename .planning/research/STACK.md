# Stack Research: v1.3 Resilience & Error UX

**Domain:** Data integrity, cross-context sync hardening, error recovery, and error UX for Even G2 smart glasses chat app
**Researched:** 2026-02-28
**Confidence:** HIGH

## Scope

This research covers ONLY the stack additions/changes needed for v1.3 resilience features:

1. IndexedDB write verification, orphan detection, referential integrity checks
2. BroadcastChannel hardening (message acknowledgment, drift detection)
3. Real-hardware gap closure (flutter_inappwebview quirks, storage eviction)
4. Error recovery patterns (mid-stream failures, stuck FSM, corrupted state)
5. Error UX components (visible error states, recovery prompts, health indicators)
6. Test infrastructure for failure scenario simulation

The existing stack (Vite 6.1, TypeScript 5.7 strict, Vitest 3.0, fake-indexeddb 6.2.5, native IndexedDB with ConversationStore/SessionStore, BroadcastChannel + localStorage fallback via SyncBridge, eventsource-parser, pure-function gesture FSM, factory/closure pattern, 372 tests across 25 suites) is validated in v1.0-v1.2 and NOT re-researched.

## Critical Finding: No New Runtime Dependencies Needed

Every v1.3 resilience feature is implementable using browser built-in APIs and patterns within the existing codebase. The architecture already has the right abstractions (factory functions, typed event bus, ConversationStore/SessionStore interfaces, SyncBridge interface). What is needed is new code using existing APIs, not new libraries.

## New Stack Additions

### Runtime Dependencies

**None.** Zero new npm packages required.

All resilience features use:
- Native IndexedDB transaction API (already in use)
- Native `navigator.storage.estimate()` and `navigator.storage.persist()` (new API usage, zero bundle cost)
- IDBTransaction durability option `{ durability: "strict" }` (new API usage, zero bundle cost)
- Existing BroadcastChannel + localStorage SyncBridge (already in use)
- Existing typed event bus `AppEventMap` (extended with new event types)

### Development Dependencies

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `fake-indexeddb` | ^6.2.5 (already installed) | IndexedDB failure simulation via `forceCloseDatabase()` | v6.2.0 added `forceCloseDatabase()` which simulates IDBDatabase closing for abnormal reasons -- exactly what we need for resilience testing. Already at 6.2.5 in the project. |

No new dev dependencies required. The existing fake-indexeddb already supports the failure simulation APIs needed.

### Browser Built-ins (Zero Bundle Cost) -- New Usage

| API | Purpose | Browser Support | Notes |
|-----|---------|----------------|-------|
| `navigator.storage.estimate()` | Detect storage pressure before eviction | Chrome 61+, Firefox 57+, Safari 17+ | Returns `{ usage, quota }` estimate. Use to warn users before quota exhaustion. Feature-detect with `'storage' in navigator && 'estimate' in navigator.storage`. |
| `navigator.storage.persist()` | Request persistent storage (prevent eviction) | Chrome 52+, Firefox 55+, Safari 15.2+ | Chrome/Edge auto-approve based on engagement heuristics (no user prompt). Firefox shows permission popup. Call once on first boot. |
| `navigator.storage.persisted()` | Check if storage is already persistent | Same as persist() | Check before requesting to avoid redundant calls. |
| `IDBTransaction` durability option | Guarantee writes are flushed to disk | Chrome 83+, Firefox (relaxed default), Safari (strict default) | Use `{ durability: "strict" }` for critical writes (session creation, message save). Relaxed is now Chrome's default since v121 -- explicit strict needed for write verification. |
| `IDBDatabase.onclose` event | Detect unexpected database closure | Chrome 31+, Firefox 50+, Safari 14+ | Fires when database is unexpectedly closed (storage eviction, manual clear). Hook to trigger recovery flow. |
| `QuotaExceededError` | Detect storage full condition | All browsers | Thrown on IndexedDB put/add when quota exceeded. Catch in `tx.onabort` handler -- check both `tx.error` and `tx.error?.inner` for cross-browser coverage. |

## Detailed Technology Rationale

### IndexedDB Write Verification: Read-After-Write Pattern

**What it is:** After a write completes (`tx.oncomplete`), immediately read the record back in a new readonly transaction to confirm it was persisted.

**Why needed:** Chrome's default durability mode changed to `relaxed` in v121 (matching Firefox/Safari). With relaxed durability, `oncomplete` fires after changes reach the OS buffer -- but before actual disk flush. A crash or eviction between `oncomplete` and disk flush loses data silently. The existing `addMessage()` and `createConversation()` fire-and-forget on `tx.oncomplete` without verification.

**Implementation approach:**
```typescript
// In conversation-store.ts addMessage():
// After tx.oncomplete resolves, verify with a read-back
async function addMessageVerified(
  conversationId: string,
  msg: { role: 'user' | 'assistant'; text: string; timestamp: number },
): Promise<string> {
  const id = crypto.randomUUID();
  const record: MessageRecord = { id, conversationId, ...msg };

  // Write in a strict-durability transaction
  await new Promise((resolve, reject) => {
    const tx = db.transaction(
      ['messages', 'conversations'],
      'readwrite',
      { durability: 'strict' } as IDBTransactionOptions,
    );
    tx.objectStore('messages').put(record);
    // ... update conversation updatedAt ...
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => {
      // QuotaExceededError surfaces here, not on onerror in some browsers
      const err = tx.error;
      reject(err?.name === 'QuotaExceededError'
        ? new DOMException('Storage quota exceeded', 'QuotaExceededError')
        : err);
    };
  });

  // Verify: read-back in a separate transaction
  const verification = await new Promise<boolean>((resolve) => {
    const tx = db.transaction('messages', 'readonly');
    const req = tx.objectStore('messages').get(id);
    req.onsuccess = () => resolve(req.result !== undefined);
    req.onerror = () => resolve(false);
  });

  if (!verification) {
    throw new Error(`Write verification failed for message ${id}`);
  }

  return id;
}
```

**TypeScript typing note:** The `{ durability: 'strict' }` third argument to `db.transaction()` is part of the IDBTransactionOptions dictionary. The DOM lib typings in TypeScript include this as of TS 4.4+. If the project's `lib: ["ES2022", "DOM"]` does not include the overload, a type assertion `as IDBTransactionOptions` resolves it cleanly.

**Integration point:** Wraps existing `addMessage()` in ConversationStore. The retry logic in `auto-save.ts` `saveWithRetry()` already handles failures -- write verification makes silent data loss detectable so retries actually trigger.

**Confidence:** HIGH -- IDBTransaction durability option is standard Web API documented on MDN, `{ durability: "strict" }` supported since Chrome 83.

### IndexedDB Orphan Detection and Referential Integrity

**What it is:** On app boot, scan for messages whose `conversationId` references a conversation that no longer exists (orphans), and clean them up.

**Why needed:** IndexedDB has no foreign key constraints. The existing `deleteSession()` in `session-store.ts` uses a cursor-based cascade delete (conversation + messages in one transaction). But if that transaction is interrupted (crash, eviction, tab close), orphaned messages survive without their parent conversation. Over time, these waste storage and may cause confusing search results (messages appear from "Unknown" conversation in `searchMessages()`).

**Implementation approach:**
```typescript
// New module: src/persistence/integrity-check.ts
export interface IntegrityReport {
  orphanedMessages: string[];
  emptyConversations: string[];
  storageHealth: StorageHealth | null;
}

export async function checkIntegrity(db: IDBDatabase): Promise<IntegrityReport> {
  const report: IntegrityReport = {
    orphanedMessages: [],
    emptyConversations: [],
    storageHealth: null,
  };

  // Single readonly transaction across both stores
  const tx = db.transaction(['conversations', 'messages'], 'readonly');
  const convStore = tx.objectStore('conversations');
  const msgStore = tx.objectStore('messages');

  // Load all conversation IDs into a Set
  const convIds = new Set<string>();
  const convReq = convStore.getAllKeys();
  await new Promise<void>((resolve) => {
    convReq.onsuccess = () => {
      for (const key of convReq.result as string[]) {
        convIds.add(key);
      }
      resolve();
    };
  });

  // Scan messages for orphans and track which conversations have messages
  const conversationsWithMessages = new Set<string>();
  const cursorReq = msgStore.openCursor();
  await new Promise<void>((resolve) => {
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        const msg = cursor.value as MessageRecord;
        if (!convIds.has(msg.conversationId)) {
          report.orphanedMessages.push(msg.id);
        } else {
          conversationsWithMessages.add(msg.conversationId);
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
  });

  // Detect empty conversations (ghost sessions)
  for (const convId of convIds) {
    if (!conversationsWithMessages.has(convId)) {
      report.emptyConversations.push(convId);
    }
  }

  return report;
}

export async function cleanupOrphans(
  db: IDBDatabase,
  orphanedMessageIds: string[],
): Promise<number> {
  if (orphanedMessageIds.length === 0) return 0;

  return new Promise((resolve, reject) => {
    const tx = db.transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    for (const id of orphanedMessageIds) {
      store.delete(id);
    }
    tx.oncomplete = () => resolve(orphanedMessageIds.length);
    tx.onerror = () => reject(tx.error);
  });
}
```

**Integration point:** Called during `restoreOrCreateConversation()` in `boot-restore.ts`, after DB opens but before any UI renders. Orphans cleaned up in a separate readwrite transaction. Results emitted via event bus for optional display.

**Confidence:** HIGH -- uses only existing IndexedDB cursor APIs already used in `deleteSession()` and `searchMessages()`.

### Storage Health Monitoring via Storage API

**What it is:** Check available storage quota on boot and periodically, warn users before eviction.

**Why needed:** Even G2 apps run in flutter_inappwebview's WKWebView which gets ~15% of total disk per origin (vs ~60% for Safari proper). WebKit evicts best-effort storage for origins with no user interaction in 7+ days. Without monitoring, the app silently loses all conversations when the browser evicts IndexedDB.

**Specific Even App storage context (verified via MDN):**
- WKWebView (non-browser WebKit app): ~15% of total disk per origin
- If saved as Home Screen web app: ~60% (browser app quota)
- Overall non-browser app cap: ~20% of total disk across all origins
- Safari's proactive eviction: script-created data deleted after 7 days without user click/tap interaction

**Implementation approach:**
```typescript
// New module: src/persistence/storage-health.ts
export interface StorageHealth {
  usageBytes: number;
  quotaBytes: number;
  usagePercent: number;
  isPersistent: boolean;
  isAvailable: boolean;
}

export async function getStorageHealth(): Promise<StorageHealth> {
  if (!('storage' in navigator) || !('estimate' in navigator.storage)) {
    return { usageBytes: 0, quotaBytes: 0, usagePercent: 0, isPersistent: false, isAvailable: false };
  }

  const estimate = await navigator.storage.estimate();
  const isPersistent = await navigator.storage.persisted?.() ?? false;

  return {
    usageBytes: estimate.usage ?? 0,
    quotaBytes: estimate.quota ?? 0,
    usagePercent: estimate.quota ? ((estimate.usage ?? 0) / estimate.quota) * 100 : 0,
    isPersistent,
    isAvailable: true,
  };
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (!('storage' in navigator) || !('persist' in navigator.storage)) {
    return false;
  }
  return navigator.storage.persist();
}
```

**Integration points:**
- Call `requestPersistentStorage()` on first boot in `initPersistence()` (hub-main.ts, glasses-main.ts).
- Call `getStorageHealth()` on boot and emit as `'persistence:health'` event.
- Hub health page already has status dots -- add storage health indicator.
- Warn at 80% quota usage, critical at 95%.

**Confidence:** HIGH -- Storage API is well-documented on MDN. `navigator.storage.estimate()` supported Chrome 61+, Firefox 57+, Safari 17+. `navigator.storage.persist()` supported Chrome 52+. WKWebView quota details confirmed via WebKit blog.

### BroadcastChannel Hardening: Sequence Numbers and Heartbeat

**What it is:** Add sequence numbers to SyncMessage for message loss detection, and periodic heartbeat messages for liveness detection.

**BroadcastChannel in the Even App WebView:**
- WKWebView iOS supports BroadcastChannel from iOS 15.4+ (confirmed via caniwebview.com, updated Feb 27, 2026)
- Android WebView supports BroadcastChannel from version 54+
- flutter_inappwebview delegates to the platform WebView -- so BC should work on iOS 15.4+ and Android 54+
- HOWEVER: BroadcastChannel works between same-origin browsing contexts. In the Even App, glasses and hub run as separate WebView instances managed by the Even App host. Whether these share a BroadcastChannel scope is UNVERIFIED on real hardware. The existing localStorage fallback handles this case.

**Why BroadcastChannel has no built-in reliability:**
- No delivery confirmation (fire-and-forget)
- No ordering guarantee across rapid successive posts
- No detection of peer liveness (other context may have closed)
- Race condition: if receiver constructs its BroadcastChannel after sender posts, message is lost

**Implementation approach -- extend existing SyncBridge:**

Add to `sync-types.ts`:
```typescript
export type SyncMessage =
  | { type: 'session:created'; origin: SyncOrigin; seq: number; session: { id: string; name: string } }
  // ... all existing types gain `seq: number` ...
  | { type: 'sync:heartbeat'; origin: SyncOrigin; seq: number; timestamp: number }
  | { type: 'sync:ack'; origin: SyncOrigin; seq: number; ackedSeq: number }
  | { type: 'sync:request-resync'; origin: SyncOrigin };
```

Add to `sync-bridge.ts`:
```typescript
// Inside createBroadcastChannelBridge():
let localSeq = 0;
let lastRemoteSeq = 0;

function postMessage(msg: SyncMessage): void {
  localSeq++;
  channel.postMessage({ ...msg, seq: localSeq });
}

// On receive: check for gaps
channel.onmessage = (event: MessageEvent) => {
  const msg = event.data as SyncMessage;
  if (msg.seq && lastRemoteSeq > 0 && msg.seq > lastRemoteSeq + 1) {
    // Gap detected -- request resync from IndexedDB
    emitDriftDetected(lastRemoteSeq, msg.seq);
  }
  lastRemoteSeq = msg.seq || lastRemoteSeq;
  for (const handler of handlers) {
    handler(msg);
  }
};
```

**Drift reconciliation:** When a sequence gap is detected, the receiving context reads the current state from IndexedDB (which both contexts share) and reconciles. This is the "source of truth" -- BroadcastChannel is just a notification, IndexedDB is the authoritative state.

**Heartbeat:** Send `sync:heartbeat` every 5 seconds. If no heartbeat received for 15 seconds, mark peer as potentially disconnected. When peer reconnects, request full resync from IndexedDB.

**Why NOT full message acknowledgment:**
- BroadcastChannel is a notification layer, not a message queue
- IndexedDB is already the shared source of truth
- Implementing reliable delivery with ACKs over BroadcastChannel would be over-engineering
- Better pattern: detect drift via sequence numbers, reconcile via IndexedDB read

**Integration point:** Extends existing `createSyncBridge()` factory. Consumers (`hub-main.ts`, `glasses-main.ts`) gain a new `onDrift` callback. The localStorage fallback transport also gains sequence numbers (encoded in JSON payload).

**Confidence:** HIGH for sequence number pattern -- simple counter, no external deps. MEDIUM for heartbeat timing -- optimal interval needs real-hardware testing.

### Error Recovery Patterns

**What it is:** Structured error handling for mid-stream gateway failures, stuck FSM states, and corrupted local state.

**Why needed:** The existing codebase has basic error handling (auto-save retry, gateway timeout, FSM reset on error). But several failure modes are unhandled:
1. **Mid-stream SSE failure:** If the SSE connection drops during `response_delta` chunks, `pendingAssistantText` in `auto-save.ts` contains a partial response that is never saved or cleared on some code paths.
2. **Stuck FSM:** If the gesture FSM enters a state and no transition fires (e.g., gateway never responds), there is no watchdog to reset it.
3. **IndexedDB connection lost:** If `IDBDatabase.onclose` fires (eviction or manual clear), all subsequent store operations silently fail.
4. **localStorage unavailable:** `readActiveConversationId()` catches errors but subsequent code assumes it works.

**Implementation approach -- no new deps, just patterns:**

```typescript
// 1. FSM watchdog timer
// In voice-loop-controller.ts or gesture-handler.ts:
const FSM_WATCHDOG_MS = 45_000; // 45 seconds max in any transient state
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

function startWatchdog(currentState: string): void {
  clearWatchdog();
  if (currentState === 'recording' || currentState === 'sent' || currentState === 'thinking') {
    watchdogTimer = setTimeout(() => {
      bus.emit('log', { level: 'warn', msg: `FSM watchdog: stuck in ${currentState}, resetting` });
      resetToIdle();
    }, FSM_WATCHDOG_MS);
  }
}

// 2. IDBDatabase.onclose handler
// In db.ts openDB():
request.onsuccess = () => {
  const db = request.result;
  db.onclose = () => {
    // Database was evicted or manually cleared
    bus.emit('persistence:error', { type: 'database-closed', recoverable: true });
    // Attempt to reopen
    reopenDB();
  };
  resolve(db);
};

// 3. Mid-stream partial response protection
// In auto-save.ts, on 'error' chunk type:
case 'error':
  if (pendingAssistantText.length > 0) {
    // Save partial response with [incomplete] marker rather than discarding
    const partial = pendingAssistantText + '\n[response interrupted]';
    saveWithRetry(() =>
      store.addMessage(convId, { role: 'assistant', text: partial, timestamp: Date.now() }),
    );
  }
  pendingAssistantText = '';
  break;
```

**Integration points:**
- FSM watchdog: new concern in gesture-handler or a separate watchdog module
- IDB onclose: extends `openDB()` in `db.ts`
- Partial response: extends existing `createAutoSave()` error handling
- All emit new events on the existing `AppEventMap` for UI consumption

**Confidence:** HIGH -- all patterns use standard JavaScript and existing project abstractions.

### Error UX Components

**What it is:** Visible error states, recovery prompts, and health indicators in the hub UI and glasses display.

**No framework needed.** The existing hub UI uses vanilla TypeScript with direct DOM manipulation (innerHTML, textContent, classList). The existing glasses display uses the bridge's `textContainerUpgrade()`. Error UX components follow the same pattern.

**Implementation approach:**

Hub error UX (in `hub-main.ts` or new `src/ui/error-banner.ts`):
```typescript
// Reuses existing toast pattern and status-dot CSS classes
function showErrorBanner(opts: {
  message: string;
  severity: 'warning' | 'error';
  recoveryAction?: { label: string; handler: () => void };
  dismissable?: boolean;
}): void {
  const banner = document.createElement('div');
  banner.className = `error-banner error-banner--${opts.severity}`;
  // Use textContent for message text to prevent XSS (consistent with v1.2 pattern)
  const msgSpan = document.createElement('span');
  msgSpan.className = 'error-banner__msg';
  msgSpan.textContent = opts.message;
  banner.appendChild(msgSpan);

  if (opts.recoveryAction) {
    const btn = document.createElement('button');
    btn.className = 'btn btn--ghost error-banner__action';
    btn.textContent = opts.recoveryAction.label;
    btn.addEventListener('click', opts.recoveryAction.handler);
    banner.appendChild(btn);
  }
  if (opts.dismissable) {
    const dismiss = document.createElement('button');
    dismiss.className = 'error-banner__dismiss';
    dismiss.textContent = 'x';
    dismiss.addEventListener('click', () => banner.remove());
    banner.appendChild(dismiss);
  }

  document.getElementById('errorContainer')?.prepend(banner);
}
```

Glasses error display (through existing bridge text API):
```typescript
// Error states shown in status container (top of 576x288 display)
// Keep messages under ~40 chars to fit 576px width with Even G2's fixed font
function showGlassesError(bridge: EvenBridge, message: string): void {
  bridge.textContainerUpgrade(STATUS_CONTAINER, `[!] ${message}`);
}
```

**New AppEventMap events for error UX:**
```typescript
interface AppEventMap {
  // ... existing events ...
  'persistence:error': { type: 'database-closed' | 'quota-exceeded' | 'write-failed'; recoverable: boolean; message?: string };
  'persistence:health': StorageHealth;
  'persistence:integrity': { orphanedMessages: number; emptyConversations: number; cleaned: boolean };
  'sync:drift-detected': { expectedSeq: number; receivedSeq: number; origin: SyncOrigin };
  'sync:peer-disconnected': { origin: SyncOrigin; lastHeartbeat: number };
  'sync:peer-connected': { origin: SyncOrigin };
  'sync:resync-complete': { origin: SyncOrigin; messagesReconciled: number };
  'fsm:watchdog-reset': { previousState: string; elapsed: number };
}
```

**Integration points:**
- Event bus subscribers in `hub-main.ts` listen for error events and call `showErrorBanner()`
- Event bus subscribers in `glasses-main.ts` listen for error events and call `showGlassesError()`
- Health page gains storage usage indicator (uses existing status-dot pattern)
- Existing `persistence:warning` event is already in AppEventMap -- reuse for non-critical warnings

**Confidence:** HIGH -- follows established patterns in the codebase.

### Test Infrastructure for Failure Scenarios

**What it is:** Test utilities for simulating IndexedDB failures, BroadcastChannel message loss, and storage pressure.

**fake-indexeddb 6.2.5 (already installed) provides:**
- `forceCloseDatabase()` -- simulates abnormal database closure (eviction scenario)
- Full IDBDatabase.onclose event simulation
- In-memory storage that can be reset between tests

**What fake-indexeddb does NOT provide (confirmed via GitHub issue #59):**
- No built-in error injection for transaction failures (onerror, onabort)
- No way to simulate QuotaExceededError
- No way to make specific `put()` or `get()` calls fail

This means IDB error testing requires **wrapper mocking** -- intercepting at the ConversationStore interface level rather than at the raw IDB transaction level. This fits perfectly with the project's factory/closure pattern: tests wrap the real store with a failing proxy.

**Additional test utilities needed (new test helper files, no deps):**

```typescript
// src/__tests__/helpers/failure-helpers.ts

import type { ConversationStore } from '../../persistence/types';
import type { SyncBridge, SyncMessage } from '../../sync/sync-types';

/**
 * Create a ConversationStore that fails after N successful writes.
 * Useful for testing retry logic and partial failure recovery.
 */
export function createFailingStore(
  realStore: ConversationStore,
  failAfterN: number,
): ConversationStore {
  let writeCount = 0;
  return {
    ...realStore,
    addMessage: async (...args: Parameters<ConversationStore['addMessage']>) => {
      writeCount++;
      if (writeCount > failAfterN) {
        throw new DOMException('Simulated write failure', 'AbortError');
      }
      return realStore.addMessage(...args);
    },
    createConversation: async (...args: Parameters<ConversationStore['createConversation']>) => {
      writeCount++;
      if (writeCount > failAfterN) {
        throw new DOMException('Simulated write failure', 'AbortError');
      }
      return realStore.createConversation(...args);
    },
  };
}

/**
 * Create a ConversationStore that simulates QuotaExceededError.
 * Tests storage-full error handling and user notification.
 */
export function createQuotaExceededStore(
  realStore: ConversationStore,
): ConversationStore {
  return {
    ...realStore,
    addMessage: async () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    },
    createConversation: async () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    },
  };
}

/**
 * Create a SyncBridge that drops every Nth message.
 * Useful for testing sequence gap detection and drift recovery.
 */
export function createLossySyncBridge(
  realBridge: SyncBridge,
  dropEveryN: number,
): SyncBridge {
  let msgCount = 0;
  return {
    postMessage: (msg: SyncMessage) => {
      msgCount++;
      if (msgCount % dropEveryN === 0) return; // dropped
      realBridge.postMessage(msg);
    },
    onMessage: realBridge.onMessage.bind(realBridge),
    destroy: realBridge.destroy.bind(realBridge),
  };
}

/**
 * Create a SyncBridge that delays messages by N milliseconds.
 * Useful for testing race conditions and out-of-order delivery.
 */
export function createDelayedSyncBridge(
  realBridge: SyncBridge,
  delayMs: number,
): SyncBridge {
  return {
    postMessage: (msg: SyncMessage) => {
      setTimeout(() => realBridge.postMessage(msg), delayMs);
    },
    onMessage: realBridge.onMessage.bind(realBridge),
    destroy: realBridge.destroy.bind(realBridge),
  };
}
```

**Testing forceCloseDatabase with fake-indexeddb:**
```typescript
import 'fake-indexeddb/auto';
import { forceCloseDatabase } from 'fake-indexeddb';
import { openDB } from '../persistence/db';

it('detects database eviction via onclose', async () => {
  const db = await openDB();
  const closeDetected = vi.fn();
  db.onclose = closeDetected;

  forceCloseDatabase(db);

  expect(closeDetected).toHaveBeenCalledOnce();
});
```

**Testing navigator.storage mocking pattern:**
```typescript
// Mock Storage API for quota/health tests
beforeEach(() => {
  Object.defineProperty(navigator, 'storage', {
    value: {
      estimate: vi.fn().mockResolvedValue({ usage: 5_000_000, quota: 100_000_000 }),
      persist: vi.fn().mockResolvedValue(true),
      persisted: vi.fn().mockResolvedValue(false),
    },
    writable: true,
    configurable: true,
  });
});
```

**Existing test patterns already support:**
- `MockBroadcastChannel` class in `sync-bridge.test.ts` (multi-instance, cross-peer delivery)
- `fake-indexeddb/auto` import for IndexedDB polyfill
- `indexedDB.deleteDatabase(DB_NAME)` for clean state between tests
- Vitest `vi.fn()`, `vi.spyOn()`, `vi.useFakeTimers()` for mocking

**No additional test libraries needed.** The existing Vitest + jsdom + fake-indexeddb stack is sufficient for all resilience test scenarios. The project's MockBroadcastChannel is actually superior to any npm mock because it correctly simulates cross-peer delivery (sender does not receive own messages), which matches real BroadcastChannel behavior.

**Why NOT MSW (Mock Service Worker) for gateway error tests:** The existing test patterns in `gateway-client.test.ts` already use `vi.fn()` to mock `fetch`. MSW would add a dependency and setup complexity for the same result. The gateway client is already well-tested with fetch mocking. Keep it consistent.

**Why NOT vitest-fetch-mock:** Same reasoning -- adding a fetch mock library when `vi.fn()` + manual mock responses already work in the existing tests would be unnecessary churn.

**Confidence:** HIGH -- fake-indexeddb 6.2.5 with `forceCloseDatabase()` is already installed. Custom test helpers use only TypeScript and existing interfaces.

## New Event Types for AppEventMap

The following event types need to be added to `src/types.ts` for resilience features:

```typescript
interface AppEventMap {
  // ... existing events from v1.2 ...

  // Storage health
  'persistence:error': { type: 'database-closed' | 'quota-exceeded' | 'write-failed'; recoverable: boolean; message?: string };
  'persistence:health': { usageBytes: number; quotaBytes: number; usagePercent: number; isPersistent: boolean };
  'persistence:integrity': { orphanedMessages: number; emptyConversations: number; cleaned: boolean };

  // Sync hardening
  'sync:drift-detected': { expectedSeq: number; receivedSeq: number; origin: SyncOrigin };
  'sync:peer-disconnected': { origin: SyncOrigin; lastHeartbeat: number };
  'sync:peer-connected': { origin: SyncOrigin };
  'sync:resync-complete': { origin: SyncOrigin; messagesReconciled: number };

  // FSM resilience
  'fsm:watchdog-reset': { previousState: string; elapsed: number };
}
```

## Installation

```bash
# No new runtime dependencies

# Dev dependencies (already installed, verify version)
# fake-indexeddb@^6.2.5 is already in devDependencies
npm ls fake-indexeddb
```

**Estimated artifact impact:** 0 KB. All resilience features use browser built-in APIs and custom TypeScript code. No new npm packages added to the production bundle.

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| Manual sequence numbers on SyncMessage | vitest-broadcast-channel-mock npm package | The project's existing MockBroadcastChannel is more accurate (proper cross-peer behavior). The npm package sends to self, which is wrong. |
| `navigator.storage.estimate()` (0B) | Periodic IndexedDB write-and-read probe | Storage API gives quota info directly. Probe approach is slower and wasteful. |
| `{ durability: "strict" }` option | `idb` library for promise wrapping | The project already uses raw IndexedDB with native transaction API. Adding idb at this point would require rewriting ConversationStore/SessionStore for no benefit. The durability option works directly on native `db.transaction()`. |
| `IDBDatabase.onclose` handler | Polling `isIndexedDBAvailable()` | onclose is an event -- zero CPU cost vs periodic polling. Fires immediately when database is evicted. |
| Custom test helpers wrapping ConversationStore | Full mock/stub framework (MSW, vitest-fetch-mock) | The factory/closure pattern means wrapping is trivial. A mock framework adds complexity without benefit. Existing fetch mocks with `vi.fn()` work. |
| Heartbeat on existing SyncBridge | WebSocket keep-alive | Hub and glasses are same-origin, same-device. WebSocket adds server dependency. BroadcastChannel heartbeat is simpler. |
| Read-after-write verification | External database integrity tool | No such tool exists for browser-side IndexedDB. Manual verification is the standard approach. |
| `requestPersistentStorage()` on boot | User-managed storage settings | Automatic persistent storage prevents silent eviction. User should not need to manage browser storage settings. |
| Wrapper-level IDB error mocking | fake-indexeddb native error injection | fake-indexeddb does not support error injection (confirmed GitHub issue #59). Wrapper mocking at the ConversationStore interface is the correct approach for this project's architecture. |

## What NOT to Add

| Avoid | Why | Do Instead |
|-------|-----|------------|
| `idb` npm package | ConversationStore and SessionStore already use raw IndexedDB with clear patterns. Adding a wrapper library for v1.3 would require rewriting working code. The durability option works on native API. | Use `db.transaction(stores, 'readwrite', { durability: 'strict' })` directly. |
| `dexie` ORM | Heavyweight ORM adds abstraction over IndexedDB. The project uses ~200 lines of direct IDB code that is well-understood. Dexie would be a rewrite for no gain. | Keep raw IDB with targeted hardening (durability, onclose, verification). |
| Service Worker for offline resilience | App's core value is real-time voice loop (requires network). Offline mode is explicitly out of scope. Service Worker adds registration complexity. | Detect offline state, show clear "no connection" UX. |
| IndexedDB schema migration framework | Only one schema version exists (v1). Migration framework is premature. If v2 schema needed later, the existing `onupgradeneeded` handler in `db.ts` handles it directly. | Use native `event.oldVersion` check in upgrade handler. |
| Error tracking service (Sentry, etc.) | Adds external dependency, bundle size, and privacy concern for a glasses app. | Emit errors to existing event bus, display in hub log page. |
| Toast notification library | Hub already has toast/banner patterns with CSS. | Extend existing toast/banner pattern. |
| State management library (Zustand, etc.) | App uses factory/closure pattern throughout. Adding a state library for error state would be inconsistent. | Track error state in module closures, emit via event bus. |
| RxJS for reactive error streams | Massive dependency for simple event-driven error handling. | Use existing event bus pub/sub pattern. |
| Retry library (p-retry, etc.) | `saveWithRetry()` in auto-save.ts already implements retry with exponential backoff in 10 lines. | Keep existing pattern, extend to new operations. |
| MSW (Mock Service Worker) | Test dep that adds setup complexity. Existing fetch mocking with `vi.fn()` in gateway tests works. | Keep `vi.fn()` fetch mocking pattern from existing gateway-client.test.ts. |

## Version Compatibility

| Feature/API | Chrome | Firefox | Safari | WKWebView (iOS) | Notes |
|-------------|--------|---------|--------|-----------------|-------|
| `navigator.storage.estimate()` | 61+ | 57+ | 17+ | 17+ (confirmed) | Feature-detect with `'storage' in navigator`. Returns estimates, not exact values. WKWebView quota is ~15% of disk (vs ~60% for Safari browser). |
| `navigator.storage.persist()` | 52+ | 55+ | 15.2+ | Uncertain in Even App | Chrome auto-approves based on engagement. WebKit grants based on heuristics (Home Screen web app status). Test on real Even App hardware. |
| `IDBTransaction { durability }` | 83+ | All (relaxed default) | All (strict default) | Yes (WebKit strict default) | Safari/WebKit defaults to strict already. Firefox defaults to relaxed. Chrome defaults to relaxed since v121. |
| `IDBDatabase.onclose` | 31+ | 50+ | 14+ | 14+ (WebKit) | Fires on abnormal closure. Not fired on intentional `db.close()`. |
| `QuotaExceededError` | All | All | All | All | Standard DOMException. On some browsers surfaces as inner error on AbortError during tx.onabort rather than onerror. |
| `fake-indexeddb` 6.2.5 `forceCloseDatabase()` | N/A (test only) | N/A | N/A | N/A | Simulates IDBDatabase.onclose event. Available since v6.2.0. Does NOT support injecting transaction errors. |
| BroadcastChannel | 54+ | 38+ | 15.4+ | 15.4+ (confirmed via caniwebview.com) | WKWebView iOS supports BC from 15.4+. Whether it works across separate Even App WebView instances is UNVERIFIED. The existing localStorage fallback handles this. |

## Integration Map with Existing Code

| Existing Module | v1.3 Change | Impact |
|-----------------|-------------|--------|
| `src/persistence/db.ts` | Add `IDBDatabase.onclose` handler, add `reopenDB()` function, export durability-aware transaction helper | Low risk -- extends existing `openDB()` |
| `src/persistence/conversation-store.ts` | Add write verification (read-after-write), use strict durability for critical writes, add `tx.onabort` for QuotaExceededError | Medium risk -- modifies core write path. Must not break existing 11 passing tests. |
| `src/persistence/session-store.ts` | No changes to interface. Internal cascade delete already handles cleanup. | No risk |
| `src/persistence/boot-restore.ts` | Call integrity check and storage health on boot. Emit results via event bus. | Low risk -- adds steps to existing boot sequence |
| `src/persistence/auto-save.ts` | Save partial responses on mid-stream failure instead of discarding. Use verified writes. | Medium risk -- changes error handling behavior. Needs tests. |
| `src/sync/sync-types.ts` | Add `seq` field to SyncMessage union. Add heartbeat/ack/resync message types. | Low risk -- additive type changes |
| `src/sync/sync-bridge.ts` | Add sequence counter, gap detection, heartbeat timer, drift callback. Extend both BC and LS transports. | Medium risk -- core sync logic changes. Existing 8 tests must pass. |
| `src/types.ts` AppEventMap | Add new event types for persistence errors, storage health, sync drift, FSM watchdog | Low risk -- purely additive |
| `src/hub-main.ts` | Subscribe to error events, show error banners, add storage health to health page | Low risk -- UI additions |
| `src/glasses-main.ts` | Subscribe to error events, show error text on glasses display, FSM watchdog | Medium risk -- glasses display changes need careful testing |
| `src/gestures/gesture-handler.ts` | Add FSM watchdog timer for stuck states | Low risk -- timeout-based safety net |

## New Modules (to be created)

| Module | Purpose |
|--------|---------|
| `src/persistence/integrity-check.ts` | Orphan detection, ghost session detection, referential integrity scan, cleanup |
| `src/persistence/storage-health.ts` | Storage quota monitoring, persistent storage request |
| `src/persistence/write-verified.ts` | Read-after-write verification wrapper (or inline in conversation-store.ts) |
| `src/sync/sync-heartbeat.ts` | Heartbeat timer, liveness detection (or inline in sync-bridge.ts) |
| `src/ui/error-banner.ts` | Hub error/warning banner component with recovery actions |
| `src/__tests__/helpers/failure-helpers.ts` | Test utilities: createFailingStore, createQuotaExceededStore, createLossySyncBridge, createDelayedSyncBridge |

## Sources

- [IndexedDB transaction durability option -- MDN](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction) -- `{ durability: "strict" }` API documentation (HIGH confidence)
- [Storage quotas and eviction -- MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) -- quota limits per app type (15% for WKWebView non-browser apps), eviction behavior, LRU policy (HIGH confidence)
- [navigator.storage.estimate() -- MDN](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate) -- usage/quota estimation API (HIGH confidence)
- [navigator.storage.persist() -- MDN](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist) -- persistent storage request API (HIGH confidence)
- [Safari storage eviction policy -- WebKit blog](https://webkit.org/blog/14403/updates-to-storage-policy/) -- 7-day no-interaction eviction, WKWebView quota breakdown (HIGH confidence)
- [IDBTransaction abort event -- MDN](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/abort_event) -- QuotaExceededError surfaces in onabort, not onerror on some browsers (HIGH confidence)
- [fake-indexeddb changelog](https://github.com/dumbmatter/fakeIndexedDB/blob/master/CHANGELOG.md) -- v6.2.0 added `forceCloseDatabase()`, v6.2.5 latest (HIGH confidence)
- [fake-indexeddb issue #59](https://github.com/dumbmatter/fakeIndexedDB/issues/59) -- confirms no native error injection support; wrapper mocking required (HIGH confidence)
- [BroadcastChannel WKWebView support -- caniwebview.com](https://caniwebview.com/features/mdn-broadcastchannel/) -- WKWebView iOS 15.4+, Android WebView 54+, updated Feb 27 2026 (HIGH confidence)
- [BroadcastChannel -- MDN](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel) -- same-origin constraint, fire-and-forget semantics (HIGH confidence)
- Existing codebase analysis: `conversation-store.ts`, `session-store.ts`, `sync-bridge.ts`, `auto-save.ts`, `boot-restore.ts`, `db.ts`, `types.ts`, `events.ts`, `gateway-client.ts`, `gesture-fsm.ts`, test files -- direct source inspection (HIGH confidence)

---
*Stack research for: Even G2 OpenClaw Chat App v1.3 -- Resilience & Error UX*
*Researched: 2026-02-28*
