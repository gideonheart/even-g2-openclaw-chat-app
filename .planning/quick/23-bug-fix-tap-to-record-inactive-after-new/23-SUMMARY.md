---
phase: quick-23
plan: 01
subsystem: gestures
tags: [fsm, event-bus, menu, tap-to-record, bug-fix]

# Dependency graph
requires:
  - phase: 11-command-menu
    provides: "menu:close bus event emitted by menu-controller on close"
  - phase: 02-gesture-fsm
    provides: "gesture FSM state machine and handler wiring"
provides:
  - "menu:close bus listener in gesture-handler that resets FSM to idle"
  - "5 regression tests for menu close -> FSM idle flow"
affects: [gesture-handler, menu-controller]

# Tech tracking
tech-stack:
  added: []
  patterns: ["bus event listener for cross-module FSM state correction"]

key-files:
  created: []
  modified:
    - src/gestures/gesture-handler.ts
    - src/__tests__/gesture-handler.test.ts

key-decisions:
  - "Reset via handleInput('reset') not direct state mutation -- uses existing FSM transition table for menu->idle"
  - "Guard state === 'menu' prevents spurious resets if menu:close fires in other states"

patterns-established:
  - "Cross-module FSM reset via bus event + state guard (avoids tight coupling)"

requirements-completed: [BUG-23]

# Metrics
duration: 3min
completed: 2026-03-03
---

# Quick Task 23: Fix Tap-to-Record Inactive After /new Summary

**menu:close bus listener in gesture-handler resets FSM from menu to idle, restoring tap-to-record after any menu command execution**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-03T00:26:19Z
- **Completed:** 2026-03-03T00:29:03Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments
- Fixed bug where tap-to-record became inactive after executing /new (or any menu command) from glasses menu
- Root cause: FSM stayed in 'menu' state after menu-controller closed the menu UI via command execution
- Added menu:close bus listener with state guard to reset FSM to idle when menu closes
- 5 regression tests covering the exact bug scenario and edge cases (guard prevents spurious resets)
- Full test suite: 600 tests passing (595 existing + 5 new), typecheck clean, build succeeds

## Task Commits

Each task was committed atomically:

1. **Task 1: Add menu:close listener to gesture handler** - `c1afb34` (fix)
2. **Task 2: Add regression tests for menu:close FSM reset** - `1fac332` (test)
3. **Task 3: Build, typecheck, and run full test suite** - verification only, no code changes

## Files Created/Modified
- `src/gestures/gesture-handler.ts` - Added menu:close bus subscription that resets FSM from menu to idle
- `src/__tests__/gesture-handler.test.ts` - Added 5 regression tests in 'menu:close FSM reset (bug #23)' describe block

## Decisions Made
- Used `handleInput('reset', Date.now())` instead of directly mutating state -- leverages existing FSM transition table where menu + reset -> idle with null action (no side effects)
- Added `state === 'menu'` guard to prevent spurious resets if menu:close fires when FSM is in idle, recording, sent, or thinking states

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Bug fix is complete and verified
- No follow-up work needed

---
*Phase: quick-23*
*Completed: 2026-03-03*
