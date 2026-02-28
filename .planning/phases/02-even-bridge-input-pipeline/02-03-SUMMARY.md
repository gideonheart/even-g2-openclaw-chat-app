---
phase: 02-even-bridge-input-pipeline
plan: 03
subsystem: gestures
tags: [gesture-handler, debounce, event-bus, audio-lifecycle, hint-bar, fsm-wiring]

# Dependency graph
requires:
  - phase: 02-even-bridge-input-pipeline
    plan: 01
    provides: Pure gesture FSM with gestureTransition() function and GestureState/GestureInput/GestureAction types
  - phase: 02-even-bridge-input-pipeline
    plan: 02
    provides: BridgeService interface, AudioCapture service, bridge:audio-frame event
provides:
  - createGestureHandler() factory wiring bus gesture events through FSM to bridge/audio actions
  - getHintText() pure function producing contextual hint text per FSM state
  - gesture:menu-toggle event in AppEventMap
  - Complete Phase 2 input pipeline: bridge -> bus -> gesture handler -> FSM -> bridge audio + audio capture
affects: [03-glasses-display, 06-integration]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Factory-based gesture handler with closure state", "275ms tap debounce for double-tap disambiguation", "Unsubscribe array pattern for bus cleanup"]

key-files:
  created:
    - src/gestures/gesture-handler.ts
    - src/__tests__/gesture-handler.test.ts
  modified:
    - src/types.ts

key-decisions:
  - "275ms debounce applies only to tap inputs, not double-tap or scroll -- prevents false positives without blocking legitimate double-tap gestures"
  - "STOP_RECORDING uses promise-based blob retrieval from audioCapture.stopRecording() with async bus emission"
  - "Hint bar produces text strings only in Phase 2; display rendering deferred to Phase 3"

patterns-established:
  - "Gesture handler pattern: bus.on -> handleInput(input, timestamp) -> gestureTransition -> dispatchAction -> bridge/audio/bus"
  - "Debounce guard: track lastTapTs, suppress tap if < DEBOUNCE_MS elapsed"
  - "Destroy pattern: collect unsub functions in array, call all on destroy()"

requirements-completed: [GEST-06]

# Metrics
duration: 3min
completed: 2026-02-28
---

# Phase 2 Plan 3: Gesture Handler Wiring Summary

**Gesture handler wiring bus events through FSM with 275ms tap debounce, bridge/audio action dispatch, and contextual hint bar text for all 5 states**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-28T01:38:01Z
- **Completed:** 2026-02-28T01:40:39Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Complete input pipeline wired: bus gesture events flow through FSM to produce actions, actions drive bridge audio control and audio capture lifecycle
- 275ms tap debounce prevents double-tap disambiguation race condition (rapid tap followed by double-tap within 275ms)
- Contextual hint bar text generated for all 5 FSM states (idle, recording, sent, thinking, menu)
- 172 total tests passing (22 new gesture handler tests + 150 existing), zero TypeScript errors
- AppEventMap complete for Phase 2 with gesture:menu-toggle added

## Task Commits

Each task was committed atomically:

1. **Task 1: Create gesture handler with debounce, action dispatch, and hint bar** - `fd8773c` (feat)
2. **Task 2: Full Phase 2 integration verification** - no commit (all tests pass, no changes needed)

## Files Created/Modified
- `src/gestures/gesture-handler.ts` - Factory function wiring bus gesture events through FSM to bridge/audio actions, with 275ms tap debounce and hint text generation
- `src/__tests__/gesture-handler.test.ts` - 22 tests covering debounce behavior, action dispatch, state tracking, bridge integration, destroy, and hint text
- `src/types.ts` - Added `gesture:menu-toggle: { active: boolean }` to AppEventMap

## Decisions Made
- 275ms debounce window applies only to `tap` inputs (not double-tap or scroll), preventing false positive tap detection while allowing legitimate double-tap gestures to pass through immediately
- STOP_RECORDING action uses promise-based flow: `bridge.stopAudio()` synchronously, then `audioCapture.stopRecording()` returns Promise<Blob>, then bus emits `audio:recording-stop` with the blob
- Phase 2 produces hint text strings only via `getHintText(state)`. Rendering on the glasses display (via textContainerUpgrade on containerID=3) is explicitly deferred to Phase 3

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Complete Phase 2 input pipeline is ready: bridge gesture events -> event bus -> gesture handler -> FSM -> bridge audio + audio capture
- Phase 3 can consume `getHintText()` for display rendering and listen to `gesture:menu-toggle` for menu UI
- All 172 tests pass with zero regressions, zero TypeScript errors
- No blockers for Phase 3 (Glasses Display Pipeline)

## Self-Check: PASSED

All 3 files verified present. Task commit fd8773c verified in git log.

---
*Phase: 02-even-bridge-input-pipeline*
*Completed: 2026-02-28*
