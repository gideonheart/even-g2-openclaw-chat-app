---
status: resolved
trigger: "G2 glasses audio recording sends empty/silent audio to WhisperX"
created: 2026-03-03T00:00:00Z
updated: 2026-03-03T00:01:00Z
---

## Current Focus

hypothesis: CONFIRMED — even-bridge.ts onEvenHubEvent callback does not return early after handling audio events. Audio frames fall through to gesture detection where eventType=undefined triggers gesture:tap. This floods the gesture FSM with phantom taps at ~100Hz, causing recording to stop after just 275ms (the debounce window). 275ms of audio is too short for speech recognition.
test: Compare reference (has `return` after audio handling) vs chat app (no return — falls through to tap emission)
expecting: Adding `return` after audio frame handling will prevent phantom taps and allow full-duration recording
next_action: Fix even-bridge.ts to return early after audio event handling

## Symptoms

expected: Tap record on G2 glasses -> speak -> tap stop -> audio blob with real PCM data sent to g2-voice-gateway -> WhisperX transcribes actual speech -> response shown in chat
actual: Audio recording completes but WhisperX receives empty/silent audio, returning error "Transcription returned empty text. The audio may be silent or too short."
errors: "Glasses gateway error: Transcription returned empty text. The audio may be silent or too short."
reproduction: On G2 glasses - tap to start recording, speak, tap to stop. Every time produces transcription error. Working reference at /home/forge/bibele.kingdom.lv/samples/stt-even-g2/dist/index.html does NOT have this problem.
started: Has never worked in the chat app. Reference stt-even-g2 has always worked.

## Eliminated

## Evidence

- timestamp: 2026-03-03T00:01:00Z
  checked: Working reference stt-even-g2/g2/main.ts recording flow
  found: START_RECORDING order: (1) pcmChunks=[], (2) audioControl(true), (3) isRecording=true. STOP_RECORDING order: (1) isRecording=false, (2) audioControl(false), (3) process pcm. Audio frame handler: `if (event.audioEvent && state.isRecording)` — same callback, synchronous push.
  implication: In the working reference, audioControl(true) is called BEFORE isRecording is set, BUT the audio frame listener check uses `state.isRecording` which is set AFTER audioControl. The key: audio frames come through the SAME onEvenHubEvent callback, and the isRecording flag is set synchronously.

- timestamp: 2026-03-03T00:02:00Z
  checked: Chat app gesture-handler.ts START_RECORDING action
  found: Order: (1) audioCapture.startRecording() — sets recording=true, (2) await bridge.startAudio() — calls audioControl(true). Bridge emits audio frames on bus. Audio frames wired at glasses-main.ts:288 via bus.on('bridge:audio-frame', ({pcm}) => audioCapture.onFrame(pcm)).
  implication: The audio frame flow is: SDK callback -> bridge emits bus event -> bus handler calls onFrame -> onFrame checks `recording && !devMode`. This should work.

- timestamp: 2026-03-03T00:03:00Z
  checked: Chat app STOP_RECORDING action in gesture-handler.ts
  found: CRITICAL ORDERING BUG! Line 128-145: (1) await bridge.stopAudio() — calls audioControl(false), (2) THEN audioCapture.stopRecording(). But bridge.stopAudio() tells the glasses to STOP sending audio frames. The stopAudio is awaited. Then stopRecording concatenates whatever frames were collected. BUT the real issue might be in START sequence — bridge.startAudio() is AWAITED (async) while audioCapture.startRecording just sets a flag. Let me check if frames could arrive before recording flag is set... No, startRecording sets recording=true synchronously FIRST, then startAudio is called.
  implication: The start order looks correct. Need to look more carefully at what's different.

- timestamp: 2026-03-03T00:04:00Z
  checked: even-bridge.ts onEvenHubEvent callback flow for audio events
  found: ROOT CAUSE — Lines 68-79 handle audio events but DO NOT return. Execution falls through to lines 82-102 gesture detection. For audio-only events, eventType resolves to undefined (no listEvent/textEvent/sysEvent). Line 88 checks `eventType === undefined` which is TRUE, so every audio frame also emits gesture:tap. At ~100Hz frame rate, this floods the gesture handler with phantom taps.
  implication: With 275ms debounce, recording stops after exactly 275ms when the first phantom tap passes the debounce window. This produces a tiny audio segment (8800 bytes PCM / 8844 bytes WAV) that WhisperX cannot meaningfully transcribe.

- timestamp: 2026-03-03T00:04:30Z
  checked: Working reference stt-even-g2/g2/main.ts line 364-367
  found: Reference has explicit `return` after audio frame handling: `if (event.audioEvent && state.isRecording) { state.pcmChunks.push(...); return; }` — gesture events only checked for non-audio events.
  implication: This is the exact difference. Reference returns early; chat app falls through.

- timestamp: 2026-03-03T00:05:00Z
  checked: Historical symptom correlation
  found: Previously WhisperX returned "you" (a known hallucination on near-empty/silent audio). After quick-28 improvements, it now returns proper error "Transcription returned empty text." Both symptoms match the root cause of only capturing ~275ms of audio (mostly silence before speech onset).
  implication: Strong evidence confirming the root cause matches observed symptoms perfectly.

## Resolution

root_cause: In src/bridge/even-bridge.ts, the onEvenHubEvent callback handles audio frames (lines 68-79) but does NOT return early. Execution falls through to gesture detection (lines 82-102) where eventType resolves to undefined for audio-only events. The condition `eventType === undefined` on line 88 is true, causing every audio frame to also emit gesture:tap at ~100Hz. The gesture handler's 275ms debounce allows a phantom tap through after 275ms, stopping recording prematurely. Only ~275ms of audio is captured, which is too short for speech recognition.
fix: Added `return` after audio frame handling in even-bridge.ts (line 85) to prevent fall-through to gesture detection. Added regression test verifying audio events do not emit gesture:tap.
verification: All 624 tests pass (38 files). New regression test "audio events do NOT emit gesture:tap (early return prevents phantom taps)" confirms the fix. Existing tests unchanged.
files_changed:
  - src/bridge/even-bridge.ts
  - src/__tests__/even-bridge.test.ts
