# Root Cause Analysis: Gateway Disconnect-on-Record Bug

## 1. Why the Bug Persisted (Architectural Root Cause)

The bug persisted because of a **Single Responsibility violation** in the error handling path:

- `setStatus('error')` in the `sendVoiceTurn` catch block served two different semantic roles:
  - (a) "gateway is unreachable" (network error, timeout, CORS block)
  - (b) "gateway rejected the request" (4xx/5xx HTTP response)

- `buildHealthViewModel` mapped ANY `status === 'error'` to the label "Unreachable" -- it had no way to distinguish "unreachable" from "request rejected".

- When the gateway returned a 400 ("Transcription returned empty text"), the UI showed "Unreachable" even though the gateway was perfectly reachable. This made debugging focus on connectivity (CORS, network, WebSocket misconceptions) rather than the actual audio/STT issue.

- The catch-all `setStatus('error')` was the original design from Phase 4 (API client). At that time, non-OK HTTP responses were genuinely unexpected. As the gateway matured and started returning structured 4xx errors (empty transcription, invalid config), the single error bucket became misleading.

## 2. Why It Wasn't Caught Earlier

- **Incomplete test assertions:** Tests verified the surface behavior ("emits error chunk on non-ok response") without asserting the STATUS SIDE-EFFECT ("and status should remain connected"). The tests were green but incomplete.

- **Invisible in development:** The gateway rarely returns 4xx during dev (controlled inputs, local network). It manifests under real-world conditions (short/noisy audio, CORS misconfiguration).

- **Misdirected investigation:** The "Unreachable" label directed debugging toward network/CORS (quick-13, 14, 16, 17) instead of error classification. Multiple quick tasks were spent on CORS and health check improvements that were useful but did not address the root cause.

## 3. DRY Violations Found and Fixed

- **sendVoiceTurn / sendTextTurn catch blocks:** Had identical 15-line catch blocks with three-way error classification. Extracted to shared `handleTurnError(err)` function. Both callers now have a 3-line catch: `clearTimeout(timeoutId); handleTurnError(err);`.

- **postVoiceTurn / postTextTurn:** Share the `throw new GatewayAppError(await readGatewayError(resp))` pattern but differ enough in request construction (audio blob vs JSON body, different Content-Type headers, different URL paths) that extracting further would over-abstract. Left as-is -- the shared pattern is the error-throw line, not the request construction.

## 4. Dead Code Removed

| Code | Origin | Why Dead |
|------|--------|----------|
| `parseSSELines` + `SSEEvent` type | Phase 4 (API client) | Vestigial from when gateway was planned to use SSE streaming. Gateway has been pure HTTP POST + JSON reply since Phase 4 implementation. Only used by its own 9 tests. |
| `connectGlasses` / `disconnectGlasses` | Phase 2 (bridge wiring) | Superseded by `setGlassesConnected` / `setGlassesDisconnected` in Phase 10. Wrappers with hardcoded mock values ("Even G2 (mock)", "87 %"). Not imported by any production code -- only tested by their own deprecated test blocks. |

## 5. Pattern Observations for Future

1. **Assert both dimensions of error handling:** When adding error classification to a shared client, always assert both the user-facing effect (error chunk emitted) AND the internal state effect (status value). Test what the user sees AND what the system remembers.

2. **Extract immediately when duplicating policy:** When multiple callers share identical error handling, extract it immediately. Duplication signals the logic is a policy (how errors are classified), not a one-off (how a specific request is built). Policy belongs in one place.

3. **Watch for semantic overloading of status values:** A single status enum value (`'error'`) meaning both "unreachable" and "request failed" is a code smell. If a value needs different downstream behavior depending on how it was reached, it should be split into distinct values or accompanied by a discriminator.
