---
status: resolved
trigger: "Two issues: (1) Tapping on Even G2 glasses still shows '[Error] Loading failed' many times on glasses display. Previous audio-load-failed debug session added WAV wrapping and mic cleanup, but error persists on real device. (2) These errors do NOT appear in Hub UI Logs/Health section."
created: 2026-03-01T00:00:00Z
updated: 2026-03-01T00:02:00Z
---

## Current Focus

hypothesis: CONFIRMED AND FIXED - Both root causes addressed and verified.
test: All 541 tests pass, TypeScript compiles clean.
expecting: n/a
next_action: Archive session

## Symptoms

expected: Tap on glasses -> record audio -> send to gateway -> get STT + AI response -> display on glasses. Errors should also appear in Hub UI Logs/Health section.
actual: (1) Tapping triggers "[Error] Loading failed" displayed many times on glasses. (2) Hub UI Logs/Health section does NOT show these errors at all.
errors: "[Error] Loading failed" on glasses display (multiple times per tap). No corresponding error in Hub UI.
reproduction: Tap on glasses to try voice recording. Check Hub UI health/logs section - errors missing.
started: Persists AFTER commit 326ed3f (WAV wrapping fix). The fix was supposed to resolve this but didn't fully.

## Eliminated

- hypothesis: "Loading failed" comes from the app source code
  evidence: Grepped entire src/ directory - string "Loading failed" does NOT exist in any app source file or Even SDK bundle. The string comes from the browser/WebView fetch() error message when the network request fails (WebKit says "Load failed" / "Loading failed").
  timestamp: 2026-03-01T00:00:30Z

- hypothesis: Previous WAV fix (commit 326ed3f) should have fixed this
  evidence: The WAV fix addressed audio format issues. But when the gateway server is unreachable (not running), the error occurs at the network level BEFORE audio format matters. The WAV fix and this error are orthogonal.
  timestamp: 2026-03-01T00:00:30Z

## Evidence

- timestamp: 2026-03-01T00:00:10Z
  checked: Source code grep for "Loading failed" string
  found: The string does NOT exist in any app source or Even SDK file. It is the browser's native fetch() error message for network failures.
  implication: The error originates from the WebView engine when fetch() to the gateway URL fails (server unreachable).

- timestamp: 2026-03-01T00:00:20Z
  checked: gateway-client.ts handleTurnError() retry logic
  found: handleTurnError() ALWAYS emits an error chunk (line 249) BEFORE checking if it should retry (line 251). When retry returns, sendVoiceTurn recursively calls itself. Each retry attempt also fails and emits another error chunk. With maxReconnectAttempts=5, this produces up to 6 "[Error] Loading failed" messages on the display (1 initial + 5 retries).
  implication: ROOT CAUSE 1: Error chunks should NOT be emitted when the client is going to retry. The error emission should be deferred until retries are exhausted.

- timestamp: 2026-03-01T00:00:30Z
  checked: Hub error propagation for gateway errors
  found: (A) Glasses and hub run separate event buses. Gateway errors from glasses voice turns go to glasses bus only. (B) Hub has its own gateway client for text turns only. (C) The sync bridge only syncs session/message/streaming events, NOT gateway errors. (D) Hub's buildHealthViewModel() only checks if gatewayUrl is set (!!settings.gatewayUrl), NOT actual gateway health. (E) Hub gateway client NEVER calls checkHealth() or startHeartbeat().
  implication: ROOT CAUSE 2: Hub has zero awareness of gateway health. No health checks, no error forwarding from glasses, and the health display is purely "is URL configured?" not "is gateway reachable?"

- timestamp: 2026-03-01T00:00:40Z
  checked: glasses-main.ts boot() gateway health check
  found: Glasses DO check gateway health at boot (line 478) and start heartbeat if healthy. But errors during voice turns are separate from health heartbeats. The heartbeat interval is 15s, and heartbeat failures only set status to 'error' -- they don't log to the bus.
  implication: Gateway status changes (including error status from heartbeat) are emitted to the bus but hub never receives them.

- timestamp: 2026-03-01T00:01:30Z
  checked: All 541 tests after fix
  found: All pass. TypeScript compiles cleanly (tsc --noEmit).
  implication: Fix is verified through existing and updated test suite.

## Resolution

root_cause: |
  TWO ROOT CAUSES:

  1. RETRY ERROR SPAM: In gateway-client.ts handleTurnError(), error chunks are emitted to the display
     on every failed attempt BEFORE checking if a retry will happen. With 5 max retries, users see
     up to 6 "[Error] Loading failed" messages per tap. The error should only be shown when retries
     are exhausted (fatal) or the error is non-retryable.

  2. HUB HEALTH BLIND SPOT: The hub UI has no live gateway health monitoring:
     (a) Hub gateway client never calls checkHealth()/startHeartbeat()
     (b) Glasses-side gateway errors are not forwarded to hub via sync bridge
     (c) buildHealthViewModel() only checks if URL is set, not actual connectivity
     (d) gateway:status changes on glasses bus are not synced to hub
     Result: Hub health display always shows "ok" for gateway as long as URL is configured,
     even when gateway is completely down.

fix: |
  FIX 1 - Silent retries (gateway-client.ts):
    Moved the error chunk emission AFTER the retry decision. During retries, no error is emitted
    (silent retry). Only when all retries are exhausted (fatal), a single clear error is emitted:
    "Gateway unreachable -- {original error message}". This eliminates the 6x error spam.

  FIX 2 - Hub gateway health monitoring (multiple files):
    (a) hub-main.ts: Hub gateway client now runs checkHealth() at boot and starts heartbeat
        monitoring. Gateway status changes update the health display in real-time.
    (b) app-wiring.ts: buildHealthViewModel() now accepts optional gatewayLiveStatus parameter.
        Dot states: connected=ok, connecting=warn, error=err, no-status/unconfigured=off.
    (c) sync-types.ts: Added 'gateway:error' and 'gateway:status-changed' sync message types.
    (d) glasses-main.ts: Forward gateway:chunk errors and gateway:status changes to hub via syncBridge.
    (e) hub-main.ts: Handle incoming gateway:error and gateway:status-changed sync messages --
        log errors in hub logs and update live gateway status for health display.

  FIX 3 - Gateway error logging (voice-loop-controller.ts):
    Added bus.emit('log',...) for gateway error chunks and status changes so they appear in
    the diagnostic log on the glasses side.

verification: |
  - All 541 tests pass (38 test files)
  - TypeScript compiles cleanly (tsc --noEmit)
  - gateway-client retry test updated: verifies 0 error chunks during retry, exactly 1 on fatal
  - app-wiring tests updated: verifies all 4 gateway health dot states (ok/warn/err/off)
  - 3 new test cases added for gateway health states

files_changed:
  - src/api/gateway-client.ts
  - src/voice-loop-controller.ts
  - src/glasses-main.ts
  - src/hub-main.ts
  - src/app-wiring.ts
  - src/sync/sync-types.ts
  - src/__tests__/gateway-client.test.ts
  - src/__tests__/app-wiring.test.ts
