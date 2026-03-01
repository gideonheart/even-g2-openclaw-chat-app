# Phase 19: Test Infrastructure & Resilience Coverage - Research

**Researched:** 2026-03-01
**Domain:** Test infrastructure, failure simulation helpers, integration tests for IDB/sync/error resilience
**Confidence:** HIGH

## Summary

Phase 19 is the final phase of the v1.3 Resilience & Error UX milestone. Its sole requirement (RES-21) is to create failure simulation test helpers and integration tests that exercise all resilience features built in Phases 14-18.5. The project already has 484 passing tests across 32 test files using Vitest 3.0 + jsdom + fake-indexeddb 6.2.5, with strong unit test coverage for each resilience module in isolation. What is missing is: (1) reusable failure-injection helpers that wrap existing interfaces (`ConversationStore`, `SyncBridge`) to simulate IDB failures, quota exhaustion, and message loss; and (2) integration tests that verify cross-module resilience scenarios end-to-end (e.g., IDB close triggers reopenDB triggers module recreation triggers health dot update).

The codebase's factory/closure pattern and typed interfaces make failure injection straightforward -- helpers wrap real stores/bridges with interceptors that fail after N operations, drop every Nth message, or reject with specific error types. The already-installed fake-indexeddb 6.2.5 provides `forceCloseDatabase()` for simulating IDB unexpected closure. No new dependencies are needed.

**Primary recommendation:** Create `src/__tests__/helpers/failure-helpers.ts` with `createFailingStore`, `createLossySyncBridge`, and `createQuotaExceededStore`, then write integration test suites that compose these helpers with real modules to verify multi-module failure scenarios.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| RES-21 | Failure simulation test helpers -- createFailingStore (fails after N writes), createLossySyncBridge (drops every Nth message). Uses existing fake-indexeddb forceCloseDatabase() for IDB closure simulation. No new dev dependencies. | Fully supported: fake-indexeddb 6.2.5 already installed with forceCloseDatabase() export. ConversationStore and SyncBridge interfaces support wrapper-based mocking. Existing test patterns (auto-save.test.ts line 162-166) already demonstrate ad-hoc failing store creation. This phase formalizes and extends that pattern. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^3.0.0 | Test runner, assertions, mocking | Already project standard, 484 tests passing |
| fake-indexeddb | ^6.2.5 | IDB polyfill + `forceCloseDatabase()` | Already installed, provides IDB closure simulation since v6.2.0 |
| jsdom | ^25.0.0 | DOM environment for tests | Already project standard, configured in vite.config.ts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest `vi.fn()` / `vi.spyOn()` | (built-in) | Mock functions and spies | All test assertions on callbacks |
| vitest `vi.useFakeTimers()` | (built-in) | Time control for heartbeat/watchdog tests | Tests involving timers (heartbeat, auto-clear, watchdog) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom failure-helpers.ts | MSW (Mock Service Worker) | MSW is for HTTP mocking; overkill for IDB/sync interface wrapping. Project already uses vi.fn() for fetch mocking. |
| Wrapper-level IDB mocking | fake-indexeddb error injection | fake-indexeddb does NOT support error injection (confirmed GitHub issue #59). Wrapper mocking at ConversationStore interface level is the correct approach. |
| Custom MockBroadcastChannel | npm vitest-broadcast-channel-mock | Project's existing MockBroadcastChannel in sync-bridge.test.ts is superior -- correctly routes cross-peer (sender does not receive own messages). |

**Installation:**
```bash
# No new packages needed -- all dependencies already installed
npm ls fake-indexeddb vitest jsdom
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── __tests__/
│   ├── helpers/
│   │   └── failure-helpers.ts       # NEW: reusable failure injection utilities
│   ├── integration/
│   │   ├── integrity-flow.test.ts   # NEW: IDB integrity check -> cleanup -> health
│   │   ├── sync-resilience.test.ts  # NEW: message loss -> drift -> reconciliation
│   │   └── error-escalation.test.ts # NEW: write failure -> retry -> escalation -> presenter
│   ├── auto-save.test.ts            # EXISTING: 24 tests (already has ad-hoc failing store)
│   ├── conversation-store.test.ts   # EXISTING: 20+ tests
│   ├── sync-monitor.test.ts         # EXISTING: 14 tests
│   ├── drift-reconciler.test.ts     # EXISTING: 8 tests
│   └── ...                          # 32 existing test files
└── ...
```

### Pattern 1: Interface-Level Failure Injection
**What:** Wrap real ConversationStore/SyncBridge instances with interceptors that inject failures at configurable points.
**When to use:** All failure simulation tests. This is the ONLY correct approach since fake-indexeddb does not support native error injection.
**Example:**
```typescript
// Source: STACK.md research + existing auto-save.test.ts pattern (line 162)
import type { ConversationStore } from '../../persistence/types';

export function createFailingStore(
  realStore: ConversationStore,
  failAfterN: number,
): ConversationStore {
  let writeCount = 0;
  return {
    ...realStore,
    addMessage: async (...args) => {
      writeCount++;
      if (writeCount > failAfterN) {
        throw new DOMException('Simulated write failure', 'AbortError');
      }
      return realStore.addMessage(...args);
    },
    createConversation: async (...args) => {
      writeCount++;
      if (writeCount > failAfterN) {
        throw new DOMException('Simulated write failure', 'AbortError');
      }
      return realStore.createConversation(...args);
    },
  };
}
```

### Pattern 2: forceCloseDatabase for IDB Closure Simulation
**What:** Use fake-indexeddb's `forceCloseDatabase()` to trigger `IDBDatabase.onclose`, simulating storage eviction or manual database deletion.
**When to use:** Tests that verify the IDB closure -> reopenDB -> module recreation pipeline.
**Example:**
```typescript
// Source: fake-indexeddb types.d.ts (line 14, 32)
import 'fake-indexeddb/auto';
import { forceCloseDatabase } from 'fake-indexeddb';
import { openDB, DB_NAME } from '../persistence/db';

it('IDB closure triggers onclose callback', async () => {
  const db = await openDB();
  const closeDetected = vi.fn();
  db.onclose = closeDetected;

  forceCloseDatabase(db);

  expect(closeDetected).toHaveBeenCalledOnce();
});
```

### Pattern 3: Composable Integration Tests
**What:** Wire real modules together (store, autoSave, syncMonitor, driftReconciler) with failure helpers injected at specific points to test cross-module resilience flows.
**When to use:** Integration test suites that verify multi-module behavior.
**Example:**
```typescript
// Compose real auto-save with failing store to test full escalation path
it('write failure -> retry exhaustion -> persistence:error -> presenter', async () => {
  vi.useFakeTimers();
  const store = createFailingStore(realStore, 0); // fail immediately
  const bus = createEventBus<AppEventMap>();
  const errors: Array<{ type: string }> = [];
  bus.on('persistence:error', (e) => errors.push(e));

  const autoSave = createAutoSave({
    bus, store,
    getConversationId: () => convId,
  });

  bus.emit('gateway:chunk', { type: 'transcript', text: 'test' });

  // Advance through retry delays
  for (let i = 0; i < 10; i++) {
    await vi.advanceTimersByTimeAsync(500);
  }

  expect(errors.length).toBeGreaterThan(0);
  expect(errors[0].type).toBe('write-failed');

  autoSave.destroy();
  vi.useRealTimers();
});
```

### Pattern 4: Mock Event Bus with Handler Tracking
**What:** Lightweight mock bus that tracks subscriptions and allows manual emission for integration tests.
**When to use:** Integration tests where the real event bus is needed but test needs to verify event flow.
**Example:**
```typescript
// Source: Existing pattern in glasses-error-presenter.test.ts (lines 9-33)
// and hub-error-presenter.test.ts (lines 7-28)
function createMockBus() {
  const handlers = new Map<string, Set<(payload: any) => void>>();
  function on(event: string, handler: (payload: any) => void): () => void {
    let set = handlers.get(event);
    if (!set) { set = new Set(); handlers.set(event, set); }
    set.add(handler);
    return () => { set!.delete(handler); };
  }
  function emit(event: string, payload: any): void {
    const set = handlers.get(event);
    if (!set) return;
    for (const h of set) h(payload);
  }
  return { on, emit };
}
```

### Anti-Patterns to Avoid
- **Testing implementation details:** Test observable behavior (events emitted, data persisted, UI state) not internal variables. The codebase uses closures -- internals are unreachable by design.
- **Over-mocking IDB:** Use real fake-indexeddb for integration tests. Only use `createFailingStore` wrapper when specifically testing failure paths. Integration tests should use real IDB operations.
- **Skipping teardown:** Every test must close DB and delete database in afterEach. Leftover IDB state between tests causes version conflicts with fake-indexeddb. Existing pattern: `closeDB(db); indexedDB.deleteDatabase(DB_NAME);`
- **Async test without proper waiting:** Use `await vi.advanceTimersByTimeAsync()` for timer-dependent tests. The existing auto-save tests use `await new Promise(r => setTimeout(r, 50))` for fire-and-forget saves.
- **Testing across vi.mock boundaries:** Integration tests that import boot files (glasses-main.ts, hub-main.ts) require extensive vi.mock setup (see glasses-main.test.ts -- 133 lines of mocks before import). Prefer testing module compositions directly instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| IDB database closure simulation | Custom IDB monkey-patching | `forceCloseDatabase()` from fake-indexeddb | Already installed, correctly simulates onclose event chain |
| IDB write failure simulation | Raw IDB transaction interception | `createFailingStore()` wrapper on ConversationStore interface | fake-indexeddb has no error injection (GitHub issue #59); interface wrapping is clean and typed |
| BroadcastChannel mock | npm mock package | Existing MockBroadcastChannel in sync-bridge.test.ts | Project's mock is superior (correct cross-peer routing, sender exclusion) |
| Event bus mock | Test framework plugin | Existing Map-based mock pattern from error-presenter tests | Already proven in 2 test files, lightweight, correct |
| Timer control | Custom timer mocking | vitest `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()` | Standard Vitest API, used in 6+ existing test files |

**Key insight:** The project's factory/closure architecture makes wrapper-based failure injection the natural and correct approach. Every module accepts its dependencies via options objects (ConversationStore, SyncBridge, EventBus), so swapping a real dependency for a failing wrapper requires zero module changes.

## Common Pitfalls

### Pitfall 1: fake-indexeddb State Leakage Between Tests
**What goes wrong:** Tests fail intermittently because IDB state from a previous test leaks into the next one.
**Why it happens:** fake-indexeddb uses in-memory storage that persists across tests unless explicitly cleaned. The `indexedDB.deleteDatabase(DB_NAME)` call in afterEach is required.
**How to avoid:** Every test file that uses `import 'fake-indexeddb/auto'` MUST have an afterEach that calls `closeDB(db); indexedDB.deleteDatabase(DB_NAME);`. Also clear localStorage if used.
**Warning signs:** Tests pass in isolation but fail when run together. "VersionError" or "blocked" errors in test output.

### Pitfall 2: Forgetting to Advance Timers for Retry Logic
**What goes wrong:** Tests that verify retry exhaustion or timer-based behavior pass trivially because timers never fire.
**Why it happens:** auto-save.ts uses `setTimeout(r, RETRY_DELAY_MS * (attempt + 1))` with delays of 500, 1000, 1500ms. Without `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()`, the test resolves before retries execute.
**How to avoid:** Use fake timers and advance through the full retry cycle. Existing pattern in auto-save.test.ts (line 179): `for (let i = 0; i < 10; i++) { await vi.advanceTimersByTimeAsync(500); }`
**Warning signs:** Test assertions pass with 0 events when expecting retries.

### Pitfall 3: Mixing Real and Fake Timers with IDB Operations
**What goes wrong:** `vi.useFakeTimers()` freezes all timer-based callbacks, but fake-indexeddb uses microtasks (Promises) for IDB operations. Mixing them can cause tests to hang.
**Why it happens:** fake-indexeddb resolves IDB requests via microtasks, not macrotasks. `vi.advanceTimersByTimeAsync()` processes microtasks, but `vi.advanceTimersByTime()` (sync version) does NOT.
**How to avoid:** Always use `vi.advanceTimersByTimeAsync()` (async) when tests involve both IDB operations and timers. Never use `vi.advanceTimersByTime()` (sync) with IDB.
**Warning signs:** Tests hang or timeout. IDB Promises never resolve.

### Pitfall 4: Integration Test Over-Mocking
**What goes wrong:** Integration tests mock so many modules that they no longer test real interactions. They become glorified unit tests.
**Why it happens:** The glasses-main.test.ts pattern requires 133 lines of vi.mock() calls to import the boot file. This level of mocking defeats the purpose of integration testing.
**How to avoid:** For integration tests, compose 2-3 real modules together (e.g., real ConversationStore + real AutoSave + real EventBus) with only the failure-injection point mocked. Do NOT try to integration-test the full boot sequence -- that requires vi.mock() for every import.
**Warning signs:** More mock setup lines than test assertion lines.

### Pitfall 5: Not Testing the Unhappy Path of forceCloseDatabase
**What goes wrong:** Tests verify that onclose fires but don't verify that subsequent IDB operations correctly fail or that reopenDB actually works.
**Why it happens:** `forceCloseDatabase()` triggers onclose but the database handle becomes invalid. Tests that only check the event miss the critical behavior: all subsequent operations on the closed handle should fail.
**How to avoid:** After forceCloseDatabase(), attempt a store operation and verify it fails. Then verify reopenDB() produces a working handle.
**Warning signs:** Tests for IDB closure only check that an event was emitted.

### Pitfall 6: createFailingStore Leaking Real Store State
**What goes wrong:** Tests using createFailingStore expect clean state but the underlying real store has data from setup.
**Why it happens:** createFailingStore wraps the real store. Read operations (getMessages, getConversation) pass through to the real store. If setup wrote data, reads see it even when writes are failing.
**How to avoid:** This is actually correct behavior (reads should work even when writes fail). But tests should be explicit about initial state. Setup should create only the minimum required data.
**Warning signs:** Tests have unexpected data in assertions.

## Code Examples

Verified patterns from existing codebase and official sources:

### Creating a QuotaExceeded Store
```typescript
// Source: STACK.md research pattern, adapted from auto-save.test.ts ad-hoc pattern
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
```

### Creating a Lossy Sync Bridge
```typescript
// Source: STACK.md research pattern
import type { SyncBridge, SyncMessage } from '../../sync/sync-types';

export function createLossySyncBridge(
  realBridge: SyncBridge,
  dropEveryN: number,
): SyncBridge {
  let msgCount = 0;
  return {
    postMessage: (msg: SyncMessage) => {
      msgCount++;
      if (msgCount % dropEveryN === 0) return; // silently dropped
      realBridge.postMessage(msg);
    },
    onMessage: realBridge.onMessage.bind(realBridge),
    destroy: realBridge.destroy.bind(realBridge),
  };
}
```

### Using forceCloseDatabase in Integration Test
```typescript
// Source: fake-indexeddb types.d.ts export (line 32)
import 'fake-indexeddb/auto';
import { forceCloseDatabase } from 'fake-indexeddb';
import { openDB, closeDB, DB_NAME, setOnUnexpectedClose } from '../persistence/db';
import { createConversationStore } from '../persistence/conversation-store';

describe('IDB closure integration', () => {
  let db: IDBDatabase;

  afterEach(() => {
    try { closeDB(db); } catch { /* may already be closed */ }
    indexedDB.deleteDatabase(DB_NAME);
  });

  it('forceCloseDatabase triggers onUnexpectedClose callback', async () => {
    db = await openDB();
    const onClose = vi.fn();
    setOnUnexpectedClose(onClose);

    forceCloseDatabase(db);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('store operations fail after database closure', async () => {
    db = await openDB();
    const store = createConversationStore(db);

    // Store works before closure
    const conv = await store.createConversation('Test');
    expect(conv.name).toBe('Test');

    // Close database
    forceCloseDatabase(db);

    // Store operations should fail
    await expect(store.createConversation('After close')).rejects.toThrow();
  });
});
```

### Integration Test: Auto-Save Escalation with Failing Store
```typescript
// Source: Existing auto-save.test.ts patterns (lines 477-541) extended
import 'fake-indexeddb/auto';
import { openDB, closeDB, DB_NAME } from '../persistence/db';
import { createConversationStore } from '../persistence/conversation-store';
import { createAutoSave } from '../persistence/auto-save';
import { createEventBus } from '../events';
import type { AppEventMap } from '../types';
import { createFailingStore } from './helpers/failure-helpers';

describe('auto-save error escalation integration', () => {
  it('createFailingStore(0) causes immediate persistence:error on first save', async () => {
    vi.useFakeTimers();
    const db = await openDB();
    const realStore = createConversationStore(db);
    const conv = await realStore.createConversation('Test');
    const failStore = createFailingStore(realStore, 0);
    const bus = createEventBus<AppEventMap>();
    const errors: Array<{ type: string; recoverable: boolean }> = [];
    bus.on('persistence:error', (e) => errors.push(e));

    const autoSave = createAutoSave({
      bus,
      store: failStore,
      getConversationId: () => conv.id,
    });

    bus.emit('gateway:chunk', { type: 'transcript', text: 'Will fail' });

    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(500);
    }

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].type).toBe('write-failed');
    expect(errors[0].recoverable).toBe(false);

    autoSave.destroy();
    closeDB(db);
    indexedDB.deleteDatabase(DB_NAME);
    vi.useRealTimers();
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Ad-hoc failing mocks inline in each test | Reusable createFailingStore/createLossySyncBridge helpers | Phase 19 (new) | DRY failure injection across all resilience tests |
| Unit tests only for resilience modules | Integration tests composing real modules with failure injection | Phase 19 (new) | Catches cross-module interaction bugs that unit tests miss |
| No IDB closure simulation | forceCloseDatabase() from fake-indexeddb 6.2.5 | Already available | Tests can verify the full IDB close -> reopen -> recreate pipeline |

**Deprecated/outdated:**
- None. The test stack (Vitest 3.0, fake-indexeddb 6.2.5, jsdom 25.0) is current.

## Open Questions

1. **How many integration test suites?**
   - What we know: RES-21 specifies failure helpers + integration tests for integrity/sync/error scenarios. Three natural groupings: (a) IDB integrity flow, (b) sync resilience flow, (c) error escalation flow.
   - What's unclear: Whether integration tests should also cover the full boot sequence (glasses-main.ts, hub-main.ts) or stay at the module-composition level.
   - Recommendation: Stay at module-composition level. Boot-sequence integration tests require 100+ lines of vi.mock() setup (see glasses-main.test.ts) and provide diminishing returns. The boot wiring is already verified by each phase's VERIFICATION.md (83/83 truths passing).

2. **Should failure-helpers.ts be in src/__tests__/helpers/ or src/__tests__/?**
   - What we know: Existing tests are all in `src/__tests__/`. No helpers directory exists yet.
   - What's unclear: Whether Vitest auto-discovers helpers if placed in a subdirectory.
   - Recommendation: Place in `src/__tests__/helpers/failure-helpers.ts`. The `include: ['src/**/*.test.ts']` pattern in vite.config.ts means Vitest only runs `*.test.ts` files, so helpers without `.test.ts` suffix are not auto-executed. This is the standard convention.

3. **Integration tests for the 5 low-severity audit issues?**
   - What we know: The milestone audit identified 5 low-severity integration issues (wrong eviction error type, quota-exceeded never emitted, orphaned storage:evicted event, unreachable hub fsm:watchdog-reset, unused hideBanner parameter). These are documented but not blocking.
   - What's unclear: Whether Phase 19 should test for these known-broken paths or only test the working paths.
   - Recommendation: Test the working paths. The broken paths are documented in the audit and are low-severity cosmetic issues. Testing them would create tests that intentionally fail, which is counterproductive. If those issues are fixed in future, tests can be added then.

## Sources

### Primary (HIGH confidence)
- Existing codebase: 32 test files, 484 passing tests -- direct source inspection of all patterns
- `fake-indexeddb` types.d.ts (line 14, 32): `forceCloseDatabase` export confirmed
- `fake-indexeddb` GitHub issue #59: no native error injection, wrapper mocking required
- `vite.config.ts` (line 28): `include: ['src/**/*.test.ts']` test discovery pattern
- `auto-save.test.ts` (lines 162-166): existing ad-hoc failing store pattern (`failStore: ConversationStore = { ...store, addMessage: () => Promise.reject(...) }`)
- `sync-bridge.test.ts` (lines 11-45): existing MockBroadcastChannel with correct cross-peer routing
- `glasses-error-presenter.test.ts` (lines 9-33): existing mock bus pattern
- `hub-error-presenter.test.ts` (lines 7-28): existing mock bus pattern
- `.planning/research/STACK.md` (lines 474-623): v1.3 research on test infrastructure, failure helpers design

### Secondary (MEDIUM confidence)
- `.planning/v1.3-MILESTONE-AUDIT.md`: 5 low-severity integration issues documented

### Tertiary (LOW confidence)
- None. All findings verified against existing codebase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed and proven across 484 tests
- Architecture: HIGH -- failure-injection patterns verified against existing test code and ConversationStore/SyncBridge interfaces
- Pitfalls: HIGH -- all pitfalls observed in existing test files or documented in research

**Research date:** 2026-03-01
**Valid until:** 2026-03-31 (stable -- no library version changes expected)
