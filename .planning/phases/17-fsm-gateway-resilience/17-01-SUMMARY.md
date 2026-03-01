---
phase: 17-fsm-gateway-resilience
plan: 01
subsystem: gestures
tags: [fsm, watchdog, timer, event-bus, resilience]

# Dependency graph
requires:
  - phase: 02-gesture-fsm
    provides: gesture FSM pure function and gesture-handler wiring
  - phase: 16-sync-hardening
    provides: sync events in AppEventMap
provides:
  - fsm:watchdog-reset event type in AppEventMap
  - 45-second watchdog timer for transient FSM states
  - response_delta streaming keepalive for watchdog
  - watchdog cleanup on destroy
affects: [18-error-ux, gateway-resilience]

# Tech tracking
tech-stack:
  added: []
  patterns: [external-watchdog-over-pure-fsm, closure-capture-for-timer-state]

key-files:
  created: []
  modified:
    - src/types.ts
    - src/gestures/gesture-handler.ts
    - src/__tests__/gesture-handler.test.ts

key-decisions:
  - "Watchdog is external concern in gesture-handler.ts, not in pure gesture-fsm.ts"
  - "startWatchdog() called on every transition, clears itself for non-transient states"
  - "response_delta chunks reset watchdog to prevent false positives during active streaming"

patterns-established:
  - "External watchdog pattern: timer logic in handler, pure FSM untouched"
  - "Closure capture for timer state: const watchedState = state before setTimeout"

requirements-completed: [RES-13, RES-20]

# Metrics
duration: 3min
completed: 2026-03-01
---

# Phase 17 Plan 01: FSM Watchdog Timer Summary

**45-second watchdog timer auto-resets stuck FSM from transient states (recording/sent/thinking) to idle, with response_delta streaming keepalive and fsm:watchdog-reset event for Phase 18 error UX**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-01T00:54:51Z
- **Completed:** 2026-03-01T00:57:39Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added `fsm:watchdog-reset` event type to AppEventMap with `{ previousState: string; elapsed: number }` payload
- Implemented 45-second watchdog timer in gesture-handler.ts for transient states (recording, sent, thinking)
- Watchdog resets on every state transition and on response_delta chunks (prevents false positives during streaming)
- Watchdog cleared on destroy() to prevent dangling timer callbacks
- Added 9 comprehensive watchdog tests covering all edge cases
- Preserved gesture-fsm.ts as pure function (zero modifications)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add fsm:watchdog-reset event type and implement watchdog timer** - `4cc6160` (feat)
2. **Task 2: Add watchdog timer tests to gesture-handler test suite** - `cfd1f51` (test)

## Files Created/Modified
- `src/types.ts` - Added `fsm:watchdog-reset` event type to AppEventMap
- `src/gestures/gesture-handler.ts` - Added WATCHDOG_MS constant, TRANSIENT_STATES set, clearWatchdog/startWatchdog functions, response_delta keepalive, destroy cleanup
- `src/__tests__/gesture-handler.test.ts` - Added 9 watchdog tests in scoped describe block with fake timers

## Decisions Made
- Watchdog is external concern in gesture-handler.ts, not in pure gesture-fsm.ts -- preserves FSM purity
- startWatchdog() called on every transition, clears itself for non-transient states (idle, menu) -- single code path
- response_delta chunks reset watchdog to prevent false positives during active streaming (Pitfall P2 from research)
- Fake timers scoped to watchdog describe block only, not affecting other gesture-handler tests

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- fsm:watchdog-reset event ready for Phase 18 Error UX to display user notification
- Plan 17-02 (gateway error classification) can proceed independently
- All 34 gesture-handler tests pass (25 existing + 9 new)

## Self-Check: PASSED

All files, commits, and content verified.

---
*Phase: 17-fsm-gateway-resilience*
*Completed: 2026-03-01*
