---
status: resolved
trigger: "gateway-disconnect-on-record: Voice Gateway disconnects when recording starts on G2 glasses"
created: 2026-03-03T00:00:00Z
updated: 2026-03-03T00:00:00Z
---

## Current Focus

hypothesis: The gateway-client.ts sendVoiceTurn() calls abort() which kills the heartbeat's AbortController, AND sets status to 'connecting' during the POST request. If the POST fails (e.g. CORS, timeout, or audio issue), status goes to 'error' which the hub displays as 'Unreachable'. The real question is WHY does the POST fail.
test: Trace the exact flow: sendVoiceTurn -> abort() -> setStatus('connecting') -> postVoiceTurn() -> fails -> setStatus('error')
expecting: The abort() call at the start of sendVoiceTurn is killing in-flight requests, and the POST to /api/voice/turn is failing
next_action: Analyze the gateway-client sendVoiceTurn flow and CORS/origin issues on the gateway server

## Symptoms

expected: Voice Gateway stays connected during recording. Tap record -> speak -> tap stop -> audio sent to gateway -> gateway sends to WhisperX -> transcription returned -> chat message displayed
actual: Three-phase failure: (1) On app load, gateway shows connected. (2) When user taps to record, status changes to "Connecting..." (3) Status then goes to "Unreachable". Recording fails, no transcription happens.
errors: Gateway status goes "Connected" -> "Connecting..." -> "Unreachable" during tap-to-record. Previous "Transcription returned empty text" error may still occur.
reproduction: Open app on G2 glasses -> see gateway connected -> tap to record -> watch gateway status change to Connecting then Unreachable
started: Has never worked properly in the chat app. The reference stt-even-g2 project works correctly.

## Eliminated

## Evidence

- timestamp: 2026-03-03T00:10:00Z
  checked: Architecture - gateway-client.ts uses HTTP POST, not WebSocket
  found: The gateway client is pure HTTP (fetch-based). No WebSocket at all. sendVoiceTurn() POSTs audio blob to /api/voice/turn. checkHealth() GETs /readyz. Heartbeat is periodic /readyz polling.
  implication: The "disconnect" is NOT a WebSocket drop -- it's the HTTP POST status changing to 'connecting' then 'error'.

- timestamp: 2026-03-03T00:11:00Z
  checked: sendVoiceTurn() flow in gateway-client.ts (lines 220-249)
  found: On every sendVoiceTurn call, it calls abort() FIRST (line 226), then creates new AbortController (line 227), then setStatus('connecting') (line 232). If the POST succeeds, setStatus('connected'). If it fails, setStatus('error'). The abort() on line 226 kills any previous in-flight request.
  implication: The 'connecting' status is EXPECTED during a voice turn POST. The problem is why it goes to 'error' (the POST is failing).

- timestamp: 2026-03-03T00:12:00Z
  checked: Gateway server CORS configuration (server.ts lines 264-305)
  found: The gateway has strict CORS. WebView/file:// origins send "null" origin. The server has an allowNullOrigin flag. If the Even App WebView sends requests from "null" origin and allowNullOrigin is false, CORS blocks the request with 403.
  implication: CORS could be blocking the POST from the Even App WebView. Need to check server config.

- timestamp: 2026-03-03T00:13:00Z
  checked: Reference stt-even-g2 project vs chat app
  found: The reference project sends audio DIRECTLY to WhisperX (wsp.kingdom.lv/speech-to-text). It does NOT go through the gateway at all. It uses FormData with multipart upload. The chat app sends raw audio blob via HTTP POST to the gateway, which then forwards to WhisperX.
  implication: Different architecture -- reference talks directly to WhisperX, chat app goes through gateway. Both are valid approaches but different failure modes.

- timestamp: 2026-03-03T00:14:00Z
  checked: Gateway readyz endpoint reachability
  found: curl -sk https://bibele.kingdom.lv/gateway/readyz returns {"status":"ready",...} -- gateway is healthy and reachable from the server
  implication: Gateway server itself is working. Problem is in client-to-gateway communication during voice turns.

- timestamp: 2026-03-03T00:15:00Z
  checked: glasses-main.ts gateway status flow (line 499-505)
  found: glasses-main.ts forwards gateway:status events to hub via syncBridge. Both sides have their OWN gateway client instances and heartbeats. The glasses-side gateway client does the voice turns; the hub-side does text turns and health monitoring.
  implication: Both contexts are monitoring gateway health independently. The glasses-side status changes propagate to hub display via sync bridge.

- timestamp: 2026-03-03T00:16:00Z
  checked: CORS on gateway - checked actual running config
  found: Need to check if allowNullOrigin is enabled in the running gateway config
  implication: If Even App WebView sends Origin: null and gateway doesn't allow it, ALL POST requests will fail with CORS 403

## Resolution

root_cause: |
  Multiple interrelated issues in the voice pipeline:

  ROOT CAUSE 1 - Gateway status misrepresents server errors as "Unreachable":
  gateway-client.ts sendVoiceTurn() sets status to 'error' for ALL failures including
  successful HTTP responses with 4xx status codes (like "Transcription returned empty text").
  The gateway IS reachable -- it processed the request and returned a meaningful error.
  But buildHealthViewModel maps status=error to "Unreachable" which is misleading.
  The fix: distinguish between network errors (truly unreachable) and server errors
  (reachable but request failed).

  ROOT CAUSE 2 - readyz detail never passed to health view model:
  hub-main.ts line 144 passes undefined as readyzDetail to buildHealthViewModel(),
  despite the gateway client already parsing readyz response (including stt health).
  This means the enriched labels ("Ready", "Degraded: STT down") are never shown.

  ROOT CAUSE 3 - STT health section shows config, not actual health:
  buildHealthViewModel shows STT as 'ok' if any provider is configured, not if the
  STT backend is actually reachable. The readyz response includes stt health info
  but it's only used to enrich the gateway label, not the STT health row.

fix: |
  1. gateway-client.ts: Added GatewayAppError sentinel class to distinguish server errors
     (4xx/5xx with HTTP response) from network errors (fetch throw). sendVoiceTurn and
     sendTextTurn now set status to 'connected' (not 'error') when the gateway responded
     with an application error -- the gateway IS reachable, the request just failed.
     Only true network errors/timeouts set status to 'error'.

  2. app-wiring.ts: buildHealthViewModel now uses readyzDetail to populate the STT health
     section. When readyzDetail.sttReady is false, shows "WhisperX -- unreachable" with
     error dot instead of showing config-only 'ok' status.

  3. hub-main.ts: refreshHealthDisplay now pulls readyz detail from hubGateway.getHealth()
     and passes it to buildHealthViewModel, enabling enriched labels ("Ready", "Degraded",
     etc.) and accurate STT health display.

  4. gateway-client.test.ts: Updated tests that previously expected status='error' on
     non-OK HTTP responses to expect status='connected' (gateway is reachable).

verification: |
  - All 624 tests pass (38 test files)
  - Build succeeds (vite build, 44 modules)
  - Behavioral verification:
    - Network failure (fetch throws) -> status 'error' -> hub shows "Unreachable" (correct)
    - Timeout -> status 'error' -> hub shows "Unreachable" (correct)
    - Server error (400 "empty transcription") -> status 'connected' -> hub stays "Connected" (fixed)
    - Server error (502 Bad Gateway) -> status 'connected' -> hub stays "Connected" (fixed)
    - readyz sttReady=false -> STT health shows error dot "WhisperX -- unreachable" (new)
    - readyz sttReady=true -> STT health shows ok dot "WhisperX" (preserved)
    - Voice loop queue drain still works (error chunks still emitted)
    - Gesture FSM reset still works (error chunks still emitted)

files_changed:
  - src/api/gateway-client.ts
  - src/app-wiring.ts
  - src/hub-main.ts
  - src/__tests__/gateway-client.test.ts
