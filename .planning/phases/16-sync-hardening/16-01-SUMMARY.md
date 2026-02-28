---
phase: 16-sync-hardening
plan: 01
subsystem: sync
tags: [indexeddb, heartbeat, sequence-tracking, drift-detection, tdd]

# Dependency graph
requires:
  - phase: 10-session-management
    provides: SyncBridge cross-context messaging
  - phase: 09-persistence-layer
    provides: ConversationStore IDB operations
provides:
  - SyncMonitor with seq tracking, gap detection, heartbeat, isAlive
  - DriftReconciler with 2-consecutive-mismatch rule and callback pattern
  - countMessages using O(1) IDB index.count()
  - sync:drift-detected and sync:reconciled event types in AppEventMap
  - SyncMonitor, DriftReconciler interfaces in sync-types.ts
affects: [16-02-boot-wiring, sync, persistence]

# Tech tracking
tech-stack:
  added: []
  patterns: [2-consecutive-mismatch drift detection, monotonic sequence numbering, callback-pattern reconciler]

key-files:
  created:
    - src/sync/sync-monitor.ts
    - src/sync/drift-reconciler.ts
    - src/__tests__/sync-monitor.test.ts
    - src/__tests__/drift-reconciler.test.ts
  modified:
    - src/types.ts
    - src/sync/sync-types.ts
    - src/persistence/types.ts
    - src/persistence/conversation-store.ts
    - src/__tests__/conversation-store.test.ts

key-decisions:
  - "DriftReconciler uses callback pattern (not bus) for portability across glasses and hub contexts"
  - "SyncMonitor isAlive() returns true when no heartbeat ever received (peer may not have started)"
  - "2-consecutive-mismatch rule prevents false positives during active streaming"
  - "countMessages uses IDB index.count() for O(1) performance"

patterns-established:
  - "Callback-pattern modules: DriftReconciler takes onDriftDetected/onReconciled callbacks instead of requiring event bus"
  - "Monotonic seq numbering: SyncMonitor stamps every outgoing message with incrementing seq"
  - "2-consecutive-mismatch rule: drift detection requires two consecutive heartbeat mismatches before triggering"

requirements-completed: [RES-09, RES-10, RES-11, RES-12, RES-20]

# Metrics
duration: 5min
completed: 2026-02-28
---

# Phase 16 Plan 01: Sync Hardening Logic Summary

**SyncMonitor with monotonic seq tracking, 10s heartbeat, and DriftReconciler with 2-consecutive-mismatch IDB count reconciliation**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-28T21:42:25Z
- **Completed:** 2026-02-28T21:47:52Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments
- SyncMonitor wraps SyncBridge to add sequence numbers, gap detection, peer reboot handling, heartbeat at 10s, and 30s liveness checking
- DriftReconciler detects IDB message count mismatches using 2-consecutive-mismatch rule with bus-agnostic callback pattern
- countMessages added to ConversationStore using O(1) IDB index.count()
- All sync types extended: seq field on all SyncMessage variants, sync:heartbeat variant, sync:drift-detected and sync:reconciled events in AppEventMap

## Task Commits

Each task was committed atomically:

1. **Task 1: Add sync event types, seq field, heartbeat variant, and countMessages** - `10aca79` (feat)
2. **Task 2: TDD SyncMonitor -- sequence tracking and heartbeat** - `f7d9c48` (test RED), `e6618c4` (feat GREEN)
3. **Task 3: TDD DriftReconciler -- count mismatch detection** - `69843aa` (test RED), `bef5d96` (feat GREEN)
4. **Fix: Remove unused import** - `ef3cc5e` (fix)

_Note: TDD tasks have separate RED (test) and GREEN (implementation) commits._

## Files Created/Modified
- `src/sync/sync-monitor.ts` - SyncMonitor factory with seq tracking, heartbeat, gap detection, isAlive
- `src/sync/drift-reconciler.ts` - DriftReconciler factory with 2-consecutive-mismatch rule
- `src/__tests__/sync-monitor.test.ts` - 13 SyncMonitor unit tests
- `src/__tests__/drift-reconciler.test.ts` - 7 DriftReconciler unit tests
- `src/types.ts` - Added sync:drift-detected and sync:reconciled to AppEventMap
- `src/sync/sync-types.ts` - Added seq field, sync:heartbeat variant, SyncMonitor/DriftReconciler interfaces
- `src/persistence/types.ts` - Added countMessages to ConversationStore interface
- `src/persistence/conversation-store.ts` - Implemented countMessages with IDB index.count()
- `src/__tests__/conversation-store.test.ts` - Added 2 countMessages tests

## Decisions Made
- DriftReconciler uses callback pattern (onDriftDetected/onReconciled) instead of event bus for portability across glasses (has bus) and hub (no bus) contexts
- isAlive() returns true when no heartbeat ever received, following research Pitfall 5 (peer may not have started yet)
- 2-consecutive-mismatch rule prevents false positives during active streaming sessions
- countMessages uses IDB index.count() with IDBKeyRange.only() for O(1) performance (no cursor scan)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed unused afterEach import from sync-monitor test**
- **Found during:** Verification (tsc --noEmit)
- **Issue:** afterEach was imported but never used, causing TS6133
- **Fix:** Removed unused import
- **Files modified:** src/__tests__/sync-monitor.test.ts
- **Committed in:** ef3cc5e

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Trivial cleanup, no scope change.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SyncMonitor and DriftReconciler are pure modules ready for boot wiring in Plan 02
- All interfaces defined in sync-types.ts for typed integration
- Event types ready in AppEventMap for bus emission in boot wiring

## Self-Check: PASSED

All 5 created/modified files verified. All 6 commits verified.

---
*Phase: 16-sync-hardening*
*Completed: 2026-02-28*
