---
status: resolved
trigger: "voice-transcription-always-you: When recording audio in OpenClaw UI, the speech transcription always outputs 'you' regardless of what the user actually said"
created: 2026-03-03T00:00:00Z
updated: 2026-03-03T00:22:00Z
---

## Current Focus

hypothesis: CONFIRMED -- Gateway GatewayReply omitted transcript field; frontend expected it
test: Added transcript field to GatewayReply, populated in orchestrator, verified with all tests
expecting: Voice turns now return STT text in reply.transcript, frontend emits transcript chunk, user messages display correctly
next_action: Archive session

## Symptoms

expected: Voice recording should transcribe the user's actual speech and send it as a message
actual: Every voice recording transcription comes back as just "you" -- seen in the chat log where the user's messages all show as "you"
errors: No error messages reported -- it behaves as if it's working, just with wrong transcription
reproduction: Record any audio in OpenClaw UI -- result is always "you"
started: Current behavior, unclear when it started

## Eliminated

- hypothesis: "you" is a hardcoded default/fallback in the frontend code
  evidence: Searched entire src/ directory for "you" string literals -- zero matches. No default value.
  timestamp: 2026-03-03T00:07:00Z

## Evidence

- timestamp: 2026-03-03T00:01:00Z
  checked: Gateway GatewayReply type in shared-types/src/voice-turn.ts
  found: GatewayReply has turnId, sessionKey, assistant{fullText, segments, truncated}, timing, meta -- NO transcript field
  implication: The backend never sends the user's STT text back to the frontend

- timestamp: 2026-03-03T00:02:00Z
  checked: orchestrator.ts executeVoiceTurn -- how reply is built
  found: sttResult.text is used to call openclawClient.sendTranscript but is NOT included in the reply object (lines 108-125)
  implication: The STT text is consumed server-side but never returned to the client

- timestamp: 2026-03-03T00:03:00Z
  checked: Frontend gateway-client.ts emitFromGatewayReply (line 173-181)
  found: Checks reply.transcript -- if truthy emits transcript chunk; otherwise skips. Since gateway never sends it, this never fires.
  implication: Frontend never receives user transcript from voice turns

- timestamp: 2026-03-03T00:04:00Z
  checked: display-controller.ts and auto-save.ts
  found: Both subscribe to gateway:chunk transcript type to display/save user messages. This chunk is never emitted for voice turns.
  implication: User messages from voice are never displayed or saved through the transcript path

- timestamp: 2026-03-03T00:05:00Z
  checked: Gateway orchestrator.ts for any use of "transcript" in reply building
  found: Zero occurrences of "transcript" in orchestrator.ts. sttResult.text is used to call openclawClient.sendTranscript but never added to the GatewayReply object
  implication: Confirmed root cause -- STT text is consumed server-side only, never sent to frontend

- timestamp: 2026-03-03T00:06:00Z
  checked: GatewayReply shared type definition (shared-types/src/voice-turn.ts lines 100-118)
  found: Type has turnId, sessionKey, assistant, timing, meta -- NO transcript field defined
  implication: This is a contract omission, not a runtime bug -- the type itself doesn't include transcript

- timestamp: 2026-03-03T00:08:00Z
  checked: All tests after fix applied
  found: 210/210 gateway tests pass, 595/595 frontend tests pass, integration test now validates transcript field
  implication: Fix is correct and introduces no regressions

## Resolution

root_cause: Contract mismatch between frontend and backend. The gateway GatewayReply type (shared-types) and orchestrator do NOT include the STT transcript text in the response sent to the frontend. The frontend gateway-client.ts expects a `transcript` field in the reply (line 77) and emits a `transcript` chunk only when present (line 174). Since the gateway never sends it, user voice messages are never displayed or saved. The word "you" appearing is likely a Whisper hallucination on short/poor audio that gets sent to OpenClaw -- the core bug is that the real transcript never reaches the frontend at all.

fix: |
  1. Added optional `transcript` field to GatewayReply type in shared-types/src/voice-turn.ts
  2. Populated `transcript: sttResult.text` in orchestrator.ts executeVoiceTurn reply
  3. Added transcript assertion to voice-turn integration test

verification: |
  - Gateway: 210/210 tests pass (including updated integration test that asserts transcript = "What is the weather today")
  - Frontend: 595/595 tests pass (no changes needed -- frontend already expected the field)
  - Text turns correctly omit transcript (optional field, not set for text turns)

files_changed:
  - /home/forge/openclaw-even-g2-voice-gateway/packages/shared-types/src/voice-turn.ts
  - /home/forge/openclaw-even-g2-voice-gateway/services/gateway-api/src/orchestrator.ts
  - /home/forge/openclaw-even-g2-voice-gateway/test/integration/voice-turn.test.ts
