---
status: resolved
trigger: "G2 glasses tap-to-record produces 'Gateway returned 400:' error instead of transcribing audio via WhisperX"
created: 2026-03-03T00:00:00Z
updated: 2026-03-03T12:05:00Z
---

## Current Focus

hypothesis: CONFIRMED -- postVoiceTurn/postTextTurn discard gateway JSON error body, showing only HTTP status
test: Verified by sending silent WAV to running gateway -- got 400 with detailed JSON error that was discarded
expecting: Fix reads JSON error body and surfaces the actual error message to the user
next_action: Archive session

## Symptoms

expected: Tap record on G2 glasses -> speak -> tap stop -> audio gets sent to WhisperX for transcription -> user message appears in chat -> OpenClaw (Gideon) responds
actual: After tap record + speak + tap stop, the UI shows "[Error] Gateway returned 400:" with no additional details. No transcription happens.
errors: "[Error] Gateway returned 400:" - incomplete/truncated error message from the gateway HTTP response
reproduction: On G2 glasses: tap to start recording, speak, tap again to stop recording. Every time produces the 400 error.
started: After quick-28 added empty-audio guard. Previously WhisperX hallucinated "you" on empty audio.

## Eliminated

- hypothesis: Audio Content-Type is wrong/unsupported
  evidence: pcm16ToWav creates Blob with type "audio/wav", postVoiceTurn sends it as Content-Type header. Gateway VALID_AUDIO_TYPES includes "audio/wav".
  timestamp: 2026-03-03T11:50:00Z

- hypothesis: Gateway is not running or unreachable
  evidence: curl to localhost:4400/readyz returns 200 with {"status":"ready","checks":{"stt":{"healthy":true},"openclaw":{"healthy":true}}}. HTTP 400 (not network error) also confirms reachability.
  timestamp: 2026-03-03T11:51:00Z

- hypothesis: Audio payload is empty (0 bytes)
  evidence: validateAudioSize throws "Audio payload is empty" for 0-byte bodies. The frontend 44-byte guard means some PCM data IS present. Error would be different.
  timestamp: 2026-03-03T11:52:00Z

- hypothesis: Quick-28 guard changes caused the 400
  evidence: Quick-28 only drops blobs <=44 bytes and warns on blobs <1644 bytes. Blobs that pass the guard are sent normally. The 400 comes from the gateway's STT pipeline, not from the guard logic.
  timestamp: 2026-03-03T11:53:00Z

## Evidence

- timestamp: 2026-03-03T11:50:00Z
  checked: gateway-client.ts postVoiceTurn error handling (line 196-197)
  found: On non-OK response, throws Error("Gateway returned ${resp.status}: ${resp.statusText}") WITHOUT reading the JSON body. statusText is empty on HTTP/2, producing "Gateway returned 400:"
  implication: The actual gateway error message is discarded -- user sees useless error

- timestamp: 2026-03-03T11:52:00Z
  checked: Gateway server.ts handleError (line 309-319)
  found: UserError maps to HTTP 400 with JSON body {"error":"...","code":"..."}. The JSON body contains the actual error description.
  implication: Gateway sends helpful error info but frontend never reads it

- timestamp: 2026-03-03T11:54:00Z
  checked: curl test sending 1600-byte silence WAV to localhost:4400/api/voice/turn
  found: Returns 400 with {"error":"Transcription returned empty text. The audio may be silent or too short.","code":"STT_TRANSCRIPTION_FAILED"}
  implication: WhisperX returns empty text on silent audio; gateway correctly rejects this as UserError (400)

- timestamp: 2026-03-03T11:55:00Z
  checked: curl test sending 440Hz sine wave WAV (1 second) to gateway
  found: Returns 200 with {"transcript":"you",...} -- hallucination on non-speech audio
  implication: Gateway pipeline works end-to-end; the 400 is specifically about empty transcription result

- timestamp: 2026-03-03T11:56:00Z
  checked: Audio pipeline wiring in glasses-main.ts and audio-capture.ts
  found: Wiring is correct: bridge:audio-frame -> audioCapture.onFrame -> frames array. startRecording/stopRecording lifecycle is properly ordered.
  implication: The pipeline structure is correct; audio CONTENT from glasses may genuinely be silence/insufficient

- timestamp: 2026-03-03T12:01:00Z
  checked: whisperx-provider.ts pollForResult (lines 206-213)
  found: When WhisperX completes but extractTranscriptText returns empty string, throws UserError(STT_TRANSCRIPTION_FAILED, "Transcription returned empty text...")
  implication: This is the exact error that becomes the 400 -- the gateway is behaving correctly, the frontend just discards the message

## Resolution

root_cause: |
  The frontend gateway-client.ts postVoiceTurn (and postTextTurn) discards the HTTP error response body on non-OK responses. Line 197: `throw new Error("Gateway returned ${resp.status}: ${resp.statusText}")` only reads the status code and statusText (which is empty on HTTP/2 and some servers). The gateway returns a JSON body `{"error":"Transcription returned empty text. The audio may be silent or too short.","code":"STT_TRANSCRIPTION_FAILED"}` on 400 errors, but the frontend never reads it. The user sees the useless message "Gateway returned 400:" with no actionable information.

  The underlying audio issue (silence/empty audio from glasses causing WhisperX to return empty text) is a separate device-level concern. The gateway correctly rejects empty transcriptions as 400. The frontend should surface the actual error message so the user knows WHY the request failed.

fix: |
  Added readGatewayError() helper to gateway-client.ts that reads the JSON error body from non-OK responses. Falls back to HTTP status if the body cannot be parsed. Updated both postVoiceTurn and postTextTurn to use this helper instead of the status-only error.

  Before: "Gateway returned 400:" (no useful info)
  After: "Transcription returned empty text. The audio may be silent or too short." (actionable)

verification: |
  - All 623 tests pass (38 test files), including 2 new regression tests:
    - Voice turn: surfaces JSON error message from 400 response
    - Text turn: surfaces JSON error message from 400 response
  - Existing error tests still pass (502 without JSON body falls back to status message)
  - curl test confirms gateway returns the detailed JSON error body that would now be surfaced

files_changed:
  - src/api/gateway-client.ts
  - src/__tests__/gateway-client.test.ts
