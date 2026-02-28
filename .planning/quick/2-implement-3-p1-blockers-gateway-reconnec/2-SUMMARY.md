---
phase: quick-2
plan: 01
subsystem: core
tags: [event-bus, gateway, reconnect, refactor, typescript]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: TypeScript modules, gateway client, main.ts app shell
provides:
  - Typed event bus for inter-module communication (createEventBus<AppEventMap>)
  - Gateway reconnect with actual retry + exponential backoff
  - Extracted testable app-wiring functions from main.ts monolith
affects: [02-even-bridge, 03-glasses-display]

# Tech tracking
tech-stack:
  added: []
  patterns: [event-bus-factory, recursive-retry-with-backoff, state-object-extraction]

key-files:
  created:
    - src/events.ts
    - src/__tests__/events.test.ts
    - src/app-wiring.ts
    - src/__tests__/app-wiring.test.ts
  modified:
    - src/types.ts
    - src/api/gateway-client.ts
    - src/__tests__/gateway-client.test.ts
    - src/main.ts

key-decisions:
  - "Used empty object constraint ({}) instead of Record<string,unknown> for event bus generic to support TypeScript interfaces without index signatures"
  - "Recursive sendVoiceTurn call for retry rather than a separate retry wrapper, keeping the change minimal"
  - "Created AppState as single state object via createAppState() factory instead of N separate let variables"

patterns-established:
  - "Event bus: createEventBus<TMap>() factory with on/emit/off/clear/listenerCount -- use for all inter-module communication"
  - "State extraction: pure functions in *-wiring.ts files, DOM manipulation stays in main.ts"

requirements-completed: [BRDG-01, API-03]

# Metrics
duration: 7min
completed: 2026-02-28
---

# Quick Task 2: Implement 3 P1 Blockers Summary

**Typed event bus, gateway reconnect with exponential backoff retry, and testable app-wiring extracted from main.ts monolith**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-28T00:59:14Z
- **Completed:** 2026-02-28T01:06:38Z
- **Tasks:** 3
- **Files modified:** 8
- **Tests added:** 28 (10 event bus + 5 gateway + 13 app-wiring)
- **Total tests:** 95 (was 67)

## Accomplishments
- Created zero-dependency typed event bus with AppEventMap covering bridge/gesture/audio/gateway/log events
- Fixed gateway sendVoiceTurn to actually retry on transient failure with exponential backoff (was a no-op comment)
- Extracted 7 pure functions from main.ts into app-wiring.ts with 13 tests, replacing 7 module-level variables with single AppState object

## Task Commits

Each task was committed atomically:

1. **Task 1: Create typed event bus module** - `b973961` (feat)
2. **Task 2: Fix gateway reconnect no-op** - `578a332` (fix)
3. **Task 3: Extract testable wiring from main.ts** - `1ffe894` (refactor)

## Files Created/Modified
- `src/events.ts` - Typed event bus factory with on/emit/off/clear/listenerCount
- `src/__tests__/events.test.ts` - 10 tests covering subscribe, unsubscribe, multi-handler, idempotency
- `src/types.ts` - Added AppEventMap interface with 11 event types
- `src/api/gateway-client.ts` - Fixed SSE parser for \r\n, added recursive retry in sendVoiceTurn catch block
- `src/__tests__/gateway-client.test.ts` - 5 new tests for sendVoiceTurn retry, give-up, abort, SSE \r\n
- `src/app-wiring.ts` - Pure functions: createAppState, connectGlasses, disconnectGlasses, switchSession, resolveLogFilter, buildSettingsViewModel, buildHealthViewModel
- `src/__tests__/app-wiring.test.ts` - 13 tests for all extracted functions
- `src/main.ts` - Imports and delegates to app-wiring, single appState object replaces 7 variables

## Decisions Made
- Used `{}` constraint instead of `Record<string, unknown>` for the event bus generic parameter because TypeScript interfaces (like AppEventMap) lack an index signature and fail the Record constraint under strict mode
- Implemented retry as a recursive `sendVoiceTurn` call after backoff delay rather than wrapping in a separate retry loop -- keeps the change minimal and localized to the catch block
- Consolidated 7 module-level `let` variables into a single `appState = createAppState(loadSettings())` object for testability and encapsulation

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript generic constraint for event bus**
- **Found during:** Task 1 (Event bus module)
- **Issue:** `Record<string, unknown>` constraint rejected TypeScript interfaces (missing index signature) under strict mode
- **Fix:** Changed to `{}` constraint which accepts both interfaces and type aliases
- **Files modified:** src/events.ts
- **Verification:** `tsc --noEmit` passes, all tests pass
- **Committed in:** b973961

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Trivial type constraint fix. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Event bus ready for Phase 2 bridge/gesture/audio communication
- Gateway reconnect working for reliable voice turn delivery
- app-wiring.ts provides safety net for Phase 2 refactoring of main.ts
- All 95 tests passing, zero TypeScript errors

## Self-Check: PASSED

- All 8 files verified present
- All 3 task commits verified (b973961, 578a332, 1ffe894)
- 95 tests passing across 7 test files
- tsc --noEmit exits clean

---
*Phase: quick-2*
*Completed: 2026-02-28*
