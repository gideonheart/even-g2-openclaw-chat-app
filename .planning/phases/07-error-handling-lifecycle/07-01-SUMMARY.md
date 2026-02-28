---
phase: 07-error-handling-lifecycle
plan: 01
subsystem: api, gestures, display
tags: [abort-signal, timeout, fsm, error-recovery, event-bus]

# Dependency graph
requires:
  - phase: 06-runtime-wiring
    provides: Working voice loop with gesture FSM, gateway client, and display controller
provides:
  - FSM 'reset' input that returns any state to idle on gateway errors
  - 30-second request timeout on gateway voice turns (no retry on timeout)
  - showError(message) method on GlassesRenderer for error chat bubbles
  - Display controller error chunk -> showError wiring
  - Settle timer cancellation on new recording start
affects: [08-build-packaging]

# Tech tracking
tech-stack:
  added: []
  patterns: [timeout-via-abort-controller, error-chunk-to-fsm-reset]

key-files:
  created: []
  modified:
    - src/gestures/gesture-fsm.ts
    - src/gestures/gesture-handler.ts
    - src/api/gateway-client.ts
    - src/display/glasses-renderer.ts
    - src/display/display-controller.ts
    - src/__tests__/gesture-fsm.test.ts
    - src/__tests__/gesture-handler.test.ts
    - src/__tests__/gateway-client.test.ts
    - src/__tests__/glasses-renderer.test.ts
    - src/__tests__/display-controller.test.ts

key-decisions:
  - "Used setTimeout + abortController.abort(reason) instead of AbortSignal.any() for timeout composition — AbortSignal.any is not available in Node test environment"
  - "Error messages rendered as assistant-role chat bubbles with [Error] prefix rather than adding a new message role — avoids ChatMessage type changes"

patterns-established:
  - "Timeout via abort controller: setTimeout fires abortController.abort(new DOMException(..., 'TimeoutError')), catch checks signal.reason"
  - "Error recovery: gateway:chunk error -> handleInput('reset') -> FSM idle"

requirements-completed: [ERR-01, ERR-02]

# Metrics
duration: 8min
completed: 2026-02-28
---

# Plan 07-01: Error Recovery Summary

**FSM reset input, 30-second gateway timeout, and user-visible error messages enable immediate retry after gateway failures**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-28
- **Completed:** 2026-02-28
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Added 'reset' input to gesture FSM — every state transitions to idle (recording also fires STOP_RECORDING)
- Gateway sendVoiceTurn uses 30-second timeout that emits error chunk without triggering exponential backoff retry
- Gesture handler listens for error chunks on the bus and dispatches 'reset' to return user to idle
- GlassesRenderer.showError() appends "[Error] {message}" as a complete assistant chat bubble
- Display controller calls showError on error chunks and cancels settle timer on new recording start
- 13 new tests added (260 total, all passing)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add FSM reset input, gateway timeout, and error listener** - `c65b0e7` (feat)
2. **Task 2: Add showError to renderer and wire display controller error handling** - `4b674a5` (feat)

## Files Created/Modified
- `src/gestures/gesture-fsm.ts` - Added 'reset' to GestureInput union and TRANSITIONS table
- `src/gestures/gesture-handler.ts` - Error listener dispatches 'reset' to FSM on gateway error chunk
- `src/api/gateway-client.ts` - 30s timeout via abort controller; TimeoutError detection before retry logic
- `src/display/glasses-renderer.ts` - showError(message) appends error chat bubble
- `src/display/display-controller.ts` - Error chunk calls showError; recording-start cancels settle timer
- `src/__tests__/gesture-fsm.test.ts` - 5 new reset input tests
- `src/__tests__/gesture-handler.test.ts` - 3 new error recovery tests
- `src/__tests__/gateway-client.test.ts` - 1 new timeout test
- `src/__tests__/glasses-renderer.test.ts` - 2 new showError tests
- `src/__tests__/display-controller.test.ts` - 3 new error + settle timer tests

## Decisions Made
- Used setTimeout + abortController.abort(reason) instead of AbortSignal.any() — the latter is not available in Node.js test environments
- Error messages rendered as assistant-role "[Error] ..." chat bubbles rather than adding a new message role

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] AbortSignal.any() not available in test environment**
- **Found during:** Task 1 (gateway timeout implementation)
- **Issue:** AbortSignal.any() is a newer API not available in the Node.js/jsdom test environment
- **Fix:** Replaced with setTimeout + abortController.abort(new DOMException('signal timed out', 'TimeoutError')); catch block checks signal.reason for TimeoutError
- **Files modified:** src/api/gateway-client.ts
- **Verification:** All gateway tests pass including new timeout test
- **Committed in:** c65b0e7 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Equivalent functionality with broader runtime compatibility. No scope creep.

## Issues Encountered
None beyond the AbortSignal.any() compatibility fix above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Error recovery path complete: gateway failures/timeouts return user to idle with visible feedback
- Ready for Phase 7 Plan 02 (lifecycle cleanup) and Phase 8 (build & packaging)

---
*Phase: 07-error-handling-lifecycle*
*Completed: 2026-02-28*
