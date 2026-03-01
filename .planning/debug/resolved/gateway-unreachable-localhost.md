---
status: resolved
trigger: "Voice Gateway shows Unreachable because gateway URL is http://localhost:4400/ which resolves to phone in WebView"
created: 2026-03-01T00:00:00Z
updated: 2026-03-01T00:10:00Z
---

## Current Focus

hypothesis: CONFIRMED - root cause found and fixed
test: Full test suite (575 tests) + TypeScript type check
expecting: All pass
next_action: Archive and commit

## Symptoms

expected: Voice Gateway health check should show "Reachable" when gateway is running on remote server
actual: Shows "Voice Gateway = Unreachable" with log "Gateway health check failed at boot"
errors: Health check fails because localhost in mobile WebView points to the phone, not the server
reproduction: Set gateway URL to http://localhost:4400/ in settings, check health on real device
started: Always broken on real device with localhost URL (DEFAULT_SETTINGS uses localhost)

## Eliminated

(none - first hypothesis was correct)

## Evidence

- timestamp: 2026-03-01T00:01:00Z
  checked: settings.ts DEFAULT_SETTINGS
  found: gatewayUrl defaults to 'http://localhost:4400'. FIELD_CONFIG placeholder also says 'http://localhost:4400'.
  implication: Every new install starts with a localhost URL that won't work on real devices.

- timestamp: 2026-03-01T00:02:00Z
  checked: gateway-client.ts checkHealth (line 116-148)
  found: checkHealth simply fetches ${gatewayUrl}/readyz. No URL validation, no localhost detection. Returns false on network error.
  implication: When URL is localhost on phone, fetch fails silently. No distinction between "misconfigured URL" and "server is down".

- timestamp: 2026-03-01T00:03:00Z
  checked: hub-main.ts boot health check (lines 1118-1132)
  found: At hub boot, if gatewayUrl is set, calls hubGateway.checkHealth(). If unreachable, sets gatewayLiveStatus='error' and logs 'Gateway health check failed at boot'. No localhost-specific messaging.
  implication: User sees generic "Unreachable" with no hint about the actual problem (localhost on phone).

- timestamp: 2026-03-01T00:04:00Z
  checked: glasses-main.ts boot health check (lines 494-506)
  found: Same pattern - checks health, emits gateway:status connected or not. No localhost detection.
  implication: Both runtimes silently fail with no actionable guidance.

- timestamp: 2026-03-01T00:05:00Z
  checked: app-wiring.ts buildHealthViewModel (lines 168-231)
  found: When status is 'error', shows label 'Unreachable'. No logic to detect localhost/127.0.0.1 and provide specific guidance.
  implication: The health display gives no clue about the root cause.

- timestamp: 2026-03-01T00:06:00Z
  checked: settings.ts FIELD_CONFIG gatewayUrl validator (line 21)
  found: Only checks if it's a valid http(s):// URL. No warning about localhost/127.0.0.1.
  implication: Settings validation doesn't warn users about localhost being wrong for real devices.

## Resolution

root_cause: DEFAULT_SETTINGS.gatewayUrl is http://localhost:4400. On real devices (Even App WebView), localhost resolves to the phone itself which has no gateway server running. The health check fetch fails, producing "Unreachable" but providing no actionable guidance. No detection of localhost/loopback misconfiguration existed anywhere in the codebase.

fix: Added localhost/loopback detection with device-aware UX guards:
1. settings.ts: Added isLocalhostUrl(), isRealDeviceRuntime(), localhostWarning() helpers. Updated FIELD_CONFIG placeholder/help text.
2. app-wiring.ts: buildHealthViewModel now accepts isOnDevice param. When localhost URL + real device, shows "localhost points to phone -- use server URL" with err dot, overriding all other states.
3. hub-main.ts: At boot, detects localhost on real device and logs actionable error before attempting health check. Passes isRealDeviceRuntime() to buildHealthViewModel.
4. glasses-main.ts: At boot, detects localhost on non-devMode and shows error on glasses display + emits error log.
5. Dev-mode localhost behavior preserved (isOnDevice=false/devMode=true skips all warnings).

verification: 575 tests pass (38 test files). TypeScript type check clean. New tests cover:
- isLocalhostUrl: localhost, 127.0.0.1, [::1], case-insensitive, non-localhost URLs, edge cases
- isRealDeviceRuntime: with/without flutter_inappwebview
- localhostWarning: all combinations of URL type x runtime
- buildHealthViewModel: localhost on device overrides connected/ready, ignored in dev mode, backward compat

files_changed:
- src/settings.ts
- src/app-wiring.ts
- src/hub-main.ts
- src/glasses-main.ts
- src/__tests__/settings.test.ts
- src/__tests__/app-wiring.test.ts
- src/__tests__/glasses-main.test.ts
