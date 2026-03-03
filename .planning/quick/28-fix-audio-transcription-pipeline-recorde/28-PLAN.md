---
phase: quick-28
plan: 28
type: execute
wave: 1
depends_on: []
files_modified:
  - src/audio/audio-capture.ts
  - src/voice-loop-controller.ts
  - src/gestures/gesture-handler.ts
  - src/__tests__/audio-capture.test.ts
  - src/__tests__/voice-loop-controller.test.ts
autonomous: true
requirements: [AUDIO-DIAG-01, AUDIO-GUARD-01]
must_haves:
  truths:
    - "Audio capture logs frame count and total byte count on stopRecording"
    - "Voice loop controller logs blob size before sending to gateway"
    - "Empty or near-silent audio is detected and logged as a warning before gateway send"
    - "Audio capture exposes frame count for diagnostics"
    - "All 613+ existing tests continue to pass"
  artifacts:
    - path: "src/audio/audio-capture.ts"
      provides: "Diagnostic frame counting and empty-audio detection"
    - path: "src/voice-loop-controller.ts"
      provides: "Pre-send audio validation with empty-audio guard"
    - path: "src/__tests__/audio-capture.test.ts"
      provides: "Tests for frame count accessor and empty WAV detection"
    - path: "src/__tests__/voice-loop-controller.test.ts"
      provides: "Tests for empty-audio warning path"
  key_links:
    - from: "src/audio/audio-capture.ts"
      to: "src/gestures/gesture-handler.ts"
      via: "stopRecording() returns blob consumed by STOP_RECORDING action"
      pattern: "audioCapture\\.stopRecording"
    - from: "src/voice-loop-controller.ts"
      to: "src/api/gateway-client.ts"
      via: "gateway.sendVoiceTurn called with blob from audio:recording-stop"
      pattern: "gateway\\.sendVoiceTurn"
---

<objective>
Add diagnostic instrumentation and empty-audio guard to the voice recording pipeline so that (1) silence/empty audio is caught before wasting a round-trip to gateway+WhisperX, and (2) log output on real G2 hardware reveals exactly where audio data is lost when transcription returns hallucinated words like "you".

Purpose: The gateway-side transcript omission was fixed (debug doc voice-transcription-always-you), but the user still sees "you" — indicating Whisper hallucinates on empty/silent audio. The PCM pipeline (bridge frames -> audio-capture buffer -> WAV blob -> gateway) needs visibility and a guard to prevent sending empty audio.

Output: Instrumented audio-capture with frame-count accessor, voice-loop-controller with pre-send validation, and tests for both.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/debug/resolved/voice-transcription-always-you.md
@ARCHITECTURE.md
@src/audio/audio-capture.ts
@src/voice-loop-controller.ts
@src/gestures/gesture-handler.ts
@src/api/gateway-client.ts
@src/bridge/even-bridge.ts
@src/__tests__/audio-capture.test.ts
@src/__tests__/voice-loop-controller.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add diagnostic frame counting and empty-audio detection to AudioCapture</name>
  <files>
    src/audio/audio-capture.ts
    src/__tests__/audio-capture.test.ts
  </files>
  <action>
In `src/audio/audio-capture.ts`:

1. Add a `getFrameCount(): number` method to the `AudioCapture` interface that returns the number of PCM frames captured during the current/last recording session. This is a read-only diagnostic accessor (not part of the recording flow).

2. Inside `createAudioCapture`, track frame count:
   - Add `let frameCount = 0` alongside the existing `frames` array.
   - In `startRecording()`, reset `frameCount = 0`.
   - In `onFrame()`, increment `frameCount++` when a frame is actually buffered (inside the `if (recording && !devMode)` block).
   - Implement `getFrameCount()` returning `frameCount`.

3. Add a `MIN_AUDIO_BYTES` constant (value: 1600 — represents 50ms of 16kHz 16-bit mono PCM, the minimum for meaningful speech). Export it for use in voice-loop-controller.

4. In `stopRecording()` (glasses mode path), after computing `totalLen` from frames, add:
   - If `totalLen < MIN_AUDIO_BYTES`, log to console.warn: `[AudioCapture] Warning: only ${totalLen} bytes (${frameCount} frames) captured — audio may be empty/silent`
   - Still return the WAV blob (don't block the pipeline — the guard is in voice-loop-controller).

Do NOT change the devMode (MediaRecorder) path — that path produces webm blobs of unknown size and is browser-only for dev testing.

In `src/__tests__/audio-capture.test.ts`:

5. Add test: "getFrameCount returns 0 before any recording".
6. Add test: "getFrameCount tracks frames during recording" — start recording, push N frames via onFrame, verify getFrameCount() === N.
7. Add test: "getFrameCount resets on new recording" — record+stop, start new recording, verify count is 0.
8. Add test: "stopRecording with zero frames produces a valid WAV header" — start, stop immediately, verify blob.size === 44 (WAV header only, no data).
9. Add test: "stopRecording with minimal frames produces valid WAV" — push one 40-byte frame, stop, verify blob.size === 84 (44 header + 40 data).
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/audio-capture.test.ts --reporter=verbose 2>&1 | tail -30</automated>
  </verify>
  <done>AudioCapture interface includes getFrameCount(), MIN_AUDIO_BYTES exported, empty-audio warning logged on glasses-mode stopRecording, 5 new tests pass alongside all existing tests.</done>
</task>

<task type="auto">
  <name>Task 2: Add pre-send audio validation and empty-audio guard to VoiceLoopController</name>
  <files>
    src/voice-loop-controller.ts
    src/__tests__/voice-loop-controller.test.ts
  </files>
  <action>
In `src/voice-loop-controller.ts`:

1. Import `MIN_AUDIO_BYTES` from `../audio/audio-capture` (or use inline constant if circular dep risk — check imports first; audio-capture has no imports from voice-loop-controller so this is safe).

2. In the `bus.on('audio:recording-stop')` handler, BEFORE pushing to `pendingTurns`, add a size check:
   ```
   if (blob.size <= 44) {
     // WAV header only — no actual audio data captured
     bus.emit('log', { level: 'warn', msg: `Empty audio blob (${blob.size} bytes, WAV header only) — skipping gateway send. Check bridge audio frame wiring.` });
     return; // do not enqueue
   }
   if (blob.size < MIN_AUDIO_BYTES + 44) {
     // Too short for meaningful speech — warn but still send (let STT decide)
     bus.emit('log', { level: 'warn', msg: `Very short audio: ${blob.size} bytes (${blob.size - 44} PCM bytes). May produce hallucinated transcription.` });
   }
   ```
   The 44 offset accounts for the WAV header. Blobs exactly 44 bytes have ZERO audio data and will always produce hallucinated text — skip them entirely. Blobs slightly larger than 44 but under MIN_AUDIO_BYTES + 44 are warned but sent.

3. In `processQueue()`, enhance the existing log line to include blob type: already has `turn.blob.size` and `turn.blob.type` — good, keep as-is.

In `src/__tests__/voice-loop-controller.test.ts`:

4. Add test: "skips empty audio blob (44 bytes = WAV header only)" — emit `audio:recording-stop` with a 44-byte blob, verify `gateway.sendVoiceTurn` was NOT called, verify a log event with level 'warn' was emitted containing "Empty audio blob".

5. Add test: "warns on very short audio but still sends" — emit `audio:recording-stop` with a blob of size 50 (44 header + 6 bytes PCM, under MIN_AUDIO_BYTES threshold), verify `gateway.sendVoiceTurn` IS called, verify a log event with level 'warn' was emitted containing "Very short audio".

6. Add test: "normal audio blob proceeds without warning" — emit `audio:recording-stop` with a blob of size 5000, verify `gateway.sendVoiceTurn` IS called, verify no warn-level log about audio size.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/voice-loop-controller.test.ts --reporter=verbose 2>&1 | tail -30</automated>
  </verify>
  <done>VoiceLoopController skips sending empty (header-only) WAV blobs, warns on very short audio, logs diagnostics. 3 new tests pass. No regressions in existing queue/lifecycle tests.</done>
</task>

<task type="auto">
  <name>Task 3: Full test suite regression check and commit uncommitted debug logging</name>
  <files>
    src/bridge/even-bridge.ts
    src/main.ts
    vite.config.ts
  </files>
  <action>
1. Run the full test suite (`npm test`) to verify all 613+ tests pass with the changes from Tasks 1 and 2.

2. Run `npm run build` (or the project's build command) to verify no type errors.

3. The working tree has uncommitted changes in 3 files that are part of ongoing debug work:
   - `src/bridge/even-bridge.ts` — adds audio frame count logging (throttled to 2s) and bridge init logging. These are valuable diagnostic additions for the audio pipeline. Review and keep them.
   - `src/main.ts` — adds build-info rendering on boot. Keep.
   - `vite.config.ts` — injects __COMMIT_HASH__ and __BUILD_TIME__ compile-time constants. Keep.

   Stage and commit these 3 files together as a separate commit BEFORE committing the Task 1+2 changes: `fix(audio): add bridge audio frame logging and build info instrumentation`

4. Then stage and commit Task 1+2 files: `fix(audio): add empty-audio guard and diagnostic frame counting to voice pipeline`

Note: The `src/build-info.ts` file is untracked — check if it exists and is complete. If it references __COMMIT_HASH__ and __BUILD_TIME__, include it in the first commit. If it's incomplete or broken, leave it untracked with a note.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npm test 2>&1 | tail -10</automated>
    <manual>Verify `git log --oneline -3` shows two clean commits with the expected messages.</manual>
  </verify>
  <done>Full test suite passes (613+ tests, 0 failures). Build succeeds. Two commits: (1) bridge debug logging + build info, (2) audio pipeline guards + diagnostics. No regressions.</done>
</task>

</tasks>

<verification>
- `npm test` passes all tests (613+ existing + ~8 new tests)
- `npm run build` (or equivalent typecheck) clean
- Audio pipeline now has visibility: frame counts in AudioCapture, blob size validation in VoiceLoopController, audio frame logging in bridge
- Empty audio (WAV header only, 44 bytes) is caught and NOT sent to gateway
- Short audio is warned but still sent (lets WhisperX decide)
- Git log shows two clean commits
</verification>

<success_criteria>
1. AudioCapture.getFrameCount() returns accurate frame counts during recording sessions
2. VoiceLoopController skips sending 44-byte (empty) WAV blobs and emits diagnostic log
3. VoiceLoopController warns on audio shorter than MIN_AUDIO_BYTES but still sends
4. All existing 613 tests pass plus ~8 new tests
5. Uncommitted bridge logging and build-info changes are committed cleanly
</success_criteria>

<output>
After completion, create `.planning/quick/28-fix-audio-transcription-pipeline-recorde/28-SUMMARY.md`
</output>
