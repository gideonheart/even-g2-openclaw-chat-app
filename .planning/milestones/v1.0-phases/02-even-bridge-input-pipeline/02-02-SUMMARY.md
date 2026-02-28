---
phase: 02-even-bridge-input-pipeline
plan: 02
subsystem: bridge
tags: [even-hub-sdk, event-bus, audio-capture, pcm, mediarecorder, gesture-mapping]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: EventBus, AppEventMap, Vite+TypeScript project structure
provides:
  - BridgeService interface for real/mock bridge implementations
  - EvenBridge service wrapping @evenrealities/even_hub_sdk lifecycle
  - BridgeMock for keyboard-driven gesture testing in dev mode
  - AudioCapture service with glasses PCM and browser MediaRecorder fallback
  - bridge:audio-frame event added to AppEventMap
affects: [03-gesture-fsm-handler, 06-integration, display-pipeline]

# Tech tracking
tech-stack:
  added: ["@evenrealities/even_hub_sdk@0.0.7"]
  patterns: ["Factory function with BridgeService interface", "vi.hoisted() for SDK mock in tests", "Synchronous PCM frame buffering"]

key-files:
  created:
    - src/bridge/bridge-types.ts
    - src/bridge/even-bridge.ts
    - src/bridge/bridge-mock.ts
    - src/audio/audio-capture.ts
    - src/__tests__/even-bridge.test.ts
    - src/__tests__/bridge-mock.test.ts
    - src/__tests__/audio-capture.test.ts
  modified:
    - src/types.ts
    - package.json

key-decisions:
  - "Used vi.hoisted() for SDK mock bridge to work with Vitest's vi.mock hoisting"
  - "BridgeMock emits bridge:connected with deviceName 'BridgeMock' for dev identification"
  - "AudioCapture uses FileReader in tests to read Blob content (jsdom Blob lacks arrayBuffer())"

patterns-established:
  - "BridgeService interface: all bridge implementations (real/mock) share init/destroy/startAudio/stopAudio"
  - "Only even-bridge.ts imports from @evenrealities/even_hub_sdk — all other modules use the event bus"
  - "onFrame() is fully synchronous for 100Hz PCM frame handling"

requirements-completed: [BRDG-01, BRDG-02, BRDG-03, VOICE-03, VOICE-04]

# Metrics
duration: 6min
completed: 2026-02-28
---

# Phase 2 Plan 2: Even Bridge & Audio Capture Summary

**EvenBridge SDK wrapper, dev-mode mock bridge with keyboard shortcuts, and dual-mode audio capture (PCM frames + MediaRecorder)**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-28T01:29:24Z
- **Completed:** 2026-02-28T01:34:58Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- EvenBridge service wraps full SDK lifecycle: waitForEvenAppBridge -> createStartUpPageContainer -> event subscription -> destroy with idempotent unsubscribe
- SDK OsEventTypeList events mapped to typed AppEventMap emissions (tap, double-tap, scroll-up, scroll-down, audio-frame)
- BridgeMock enables keyboard-driven gesture testing (t=tap, d=double-tap, ArrowUp/Down=scroll) without physical glasses
- AudioCapture handles both glasses PCM frame buffering (synchronous onFrame at ~100Hz) and browser MediaRecorder fallback
- All 150 tests pass (33 new + 117 existing), zero TypeScript errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Install SDK and create bridge types, EvenBridge service, and mock bridge with tests** - `11a3042` (feat)
2. **Task 2: Create audio capture service with glasses/browser fallback and tests** - `599727e` (feat)

## Files Created/Modified
- `src/bridge/bridge-types.ts` - Shared BridgeService interface (init/destroy/startAudio/stopAudio)
- `src/bridge/even-bridge.ts` - Real EvenBridge wrapping @evenrealities/even_hub_sdk
- `src/bridge/bridge-mock.ts` - Dev-mode mock with keyboard shortcuts
- `src/audio/audio-capture.ts` - Audio capture with glasses PCM and browser MediaRecorder modes
- `src/__tests__/even-bridge.test.ts` - 11 tests for SDK lifecycle, event mapping, destroy, audio delegation
- `src/__tests__/bridge-mock.test.ts` - 8 tests for keyboard shortcuts and lifecycle
- `src/__tests__/audio-capture.test.ts` - 14 tests for both capture modes
- `src/types.ts` - Added bridge:audio-frame to AppEventMap
- `package.json` - Added @evenrealities/even_hub_sdk dependency

## Decisions Made
- Used `vi.hoisted()` for mock bridge definition so vi.mock factory can reference it (Vitest hoists vi.mock calls above imports)
- BridgeMock emits `bridge:connected` with deviceName `'BridgeMock'` so app can distinguish dev vs real bridge
- AudioCapture tests use FileReader to read Blob content since jsdom Blob lacks `arrayBuffer()` method

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed vi.mock hoisting error in even-bridge tests**
- **Found during:** Task 1 (bridge tests)
- **Issue:** `vi.mock` factory referenced `mockBridge` declared at module scope, but vi.mock is hoisted above all declarations causing ReferenceError
- **Fix:** Moved mock bridge definition into `vi.hoisted()` block with getter functions for callbacks
- **Files modified:** src/__tests__/even-bridge.test.ts
- **Verification:** All 11 bridge tests pass
- **Committed in:** 11a3042 (part of Task 1 commit)

**2. [Rule 1 - Bug] Fixed Blob.arrayBuffer() not available in jsdom**
- **Found during:** Task 2 (audio capture tests)
- **Issue:** jsdom Blob does not implement `arrayBuffer()` method, causing 2 tests to fail
- **Fix:** Created `readBlob()` helper using FileReader API which is supported in jsdom
- **Files modified:** src/__tests__/audio-capture.test.ts
- **Verification:** All 14 audio capture tests pass
- **Committed in:** 599727e (part of Task 2 commit)

**3. [Rule 1 - Bug] Removed unused type import for tsc compliance**
- **Found during:** Task 2 (TypeScript type check)
- **Issue:** `import type { EvenHubEvent, DeviceStatus }` in even-bridge.test.ts was unused after refactoring to vi.hoisted()
- **Fix:** Removed the unused import line
- **Files modified:** src/__tests__/even-bridge.test.ts
- **Verification:** `tsc --noEmit` passes with zero errors
- **Committed in:** 599727e (part of Task 2 commit)

---

**Total deviations:** 3 auto-fixed (3 bugs)
**Impact on plan:** All auto-fixes necessary for test correctness and TypeScript compliance. No scope creep.

## Issues Encountered
None beyond the auto-fixed issues above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Bridge service and mock are ready for gesture FSM wiring (Plan 03)
- AudioCapture service ready for gesture-handler integration (start/stop recording on tap FSM transitions)
- Event bus bridge:audio-frame event enables bridge -> AudioCapture.onFrame() wiring in gesture handler

## Self-Check: PASSED

All 7 created files verified present. Both task commits (11a3042, 599727e) verified in git log.

---
*Phase: 02-even-bridge-input-pipeline*
*Completed: 2026-02-28*
