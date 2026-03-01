---
phase: 14-data-integrity-foundation
plan: 05
subsystem: persistence
tags: [indexeddb, localStorage, orphan-cleanup, grace-period, diagnostics]

# Dependency graph
requires:
  - phase: 14-02
    provides: cleanupOrphans() function in integrity-checker.ts
  - phase: 14-03
    provides: integrity check wiring in boot sequences (glasses-main, hub-main)
provides:
  - Orphan grace-period lifecycle (30s) with localStorage timestamp persistence
  - cleanupOrphans() called for confirmed-stale orphans on subsequent boots
  - orphanCount field in DiagnosticsPayload for hub copy-diagnostics
affects: [hub-diagnostics, data-integrity, resilience]

# Tech tracking
tech-stack:
  added: []
  patterns: [localStorage-based grace-period scheduling, conditional spread for optional payload fields]

key-files:
  created: []
  modified:
    - src/glasses-main.ts
    - src/hub-main.ts
    - src/types.ts
    - src/logs.ts

key-decisions:
  - "Both boot files share localStorage orphan keys for cross-context cleanup (glasses detects, hub cleans or vice versa)"
  - "staleOrphans filter (intersection of previous + current) provides scheduling-layer re-verification before IDB-layer re-verification in cleanupOrphans()"
  - "orphanCount uses conditional spread to omit field entirely when no orphans present (clean payload)"

patterns-established:
  - "Grace-period pattern: persist detection timestamp, check elapsed on next boot, act only after threshold"

requirements-completed: [RES-05]

# Metrics
duration: 4min
completed: 2026-02-28
---

# Phase 14 Plan 05: Orphan Grace Period and Diagnostics Summary

**Orphan grace-period lifecycle with 30s timestamp-based scheduling and orphanCount in hub diagnostics payload**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-28T19:48:28Z
- **Completed:** 2026-02-28T19:52:21Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Orphan IDs and detection timestamp persisted to localStorage on boot when orphans detected
- Grace period (30 seconds) enforced before cleanup: subsequent boots check elapsed time and call cleanupOrphans() for confirmed-stale orphans
- Orphan count surfaced in hub diagnostics payload via optional orphanCount field in DiagnosticsPayload
- Cross-context cleanup works: glasses and hub share the same localStorage keys for orphan tracking
- All 398 existing tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement orphan grace-period lifecycle in glasses-main.ts and hub-main.ts boot sequences** - `762239e` (feat)
2. **Task 2: Surface orphan count in hub diagnostics payload** - `c3432be` (feat)

## Files Created/Modified
- `src/glasses-main.ts` - Added orphan grace-period lifecycle in boot sequence (localStorage persist, 30s check, cleanupOrphans call)
- `src/hub-main.ts` - Added same grace-period lifecycle with console logging instead of bus events
- `src/types.ts` - Added optional orphanCount field to DiagnosticsPayload interface
- `src/logs.ts` - Updated buildDiagnostics to read orphan count from localStorage and include in payload

## Decisions Made
- Both boot files share localStorage orphan keys (`openclaw-orphan-ids`, `openclaw-orphan-detected-at`) enabling cross-context cleanup -- if glasses detects orphans and hub boots 30+ seconds later, hub can clean them up
- staleOrphans filter uses intersection of previous and current boot orphans for scheduling-layer re-verification (cleanupOrphans() performs second IDB-layer re-verification for double safety)
- orphanCount uses conditional spread (`...(orphanCount !== undefined && { orphanCount })`) to omit field when no orphans exist, keeping diagnostics payload clean

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- RES-05 fully satisfied: orphan grace period lifecycle + hub diagnostics surface
- Phase 14 (data-integrity-foundation) is now complete with all 5 plans executed
- All integrity foundation requirements (sentinel, orphan cleanup, storage health, boot wiring, reopenDB, grace period) are in place

## Self-Check: PASSED

All files verified present. All commit hashes verified in git log.

---
*Phase: 14-data-integrity-foundation*
*Completed: 2026-02-28*
