---
phase: quick-27
plan: 01
subsystem: gestures
tags: [fsm, watchdog, documentation, inline-comments]

requires:
  - phase: quick-23
    provides: "menu:close bus listener with state === 'menu' guard"
  - phase: quick-24
    provides: "session:switched bus listener with state !== 'idle' guard"
provides:
  - "Inline documentation explaining guard asymmetry between menu:close and session:switched listeners"
  - "Inline documentation of watchdog timer clearance dependency through handleInput('reset') path"
affects: [gesture-handler, fsm-maintenance]

tech-stack:
  added: []
  patterns: [inline-comment-rationale-for-asymmetric-guards]

key-files:
  created: []
  modified:
    - src/gestures/gesture-handler.ts

key-decisions:
  - "Comments-only change -- zero behavioral modifications, 12 lines added, 3 lines replaced"

patterns-established:
  - "Guard asymmetry documentation: when two listeners use different guard styles, document WHY inline with cross-reference"

requirements-completed: [DRY-GUARD-COMMENTS]

duration: 1min
completed: 2026-03-03
---

# Quick-27: Guard Asymmetry and Watchdog Dependency Comments

**Inline comments documenting menu:close narrow guard vs session:switched broad guard rationale, plus watchdog timer clearance chain through handleInput('reset') path**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-03T10:19:35Z
- **Completed:** 2026-03-03T10:20:43Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Documented why menu:close uses narrow `state === 'menu'` guard (single source: menu controller)
- Documented why session:switched uses broad `state !== 'idle'` guard (any-state, any-UI-path origin)
- Documented watchdog timer dependency: handleInput('reset') -> startWatchdog() -> clearWatchdog() cancels pending timers
- Cross-referenced the two listeners so future maintainers see the intentional asymmetry

## Task Commits

Each task was committed atomically:

1. **Task 1: Add guard asymmetry and watchdog dependency comments** - `5e0dac3` (docs)

## Files Created/Modified
- `src/gestures/gesture-handler.ts` - Enhanced inline comments on menu:close (lines 185-188) and session:switched (lines 195-205) bus listeners

## Decisions Made
- Comments-only, zero behavioral changes -- verified by diff showing only comment additions/replacements
- Used plain `//` comment style matching existing file conventions (no JSDoc blocks)
- Referenced line numbers in watchdog dependency comment for traceability (lines 70, 97)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Guard asymmetry and watchdog dependency are now documented inline
- Future maintainers will not inadvertently "normalize" the guard conditions

---
*Phase: quick-27*
*Completed: 2026-03-03*
