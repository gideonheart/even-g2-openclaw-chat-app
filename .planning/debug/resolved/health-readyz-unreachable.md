---
status: resolved
trigger: "Voice Gateway health check shows Unreachable in UI despite gateway running healthy on port 4400"
created: 2026-03-01T00:00:00Z
updated: 2026-03-01T00:00:00Z
---

## Current Focus

hypothesis: RESOLVED
test: n/a
expecting: n/a
next_action: none -- fix applied and verified

## Symptoms

expected: Voice Gateway health indicator shows "Connected" or "Ready" since the gateway is running with all services healthy
actual: Health section shows "Voice Gateway: Unreachable" -- status dot is in error state
errors: No error messages visible, just "Unreachable" label in health UI
reproduction: Open the app, go to Health tab, gateway shows Unreachable even though it's running
started: After quick task 13 which switched health check from GET /healthz to GET /readyz

## Eliminated

## Evidence

- timestamp: 2026-03-01T00:01:00Z
  checked: Gateway server.ts readiness gate (line 104)
  found: Gate is `if (!deps.ready && req.url !== "/healthz")` -- only /healthz is excluded; /readyz is blocked with 503 when deps.ready is false
  implication: During startup, /readyz returns 503 (NOT_READY) even before it can check actual dependency health

- timestamp: 2026-03-01T00:02:00Z
  checked: Gateway server.ts CORS handling flow (lines 102-113)
  found: CORS is handled AFTER the readiness gate. When deps.ready is false and url is not /healthz, the 503 is sent WITHOUT CORS headers. The sendJson helper (line 443-449) only sets Content-Type, no CORS headers.
  implication: Browser fetch from chat app origin will get a CORS error (no Access-Control-Allow-Origin) on the 503 response, causing the fetch to throw a TypeError, which checkHealth catches and returns false.

- timestamp: 2026-03-01T00:03:00Z
  checked: Chat app checkHealth() in gateway-client.ts (lines 116-143)
  found: checkHealth() fetches /readyz and returns resp.ok. If fetch throws (CORS error), it catches and returns false. If 503 returned with CORS headers, resp.ok would be false anyway.
  implication: Either way (CORS block or 503 status), checkHealth returns false.

- timestamp: 2026-03-01T00:04:00Z
  checked: Hub-main.ts boot health check (lines 1118-1130)
  found: On boot, calls checkHealth(). If false, sets gatewayLiveStatus = 'error'. This feeds into buildHealthViewModel() which maps 'error' to dot='err', label='Unreachable'.
  implication: This confirms the full chain: /readyz blocked -> checkHealth false -> status 'error' -> UI shows 'Unreachable'

- timestamp: 2026-03-01T00:05:00Z
  checked: Whether deps.ready is actually true at steady state
  found: Need to check when deps.ready transitions to true. But even if it IS true, the real question is: should /readyz bypass the readiness gate (like /healthz does)?
  implication: /readyz is a PROBE endpoint. Kubernetes uses it to determine readiness. It should ALWAYS be reachable -- it returns 503 on its own when deps are unhealthy. The readiness gate is redundant for /readyz.

## Resolution

root_cause: The gateway server's readiness gate (server.ts line 104) blocks ALL requests except /healthz when deps.ready is false. When quick task 13 switched the chat app from /healthz to /readyz, the health check started hitting an endpoint that gets blocked by the readiness gate during startup (returning 503 without CORS headers). Even after startup completes (deps.ready = true), the initial boot health check has already failed, setting the status to 'error'. The heartbeat only recovers if it was started -- but heartbeat is only started when the INITIAL check succeeds (hub-main.ts line 1123). So once the first check fails, no heartbeat runs to recover the status.
fix: |
  1. gateway-client.ts checkHealth(): Changed `return resp.ok` to `return true`. Any HTTP response
     (200 or 503) from /readyz means the gateway is reachable. Only a fetch throw (network error,
     CORS block, timeout) means truly unreachable. The readyz body carries the actual readiness
     detail via health.readyStatus/sttReady/openclawReady fields.
  2. hub-main.ts: Moved startHeartbeat() call outside the if(reachable) block so it always starts
     regardless of initial check result. This ensures status can recover from 'error' to 'connected'
     on subsequent heartbeat ticks.
  3. glasses-main.ts: Same fix as hub-main.ts -- always start heartbeat unconditionally.
  4. gateway-client.test.ts: Updated "parses body on 503 response" test to expect true (reachable).
verification: |
  - All 549 tests pass across 38 test files (0 failures)
  - TypeScript type check passes (tsc --noEmit)
  - Production build succeeds (vite build)
files_changed:
  - src/api/gateway-client.ts
  - src/hub-main.ts
  - src/glasses-main.ts
  - src/__tests__/gateway-client.test.ts
