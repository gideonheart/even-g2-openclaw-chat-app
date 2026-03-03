---
status: resolved
trigger: "Long audio recordings on G2 glasses are timing out or failing"
created: 2026-03-03T00:00:00Z
updated: 2026-03-03T00:03:00Z
---

## Current Focus

hypothesis: CONFIRMED AND FIXED
test: All 630 tests pass, TypeScript clean
expecting: N/A
next_action: Archive and commit

## Symptoms

expected: Long audio recordings should be sent to the voice gateway and return an AI response normally, just like short recordings
actual: Long audio recordings timeout or fail silently - the user doesn't get a response back. The FSM may get stuck in sent/thinking state.
errors: Likely timeout-related errors in the gateway or silent failures
reproduction: Record a long audio message (>10-30 seconds) on G2 glasses and wait for response
started: Observed during v1.4 development. Recent quick-28 added audio pipeline diagnostics.

## Eliminated

- hypothesis: Voice queue drops long recordings
  evidence: Queue has MAX_QUEUE=5 cap and drops oldest on overflow. No size-based filtering. Long recordings enter queue normally.
  timestamp: 2026-03-03T00:01:00Z

- hypothesis: WebSocket message size limit
  evidence: System uses HTTP POST (fetch), not WebSocket, for voice turns. No WS message size issue.
  timestamp: 2026-03-03T00:01:00Z

- hypothesis: FSM watchdog interferes with long recordings
  evidence: Watchdog was 45s, which would fire BEFORE the new gateway timeout for long audio. Fixed by making watchdog state-dependent.
  timestamp: 2026-03-03T00:01:00Z

- hypothesis: Audio capture corrupts large files
  evidence: audio-capture.ts simply concatenates all PCM frames and wraps in WAV header. No size limit, no truncation.
  timestamp: 2026-03-03T00:01:00Z

## Evidence

- timestamp: 2026-03-03T00:01:00Z
  checked: gateway-client.ts TURN_TIMEOUT_MS
  found: TURN_TIMEOUT_MS = 30_000 (30 seconds) hardcoded. Used for BOTH voice and text turns.
  implication: Primary bottleneck. Voice turns need much longer due to STT processing.

- timestamp: 2026-03-03T00:01:00Z
  checked: gesture-handler.ts WATCHDOG_MS
  found: WATCHDOG_MS = 45_000 (45 seconds). Single value for all transient states.
  implication: Would fire before new gateway timeout, prematurely resetting FSM.

- timestamp: 2026-03-03T00:02:00Z
  checked: Full pipeline timeline
  found: 30s recording -> upload(2-5s) + STT(10-30s) + LLM(5-15s) = 17-50s total. Exceeds 30s.
  implication: TURN_TIMEOUT_MS must be proportional to audio duration.

## Resolution

root_cause: Two interacting timeout issues:
  1. TURN_TIMEOUT_MS = 30s in gateway-client.ts was a single hardcoded value for both voice and text turns. Voice turns require upload + STT transcription + LLM generation, which easily exceeds 30s for recordings longer than ~10-15 seconds.
  2. FSM WATCHDOG_MS = 45s would prematurely reset the FSM to idle for long-running voice turns, even if the gateway was still processing.

fix: |
  1. gateway-client.ts: Split timeout into TEXT_TURN_TIMEOUT_MS (30s) and audio-size-proportional voiceTurnTimeout(). Voice timeout = base 60s + 1s per second of audio (estimated from WAV blob size), capped at 180s max. A 30s recording gets 90s timeout; 60s recording gets 120s.
  2. gesture-handler.ts: Made watchdog state-dependent. Recording state = 120s (reasonable max recording). Sent/thinking state = 210s (above max voice turn timeout of 180s).

verification: |
  - 630/630 tests pass (38 test files)
  - TypeScript compilation clean (zero errors)
  - Added 2 new gateway-client tests:
    - Large blob (30s audio) does NOT timeout at 30s, succeeds at 35s
    - Small blob (1s audio) uses ~61s timeout (base 60s + 1s audio)
  - Added 2 new gesture-handler watchdog tests:
    - Recording state does NOT reset before 120s
    - Sent state does NOT reset before 210s
  - Updated existing watchdog tests for new timeout values

files_changed:
  - src/api/gateway-client.ts
  - src/gestures/gesture-handler.ts
  - src/__tests__/gateway-client.test.ts
  - src/__tests__/gesture-handler.test.ts
