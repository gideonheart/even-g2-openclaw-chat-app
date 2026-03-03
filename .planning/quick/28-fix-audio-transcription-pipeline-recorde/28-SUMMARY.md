---
phase: quick-28
plan: 28
subsystem: audio
tags: [pcm, wav, whisper, stt, empty-audio-guard, diagnostics]

# Dependency graph
requires:
  - phase: Phase 2
    provides: AudioCapture and voice-loop-controller with PCM frame pipeline
provides:
  - AudioCapture.getFrameCount() diagnostic accessor
  - MIN_AUDIO_BYTES constant for audio validation threshold
  - Empty-audio guard in VoiceLoopController (skips header-only WAV blobs)
  - Short-audio warning in VoiceLoopController (warns but sends sub-threshold blobs)
  - Bridge audio frame count logging (throttled 2s) for PCM pipeline visibility
  - Build info rendering with commit hash and build time
affects: [voice-loop, audio-capture, gateway-client, glasses-main]

# Tech tracking
tech-stack:
  added: []
  patterns: [empty-audio-guard-before-gateway-send, diagnostic-frame-counting]

key-files:
  created:
    - src/build-info.ts
  modified:
    - src/audio/audio-capture.ts
    - src/voice-loop-controller.ts
    - src/bridge/even-bridge.ts
    - src/main.ts
    - vite.config.ts
    - src/__tests__/audio-capture.test.ts
    - src/__tests__/voice-loop-controller.test.ts
    - src/__tests__/gesture-handler.test.ts
    - src/__tests__/glasses-main.test.ts

key-decisions:
  - "MIN_AUDIO_BYTES = 1600 (50ms of 16kHz 16-bit mono PCM) as threshold for meaningful speech"
  - "WAV header-only blobs (<=44 bytes) are silently dropped; short blobs are warned but still sent"
  - "makeAudioBlob() helper in tests creates 2000-byte blobs to pass the empty-audio guard"

patterns-established:
  - "Empty-audio guard: validate blob.size > 44 before enqueuing for gateway send"
  - "Diagnostic accessor pattern: getFrameCount() exposes internal counter without exposing mutation"

requirements-completed: [AUDIO-DIAG-01, AUDIO-GUARD-01]

# Metrics
duration: 7min
completed: 2026-03-03
---

# Quick Task 28: Audio Transcription Pipeline Diagnostics and Empty-Audio Guard Summary

**Empty-audio guard skipping header-only WAV blobs before gateway send, plus diagnostic frame counting and bridge audio logging for PCM pipeline visibility**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-03T11:29:57Z
- **Completed:** 2026-03-03T11:37:00Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments
- AudioCapture now exposes `getFrameCount()` for diagnostic visibility into PCM frame accumulation
- VoiceLoopController skips sending empty WAV blobs (<=44 bytes = header only) to prevent Whisper hallucination on silent input
- VoiceLoopController warns on very short audio (<1644 bytes) but still sends, letting WhisperX decide
- Bridge audio frame logging (throttled to 2s) provides real-device visibility into PCM pipeline
- Build info module renders commit hash and build age in hub UI
- 8 new tests (5 audio-capture + 3 voice-loop-controller), all 621 tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Add diagnostic frame counting and empty-audio detection to AudioCapture** - `89c84ac` (feat)
2. **Task 2: Add pre-send audio validation and empty-audio guard to VoiceLoopController** - `83b5c05` (feat)
3. **Task 3a: Bridge debug logging and build info instrumentation** - `569a966` (fix)
4. **Task 3b: Fix AudioCapture mock type errors in gesture-handler and glasses-main tests** - `2414337` (fix)

## Files Created/Modified
- `src/audio/audio-capture.ts` - Added getFrameCount() accessor, MIN_AUDIO_BYTES constant, empty-audio warning on stopRecording
- `src/voice-loop-controller.ts` - Added empty-audio guard (skip <=44 byte blobs), short-audio warning before gateway send
- `src/bridge/even-bridge.ts` - Added throttled audio frame count logging (every 2s)
- `src/main.ts` - Added build-info rendering on boot
- `vite.config.ts` - Added __COMMIT_HASH__ and __BUILD_TIME__ compile-time constants
- `src/build-info.ts` - New module: commit hash + build age display
- `src/__tests__/audio-capture.test.ts` - 5 new tests: getFrameCount lifecycle, zero-frame WAV, minimal-frame WAV
- `src/__tests__/voice-loop-controller.test.ts` - 3 new tests: empty blob skip, short audio warning, normal audio no-warning; updated existing test blobs to use makeAudioBlob() helper
- `src/__tests__/gesture-handler.test.ts` - Added getFrameCount mock to AudioCapture mock
- `src/__tests__/glasses-main.test.ts` - Added getFrameCount mock to AudioCapture mock

## Decisions Made
- **MIN_AUDIO_BYTES = 1600:** Represents 50ms of 16kHz 16-bit mono PCM. Anything shorter will almost certainly produce hallucinated STT output. Used as threshold in both AudioCapture warning and VoiceLoopController guard.
- **Guard vs. warning split:** Empty blobs (<=44 bytes) are always dropped (100% hallucination). Short blobs (45-1643 bytes) are warned but sent -- lets WhisperX decide, since borderline audio might contain a valid word.
- **makeAudioBlob() test helper:** Creates 2000-byte blobs to pass the empty-audio guard, replacing small string blobs in existing tests.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Existing test blobs too small for empty-audio guard**
- **Found during:** Task 2 (VoiceLoopController testing)
- **Issue:** Existing tests used `new Blob(['audio-data'])` (10 bytes) which triggered the new empty-audio guard, causing 12 test failures
- **Fix:** Added `makeAudioBlob()` helper creating 2000-byte blobs; updated all existing test blob references
- **Files modified:** src/__tests__/voice-loop-controller.test.ts
- **Verification:** All 19 voice-loop-controller tests pass
- **Committed in:** 83b5c05 (Task 2 commit)

**2. [Rule 3 - Blocking] Missing getFrameCount in AudioCapture mocks**
- **Found during:** Task 3 (build verification)
- **Issue:** `tsc` build failed -- gesture-handler.test.ts and glasses-main.test.ts mock AudioCapture without the new getFrameCount method
- **Fix:** Added `getFrameCount: vi.fn().mockReturnValue(0)` to both mocks
- **Files modified:** src/__tests__/gesture-handler.test.ts, src/__tests__/glasses-main.test.ts
- **Verification:** `npm run build` succeeds, all 621 tests pass
- **Committed in:** 2414337 (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both auto-fixes necessary for correctness. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Audio pipeline now has full diagnostic visibility from bridge frames through to gateway send
- Empty/silent audio is caught before wasting a round-trip to gateway+WhisperX
- Ready for real-device testing to verify the "you" hallucination is eliminated

## Self-Check: PASSED

All 10 created/modified files verified present. All 4 commit hashes verified in git log.

---
*Phase: quick-28*
*Completed: 2026-03-03*
