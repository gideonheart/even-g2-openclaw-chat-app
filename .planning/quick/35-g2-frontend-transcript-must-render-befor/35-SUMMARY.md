---
phase: quick-35
plan: 01
subsystem: api
tags: [gateway-client, async, microtask, transcript, glasses-display]

# Dependency graph
requires:
  - phase: quick-19
    provides: transcript chunk emission in emitFromGatewayReply
provides:
  - Async emitFromGatewayReply with microtask yield between transcript and response lifecycle
  - Tests proving microtask boundary separates transcript from response_start
affects: [display-controller, voice-loop-controller, glasses-bridge]

# Tech tracking
tech-stack:
  added: []
  patterns: [microtask-yield-for-display-ordering]

key-files:
  created: []
  modified:
    - src/api/gateway-client.ts
    - src/__tests__/gateway-client.test.ts

key-decisions:
  - "await Promise.resolve() microtask yield (not setTimeout/requestAnimationFrame) between transcript and response_start -- zero-cost async boundary"

patterns-established:
  - "Microtask yield pattern: emit display-affecting chunk, await Promise.resolve(), continue with overwriting chunks"

requirements-completed: [QUICK-35]

# Metrics
duration: 5min
completed: 2026-03-04
---

# Quick Task 35: Transcript-First Rendering Summary

**Async microtask yield in emitFromGatewayReply ensures user transcript renders on glasses before assistant response overwrites the display**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-04T13:14:38Z
- **Completed:** 2026-03-04T13:19:11Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Converted emitFromGatewayReply from synchronous to async with `await Promise.resolve()` between transcript and response_start
- Updated both sendVoiceTurn and sendTextTurn call sites to await the now-async function
- Added 3 new regression tests proving microtask boundary separates transcript from response lifecycle (voice turn, text turn, and no-transcript backward compat)
- All 639 tests pass, TypeScript typecheck clean, zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Make emitFromGatewayReply async with microtask yield** - `7137c20` (feat)
2. **Task 2: Add transcript-first rendering guarantee tests** - `0daa5ae` (test)

## Files Created/Modified
- `src/api/gateway-client.ts` - emitFromGatewayReply now async; await Promise.resolve() after transcript chunk; both call sites updated to await
- `src/__tests__/gateway-client.test.ts` - 3 new tests in "transcript-first rendering guarantee" describe blocks (sendVoiceTurn + sendTextTurn)

## Decisions Made
- Used `await Promise.resolve()` (microtask yield) instead of setTimeout or requestAnimationFrame -- this is the minimal async boundary, adds zero wall-clock delay, and lets the JS event loop flush pending bridge calls between transcript and response lifecycle chunks
- Tests use `queueMicrotask()` callback pattern to prove the yield happened: if the microtask scheduled on transcript arrival has flushed by the time response_start fires, the boundary is proven

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Transcript-first display ordering is now guaranteed for both voice and text turns
- The glasses bridge will render user speech-to-text before assistant streaming begins
- DisplayController and VoiceLoopController unchanged -- they consume chunks synchronously from the event bus, unaffected by the upstream async change

## Self-Check: PASSED

All files found, all commits verified.

---
*Phase: quick-35*
*Completed: 2026-03-04*
