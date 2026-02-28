# Phase 14: Data Integrity Foundation - Research

**Researched:** 2026-02-28
**Domain:** IndexedDB integrity checking, storage health monitoring, eviction detection, persistent storage, IDB lifecycle events
**Confidence:** HIGH

## Summary

Phase 14 establishes the data integrity foundation that all subsequent v1.3 resilience phases depend on. The scope is narrowly defined: boot-time integrity checks (orphan detection, dangling pointer validation), storage health monitoring (quota estimation, persistent storage requests), eviction detection (sentinel record pattern), IDB lifecycle handling (onclose event), and the persistence event types that downstream phases consume.

Every feature in this phase uses browser built-in APIs with zero new runtime dependencies. The existing codebase already has the right abstractions (factory/closure pattern, typed event bus, ConversationStore/SessionStore interfaces) -- Phase 14 adds new modules alongside existing ones without modifying any working function signatures.

**Primary recommendation:** Build integrity-checker.ts and storage-health.ts as new factory/closure modules. Wire them into the existing boot sequence between `openDB()` and `restoreOrCreateConversation()`. Add persistence event types to AppEventMap. Hook IDBDatabase.onclose in db.ts. Use the existing IDB callback pattern (tx.oncomplete, req.onsuccess) -- never async/await within transactions.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| RES-01 | Boot-time integrity check: scan for orphaned messages and dangling session pointer. Single read-only IDB transaction. Under 50ms, under 50 lines. No per-write verification (P1). No auto-delete orphans (P2) -- use grace period. | IntegrityChecker design pattern. Single readonly tx with getAllKeys + cursor scan. Pitfall P1 (no per-write verification) and P2 (grace period) constraints documented. Existing cursor patterns in conversation-store.ts and session-store.ts provide exact code model. |
| RES-02 | Storage health monitoring: call navigator.storage.estimate() on boot, emit quota info via event bus. Warn at 80%, critical at 95%. Feature-detect with 'storage' in navigator. | StorageHealth module design. API verified on MDN (Chrome 61+, Firefox 57+, Safari 17+, WKWebView iOS 17+). Feature detection pattern documented. Event type `persistence:health` designed. |
| RES-03 | Persistent storage request: call navigator.storage.persist() on first boot. Log whether granted. If denied, show non-dismissible warning on hub health page. | requestPersistence() function. API verified on MDN (Chrome 52+, Firefox 55+, Safari 15.2+). Chrome auto-approves based on engagement heuristics. WKWebView behavior uncertain (MEDIUM confidence) -- feature-detect and log result. |
| RES-04 | Eviction detection via sentinel record: write sentinel to IDB on first run. On subsequent boots, if IDB opens but sentinel missing, data was evicted. Emit storage:evicted event. No first-run confusion (P4). | Sentinel record pattern using conversations store (avoids schema change). Write on first boot, check on every boot. Distinguished from first-run by checking localStorage conversation count vs IDB state. Pitfall P4 constraints addressed. |
| RES-05 | Orphan cleanup with grace period: mark suspected orphans with timestamp. Only delete after 30-second grace period. Verify orphan status a second time before deletion. Surface orphan counts in hub diagnostics. One integrity check per boot maximum (P2). | Two-phase orphan cleanup: check() returns IDs read-only, cleanupOrphans() deletes after grace period with re-verification. localStorage timestamp prevents multiple runs. Pitfall P2 constraints documented. |
| RES-15 | IDB database onclose handler: hook IDBDatabase.onclose to detect unexpected closure (eviction, manual clear). Emit persistence:error with type database-closed. Attempt reopenDB(). | IDBDatabase.onclose API verified on MDN (Chrome 31+, Firefox 50+, Safari 14+). Not fired on intentional db.close(). Hook in openDB() after request.onsuccess. Add reopenDB() export to db.ts. |
| RES-20 | New AppEventMap events (persistence events only): add persistence:error, persistence:health, storage:evicted event types to src/types.ts. All additive (no breaking changes). | Event type definitions designed. Three new persistence-related events. Additive-only change to existing AppEventMap interface. Other RES-20 events (sync, fsm) deferred to their respective phases. |
| RES-22 | Zero new runtime dependencies: all features use browser built-in APIs. Zero bundle impact. | Confirmed: navigator.storage.estimate(), navigator.storage.persist(), IDBDatabase.onclose, IDB transactions -- all browser built-ins. fake-indexeddb 6.2.5 already installed for test support. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native IndexedDB API | Browser built-in | Integrity check transactions, sentinel records, orphan detection | Already used throughout persistence layer. Zero bundle cost. |
| Navigator Storage API | Browser built-in | Quota estimation, persistent storage requests, eviction detection | `navigator.storage.estimate()` and `navigator.storage.persist()` -- zero bundle cost. |
| IDBDatabase.onclose | Browser built-in | Detect unexpected database closure (eviction, manual clear) | Standard event handler, supported Chrome 31+, Firefox 50+, Safari 14+. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| fake-indexeddb | ^6.2.5 (already installed) | IDB test simulation including `forceCloseDatabase()` | All IDB-related tests. v6.2.0+ added `forceCloseDatabase()` for onclose simulation. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw IDB transactions | `idb` npm package (promise wrapper) | Project already uses raw IDB consistently across 60 files. Adding idb would require rewriting ConversationStore/SessionStore for no gain. Stick with raw IDB. |
| Raw IDB transactions | Dexie ORM | Heavyweight ORM adds abstraction. Project uses ~200 lines of direct IDB code that is well-understood. Unnecessary. |
| `navigator.storage.estimate()` | Periodic IDB write-and-read probe | Storage API gives quota info directly. Probe approach is slower and wasteful. |

**Installation:**
```bash
# No new packages needed. All APIs are browser built-ins.
# fake-indexeddb@^6.2.5 already in devDependencies.
npm ls fake-indexeddb
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  persistence/
    db.ts                    # MODIFIED: add onclose handler, reopenDB()
    integrity-checker.ts     # NEW: orphan detection + grace-period cleanup
    storage-health.ts        # NEW: quota monitoring + persist request + sentinel
    conversation-store.ts    # UNCHANGED
    session-store.ts         # UNCHANGED
    boot-restore.ts          # UNCHANGED (integrity wired at boot level, not here)
    auto-save.ts             # UNCHANGED (Phase 15 scope)
    types.ts                 # UNCHANGED
  types.ts                   # MODIFIED: add persistence event types to AppEventMap
  glasses-main.ts            # MODIFIED: wire integrity + health into boot sequence
  hub-main.ts                # MODIFIED: wire integrity + health into initPersistence
```

### Pattern 1: Factory/Closure with Read-Only Detection + Opt-In Repair
**What:** IntegrityChecker uses the project's factory/closure pattern. `check()` is read-only and safe to run every boot. `cleanupOrphans()` is a separate mutation that requires explicit call with re-verification.
**When to use:** Any time detection and action must be separated for safety.
**Example:**
```typescript
// Source: project pattern (conversation-store.ts, session-store.ts)
export interface IntegrityReport {
  orphanedMessageIds: string[];
  danglingPointer: boolean;
  sentinelPresent: boolean;
  conversationCount: number;
  messageCount: number;
  checkedAt: number;
}

export interface IntegrityChecker {
  check(): Promise<IntegrityReport>;
  cleanupOrphans(ids: string[]): Promise<number>;
  writeSentinel(): Promise<void>;
}

export function createIntegrityChecker(db: IDBDatabase): IntegrityChecker {
  const SENTINEL_ID = '__sentinel__';

  function check(): Promise<IntegrityReport> {
    return new Promise((resolve, reject) => {
      const report: IntegrityReport = {
        orphanedMessageIds: [],
        danglingPointer: false,
        sentinelPresent: false,
        conversationCount: 0,
        messageCount: 0,
        checkedAt: Date.now(),
      };

      const tx = db.transaction(['conversations', 'messages'], 'readonly');
      const convStore = tx.objectStore('conversations');
      const msgStore = tx.objectStore('messages');

      // Load all conversation IDs into a Set
      const convIds = new Set<string>();
      const keysReq = convStore.getAllKeys();
      keysReq.onsuccess = () => {
        for (const key of keysReq.result as string[]) {
          if (key === SENTINEL_ID) {
            report.sentinelPresent = true;
          } else {
            convIds.add(key);
          }
        }
        report.conversationCount = convIds.size;

        // Scan messages for orphans
        const cursorReq = msgStore.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            report.messageCount++;
            const msg = cursor.value;
            if (!convIds.has(msg.conversationId)) {
              report.orphanedMessageIds.push(msg.id);
            }
            cursor.continue();
          }
        };
      };

      // Check dangling pointer
      try {
        const savedId = localStorage.getItem('openclaw-active-conversation');
        if (savedId && !convIds?.has(savedId)) {
          report.danglingPointer = true;
        }
      } catch {
        // localStorage unavailable
      }

      tx.oncomplete = () => resolve(report);
      tx.onerror = () => reject(tx.error);
    });
  }

  // ... cleanupOrphans and writeSentinel implementations
  return { check, cleanupOrphans, writeSentinel };
}
```

### Pattern 2: Feature-Detect + Fallback for Storage APIs
**What:** Always feature-detect browser APIs before use. Return safe defaults when unavailable.
**When to use:** Any Storage API usage (navigator.storage.estimate, persist, persisted).
**Example:**
```typescript
// Source: MDN StorageManager API docs
export async function getStorageHealth(): Promise<StorageHealth> {
  if (!('storage' in navigator) || !('estimate' in navigator.storage)) {
    return {
      usageBytes: 0, quotaBytes: 0, usagePercent: 0,
      isPersisted: false, isAvailable: false,
    };
  }

  const estimate = await navigator.storage.estimate();
  const isPersisted = await navigator.storage.persisted?.() ?? false;

  return {
    usageBytes: estimate.usage ?? 0,
    quotaBytes: estimate.quota ?? 0,
    usagePercent: estimate.quota
      ? ((estimate.usage ?? 0) / estimate.quota) * 100
      : 0,
    isPersisted,
    isAvailable: true,
  };
}
```

### Pattern 3: IDB Callback Pattern (Safari-Safe)
**What:** Use `tx.oncomplete`, `req.onsuccess` callbacks directly. Never use async/await within IDB transaction boundaries.
**When to use:** All IndexedDB operations in this project.
**Why:** Safari/WebKit closes IDB transactions more aggressively when microtask boundaries (await, Promise.then) occur between IDB operations within a single transaction. The existing codebase correctly uses callbacks throughout -- new code must follow this pattern exactly.
**Example:**
```typescript
// CORRECT -- follows existing codebase pattern
function check(): Promise<IntegrityReport> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['conversations', 'messages'], 'readonly');
    // All IDB ops use req.onsuccess, cursorReq.onsuccess
    // No await between IDB operations within this transaction
    tx.oncomplete = () => resolve(report);
    tx.onerror = () => reject(tx.error);
  });
}

// WRONG -- will break on Safari/WebKit
async function check(): Promise<IntegrityReport> {
  const tx = db.transaction(['conversations', 'messages'], 'readonly');
  const keys = await getAllKeysAsync(tx);  // await causes microtask boundary
  // Safari may auto-commit tx here!
  const messages = await scanMessages(tx); // TransactionInactiveError on Safari
}
```

### Pattern 4: Sentinel Record for Eviction Detection
**What:** Write a known record to IDB on first run. On subsequent boots, if IDB opens but sentinel is missing, data was evicted by the OS.
**When to use:** Distinguishing "first run ever" from "data was wiped by storage pressure."
**Example:**
```typescript
// Sentinel stored in conversations store to avoid schema migration
const SENTINEL_ID = '__sentinel__';

function writeSentinel(): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('conversations', 'readwrite');
    tx.objectStore('conversations').put({
      id: SENTINEL_ID,
      name: '__sentinel__',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
```
**Why conversations store:** Avoids schema migration (no new object store). Sentinel record has the same shape as ConversationRecord. `getAllConversations()` filters it out by convention (or sentinel ID starts with `__` which no UUID would).

### Anti-Patterns to Avoid

- **Per-write verification (Pitfall P1):** Never read-back a record immediately after writing to "verify" it was saved. Under relaxed durability (Chrome 121+), the read sees in-memory data, not disk. Write verification adds latency with zero durability benefit. Use boot-time integrity checks instead.
- **Auto-delete orphans on first detection (Pitfall P2):** Never delete orphaned records immediately. Cross-context writes may produce false-positive orphans (glasses wrote a message milliseconds before hub's integrity scan). Always use a grace period (30+ seconds) with re-verification.
- **Async/await inside IDB transactions (Pitfall P11):** Safari auto-commits transactions at microtask boundaries. Use the callback pattern (tx.oncomplete, req.onsuccess) exactly as the existing codebase does.
- **Over-engineering integrity for a two-store schema (Pitfall P9):** The only integrity violation possible is orphaned messages (conversationId -> no conversation) and dangling session pointer (localStorage -> deleted conversation). Two checks, under 50 lines. Nothing more.
- **Integrity checks on every navigation:** Run once per boot. Cache results. Never on page navigation.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Storage quota estimation | Custom IDB size calculator (summing record sizes) | `navigator.storage.estimate()` | Built-in API, returns usage/quota in one call, zero cost |
| Persistent storage request | Custom cache pinning or data backup | `navigator.storage.persist()` | OS-level eviction protection, one API call |
| Database close detection | Polling `indexedDB.open()` to check availability | `IDBDatabase.onclose` event handler | Native event, zero CPU cost, fires immediately |
| IDB promise wrapper | Custom promisify utility for IDB transactions | Raw callback pattern (match existing code) | The codebase already uses callbacks consistently. A wrapper introduces Safari auto-commit risk. |
| Schema migration framework | Versioned migration runner | Native `onupgradeneeded` with `event.oldVersion` check | Only one schema version exists (v1). Premature abstraction. |

**Key insight:** Every "infrastructure" problem in this phase is already solved by browser built-in APIs. The implementation work is wiring these APIs into the existing boot sequence and event bus, not building new abstractions.

## Common Pitfalls

### Pitfall 1: Sentinel Record Conflicts with ConversationStore Queries
**What goes wrong:** The sentinel record (`__sentinel__`) lives in the conversations store. `getAllConversations()` returns it in the list. The hub shows a conversation named "__sentinel__" in the session list.
**Why it happens:** `getAllConversations()` uses a cursor on `by-updatedAt` index with no filtering. The sentinel has the same shape as a ConversationRecord.
**How to avoid:** Either (a) filter sentinel in `getAllConversations()` by checking `id !== '__sentinel__'`, or (b) use a separate object store for metadata (requires schema migration). Option (a) is strongly preferred -- one line of filtering vs schema change.
**Warning signs:** "__sentinel__" appears in session list. Sentinel shows up in search results.

### Pitfall 2: Dangling Pointer Check Has Race Condition with localStorage
**What goes wrong:** The integrity check reads `localStorage.getItem('openclaw-active-conversation')` and checks if the conversation exists in IDB. Between the check and any corrective action, the other context may write a new active session pointer. The "fix" overwrites a valid pointer.
**Why it happens:** localStorage is shared and has no locking. The hub could be writing a new active session while glasses run integrity.
**How to avoid:** Only flag dangling pointer in the report. Never auto-fix it. `restoreOrCreateConversation()` already handles dangling pointers gracefully (falls through to `getLastConversation()` on line 51). The existing code is resilient to this -- the integrity check's role is diagnostic, not corrective.
**Warning signs:** Active session pointer changes unexpectedly after boot.

### Pitfall 3: Storage Health API Returns Estimates, Not Exact Values
**What goes wrong:** `navigator.storage.estimate()` returns estimated values. Developers treat `usage` and `quota` as precise and make critical decisions (like blocking writes at 95%).
**Why it happens:** MDN explicitly states: "The returned values are not exact; between compression, deduplication, and obfuscation for security reasons, they will be imprecise."
**How to avoid:** Use estimates for user-facing indicators (progress bars, warnings) only. Never use them to make write-blocking decisions. The 80%/95% thresholds are advisory warnings, not hard limits.
**Warning signs:** App refuses to save because estimate says 96% but actual usage is lower.

### Pitfall 4: onclose Handler Creates Infinite Reconnect Loop
**What goes wrong:** IDBDatabase.onclose fires, the handler calls reopenDB(), the new DB immediately closes again (e.g., because storage was cleared). reopenDB() fires onclose again. CPU spins.
**Why it happens:** If the underlying storage was evicted, every new DB connection may immediately close.
**How to avoid:** Add a retry counter and cooldown to reopenDB(). Maximum 3 attempts, 1-second delay between. After exhaustion, emit `persistence:error` with `recoverable: false` and stop trying. Let the user restart the app.
**Warning signs:** Console shows rapid sequence of "Database connection closed" / "Reopening database" messages.

### Pitfall 5: Integrity Check Delays Boot Visibly
**What goes wrong:** Integrity check with full cursor scan takes 200ms+ on large databases (1000+ messages). Combined with storage health API call, boot adds 300ms+ of delay during the "Connecting..." splash.
**Why it happens:** Cursor scan is O(n) in total message count.
**How to avoid:** Use `getAllKeys()` instead of full cursor scan for conversations (keys only, no value deserialization). For messages, cursor scan is necessary to read `conversationId`, but the value is small (MessageRecord). At typical sizes (<1000 messages), this completes in <10ms. If boot latency becomes a problem, defer integrity check to after display init (run during idle time).
**Warning signs:** "Connecting..." stays on screen for noticeably longer.

## Code Examples

### Boot Sequence Integration (glasses-main.ts)
```typescript
// Source: existing glasses-main.ts boot() pattern + new integrity modules
// Inserted between openDB() and restoreOrCreateConversation()

// After: const db = await openDB();
// After: store = createConversationStore(db);

// NEW: Integrity check (read-only, <10ms)
const integrityChecker = createIntegrityChecker(db);
const integrityReport = await integrityChecker.check();

// NEW: Sentinel check for eviction detection
if (!integrityReport.sentinelPresent) {
  if (integrityReport.conversationCount === 0) {
    // Could be first run OR eviction -- check localStorage for evidence
    const hadPreviousData = localStorage.getItem('openclaw-conversation-count');
    if (hadPreviousData) {
      bus.emit('storage:evicted', {});
    }
    // Write sentinel for future boots
    await integrityChecker.writeSentinel();
  } else {
    // Conversations exist but sentinel missing -- sentinel was evicted selectively (unlikely)
    await integrityChecker.writeSentinel();
  }
}

// NEW: Storage health
const storageHealth = createStorageHealth();
const quota = await storageHealth.getQuota();
if (quota.isAvailable) {
  bus.emit('persistence:health', quota);
  if (!quota.isPersisted) {
    const granted = await storageHealth.requestPersistence();
    if (granted) {
      bus.emit('log', { level: 'info', msg: 'Persistent storage granted' });
    } else {
      bus.emit('log', { level: 'warn', msg: 'Persistent storage denied' });
    }
  }
}

// Existing: restoreOrCreateConversation({store})
```

### IDBDatabase.onclose Handler (db.ts modification)
```typescript
// Source: MDN IDBDatabase close event documentation
// Added inside openDB() after request.onsuccess

let currentDb: IDBDatabase | null = null;
let reopenAttempts = 0;
const MAX_REOPEN_ATTEMPTS = 3;
const REOPEN_DELAY_MS = 1000;

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => { /* existing schema setup */ };

    request.onsuccess = () => {
      const db = request.result;
      currentDb = db;

      // NEW: Hook onclose for unexpected closure detection
      db.onclose = () => {
        currentDb = null;
        // Emit event for interested listeners (ErrorPresenter, health page)
        // Note: bus is not available here -- use a module-level callback
        if (onUnexpectedClose) onUnexpectedClose();
      };

      resolve(db);
    };

    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      console.warn('[db] Database upgrade blocked by another tab');
    };
  });
}

// NEW: Reopen after unexpected closure
export async function reopenDB(): Promise<IDBDatabase> {
  if (reopenAttempts >= MAX_REOPEN_ATTEMPTS) {
    throw new Error('Max reopen attempts exceeded');
  }
  reopenAttempts++;
  await new Promise((r) => setTimeout(r, REOPEN_DELAY_MS));
  const db = await openDB();
  reopenAttempts = 0; // Reset on success
  return db;
}

// Module-level callback for onclose notification
let onUnexpectedClose: (() => void) | null = null;
export function setOnUnexpectedClose(cb: () => void): void {
  onUnexpectedClose = cb;
}
```

### AppEventMap Extensions (types.ts)
```typescript
// Source: ARCHITECTURE.md research + requirements RES-20
// All additive -- no existing events modified

export interface AppEventMap {
  // ... existing events unchanged ...

  // Phase 14: Data Integrity Foundation
  'persistence:error': {
    type: 'database-closed' | 'quota-exceeded' | 'write-failed' | 'verify-failed';
    recoverable: boolean;
    message?: string;
    conversationId?: string;
  };
  'persistence:health': {
    usageBytes: number;
    quotaBytes: number;
    usagePercent: number;
    isPersisted: boolean;
    isAvailable: boolean;
  };
  'storage:evicted': {};

  // Note: sync:drift-detected, sync:reconciled, fsm:watchdog-reset,
  // health:status-change are deferred to their respective phases (16, 17, 18)
}
```

### Storage Health Module (storage-health.ts)
```typescript
// Source: MDN Storage API documentation
export interface StorageHealth {
  usageBytes: number;
  quotaBytes: number;
  usagePercent: number;
  isPersisted: boolean;
  isAvailable: boolean;
}

export interface StorageHealthService {
  getQuota(): Promise<StorageHealth>;
  requestPersistence(): Promise<boolean>;
}

export function createStorageHealth(): StorageHealthService {
  async function getQuota(): Promise<StorageHealth> {
    if (!('storage' in navigator) || !('estimate' in navigator.storage)) {
      return {
        usageBytes: 0, quotaBytes: 0, usagePercent: 0,
        isPersisted: false, isAvailable: false,
      };
    }

    const estimate = await navigator.storage.estimate();
    let isPersisted = false;
    if ('persisted' in navigator.storage) {
      isPersisted = await navigator.storage.persisted();
    }

    return {
      usageBytes: estimate.usage ?? 0,
      quotaBytes: estimate.quota ?? 0,
      usagePercent: estimate.quota
        ? ((estimate.usage ?? 0) / estimate.quota) * 100
        : 0,
      isPersisted,
      isAvailable: true,
    };
  }

  async function requestPersistence(): Promise<boolean> {
    if (!('storage' in navigator) || !('persist' in navigator.storage)) {
      return false;
    }
    return navigator.storage.persist();
  }

  return { getQuota, requestPersistence };
}
```

### Orphan Cleanup with Grace Period and Re-Verification
```typescript
// Source: Pitfall P2 research -- grace period prevents cross-context false positives
const ORPHAN_GRACE_MS = 30_000; // 30 seconds

async function cleanupOrphans(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;

  // Re-verify: some "orphans" may have gained a conversation since detection
  const stillOrphaned = await reVerifyOrphans(db, ids);
  if (stillOrphaned.length === 0) return 0;

  return new Promise((resolve, reject) => {
    const tx = db.transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    for (const id of stillOrphaned) {
      store.delete(id);
    }
    tx.oncomplete = () => resolve(stillOrphaned.length);
    tx.onerror = () => reject(tx.error);
  });
}

// Re-verify reads conversations in a new transaction to catch races
function reVerifyOrphans(db: IDBDatabase, ids: string[]): Promise<string[]> {
  return new Promise((resolve) => {
    const tx = db.transaction(['conversations', 'messages'], 'readonly');
    const convStore = tx.objectStore('conversations');
    const msgStore = tx.objectStore('messages');
    const convIds = new Set<string>();
    const confirmed: string[] = [];

    const keysReq = convStore.getAllKeys();
    keysReq.onsuccess = () => {
      for (const key of keysReq.result as string[]) {
        convIds.add(key);
      }

      // Check each suspected orphan
      let checked = 0;
      for (const id of ids) {
        const getReq = msgStore.get(id);
        getReq.onsuccess = () => {
          checked++;
          if (getReq.result && !convIds.has(getReq.result.conversationId)) {
            confirmed.push(id);
          }
          if (checked === ids.length) {
            // Will resolve when tx.oncomplete fires
          }
        };
      }
    };

    tx.oncomplete = () => resolve(confirmed);
  });
}
```

### Testing Patterns for Storage APIs
```typescript
// Source: Vitest + fake-indexeddb patterns from existing test suite
import 'fake-indexeddb/auto';

// Mock navigator.storage for quota/health tests
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

// Test IDBDatabase.onclose with fake-indexeddb forceCloseDatabase()
import { forceCloseDatabase } from 'fake-indexeddb';

it('detects unexpected database closure', async () => {
  const db = await openDB();
  const closeHandler = vi.fn();
  db.onclose = closeHandler;
  forceCloseDatabase(db);
  expect(closeHandler).toHaveBeenCalledOnce();
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| IDB relaxed durability was Chrome only | Chrome 121+ defaults to relaxed (matching Firefox/Safari) | Chrome 121, Jan 2024 | Per-write read-back verification is pointless under relaxed default. Use boot-time integrity checks instead. |
| No standard eviction detection API | `IDBDatabase.onclose` + sentinel record pattern | Chrome 31+, standardized | Eviction now detectable at database level (onclose) and data level (sentinel). |
| Manual quota estimation | `navigator.storage.estimate()` | Chrome 61+, Safari 17+ (2023) | Browser provides usage/quota estimates directly. No need to calculate IDB size manually. |
| Best-effort storage (default, evictable) | `navigator.storage.persist()` to request OS protection | Chrome 52+, Safari 15.2+ | One API call protects against eviction. Chrome auto-approves based on engagement. |
| IDB error injection via raw API | Wrapper-level mocking at ConversationStore interface | fake-indexeddb limitation (issue #59) | fake-indexeddb does not support error injection. Mock at the store interface using factory pattern. |

**Deprecated/outdated:**
- `window.webkitStorageInfo` / `navigator.webkitTemporaryStorage`: Replaced by `navigator.storage.estimate()`. Do not use.
- `IDBDatabase.onclose` as `onclose` property: Both property form and `addEventListener('close', ...)` work. Property form is fine for single handler (our use case).

## Open Questions

1. **navigator.storage.persist() behavior in Even App WKWebView**
   - What we know: Safari 15.2+ supports persist(). Chrome auto-approves based on engagement. WKWebView on iOS 17+ supports the Storage API.
   - What's unclear: Whether `navigator.storage.persist()` returns `true` in flutter_inappwebview's WKWebView. Even App may not qualify as a "Home Screen Web App" which is one of WebKit's heuristics for granting persistence.
   - Recommendation: Call persist() anyway and log the result. Feature-detect. If denied, show warning on hub health page. Do NOT block on the answer -- the sentinel record provides eviction detection regardless of persistence status.

2. **Sentinel record in conversations store vs separate object store**
   - What we know: Using conversations store avoids schema migration. Sentinel has ConversationRecord shape.
   - What's unclear: Whether `getAllConversations()` callers filter correctly, or whether sentinel appears in search results.
   - Recommendation: Use conversations store. Filter `__sentinel__` in `getAllConversations()` and `searchMessages()`. One-line filter per function. Much simpler than schema migration.

3. **Grace period timing for orphan cleanup**
   - What we know: 30 seconds is specified in RES-05. Cross-context writes via BroadcastChannel typically complete in <100ms.
   - What's unclear: Whether 30 seconds is sufficient for all race conditions, especially if BC is unavailable and the other context has not yet booted.
   - Recommendation: Use 30 seconds as specified. Store orphan detection timestamp in localStorage. On next boot (or after 30s timeout within same session), re-verify and clean. This is safe because the worst case is orphans persisting one extra boot cycle.

## Sources

### Primary (HIGH confidence)
- [MDN: IDBDatabase close event](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/close_event) -- onclose handler API, not fired on intentional close
- [MDN: StorageManager.estimate()](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate) -- usage/quota estimation API
- [MDN: StorageManager.persist()](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist) -- persistent storage request API
- [MDN: Storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) -- quota limits, eviction policy
- [WebKit: Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/) -- WKWebView quota breakdown (15% non-browser, 60% browser app), 7-day inactivity eviction
- [Can I Use: StorageManager estimate()](https://caniuse.com/mdn-api_storagemanager_estimate) -- browser support matrix
- Existing codebase analysis: `db.ts`, `conversation-store.ts`, `session-store.ts`, `boot-restore.ts`, `auto-save.ts`, `types.ts`, `events.ts`, `sync-bridge.ts`, `sync-types.ts`, `glasses-main.ts`, `hub-main.ts` -- direct source inspection

### Secondary (MEDIUM confidence)
- [flutter_inappwebview: Web Storage Manager](https://inappwebview.dev/docs/web-storage-manager/) -- WebStorage support in flutter_inappwebview
- [flutter_inappwebview issue #928](https://github.com/pichillilorenzo/flutter_inappwebview/issues/928) -- localStorage persistence issues on iOS
- v1.3 research streams: `.planning/research/ARCHITECTURE.md`, `.planning/research/STACK.md`, `.planning/research/PITFALLS.md` -- foundational analysis of all resilience features

### Tertiary (LOW confidence)
- navigator.storage.persist() in flutter_inappwebview WKWebView -- no direct documentation found. Behavior inferred from Safari/WKWebView Storage API support. Needs real-hardware validation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all browser built-in APIs with verified MDN documentation and browser support matrices
- Architecture: HIGH -- follows existing project patterns (factory/closure, event bus, IDB callbacks). New modules sit alongside existing ones without modifying signatures.
- Pitfalls: HIGH -- verified against v1.3 PITFALLS.md research (P1, P2, P4, P9, P11) with codebase-specific mitigation strategies

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (stable APIs, no expected changes)
