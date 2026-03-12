---
phase: quick-50
plan: 01
subsystem: api
tags: [replay, sse, resume-sync, localStorage, gateway]

# Dependency graph
requires:
  - phase: quick-48
    provides: SSE streaming parser and gateway-client test patterns
provides:
  - replay-client.ts module with fetchSessionReplay, fetchTurnReplay, replayEventsAsChunks
  - gateway-client lastEventSeq tracking with localStorage persistence
  - glasses-main resume sync wiring (fire-and-forget replay on reboot)
affects: [gateway-client, glasses-main, voice-loop-controller]

# Tech tracking
tech-stack:
  added: []
  patterns: [fire-and-forget replay on visibility resume, per-turnId response_start tracking for multi-turn replay, localStorage seq cursor for resume checkpoint]

key-files:
  created:
    - src/api/replay-client.ts
    - src/__tests__/replay-client.test.ts
  modified:
    - src/types.ts
    - src/api/gateway-client.ts
    - src/__tests__/gateway-client.test.ts
    - src/glasses-main.ts
    - src/__tests__/glasses-main.test.ts
    - src/__tests__/voice-loop-controller.test.ts

key-decisions:
  - "Replay events emitted to bus.emit('gateway:chunk') not gateway.emitChunk() -- bus is what auto-save and display subscribe to"
  - "Fire-and-forget resume sync: non-blocking, silent failure, replay is best-effort"
  - "lastEventSeq only updated via setLastSeq after replay, not during normal SSE (SSE streams lack seq numbers)"
  - "Per-turnId response_start tracking in replayEventsAsChunks for multi-turn replay correctness"

patterns-established:
  - "Replay client pattern: fetch -> map to existing chunk types -> emit through bus"
  - "localStorage seq cursor for resume sync checkpoint across boot cycles"

requirements-completed: [REPLAY-01, REPLAY-02, REPLAY-03]

# Metrics
duration: 9min
completed: 2026-03-12
---

# Quick Task 50: Frontend Resume Sync Summary

**Replay client with session/turn fetch, per-turnId chunk mapping, localStorage seq cursor, and fire-and-forget resume sync in glasses boot flow**

## Performance

- **Duration:** 9 min
- **Started:** 2026-03-12T19:54:42Z
- **Completed:** 2026-03-12T20:03:55Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Created replay-client.ts with fetchSessionReplay, fetchTurnReplay, and replayEventsAsChunks
- Added ReplayEvent type to types.ts with turnId, sessionKey, seq, type, payload, timestamp
- Added getLastSeq/setLastSeq to gateway-client with localStorage persistence
- Wired resume sync in glasses-main: fetches missed events after boot when lastSeq is available
- 34 new tests total (21 replay-client + 6 gateway-client lastEventSeq + 7 resume sync wiring)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create replay-client module with ReplayEvent type, fetch functions, and chunk mapping + tests** - `7842f53` (feat)
2. **Task 2: Add lastEventSeq tracking to gateway-client + wire resume sync in glasses-main + tests** - `54e3d1b` (feat)

## Files Created/Modified
- `src/types.ts` - Added ReplayEvent interface
- `src/api/replay-client.ts` - Replay client with fetchSessionReplay, fetchTurnReplay, replayEventsAsChunks
- `src/__tests__/replay-client.test.ts` - 21 tests for all replay-client functions and edge cases
- `src/api/gateway-client.ts` - Added getLastSeq/setLastSeq with localStorage persistence
- `src/__tests__/gateway-client.test.ts` - 6 new lastEventSeq tracking tests
- `src/glasses-main.ts` - Import replay-client, fire-and-forget resume sync after gateway health check
- `src/__tests__/glasses-main.test.ts` - 7 resume sync wiring tests with hoisted settings mock
- `src/__tests__/voice-loop-controller.test.ts` - Added getLastSeq/setLastSeq to mock gateway (tsc fix)

## Decisions Made
- Replay events emitted directly to bus ('gateway:chunk') rather than through gateway.emitChunk() -- the bus is what auto-save and the display controller subscribe to
- Fire-and-forget pattern for resume sync -- replay does not block boot, and failures are silently logged
- lastEventSeq is only updated via explicit setLastSeq() calls after processing replay events; normal SSE streams do not carry seq numbers
- Per-turnId response_start tracking using a Set in replayEventsAsChunks ensures correct chunk emission across multi-turn replays
- destroy() does not clear lastEventSeq from localStorage -- it should persist across boot cycles

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed voice-loop-controller.test.ts mock missing getLastSeq/setLastSeq**
- **Found during:** Task 2 (type check verification)
- **Issue:** Adding getLastSeq/setLastSeq to gateway-client changed the GatewayClient type, breaking the mock in voice-loop-controller.test.ts
- **Fix:** Added getLastSeq: vi.fn().mockReturnValue(null) and setLastSeq: vi.fn() to the mock gateway
- **Files modified:** src/__tests__/voice-loop-controller.test.ts
- **Verification:** npx tsc --noEmit passes clean (0 errors)
- **Committed in:** 54e3d1b (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Type-safety fix required by changing the GatewayClient interface. No scope creep.

## Issues Encountered
None -- plan executed cleanly.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Replay client ready for gateway backend implementation of /api/sessions/:sessionKey/events and /api/turns/:turnId/events endpoints
- Resume sync will activate automatically once the gateway supports replay endpoints and SSE events include seq numbers
- All 713 tests pass (8 pre-existing failures in nav-switching/confirm-modal tests are unrelated to this task)

## Self-Check: PASSED

All 9 files verified present. Both task commits (7842f53, 54e3d1b) confirmed in git log. TypeScript type check clean (0 errors). 106 tests pass across 4 affected test files.

---
*Phase: quick-50*
*Completed: 2026-03-12*
