---
status: resolved
trigger: "Missing loading dots immediately after stop-tap + race condition with overlapping turns mutating status bar"
created: 2026-03-04T00:00:00Z
updated: 2026-03-04T00:10:00Z
---

## Current Focus

hypothesis: CONFIRMED - Two root causes identified and fixed.
test: All 653 tests pass (38 files). TypeScript compiles clean.
expecting: N/A - resolved.
next_action: Archive and commit.

## Symptoms

expected: On tap-stop, status bar should immediately show loading dots (`. .. ...`). During overlapping turns, status should follow deterministic priority (recording > sent > thinking > idle).
actual: (1) Loading dots are delayed because `audio:recording-stop` is emitted late in async chain (after stopAudio + stopRecording complete). (2) Late gateway events from previous turn can overwrite current status during rapid re-recording.
errors: No crash errors -- purely visual state race condition.
reproduction: (1) Tap stop and observe delay before loading dots appear. (2) Start new recording while previous response is still streaming -- status bar flickers/shows wrong state.
started: Structural issue since voice loop implementation. Quick-36 added animated dots but timing issue predates it.

## Eliminated

(none -- both initial hypotheses were confirmed)

## Evidence

- timestamp: 2026-03-04T00:01:00Z
  checked: gesture-handler.ts STOP_RECORDING action (lines 138-159)
  found: Flow is `await bridge.stopAudio()` -> `audioCapture.stopRecording().then(blob => emit audio:recording-stop)`. The `audio:recording-stop` event (which carries the blob) is delayed by both the bridge.stopAudio await AND the stopRecording promise.
  implication: The display-controller only sets `sent` icon on `audio:recording-stop`, so user sees no visual change until both async ops complete.

- timestamp: 2026-03-04T00:02:00Z
  checked: display-controller.ts icon state writers (lines 36-122)
  found: At least 5 competing writers to `renderer.setIconState()`: (1) gateway:chunk transcript -> sent, (2) gateway:chunk response_start -> thinking, (3) gateway:chunk response_end -> idle (via 500ms settle), (4) audio:recording-start -> recording, (5) audio:recording-stop -> sent. NO priority mechanism exists -- last-write-wins.
  implication: A late response_end from turn N can overwrite the `recording` icon for turn N+1. The settle timer can overwrite `sent` from a fresh recording stop.

- timestamp: 2026-03-04T00:03:00Z
  checked: gesture-handler.ts STOP_RECORDING vs START_RECORDING patterns
  found: START_RECORDING emits `audio:recording-start` synchronously at end of action, after awaiting bridge.startAudio. But the key insight is the FSM already transitions to `sent` state synchronously (line 109). However, display-controller does NOT listen to FSM state -- it listens to bus events.
  implication: The FSM transitions immediately but the display update waits for the async event. This is the core disconnect.

- timestamp: 2026-03-04T00:05:00Z
  checked: Verification of fix implementation
  found: All 653 tests pass (38 files, 0 failures). 11 new tests added for priority-based icon resolution. TypeScript compiles clean with no errors.
  implication: Fix is correct, complete, and regression-free.

## Resolution

root_cause: Two intertwined issues:
1. DELAYED SENT ICON: In gesture-handler STOP_RECORDING, `audio:recording-stop` is emitted only after `await bridge.stopAudio()` + `audioCapture.stopRecording()` promise resolves. Display-controller sets `sent` icon only on this event. So loading dots appear late.
2. NO PRIORITY GUARD: display-controller has no priority mechanism -- any event can overwrite any icon state. Late gateway events (response_end settle timer, transcript from previous turn) can overwrite the current active state.

fix: Three-part fix:
1. Added `audio:stop-requested` event to AppEventMap (types.ts) -- synchronous, immediate, no async dependencies.
2. Emit `audio:stop-requested` in gesture-handler STOP_RECORDING action BEFORE the async bridge.stopAudio/audioCapture.stopRecording chain. This decouples "user intent to stop" from "audio blob ready".
3. Rewrote display-controller icon state management with deterministic priority resolution:
   - Tracks `recordingActive` (boolean), `pendingTurns` (counter), `streamingActive` (boolean)
   - resolveIcon() applies priority: recording > sent > thinking > idle
   - Only calls renderer.setIconState() when resolved state differs from last-applied (idempotent)
   - audio:stop-requested sets recordingActive=false, pendingTurns++, resolves immediately to `sent`
   - response_end/error settle timer decrements pendingTurns -- but recording/sent can still take priority
   - audio:recording-start clears settle timer and sets recordingActive=true

verification:
- 653 tests pass (38 files, 0 failures)
- 31 display-controller tests (11 new priority tests)
- 59 gesture-handler tests (2 new stop-requested ordering tests)
- TypeScript compiles clean
- Acceptance tests confirmed:
  1. stop tap -> immediate `sent` icon transition (no wait for async)
  2. response_end from previous turn does not hide active `recording` icon
  3. overlapping turns maintain deterministic status priority
  4. after all pending processing clears and not recording -> idle
  5. multiple overlapping turns: sent persists until all settle

files_changed:
- src/types.ts (added `audio:stop-requested` event)
- src/gestures/gesture-handler.ts (emit `audio:stop-requested` before async chain)
- src/display/display-controller.ts (priority-based icon state management)
- src/__tests__/display-controller.test.ts (updated + 11 new priority tests)
- src/__tests__/gesture-handler.test.ts (2 new stop-requested ordering tests)
