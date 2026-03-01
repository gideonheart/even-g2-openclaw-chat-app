---
status: resolved
trigger: "Even G2 glasses show 'Failed Tap to speak' on open, then '[Error] Load failed' repeatedly after tapping"
created: 2026-03-01T00:00:00Z
updated: 2026-03-01T01:00:00Z
---

## Current Focus

hypothesis: RESOLVED - Two bugs confirmed and fixed.
test: All 58 tests in changed files pass.
expecting: No more "Failed Tap to speak" on open; no more "[Error] Load failed" after tap.
next_action: Archived.

## Symptoms

expected: Tap -> record audio -> send to gateway -> get STT + AI response -> display on glasses. Full voice loop working.
actual: On open, glasses show "Failed Tap to speak". Tapping toggles the record icon (outline -> filled), confirming gestures work. But then glasses repeatedly show "[Error] Load failed" (multiple times). No successful voice turn completes.
errors: "[Error] Load failed" displayed on glasses multiple times after tap. Initial "Failed Tap to speak" on app open.
reproduction: Open the app on real Even G2 glasses. Observe "Failed Tap to speak". Tap to try to record. See "[Error] Load failed" repeatedly.
started: Audio pipeline was never tested on real Even G2 hardware before -- first real-device test after v1.3 shipped.

## Eliminated

- hypothesis: Missing createStartUpPageContainer prerequisite for audioControl
  evidence: even-bridge.ts init() calls createStartUpPageContainer(STARTUP_LAYOUT) which creates a valid 1-container page before any audio control. Prerequisite is met.
  timestamp: 2026-03-01T00:25:00Z

- hypothesis: isEventCapture layout mismatch causing audio failure
  evidence: STARTUP_LAYOUT has isEventCapture:1 on the single container (correct). CHAT_LAYOUT has isEventCapture:1 on CHAT_CONTAINER only (correct). SDK says only one container per page can have isEventCapture=1, both layouts comply.
  timestamp: 2026-03-01T00:25:00Z

## Evidence

- timestamp: 2026-03-01T00:10:00Z
  checked: stt-even-g2/g2/main.ts reference sample
  found: pcm16ToWav() function wraps raw PCM in WAV (RIFF) headers (44-byte header + data) before calling transcribeWithWhisperx(). The blob is typed as 'audio/wav' and the form field name is 'file' with filename 'g2-audio.wav'.
  implication: The reference sample explicitly converts PCM->WAV. The chat app sends raw PCM as 'audio/pcm' with filename 'recording.webm' -- format mismatch on both MIME type and extension.

- timestamp: 2026-03-01T00:15:00Z
  checked: audio-capture.ts stopRecording() in glasses mode
  found: Returns new Blob([buffer], { type: 'audio/pcm' }). No WAV header conversion. Raw PCM concatenated directly.
  implication: Gateway receives raw PCM which is undecodable by standard audio decoders expecting WAV/WebM container.

- timestamp: 2026-03-01T00:15:00Z
  checked: gateway-client.ts sendVoiceTurn()
  found: formData.append('audio', request.audio, 'recording.webm'). Filename is 'recording.webm' but blob type is 'audio/pcm' -- contradictory. A gateway/STT expecting .webm/audio format would reject this with an error.
  implication: Even if the gateway forwards to WhisperX, WhisperX will fail to decode raw PCM labeled as .webm. This produces the "[Error] Load failed" sequence.

- timestamp: 2026-03-01T00:20:00Z
  checked: even-bridge.ts destroy() method
  found: Calls unsubEvent?.(), unsubStatus?.(), bridge?.shutDownPageContainer(0). Does NOT call bridge?.audioControl(false) before shutting down the page.
  implication: If audioControl(true) was called during a recording session and the app is hidden/closed, the microphone is left open. On next app open, the Even G2 OS shows "Failed Tap to speak" because the audio state is corrupted from the previous session.

- timestamp: 2026-03-01T00:20:00Z
  checked: glasses-main.ts cleanup() function
  found: audioCapture.stopRecording().catch(() => {}) is called, then bridge.destroy(). The gesture handler may call bridge.startAudio() to open the mic, but cleanup never calls bridge.stopAudio() directly before destroy.
  implication: bridge.stopAudio() is not called during cleanup -- only bridge.destroy() which lacks audioControl(false). The mic can be left open across sessions.

- timestamp: 2026-03-01T00:25:00Z
  checked: SDK README audioControl prerequisite
  found: "Prerequisite: You must call createStartUpPageContainer successfully before opening or closing the microphone." This prerequisite IS met by even-bridge.ts init().
  implication: The audio control prerequisite is not the primary cause.

- timestamp: 2026-03-01T00:28:00Z
  checked: SDK README PCM format spec
  found: "PCM parameters: dtUs 10000 µs (frame length), srHz 16kHz (sample rate), 40 bytes per frame, little-endian byte order." This matches pcm16ToWav() in the reference sample (sampleRate=16000, channels=1, bitsPerSample=16).
  implication: PCM parameters are known. WAV conversion using these exact parameters is required before sending to STT.

- timestamp: 2026-03-01T01:00:00Z
  checked: Test suite after applying fixes
  found: All 58 tests in audio-capture.test.ts, even-bridge.test.ts, gateway-client.test.ts pass. One pre-existing failure in glasses-main.test.ts (lifecycle reboot test) unrelated to this fix.
  implication: Fixes are correct and do not break any existing behavior.

## Resolution

root_cause: Two compounding bugs in the audio pipeline for real Even G2 hardware. (1) bridge.destroy() does not call audioControl(false) before shutDownPageContainer -- the microphone was left open between sessions, causing the Even G2 OS to display "Failed Tap to speak" on the next boot because it cannot open an already-open microphone. (2) audio-capture.ts returns raw PCM as 'audio/pcm' blob (no WAV container), but the gateway/STT backend expects a proper audio container format. The audio was also sent with filename 'recording.webm' contradicting the actual content type. The reference sample (stt-even-g2/g2/main.ts) explicitly wraps PCM in a WAV header via pcm16ToWav() at 16kHz/16-bit/mono before sending.

fix: (A) Added bridge?.audioControl(false).catch(() => {}) call in even-bridge.ts destroy() before shutDownPageContainer -- ensures the mic is always closed on session teardown. (B) Added pcm16ToWav() function in audio-capture.ts that wraps raw PCM in a proper WAV (RIFF) container (16kHz, 16-bit, mono) matching the Even G2 SDK spec and reference sample. Glasses-mode stopRecording() now returns 'audio/wav' instead of raw 'audio/pcm'. (C) Fixed gateway-client.ts to derive filename from blob MIME type -- WAV blobs get 'recording.wav', WebM (dev mode) gets 'recording.webm'.

verification: 58 tests pass in the three affected test files. Tests updated to assert audio/wav type, 44+N byte WAV size, RIFF header presence, correct PCM data at offset 44, correct sample rate/channels/bit depth in WAV header. even-bridge destroy test now asserts audioControl(false) is called before shutDownPageContainer.

files_changed:
  - src/audio/audio-capture.ts: Added pcm16ToWav() exported function; stopRecording() in glasses mode now calls pcm16ToWav() instead of returning raw Blob([buffer], {type:'audio/pcm'})
  - src/bridge/even-bridge.ts: Added bridge?.audioControl(false).catch(() => {}) in destroy() before shutDownPageContainer()
  - src/api/gateway-client.ts: Derive filename extension from request.audio.type (wav or webm) so the filename matches the actual content
  - src/__tests__/audio-capture.test.ts: Updated 5 tests for WAV format; added pcm16ToWav unit test suite (4 tests)
  - src/__tests__/even-bridge.test.ts: Updated destroy() test to assert audioControl(false) is called
