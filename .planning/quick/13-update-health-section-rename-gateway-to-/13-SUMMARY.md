---
phase: quick-13
plan: 01
subsystem: api, ui
tags: [health-check, readyz, gateway, voice-gateway]

# Dependency graph
requires:
  - phase: quick-2
    provides: gateway-client health monitoring
provides:
  - /readyz-based health check with STT + OpenClaw sub-check detail
  - enriched health view model with degraded status labels
  - "Voice Gateway URL" label consistency in settings
affects: [hub-main, glasses-main, health-page]

# Tech tracking
tech-stack:
  added: []
  patterns: [readyz over healthz for meaningful health monitoring]

key-files:
  created: []
  modified:
    - src/api/gateway-client.ts
    - src/types.ts
    - src/app-wiring.ts
    - src/__tests__/gateway-client.test.ts
    - src/__tests__/app-wiring.test.ts
    - index.html

key-decisions:
  - "Use /readyz instead of /healthz for gateway health check -- /healthz always returns 200 (liveness), /readyz returns real dependency status"
  - "ReadyzDetail is a separate interface param (not merged into GatewayHealthState direct consumption) to keep buildHealthViewModel backward-compatible"
  - "Best-effort JSON parsing -- non-JSON /readyz responses gracefully clear detail fields instead of failing"

patterns-established:
  - "Readyz detail enrichment: connected + readyStatus=ready shows 'Ready'; not_ready shows 'Degraded: X down'"

requirements-completed: [QUICK-13]

# Metrics
duration: 4min
completed: 2026-03-01
---

# Quick Task 13: Health Section /readyz Switch and Gateway Label Rename Summary

**Switched gateway health from /healthz to /readyz with STT+OpenClaw sub-check detail in health view, renamed settings label to Voice Gateway URL**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-01T19:52:19Z
- **Completed:** 2026-03-01T19:56:44Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- Gateway health check now uses /readyz which returns real dependency status (200/503) instead of always-200 /healthz
- GatewayHealthState extended with readyStatus, sttReady, openclawReady optional fields parsed from readyz JSON body
- Health view model shows "Ready", "Degraded: STT down", or "Degraded: STT, OpenClaw down" based on readyz detail
- Settings page label renamed from "Gateway URL" to "Voice Gateway URL" for consistency
- All 549 tests pass (11 new tests added)

## Task Commits

Each task was committed atomically:

1. **Task 1: Switch checkHealth to /readyz and extend GatewayHealthState** - `5091b5b` (feat)
2. **Task 2: Enrich health view model with readyz details and rename label** - `dcbf44a` (feat)
3. **Task 3: Full test suite verification** - no code changes needed (verification only)

## Files Created/Modified
- `src/types.ts` - Added readyStatus, sttReady, openclawReady optional fields to GatewayHealthState
- `src/api/gateway-client.ts` - Switched checkHealth from /healthz to /readyz with JSON body parsing
- `src/app-wiring.ts` - Added ReadyzDetail interface; enriched buildHealthViewModel with readyz detail labels
- `src/__tests__/gateway-client.test.ts` - Added 5 checkHealth tests (readyz URL, 200 parsing, 503 parsing, non-JSON, network error)
- `src/__tests__/app-wiring.test.ts` - Added 6 readyz detail tests (ready label, degraded STT, degraded both, not ready, error enrichment, backward compat)
- `index.html` - Renamed "Gateway URL" to "Voice Gateway URL" in settings

## Decisions Made
- Used /readyz instead of /healthz because /healthz always returns 200 (liveness only), making it useless for actual health monitoring
- Made readyz body parsing best-effort with try/catch -- non-JSON responses gracefully clear detail fields instead of failing the health check
- Added ReadyzDetail as a separate interface parameter to buildHealthViewModel for backward compatibility -- callers that don't pass it get identical behavior to before

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Health monitoring now provides meaningful readyz status detail
- Hub-main's refreshHealthDisplay can be updated to pass readyzDetail from getHealth() when desired (not required -- backward compatible)

---
*Quick Task: 13*
*Completed: 2026-03-01*
