---
phase: 03-glasses-display-streaming
plan: 01
subsystem: display
tags: [viewport, icon-animation, tdd, pure-functions, unicode-icons, chat-serialization]

# Dependency graph
requires:
  - phase: 02-even-bridge-input-pipeline
    provides: gesture events (scroll-up, scroll-down) and AppEventMap type definitions
provides:
  - ChatMessage and ViewportState types for display state management
  - serializeMessages() for chat text rendering on glasses
  - renderViewport() with MAX_VIEWPORT_CHARS truncation for SDK compliance
  - scrollUp()/scrollDown() for gesture-driven viewport navigation
  - createIconAnimator() with frame-drop protection for state icon animation
  - ICON_FRAMES Unicode text definitions for idle/recording/sent/thinking states
  - Display event types in AppEventMap (display:state-change, display:viewport-update, display:hide, display:wake)
affects: [03-02-glasses-renderer, 03-03-display-controller, 06-voice-loop-integration]

# Tech tracking
tech-stack:
  added: []
  patterns: [pure-function-display-logic, unicode-text-icons, frame-drop-animation, bottom-up-viewport-windowing]

key-files:
  created:
    - src/display/viewport.ts
    - src/display/icon-animator.ts
    - src/display/icon-bitmaps.ts
    - src/__tests__/viewport.test.ts
    - src/__tests__/icon-animator.test.ts
  modified:
    - src/types.ts

key-decisions:
  - "Unicode text icons instead of 4-bit greyscale image containers for v1 (eliminates pixel packing ambiguity)"
  - "MAX_VIEWPORT_CHARS = 1800 (200-char buffer under 2000 SDK limit)"
  - "Icon animator uses promise .then()/.catch() instead of .finally() for broader compatibility"

patterns-established:
  - "Pure display functions: viewport.ts and icon-animator.ts have zero SDK imports -- all side effects injected via callbacks"
  - "Frame-drop protection: in-flight boolean flag skips animation ticks when previous updateFn hasn't resolved"
  - "Bottom-up viewport windowing: renderViewport builds text from newest messages backward, stopping at char limit"

requirements-completed: [CHAT-01, CHAT-02, CHAT-04, CHAT-05, CHAT-06, CHAT-07, ICONS-01, ICONS-02, ICONS-03, ICONS-04, ICONS-05]

# Metrics
duration: 4min
completed: 2026-02-28
---

# Phase 3 Plan 01: Viewport State and Icon Animator Summary

**TDD pure functions for chat viewport windowing with 1800-char SDK truncation, scroll offset management, and icon animation loop with frame-drop protection using Unicode text icons**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-28T02:05:21Z
- **Completed:** 2026-02-28T02:09:33Z
- **Tasks:** 6 (types + bitmaps, viewport RED, viewport GREEN, icon RED, icon GREEN, TS fix)
- **Files modified:** 6

## Accomplishments
- viewport.ts with serializeMessages (user "> " prefix, assistant no prefix, incomplete " ..." suffix), renderViewport (bottom-up windowing at 1800 chars), scrollUp/scrollDown with autoScroll
- icon-animator.ts with createIconAnimator factory: setState resets frame and fires immediate tick, 200ms interval loop, frame-drop via in-flight flag
- icon-bitmaps.ts with Unicode text frames: idle (open circle), recording (2-frame blink), sent (checkmark), thinking (10-frame braille spinner)
- 32 tests total (22 viewport + 10 icon-animator), all passing, TypeScript strict mode clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Display types + icon bitmaps** - `70175e3` (feat)
2. **Task 2: Viewport tests RED** - `4ea9f1a` (test)
3. **Task 3: Viewport implementation GREEN** - `fec72ab` (feat)
4. **Task 4: Icon-animator tests RED** - `3c37f97` (test)
5. **Task 5: Icon-animator implementation GREEN** - `d739498` (feat)
6. **Task 6: TypeScript strict mode fix** - `523eb01` (fix)

_TDD cycle: RED (failing tests) -> GREEN (minimal implementation) per task pair_

## Files Created/Modified
- `src/types.ts` - Added IconState type and 4 display events to AppEventMap
- `src/display/viewport.ts` - ChatMessage, ViewportState, serializeMessages, renderViewport, scrollUp, scrollDown, MAX_VIEWPORT_CHARS
- `src/display/icon-animator.ts` - createIconAnimator factory with setState/start/stop/getState and frame-drop protection
- `src/display/icon-bitmaps.ts` - ICON_FRAMES with Unicode text arrays for idle/recording/sent/thinking
- `src/__tests__/viewport.test.ts` - 22 test cases for all viewport functions
- `src/__tests__/icon-animator.test.ts` - 10 test cases for animator lifecycle and frame management

## Decisions Made
- Used Unicode text icons per research Open Question #3 recommendation -- eliminates 4-bit pixel packing ambiguity and reduces container count from 3 to 2 (no image container needed)
- Set MAX_VIEWPORT_CHARS to 1800 (200-char safety buffer under 2000-char SDK textContainerUpgrade limit)
- Used .then()/.catch() instead of .finally() in icon-animator for the in-flight flag reset

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript strict mode error in test assertion**
- **Found during:** Task 6 (verification)
- **Issue:** `updateFn.mock.calls` tuple type inference failed with `as string` cast on line 137
- **Fix:** Added intermediate `as unknown[]` cast for mock call array access
- **Files modified:** src/__tests__/icon-animator.test.ts
- **Verification:** `npx tsc --noEmit` passes clean
- **Committed in:** 523eb01

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor type assertion fix in test code. No scope creep.

## Issues Encountered
None -- TDD RED/GREEN cycle executed cleanly for both modules.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- viewport.ts and icon-animator.ts are ready for GlassesRenderer (Plan 02) to consume
- GlassesRenderer will inject bridge SDK calls as the updateFn callback to icon-animator
- GlassesRenderer will use renderViewport() output as textContainerUpgrade content
- Display event types in AppEventMap ready for bus wiring in Plan 03

## Self-Check: PASSED

All 6 created/modified files verified on disk. All 6 commit hashes verified in git log.

---
*Phase: 03-glasses-display-streaming*
*Completed: 2026-02-28*
