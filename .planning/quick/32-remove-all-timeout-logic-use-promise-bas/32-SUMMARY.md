---
phase: quick-32
plan: 01
subsystem: api, gestures
tags: [fetch, abort-controller, watchdog, timeout, fsm]

# Dependency graph
requires:
  - phase: quick-29
    provides: "handleTurnError extraction"
provides:
  - "Timeout-free gateway client with promise-based error propagation"
  - "Unified 120s watchdog for all transient FSM states"
  - "Silent AbortError handling (manual abort only)"
affects: [gateway-client, gesture-handler, health-indicator]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Promise-based fetch error propagation (no setTimeout wrappers)"]

key-files:
  created: []
  modified:
    - src/api/gateway-client.ts
    - src/gestures/gesture-handler.ts
    - src/__tests__/gateway-client.test.ts
    - src/__tests__/gesture-handler.test.ts

key-decisions:
  - "AbortError handled silently (no error chunk, no status change) -- manual abort means user started new request"
  - "Unified WATCHDOG_MS=120_000 for all transient states (recording, sent, thinking) -- 210s for sent was only needed to exceed removed 180s timeout"

patterns-established:
  - "No setTimeout-based timeouts on fetch -- let promises resolve/reject naturally"
  - "Manual abort via AbortController is silent, not an error condition"

requirements-completed: [QUICK-32]

# Metrics
duration: 5min
completed: 2026-03-03
---

# Quick Task 32: Remove All Timeout Logic Summary

**Timeout-free gateway client with silent AbortError handling and unified 120s watchdog for all transient FSM states**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-03T21:18:44Z
- **Completed:** 2026-03-03T21:23:57Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Removed all timeout constants, setTimeout/clearTimeout, and voiceTurnTimeout() from gateway-client
- handleTurnError silently returns on AbortError (no error chunk, no status change)
- Removed setStatus('connecting') from sendVoiceTurn and sendTextTurn (fixes Health tab flash)
- Unified gesture-handler watchdog to single WATCHDOG_MS=120_000 constant
- All 628 tests pass, build succeeds with zero errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove timeout logic from gateway-client.ts and fix status handling** - `b2eae13` (refactor)
2. **Task 2: Simplify gesture-handler watchdog to unified 120s and update tests** - `17c2391` (refactor)
3. **Task 3: Build verification and full test suite** - (verification only, no code changes)

## Files Created/Modified
- `src/api/gateway-client.ts` - Removed timeout constants/functions, simplified sendVoiceTurn/sendTextTurn, silent AbortError
- `src/gestures/gesture-handler.ts` - Single WATCHDOG_MS=120_000, removed watchdogMs() function
- `src/__tests__/gateway-client.test.ts` - Deleted 2 timeout tests, updated AbortError tests to assert silent handling, precise status assertions
- `src/__tests__/gesture-handler.test.ts` - Updated 5 watchdog tests from 210s to 120s for sent state

## Decisions Made
- AbortError handled silently (return early, no error chunk) because manual abort only occurs when user starts a new request -- the old request being cancelled is expected
- Unified watchdog to 120s for all states because the 210s sent timeout was only needed to exceed the now-removed 180s voice turn timeout
- Removed setStatus('connecting') entirely -- fetch naturally resolves/rejects, no artificial intermediate state needed

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Gateway client is now timeout-free with clean promise-based error propagation
- Watchdog is simplified to a single constant for all transient states
- Ready for further voice loop refinements

## Self-Check: PASSED

- All 5 files exist on disk
- Both task commits verified: b2eae13 (Task 1), 17c2391 (Task 2)
- npm run build: success (0 errors)
- npx vitest run: 628 tests passed (0 failures)
- Verification grep checks: all 6 pass

---
*Phase: quick-32*
*Completed: 2026-03-03*
