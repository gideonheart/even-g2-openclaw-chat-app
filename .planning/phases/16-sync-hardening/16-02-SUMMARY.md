---
phase: 16-sync-hardening
plan: 02
subsystem: sync
tags: [sync-bridge, heartbeat, drift-reconciliation, boot-wiring, lifecycle]

# Dependency graph
requires:
  - phase: 16-sync-hardening
    provides: SyncMonitor, DriftReconciler, countMessages, sync event types
  - phase: 10-session-management
    provides: SyncBridge cross-context messaging, SessionManager
provides:
  - SyncMonitor + DriftReconciler wired into glasses-main.ts boot lifecycle
  - SyncMonitor + DriftReconciler wired into hub-main.ts boot lifecycle
  - Heartbeat starts after display init in glasses, after persistence init in hub
  - Drift reconciliation triggers re-render (glasses) or loadLiveConversation (hub)
  - Proper teardown order (syncMonitor before syncBridge) in both contexts
affects: [sync, glasses-main, hub-main]

# Tech tracking
tech-stack:
  added: []
  patterns: [observer-wrapper boot wiring, sync monitor before bridge teardown order]

key-files:
  created: []
  modified:
    - src/glasses-main.ts
    - src/hub-main.ts

key-decisions:
  - "SyncMonitor created after syncBridge, destroyed before syncBridge in both contexts"
  - "Glasses drift reconciliation re-renders via renderer.destroy()+init() cycle then replays messages from IDB"
  - "Hub drift reconciliation calls loadLiveConversation() to re-read from IDB"
  - "Hub SyncMonitor created after SessionManager so getActiveConversationId can reference mgr"
  - "Existing syncBridge.onMessage handlers and auto-save callers left unchanged (SyncMonitor is independent observer)"

patterns-established:
  - "Monitor-before-bridge teardown: always destroy SyncMonitor before SyncBridge to prevent heartbeat on closed channel"
  - "Conditional sync wiring: SyncMonitor/DriftReconciler created only when store is available (null guards)"

requirements-completed: [RES-09, RES-10, RES-11, RES-12, RES-20]

# Metrics
duration: 3min
completed: 2026-02-28
---

# Phase 16 Plan 02: Boot Wiring Summary

**SyncMonitor and DriftReconciler wired into both glasses-main.ts and hub-main.ts with heartbeat start, drift re-render, and ordered teardown**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-28T21:50:28Z
- **Completed:** 2026-02-28T21:53:47Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Glasses boot creates SyncMonitor + DriftReconciler, starts heartbeat after display init, wires sync:reconciled to re-render from IDB, destroys monitor before bridge in cleanup
- Hub boot creates SyncMonitor + DriftReconciler in initPersistence(), starts heartbeat, wires reconciliation to loadLiveConversation(), destroys monitor before bridge on beforeunload
- All existing 433 tests pass, TypeScript compiles clean, Vite builds successfully

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire SyncMonitor and DriftReconciler into glasses-main.ts** - `5ce7183` (feat)
2. **Task 2: Wire SyncMonitor and DriftReconciler into hub-main.ts** - `c183672` (feat)

## Files Created/Modified
- `src/glasses-main.ts` - Added SyncMonitor + DriftReconciler creation, heartbeat start, sync:reconciled re-render handler, ordered teardown
- `src/hub-main.ts` - Added SyncMonitor + DriftReconciler creation in initPersistence(), heartbeat start, syncMonitor in return type, module-level hubSyncMonitor, ordered beforeunload teardown

## Decisions Made
- SyncMonitor created after syncBridge, destroyed before syncBridge in both contexts (prevents heartbeat on closed channel)
- Glasses drift reconciliation uses renderer.destroy()+init() cycle then replays all IDB messages (same pattern as switchToSession)
- Hub drift reconciliation simply calls loadLiveConversation() which already handles IDB re-read and live view refresh
- Hub SyncMonitor placed after SessionManager creation so getActiveConversationId callback can reference mgr
- Existing syncBridge.onMessage handlers and auto-save callers left entirely unchanged -- SyncMonitor subscribes independently alongside them

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 16 sync hardening is complete -- both contexts track sequence numbers, send heartbeats every 10s, and automatically reconcile presentation drift by re-reading from IDB
- SyncMonitor.isAlive() is available in both contexts for future liveness checking UI
- Ready for Phase 17 or other v1.3 resilience phases

## Self-Check: PASSED

All 2 modified files verified. All 2 commits verified.

---
*Phase: 16-sync-hardening*
*Completed: 2026-02-28*
