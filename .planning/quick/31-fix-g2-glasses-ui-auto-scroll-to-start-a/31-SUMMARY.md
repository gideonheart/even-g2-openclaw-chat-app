---
phase: quick-31
plan: 01
subsystem: display
tags: [scroll, viewport, glasses-renderer, auto-scroll, user-message]

# Dependency graph
requires:
  - phase: quick-25
    provides: Conditional autoScroll reset in endStreaming (scroll anchoring)
  - phase: quick-26
    provides: getViewportState debug accessor, autoScroll audit
provides:
  - addUserMessage always snaps scroll to bottom regardless of prior scroll state
  - 3 new tests covering force-scroll on user message during scrolled-up state
affects: [glasses-renderer, viewport, scroll-behavior]

# Tech tracking
tech-stack:
  added: []
  patterns: [user-initiated-action-overrides-scroll-position]

key-files:
  created: []
  modified:
    - src/display/glasses-renderer.ts
    - src/__tests__/glasses-renderer.test.ts

key-decisions:
  - "addUserMessage unconditionally resets scrollOffset=0 and autoScroll=true -- user-initiated actions (voice tap, hub text, sync) always snap to bottom"

patterns-established:
  - "User-initiated actions override scroll position: new turns always snap to bottom, but passive events (endStreaming, showError) respect manual scroll"

requirements-completed: [SCROLL-AUTO-BOTTOM]

# Metrics
duration: 3min
completed: 2026-03-03
---

# Quick Task 31: Fix G2 Glasses UI Auto-Scroll to Start Summary

**addUserMessage unconditionally snaps scroll to bottom so new questions are always visible, with 3 new tests covering scrolled-up state behavior**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-03T18:07:22Z
- **Completed:** 2026-03-03T18:10:27Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Removed `if (viewport.autoScroll)` guard from `addUserMessage()` so new user messages always reset scroll to bottom
- Updated autoScroll invariant comment block: addUserMessage is now a WRITE mutation point (not READ)
- Added 3 comprehensive tests: snap from scrolled-up, render verification, streaming-after-snap end-to-end
- All 622 tests pass, build and typecheck green

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix addUserMessage to always scroll to bottom** - `232f131` (fix)
2. **Task 2: Add and update tests for addUserMessage force-scroll** - `d9e4309` (test)

## Files Created/Modified
- `src/display/glasses-renderer.ts` - Removed autoScroll guard from addUserMessage; always sets scrollOffset=0 and autoScroll=true
- `src/__tests__/glasses-renderer.test.ts` - 3 new tests for addUserMessage force-scroll in scroll anchoring describe block

## Decisions Made
- addUserMessage unconditionally resets scrollOffset=0 and autoScroll=true. Rationale: a new user message means the user actively started a new interaction (voice tap, hub text input, or sync message), so snapping to bottom is the correct UX.
- endStreaming and showError continue to respect manual scroll position (quick-25 behavior preserved). The asymmetry is intentional: user-initiated vs passive events.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Scroll anchoring now has correct asymmetry: addUserMessage snaps, endStreaming/showError preserve
- All quick-25/quick-26 scroll behavior preserved and tested

---
*Phase: quick-31*
*Completed: 2026-03-03*
