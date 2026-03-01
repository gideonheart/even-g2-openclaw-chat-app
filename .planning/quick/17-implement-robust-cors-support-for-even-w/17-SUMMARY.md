---
phase: quick-17
plan: 01
subsystem: api
tags: [cors, webview, security, gateway, rfc-6454]

requires:
  - phase: quick-14
    provides: "Running voice gateway with strict CORS"
provides:
  - "allowNullOrigin CORS support for WebView Origin: null"
  - "CORS_ALLOW_NULL_ORIGIN env var config flag"
  - "Comprehensive CORS unit tests (7 tests)"
affects: [gateway-api, even-app-webview]

tech-stack:
  added: []
  patterns: ["RFC 6454 null origin handling behind opt-in flag"]

key-files:
  created: []
  modified:
    - "/home/forge/openclaw-even-g2-voice-gateway/packages/shared-types/src/config.ts"
    - "/home/forge/openclaw-even-g2-voice-gateway/services/gateway-api/src/server.ts"
    - "/home/forge/openclaw-even-g2-voice-gateway/services/gateway-api/src/config-loader.ts"
    - "/home/forge/openclaw-even-g2-voice-gateway/services/gateway-api/src/server.test.ts"
    - "/home/forge/openclaw-even-g2-voice-gateway/services/gateway-api/src/config-loader.test.ts"

key-decisions:
  - "Null origin branch placed before strict mode check so it fires regardless of allowedOrigins state"
  - "allowNullOrigin defaults to false (opt-in security model)"
  - "Reflect literal 'null' string back in ACAO header (not wildcard '*') per CORS spec"

patterns-established:
  - "Env var boolean parsing: lowercase comparison against 'true' string"

requirements-completed: [QUICK-17]

duration: 5min
completed: 2026-03-01
---

# Quick Task 17: Implement Robust CORS Support for Even WebView Summary

**RFC 6454 null-origin CORS handling with opt-in allowNullOrigin flag, 10 new tests, gateway verified with 6 curl checks**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-01T21:42:24Z
- **Completed:** 2026-03-01T21:47:44Z
- **Tasks:** 2 completed (Task 3 is human-verify checkpoint)
- **Files modified:** 11

## Accomplishments
- Added `allowNullOrigin: boolean` to `ServerConfig` type and `CORS_ALLOW_NULL_ORIGIN` env var support
- Updated `handleCors()` with null origin branch before strict mode check, reflecting `"null"` back per RFC 6454
- Added 7 CORS unit tests covering allowed, disallowed, null-allowed, null-rejected, no-origin, and preflight scenarios
- Added 3 config-loader tests for the new env var
- Updated all 8 test fixtures across the monorepo with the new `allowNullOrigin` field
- Gateway restarted with `CORS_ALLOW_NULL_ORIGIN=true` and verified with 6 curl checks

## Task Commits

Each task was committed atomically:

1. **Task 1: Add allowNullOrigin to ServerConfig, config-loader, and handleCors** - `7106723` (feat)
2. **Task 2: Update .env, restart gateway, verify CORS** - ops-only (no committable source; .env is gitignored)

## Files Created/Modified
- `packages/shared-types/src/config.ts` - Added `allowNullOrigin: boolean` to ServerConfig
- `services/gateway-api/src/config-loader.ts` - Load CORS_ALLOW_NULL_ORIGIN env var
- `services/gateway-api/src/config-loader.test.ts` - 3 new tests for CORS_ALLOW_NULL_ORIGIN
- `services/gateway-api/src/server.ts` - Null origin branch in handleCors(), updated call site
- `services/gateway-api/src/server.test.ts` - 7 new CORS unit tests via HTTP server
- `services/gateway-api/src/config-store.test.ts` - Added allowNullOrigin to fixture
- `services/gateway-api/src/openclaw-rebuilder.test.ts` - Added allowNullOrigin to fixture
- `services/gateway-api/src/provider-rebuilder.test.ts` - Added allowNullOrigin to fixture
- `test/integration/config-hot-reload.test.ts` - Added allowNullOrigin to fixture
- `test/integration/voice-turn.test.ts` - Added allowNullOrigin to fixture
- `test/integration/text-turn.test.ts` - Added allowNullOrigin to fixture

## Decisions Made
- Null origin branch placed BEFORE strict mode check so `Origin: null` + `allowNullOrigin: true` works regardless of whether `corsOrigins` is populated
- `allowNullOrigin` defaults to `false` -- secure by default, opt-in for WebView contexts
- Response header reflects literal string `"null"` (not `"*"`) per CORS specification

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `.env` is gitignored (correctly) so Task 2's env change could not be committed to source control. This is expected operational behavior -- the .env change is applied to the running server instance.

## Verification Results

All 6 curl checks passed:
1. `Origin: https://bibele.kingdom.lv` -> 200 with ACAO header
2. `Origin: http://localhost:3001` -> 200 with ACAO header
3. `Origin: null` -> 200 with `Access-Control-Allow-Origin: null`
4. `Origin: http://evil.example.com` -> 403 CORS_REJECTED
5. `OPTIONS` with `Origin: null` -> 204 with CORS headers
6. No Origin header -> 200 pass-through (no CORS headers)

All 210 tests pass (20 test files).

## User Setup Required
None - CORS_ALLOW_NULL_ORIGIN=true already applied to running gateway.

## Next Phase Readiness
- Gateway CORS support complete for WebView context
- Awaiting human verification from Even App (Task 3 checkpoint)

---
*Phase: quick-17*
*Completed: 2026-03-01*
