---
phase: 06-runtime-wiring
plan: 01
subsystem: bridge, events, voice-loop
tags: [event-bus, gesture, audio, gateway, voice-loop]

requires:
  - phase: 02-even-bridge-input-pipeline
    provides: gesture event mapping, bridge service, audio capture
  - phase: 04-gateway-api-client
    provides: gateway client with SSE streaming

provides:
  - Clean AppEventMap without orphaned event types
  - CLICK_EVENT SDK quirk fix for real hardware tap detection
  - Spacebar keyboard shortcut for dev mode tap
  - VoiceLoopController module bridging gateway events to bus

affects: [06-runtime-wiring, 07-error-handling]

tech-stack:
  added: []
  patterns: [factory+interface with unsubs array for cleanup]

key-files:
  created:
    - src/voice-loop-controller.ts
    - src/__tests__/voice-loop-controller.test.ts
  modified:
    - src/types.ts
    - src/bridge/even-bridge.ts
    - src/bridge/bridge-mock.ts
    - src/__tests__/even-bridge.test.ts
    - src/__tests__/bridge-mock.test.ts

key-decisions:
  - "VoiceLoopController uses settings getter (not reference) to always get current values"
  - "undefined eventType maps to gesture:tap to handle SDK CLICK_EVENT=0 normalization quirk"

patterns-established:
  - "Settings getter pattern: pass () => settings instead of settings reference for modules that need current values"

requirements-completed: [ERR-04, LOOP-04, LOOP-06]

duration: 4min
completed: 2026-02-28
---

# Plan 06-01: Module-level fixes + VoiceLoopController Summary

**Clean AppEventMap, CLICK_EVENT SDK quirk fix for real hardware, spacebar dev shortcut, and VoiceLoopController gateway-to-bus event bridge**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-28T11:24:00Z
- **Completed:** 2026-02-28T11:28:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Removed 4 orphaned event types from AppEventMap (display:state-change, display:viewport-update, display:hide, display:wake) [ERR-04]
- Fixed CLICK_EVENT SDK quirk: undefined eventType now maps to gesture:tap instead of being silently dropped on real hardware [LOOP-06]
- Created VoiceLoopController with factory+interface pattern, gateway chunk/status forwarding, and recording-stop voice turn dispatch [LOOP-04]
- Updated bridge mock keyboard shortcut from 't' to spacebar for dev mode tap
- All 246 tests pass (6 new VoiceLoopController tests added)

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix orphaned events, CLICK_EVENT quirk, and keyboard shortcut** - `63c7044` (fix)
2. **Task 2: Create VoiceLoopController module with tests** - `83eee18` (feat)

## Files Created/Modified
- `src/types.ts` - Removed 4 orphaned event types from AppEventMap
- `src/bridge/even-bridge.ts` - Fixed CLICK_EVENT quirk: undefined eventType maps to gesture:tap
- `src/bridge/bridge-mock.ts` - Changed tap shortcut from 't' to spacebar
- `src/voice-loop-controller.ts` - New VoiceLoopController with gateway-to-bus bridging
- `src/__tests__/voice-loop-controller.test.ts` - 6 comprehensive tests for VoiceLoopController
- `src/__tests__/even-bridge.test.ts` - Updated test for CLICK_EVENT quirk behavior
- `src/__tests__/bridge-mock.test.ts` - Updated tests for spacebar shortcut

## Decisions Made
- Used settings getter pattern (pass `() => settings` instead of `settings`) so VoiceLoopController always reads current settings at voice turn time
- Mapped undefined eventType to gesture:tap (not ignored) because SDK's fromJson normalizes CLICK_EVENT=0 to undefined

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- VoiceLoopController ready for glasses-main.ts assembly (Plan 06-02)
- Clean AppEventMap ready for runtime wiring
- CLICK_EVENT quirk handled -- tap gestures will work on real hardware

---
*Plan: 06-01 of 06-runtime-wiring*
*Completed: 2026-02-28*
