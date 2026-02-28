---
phase: 06-runtime-wiring
plan: 02
subsystem: runtime, display, voice-loop
tags: [runtime-router, boot-sequence, voice-loop, display, welcome-message, settle-period]

requires:
  - phase: 06-runtime-wiring
    plan: 01
    provides: VoiceLoopController, clean AppEventMap, CLICK_EVENT fix
  - phase: 01-foundation
    provides: TypeScript infrastructure, settings store, event bus
  - phase: 02-even-bridge-input-pipeline
    provides: Gesture FSM, bridge wrapper, audio capture
  - phase: 03-glasses-display-streaming
    provides: Viewport, renderer, display controller
  - phase: 04-gateway-api-client
    provides: Gateway client with SSE streaming
  - phase: 05-companion-hub-ui
    provides: Companion hub UI (extracted to hub-main.ts)

provides:
  - Thin environment router (main.ts) detecting Even App vs browser
  - Extracted companion hub entry point (hub-main.ts)
  - Glasses runtime boot with Layer 0-5 initialization (glasses-main.ts)
  - Updated display: no hint bar, welcome message, settle period, turn buffer
  - Full end-to-end voice turn path wired

affects: [07-error-handling, 08-evenhub-submission]

tech-stack:
  added: []
  patterns: [environment-router, layer-based-init-sequence, settle-period]

key-files:
  created:
    - src/hub-main.ts
    - src/glasses-main.ts
  modified:
    - src/main.ts
    - src/display/glasses-renderer.ts
    - src/display/display-controller.ts
    - src/__tests__/glasses-renderer.test.ts
    - src/__tests__/display-controller.test.ts

key-decisions:
  - "Hardcode 'gideon' as default active session for glasses runtime (session selection deferred)"
  - "2-container layout (status + chat) -- hint bar removed per user decision"
  - "MAX_TURNS=8 pairs (16 messages) for turn buffer limit"
  - "500ms settle period after response_end AND error to prevent accidental double-trigger"
  - "Auto-scroll resets at end of each turn, not on new stream start"
  - "?mock-audio URL param enables mock audio for headless CI without mic"

patterns-established:
  - "Environment router pattern: thin main.ts with dynamic imports based on runtime detection"
  - "Layer-based initialization: modules init in strict dependency order (Layer 0-5)"
  - "Settle period pattern: setTimeout delay on icon state transition to prevent premature interaction"

requirements-completed: [LOOP-01, LOOP-02, LOOP-03, LOOP-05]

duration: 6min
completed: 2026-02-28
---

# Plan 06-02: Runtime Router, Glasses Boot, Display Lifecycle Summary

**Thin environment router, Layer 0-5 glasses boot sequence, and display turn lifecycle with welcome message, settle period, and turn buffer**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-28T11:28:00Z
- **Completed:** 2026-02-28T11:34:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Split monolithic main.ts into thin environment router + hub-main.ts + glasses-main.ts [LOOP-02]
- Glasses boot initializes all modules in correct Layer 0-5 dependency order [LOOP-03]
- bridge:audio-frame -> audioCapture.onFrame() subscription wired before first tap [LOOP-05]
- Full voice turn path wired: tap -> FSM -> recording -> audio:recording-stop -> VoiceLoopController -> gateway -> SSE chunks -> display controller -> renderer [LOOP-01]
- Display updated: 2-container layout (no hint bar), "Tap to ask" welcome, 500ms settle, MAX_TURNS=8 buffer, auto-scroll reset
- 247 tests passing (1 net new from renderer tests, previous hint tests removed)

## Task Commits

Each task was committed atomically:

1. **Task 1: Split main.ts into environment router, hub-main.ts, and glasses-main.ts** - `2a1a64a` (feat)
2. **Task 2: Update display for turn lifecycle** - `678f9d7` (feat)

## Files Created/Modified
- `src/main.ts` - Thin environment router (~20 lines), detects flutter_inappwebview or ?even param
- `src/hub-main.ts` - Extracted companion hub code with exported initHub()
- `src/glasses-main.ts` - Layer 0-5 initialization sequence, creates all modules in correct order
- `src/display/glasses-renderer.ts` - 2-container layout, showWelcome(), showConfigRequired(), MAX_TURNS, auto-scroll reset
- `src/display/display-controller.ts` - Removed gestureHandler param and hint bar wiring, added 500ms settle
- `src/__tests__/glasses-renderer.test.ts` - Updated for 2-container layout, new welcome/config/buffer/scroll tests
- `src/__tests__/display-controller.test.ts` - Updated for no gestureHandler, settle period tests with fake timers

## Decisions Made
- Hardcoded 'gideon' as default active session for glasses runtime (session selection on glasses is deferred -- not in scope for v1.1)
- Removed hint bar entirely from glasses display -- user decided "no hint bar on glasses"
- 500ms settle period applies to both response_end AND error chunks (consistent behavior)
- Auto-scroll resets in endStreaming() so it resumes at the start of the next turn

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- TypeScript flagged unused `gestureHandler` variable in glasses-main.ts (TS6133). Fixed by removing the variable assignment since the handler subscribes to bus events in its constructor and doesn't need a direct reference.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Full voice loop is wired end-to-end, ready for error handling work (Phase 7)
- All modules initialize in correct dependency order
- Display turn lifecycle is complete with settle period and buffer management

---
*Plan: 06-02 of 06-runtime-wiring*
*Completed: 2026-02-28*
