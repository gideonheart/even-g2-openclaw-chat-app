---
phase: quick-29
plan: 01
subsystem: api
tags: [dry, srp, error-handling, dead-code-removal, gateway-client]

requires:
  - phase: quick-28
    provides: "Gateway error classification (GatewayAppError sentinel class)"
provides:
  - "DRY error handling via shared handleTurnError in gateway-client"
  - "Clean gateway-client without dead SSE code"
  - "Clean app-wiring without deprecated glasses functions"
  - "Root cause analysis of disconnect-on-record bug persistence"
affects: [gateway-client, app-wiring, types]

tech-stack:
  added: []
  patterns: ["Shared error handler for multi-caller error classification policy"]

key-files:
  created:
    - ".planning/quick/29-analyze-recent-changes-for-dry-srp-remov/29-ANALYSIS.md"
  modified:
    - "src/api/gateway-client.ts"
    - "src/__tests__/gateway-client.test.ts"
    - "src/app-wiring.ts"
    - "src/__tests__/app-wiring.test.ts"
    - "src/types.ts"

key-decisions:
  - "Extract handleTurnError as shared function rather than further abstracting postVoiceTurn/postTextTurn (request construction differs enough to warrant separate functions)"
  - "Remove parseSSELines entirely rather than keeping for potential future use (gateway architecture is HTTP POST, SSE was never implemented)"

patterns-established:
  - "When multiple callers share identical error handling, extract immediately -- duplication signals policy not one-off logic"
  - "Assert both user-facing effect (error chunk) AND internal state effect (status value) in error handling tests"

requirements-completed: [QUICK-29]

duration: 10min
completed: 2026-03-03
---

# Quick Task 29: DRY/SRP Cleanup Summary

**Extracted shared handleTurnError from duplicated catch blocks, removed 4 dead code artifacts (parseSSELines, SSEEvent, connectGlasses, disconnectGlasses), documented root cause of disconnect-on-record bug persistence**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-03T14:30:27Z
- **Completed:** 2026-03-03T14:40:44Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Extracted identical 15-line catch block from sendVoiceTurn/sendTextTurn into shared `handleTurnError` (DRY fix)
- Removed 4 dead code artifacts: `parseSSELines` function, `SSEEvent` interface, `connectGlasses`/`disconnectGlasses` deprecated wrappers
- Created root cause analysis documenting why disconnect-on-record bug persisted (SRP violation in error status classification)
- Test count reduced from 624 to 613 (11 dead-code tests removed), all remaining tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract shared error handler and remove dead SSE/deprecated code** - `519b4dd` (refactor)
2. **Task 2: Root cause analysis document** - `c21a331` (docs)

## Files Created/Modified
- `src/api/gateway-client.ts` - Extracted handleTurnError, removed parseSSELines and SSEEvent import
- `src/__tests__/gateway-client.test.ts` - Removed 9 parseSSELines tests, updated import
- `src/app-wiring.ts` - Removed deprecated connectGlasses/disconnectGlasses functions
- `src/__tests__/app-wiring.test.ts` - Removed 2 deprecated function tests, updated import
- `src/types.ts` - Removed SSEEvent interface
- `.planning/quick/29-analyze-recent-changes-for-dry-srp-remov/29-ANALYSIS.md` - Root cause analysis document

## Decisions Made
- Extracted handleTurnError as shared function rather than further abstracting postVoiceTurn/postTextTurn -- request construction differs enough (audio blob vs JSON body, different Content-Type) that extraction would over-abstract
- Removed parseSSELines entirely rather than keeping for potential future use -- gateway architecture has been pure HTTP POST + JSON reply since Phase 4, SSE was never implemented

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Gateway client is clean: single error handling policy, no dead code
- App wiring uses only the modern glasses state API (setGlassesConnected/Disconnected)
- Root cause analysis documents patterns to prevent similar bugs

## Self-Check: PASSED

All artifacts verified: 5 modified files exist, 2 created files exist, both task commits (519b4dd, c21a331) found in git history.

---
*Phase: quick-29*
*Completed: 2026-03-03*
