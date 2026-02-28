---
phase: 11-glasses-command-menu
plan: 01
subsystem: ui
tags: [gesture-fsm, menu, pure-functions, tdd, state-management]

# Dependency graph
requires:
  - phase: 02-gestures-audio
    provides: "Gesture FSM with menu state transitions"
provides:
  - "Pure command menu state module (create, scroll, select, confirm, cancel, render)"
  - "MENU_SELECT gesture FSM action for tap-in-menu"
  - "menu:select and menu:close event types in AppEventMap"
affects: [11-glasses-command-menu, menu-controller, gesture-handler]

# Tech tracking
tech-stack:
  added: []
  patterns: [pure-function-state-module, confirmation-sub-state, immutable-state-transitions]

key-files:
  created:
    - src/menu/command-menu.ts
    - src/__tests__/command-menu.test.ts
  modified:
    - src/gestures/gesture-fsm.ts
    - src/__tests__/gesture-fsm.test.ts
    - src/types.ts

key-decisions:
  - "MENU_SELECT action added to FSM; tap in menu stays in menu state (controller decides when to close)"
  - "Destructive items require confirmation sub-state before execution"
  - "Scroll locked during confirmation to prevent accidental navigation"

patterns-established:
  - "Pure menu state module: same pattern as gesture-fsm.ts and viewport.ts"
  - "Confirmation sub-state: confirmingIndex gates destructive actions"

requirements-completed: [MENU-01, MENU-02, MENU-03, MENU-04]

# Metrics
duration: 4min
completed: 2026-02-28
---

# Phase 11 Plan 01: CommandMenu Pure State Module + FSM Extension Summary

**Pure-function command menu with 5 items, scroll/select/confirm state transitions, text rendering, and MENU_SELECT FSM action**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-28T17:22:15Z
- **Completed:** 2026-02-28T17:26:19Z
- **Tasks:** 3 (TDD RED + GREEN + FSM extension)
- **Files modified:** 5

## Accomplishments
- Created pure command menu state module with 5 menu items (/new, /switch, /rename, /reset, /delete)
- Implemented all state transitions: scroll up/down (clamped), select (execute vs confirm), cancel confirm, render text
- Destructive items (/reset, /delete) require confirmation before execution with scroll-locked sub-state
- Extended gesture FSM with MENU_SELECT action for tap-in-menu (stays in menu, controller decides close)
- Added menu:select and menu:close event types to AppEventMap
- 24 new tests for command-menu module, all passing; 352 total project tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: TDD RED - failing tests + stub** - `658ed43` (test)
2. **Task 2: TDD GREEN - implement pure functions** - `7a85648` (feat)
3. **Task 3: FSM extension + event types** - `3577f00` (feat)

_TDD flow: RED (24 failing) -> GREEN (24 passing) -> FSM extension (352 passing)_

## Files Created/Modified
- `src/menu/command-menu.ts` - Pure menu state: items, scroll, select, confirm, cancel, text rendering
- `src/__tests__/command-menu.test.ts` - 24 tests covering all 12 behaviors from plan spec
- `src/gestures/gesture-fsm.ts` - Added MENU_SELECT to GestureAction, changed menu.tap transition
- `src/__tests__/gesture-fsm.test.ts` - Updated menu.tap test expectation
- `src/types.ts` - Added menu:select and menu:close to AppEventMap

## Decisions Made
- MENU_SELECT action added to FSM: tap in menu stays in menu state (not idle). The menu controller decides when to close the menu, not the FSM. This enables the confirmation dialog flow for destructive commands.
- Destructive items require confirmation sub-state: confirmingIndex gates execution. Scroll is locked during confirmation to prevent accidental navigation away.
- renderMenuText uses simple cursor indicator pattern ('> ' vs '  ') consistent with text-only glasses display constraints (576x288, ~1800 chars).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Command menu state module ready for consumption by menu-controller (Plan 11-02)
- MENU_SELECT action ready for gesture-handler dispatch (Plan 11-02)
- menu:select and menu:close events ready for bus wiring (Plan 11-02)

## Self-Check: PASSED

- All 5 files verified on disk
- All 3 task commits verified in git log (658ed43, 7a85648, 3577f00)

---
*Phase: 11-glasses-command-menu*
*Completed: 2026-02-28*
