---
phase: 14-data-integrity-foundation
plan: 04
subsystem: persistence
tags: [indexeddb, reopendb, error-recovery, onclose]

# Dependency graph
requires:
  - phase: 14-01
    provides: "reopenDB() function in db.ts with retry logic"
  - phase: 14-03
    provides: "setOnUnexpectedClose callbacks in both boot files"
provides:
  - "IDB onclose callbacks that attempt reopenDB() before giving up"
  - "recoverable: false persistence:error on max retry exhaustion (glasses)"
  - "Fatal console logging on max retry exhaustion (hub)"
affects: [18-error-ux]

# Tech tracking
tech-stack:
  added: []
  patterns: [fire-and-forget Promise chain in synchronous callbacks]

key-files:
  created: []
  modified:
    - src/glasses-main.ts
    - src/hub-main.ts

key-decisions:
  - "reopenDB() uses .then()/.catch() (not async/await) since onclose is synchronous fire-and-forget"
  - "Initial persistence:error with recoverable: true kept before reopenDB call to notify listeners of drop"
  - "Second persistence:error with recoverable: false only emitted on max retry exhaustion"

patterns-established:
  - "Promise chain pattern for recovery in synchronous callbacks: emit initial error, attempt recovery, emit fatal on failure"

requirements-completed: [RES-15]

# Metrics
duration: 2min
completed: 2026-02-28
---

# Phase 14 Plan 04: reopenDB Wiring Summary

**Wire reopenDB() into IDB onclose callbacks in glasses-main.ts and hub-main.ts for automatic database reconnection after unexpected closure**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-28T19:44:19Z
- **Completed:** 2026-02-28T19:46:15Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Both onclose callbacks now call reopenDB() after emitting/logging the initial error
- On success, recovery is logged (bus event on glasses, console on hub)
- On max retry exhaustion, recoverable: false persistence:error emitted (glasses) or fatal logged (hub)
- RES-15 fully satisfied: onclose emits persistence:error AND attempts reopenDB()
- All 398 tests pass, TypeScript compiles clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire reopenDB() into onclose callbacks** - `c20b2d4` (feat)

## Files Created/Modified
- `src/glasses-main.ts` - Added reopenDB to import, wired reopenDB() call in setOnUnexpectedClose callback with success/failure handling
- `src/hub-main.ts` - Added reopenDB to dynamic import, wired reopenDB() call in setOnUnexpectedClose callback with console logging

## Decisions Made
- Used `.then()/.catch()` Promise chain (not async/await) since the onclose callback is synchronous and fire-and-forget -- reopenDB runs in the background
- Kept existing `recoverable: true` persistence:error emission before the reopenDB call so listeners know the connection dropped immediately
- The second `recoverable: false` error only fires if all 3 retry attempts fail, signaling that a restart is required
- Hub uses console.log/console.error (no bus) consistent with existing hub conventions

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- RES-15 requirement fully closed
- Phase 18 (Error UX) can build on the `recoverable: false` persistence:error to show "restart required" messaging
- Plan 14-05 (orphan grace period + diagnostics) is the remaining gap-closure plan

## Self-Check: PASSED

- FOUND: src/glasses-main.ts
- FOUND: src/hub-main.ts
- FOUND: commit c20b2d4
- FOUND: 14-04-SUMMARY.md

---
*Phase: 14-data-integrity-foundation*
*Completed: 2026-02-28*
