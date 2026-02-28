---
phase: 14-data-integrity-foundation
verified: 2026-02-28T19:35:00Z
status: gaps_found
score: 13/15 must-haves verified
gaps:
  - truth: "IDB database onclose handler attempts reopenDB() on unexpected closure"
    status: partial
    reason: "onclose callback emits persistence:error correctly but does NOT call reopenDB(). The function exists and is exported from db.ts but is never invoked from glasses-main.ts or hub-main.ts onclose handlers. RES-15 explicitly requires 'Attempt reopenDB()'."
    artifacts:
      - path: "src/glasses-main.ts"
        issue: "setOnUnexpectedClose callback (lines 86-93) emits persistence:error and logs but never calls reopenDB()"
      - path: "src/hub-main.ts"
        issue: "setOnUnexpectedClose callback (lines 979-981) only logs but never calls reopenDB()"
      - path: "src/persistence/db.ts"
        issue: "reopenDB() is exported and correctly implemented but never called from boot wiring"
    missing:
      - "In the onclose callback in glasses-main.ts, call reopenDB() after emitting persistence:error"
      - "In the onclose callback in hub-main.ts, call reopenDB() after the console.error log"
      - "Handle reopenDB() failure (exhausted attempts) in both boot contexts"
  - truth: "Orphan cleanup grace period scheduling and hub diagnostics surface are implemented"
    status: failed
    reason: "RES-05 requires: (1) mark suspected orphans with timestamp, (2) only delete after 30-second grace period, (3) surface orphan counts in hub diagnostics. Phase 14 implements the re-verification mechanism in cleanupOrphans() and detects orphans on boot, but does not schedule the 30-second grace period, does not persist orphan timestamps to localStorage, and does not surface orphan counts in the hub diagnostics UI. The 14-02 plan must_have truths only cover the cleanupOrphans() mechanism itself, not the grace period scheduler or hub surface."
    artifacts:
      - path: "src/glasses-main.ts"
        issue: "Orphans detected and logged (lines 61-63) but no timestamp persisted, no grace period scheduled, no cleanupOrphans() ever called"
      - path: "src/hub-main.ts"
        issue: "Orphans detected and logged (lines 967-969) but same as above -- no grace period, no hub diagnostics surface"
    missing:
      - "Persist orphan IDs with detection timestamp to localStorage on boot"
      - "On subsequent boots, check if grace period (30 seconds) has elapsed and call cleanupOrphans() for confirmed-stale orphans"
      - "Surface orphan count in hub diagnostics UI (health page or copy-diagnostics payload)"
---

# Phase 14: Data Integrity Foundation Verification Report

**Phase Goal:** Boot-time integrity checking, storage health monitoring, eviction detection, and persistent storage -- the foundation all other resilience features depend on.
**Verified:** 2026-02-28T19:35:00Z
**Status:** gaps_found
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | AppEventMap includes persistence:error, persistence:health, storage:evicted | VERIFIED | src/types.ts lines 120-133: all three event types present with correct payload shapes |
| 2 | IDBDatabase.onclose handler emits persistence:error on unexpected closure | VERIFIED | src/persistence/db.ts line 46-48: `db.onclose = () => { if (onUnexpectedClose) onUnexpectedClose(); }` |
| 3 | reopenDB() exists with cooldown and max attempts | VERIFIED | src/persistence/db.ts lines 78-97: retry logic with MAX_REOPEN_ATTEMPTS=3, REOPEN_DELAY_MS=1000 |
| 4 | IDB onclose callback attempts reopenDB() after emitting error | PARTIAL | reopenDB() exported and implemented but never called from boot wiring callbacks in glasses-main or hub-main |
| 5 | Sentinel record filtered from getAllConversations, getLastConversation, searchMessages | VERIFIED | src/persistence/conversation-store.ts: SENTINEL_ID check at lines 145, 167, 253 |
| 6 | Boot-time integrity check detects orphaned messages in single readonly transaction | VERIFIED | src/persistence/integrity-checker.ts lines 36-84: single readonly tx over [conversations, messages], getAllKeys + cursor scan |
| 7 | Boot-time integrity check detects dangling localStorage pointer | VERIFIED | integrity-checker.ts lines 70-82: localStorage read inside tx.oncomplete (correctly after convIds populated) |
| 8 | Sentinel record detected as present or missing on each check | VERIFIED | integrity-checker.ts lines 46-48: SENTINEL_ID key check in getAllKeys loop |
| 9 | writeSentinel() creates idempotent sentinel record | VERIFIED | integrity-checker.ts lines 87-101: put() on conversations store with ConversationRecord shaped sentinel |
| 10 | cleanupOrphans() re-verifies before deletion | VERIFIED | integrity-checker.ts lines 106-153: two-phase pattern -- readonly tx re-verify then readwrite tx delete |
| 11 | Storage quota estimated via navigator.storage.estimate() on boot | VERIFIED | storage-health.ts lines 31-47: estimate() call with feature detection; glasses-main.ts line 72 emits persistence:health |
| 12 | Persistent storage requested on first boot via navigator.storage.persist() | VERIFIED | glasses-main.ts lines 79-81: requestPersistence() called when !quota.isPersisted, result logged |
| 13 | Grace period orphan cleanup scheduled with timestamp marking | FAILED | No localStorage timestamp persisted for orphan IDs, no grace period scheduling, cleanupOrphans() never called from boot wiring |
| 14 | Glasses and hub boot sequences run integrity check and storage health | VERIFIED | glasses-main.ts lines 44-93 and hub-main.ts lines 947-981: both call createIntegrityChecker and createStorageHealth |
| 15 | Zero new runtime dependencies | VERIFIED | package.json dependencies: only "@evenrealities/even_hub_sdk" -- unchanged from before Phase 14 |

**Score:** 13/15 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/types.ts` | Persistence event types in AppEventMap | VERIFIED | Lines 119-133: persistence:error, persistence:health, storage:evicted present with correct payload shapes |
| `src/persistence/db.ts` | onclose handler, reopenDB(), setOnUnexpectedClose() | VERIFIED | All four exports present: openDB, closeDB, reopenDB, setOnUnexpectedClose. onclose hook wired in openDB() |
| `src/persistence/conversation-store.ts` | Sentinel filtering in 3 query methods | VERIFIED | SENTINEL_ID exported (line 12), filtered in getAllConversations (145), getLastConversation (167), searchMessages (253) |
| `src/persistence/integrity-checker.ts` | IntegrityChecker factory with check(), writeSentinel(), cleanupOrphans() | VERIFIED | 157 lines. Exports createIntegrityChecker, IntegrityReport, IntegrityChecker. All three methods implemented |
| `src/persistence/__tests__/integrity-checker.test.ts` | Tests for all integrity check behaviors | VERIFIED | 319 lines. 16 tests covering empty DB, orphan detection, sentinel, dangling pointer, writeSentinel idempotency, cleanupOrphans re-verification and mixed cases |
| `src/persistence/storage-health.ts` | StorageHealthService with getQuota() and requestPersistence() | VERIFIED | 59 lines. Exports createStorageHealth, StorageHealth, StorageHealthService. Feature-detected with truthiness check |
| `src/persistence/__tests__/storage-health.test.ts` | Tests for storage health with mocked navigator.storage | VERIFIED | 191 lines. 10 tests covering quota estimation, usagePercent, unavailable API, persisted() fallback, requestPersistence all cases |
| `src/glasses-main.ts` | Boot wiring for integrity checker and storage health | VERIFIED | Lines 44-93: createIntegrityChecker, createStorageHealth, setOnUnexpectedClose all called. Sentinel, eviction, quota, persistence all handled |
| `src/hub-main.ts` | Boot wiring in initPersistence | VERIFIED | Lines 947-981: dynamic imports for createIntegrityChecker, createStorageHealth, setOnUnexpectedClose. All called in initPersistence() |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| src/persistence/db.ts | src/types.ts (persistence:error) | onclose callback emits persistence:error event type | WIRED | Pattern "persistence:error" found in db.ts via setOnUnexpectedClose callback pattern; boot code emits event in glasses-main.ts line 87 |
| src/persistence/conversation-store.ts | sentinel filter | id !== '__sentinel__' check in cursor loops | WIRED | SENTINEL_ID constant used at lines 145, 167, 253 in cursor/result loops |
| src/persistence/integrity-checker.ts | IDB conversations + messages stores | Single readonly transaction for check() | WIRED | Line 36: `db.transaction(['conversations', 'messages'], 'readonly')` confirmed |
| src/persistence/integrity-checker.ts | src/persistence/conversation-store.ts | Imports SENTINEL_ID constant | WIRED | Line 6: `import { SENTINEL_ID } from './conversation-store'` |
| src/persistence/storage-health.ts | navigator.storage API | Feature-detected estimate() and persist() calls | WIRED | Lines 21, 31, 51: truthiness feature detection and API calls present |
| src/glasses-main.ts | src/persistence/integrity-checker.ts | createIntegrityChecker(db) called after openDB() | WIRED | Lines 22 (import) + 44-45 (called after openDB) |
| src/glasses-main.ts | src/persistence/storage-health.ts | createStorageHealth() called after integrity check | WIRED | Lines 23 (import) + 69 (called after integrity report) |
| src/hub-main.ts | src/persistence/integrity-checker.ts | createIntegrityChecker(db) called in initPersistence | WIRED | Lines 947-952: dynamic import + call |
| src/hub-main.ts | src/persistence/storage-health.ts | createStorageHealth() called in initPersistence | WIRED | Lines 948-972: dynamic import + call |
| glasses-main.ts onclose callback | reopenDB() | reopenDB() called after persistence:error emission | NOT WIRED | onclose callback emits event and logs, never calls reopenDB() |
| hub-main.ts onclose callback | reopenDB() | reopenDB() called after console.error | NOT WIRED | onclose callback only console.errors, never calls reopenDB() |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| RES-01 | 14-02 | Boot-time integrity check: orphaned messages + dangling pointer, single readonly IDB tx, under 50ms/50 lines | SATISFIED | integrity-checker.ts check() uses one readonly tx, 60 lines of core logic. 16 passing tests including orphan and dangling pointer cases |
| RES-02 | 14-03 | Storage health monitoring: navigator.storage.estimate() on boot, emit quota info, warn at 80%/95% | SATISFIED | storage-health.ts getQuota() calls estimate(). glasses-main.ts lines 71-77 emit persistence:health and log at 80%/95% thresholds |
| RES-03 | 14-03 | Persistent storage request: navigator.storage.persist() on first boot, log result | SATISFIED | glasses-main.ts lines 79-81: requestPersistence() called when !isPersisted. Result logged. Hub also calls requestPersistence() when not persisted |
| RES-04 | 14-03 | Eviction detection via sentinel: write on first run, emit storage:evicted if missing on subsequent boot | SATISFIED | glasses-main.ts lines 48-53: sentinel check, eviction detection against localStorage count, writeSentinel() call. storage:evicted emitted at line 51 |
| RES-05 | 14-02 | Orphan cleanup: mark with timestamp, 30-second grace period, re-verify before deletion, surface counts in hub diagnostics | BLOCKED | cleanupOrphans() re-verification mechanism exists and is tested. However: (1) no timestamp marking in localStorage, (2) no grace period scheduling on boot, (3) no hub diagnostics surface for orphan counts. cleanupOrphans() is never called from boot code -- orphans are only logged |
| RES-15 | 14-01 | IDB onclose handler: emit persistence:error database-closed, attempt reopenDB() | BLOCKED | onclose hook registered in db.ts, persistence:error emitted in glasses-main.ts callback. But reopenDB() never called -- the "Attempt reopenDB()" half of RES-15 is missing |
| RES-20 (persistence events only) | 14-01 | Add persistence:error, persistence:health, storage:evicted to AppEventMap | SATISFIED | src/types.ts lines 119-133: all three persistence event types added. Sync, fsm, health events correctly deferred to other phases |
| RES-22 | 14-01, 14-03 | Zero new runtime dependencies | SATISFIED | package.json dependencies unchanged. Only @evenrealities/even_hub_sdk present. All Storage and IDB APIs are browser built-ins |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | -- | -- | -- | -- |

No TODO/FIXME/placeholder comments, empty implementations, or stub handlers found in any Phase 14 modified files.

### Human Verification Required

#### 1. Persistent Storage Grant UX (RES-03)

**Test:** In a browser that supports navigator.storage.persist(), boot the glasses app on a fresh profile. Check the console log for "Persistent storage granted" or "Persistent storage denied".
**Expected:** Log message appears. On Chrome with sufficient engagement, "granted" is expected. On first visit, "denied" may appear depending on browser heuristics.
**Why human:** Browser engagement heuristics are runtime behavior that cannot be verified programmatically.

#### 2. storage:evicted Event Trigger (RES-04)

**Test:** Boot the app, create a conversation (sentinel gets written, count persisted). Manually clear IndexedDB via DevTools. Reboot the app. Check if storage:evicted is emitted.
**Expected:** On second boot with empty IDB but existing localStorage conversation-count, storage:evicted event fires.
**Why human:** Requires simulated eviction via DevTools; cannot trigger IDB eviction in automated tests.

#### 3. Integrity Check Latency (RES-01)

**Test:** Boot the app with a database containing ~100 conversations and ~1000 messages. Measure elapsed time from openDB() to after integrityChecker.check() resolves.
**Expected:** Under 50ms on typical hardware.
**Why human:** Performance measurement requires real browser + realistic data size.

### Gaps Summary

Two gaps block complete RES-15 and RES-05 satisfaction:

**Gap 1 (RES-15 partial):** `reopenDB()` is built, exported, and correctly implements retry with cooldown -- but the boot-wiring onclose callbacks in `glasses-main.ts` and `hub-main.ts` never call it. The callbacks emit `persistence:error` (correct) but stop there. The RES-15 requirement text and research both state "Attempt reopenDB()". The fix is small: call `reopenDB()` inside the onclose callback and handle the rejection case (max retries exhausted) by emitting a `recoverable: false` persistence:error.

**Gap 2 (RES-05 partial):** The orphan re-verification mechanism (`cleanupOrphans()`) is fully implemented and tested. However, the grace period lifecycle is absent: no timestamp is persisted when orphans are detected on boot, `cleanupOrphans()` is never called on subsequent boots, and orphan counts are not surfaced in the hub diagnostics UI. The boot code logs orphan counts (correct for visibility) but the cleanup pipeline ends there. This gap is larger than Gap 1 and may represent planned deferral (Phase 15 scope) rather than an oversight.

**Note on Phase 14 plan scope:** Both gaps correspond to behaviors that the Phase 14 PLAN frontmatter `must_haves.truths` did NOT explicitly include. The 14-02 plan truths cover `cleanupOrphans()` mechanics but not grace period scheduling. The 14-03 plan truths cover "IDB onclose handler registered" but not "attempts reopenDB()". This suggests the gaps may be intentional phase boundaries -- the mechanisms are built in Phase 14, with wiring expected in Phase 15 (Write Verification & Auto-Save Hardening). However, RES-15 is explicitly listed as a Phase 14 requirement, making the `reopenDB()` wiring a genuine gap for this phase.

---

## Commit Verification

All 6 Phase 14 commits verified present in git history:

| Commit | Plan | Description |
|--------|------|-------------|
| `ab710e8` | 14-01 Task 1 | Add persistence event types and IDBDatabase.onclose |
| `5190e77` | 14-01 Task 2 | Filter sentinel records from ConversationStore queries |
| `afd7809` | 14-02 Task 1 (RED) | Add failing tests for IntegrityChecker |
| `4aea396` | 14-02 Task 2 (GREEN) | Implement IntegrityChecker |
| `da71202` | 14-03 Task 1 | Create StorageHealth module |
| `f8d6035` | 14-03 Task 2 | Wire integrity checker, storage health, and onclose into boot sequences |

## Test Results

- **Total tests:** 398 passing (0 failing)
- **New tests added:** 26 (16 integrity-checker + 10 storage-health)
- **Regressions:** None
- **TypeScript:** Clean compile (0 errors)

---

_Verified: 2026-02-28T19:35:00Z_
_Verifier: Claude (gsd-verifier)_
