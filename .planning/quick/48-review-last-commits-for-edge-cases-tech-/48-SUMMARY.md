---
phase: quick-48
plan: 1
subsystem: testing
tags: [vitest, vi-hoisted, sse, readablestream, gateway-client, glasses-main]

# Dependency graph
requires:
  - phase: quick-1
    provides: SSE streaming parser in gateway-client.ts (commit d7c08d1)
  - phase: quick-47
    provides: Preload swap batch loadMessages (commit 12e39f4) with broken vi.mock hoisting in working tree
provides:
  - Fixed glasses-main.test.ts vi.mock hoisting (19 tests green again)
  - 6 SSE parser tests for parseServerSentEventsFromResponse
  - response.body null guard (no more non-null assertion crash)
affects: [gateway-client, glasses-main, persistence-mocks]

# Tech tracking
tech-stack:
  added: []
  patterns: [vi.hoisted for mock variables used inside vi.mock factories, ReadableStream<Uint8Array<ArrayBuffer>> for SSE test mocks]

key-files:
  created: []
  modified:
    - src/__tests__/glasses-main.test.ts
    - src/__tests__/gateway-client.test.ts
    - src/api/gateway-client.ts

key-decisions:
  - "vi.hoisted() for all mock variables referenced inside vi.mock factories (Vitest hoisting requirement)"
  - "response.body null guard emits error chunk via emitChunkCallback instead of crashing with TypeError"

patterns-established:
  - "vi.hoisted pattern: use const { mock } = vi.hoisted(() => ({ mock: vi.fn() })) for any mock variable referenced inside vi.mock()"
  - "ReadableStream<Uint8Array<ArrayBuffer>> type annotation for SSE test mocks (avoids TS5 ArrayBufferLike strictness)"

requirements-completed: [QUICK-48]

# Metrics
duration: 9min
completed: 2026-03-12
---

# Quick Task 48: Fix Broken Tests + SSE Coverage + Null-Body Guard Summary

**vi.hoisted fix restores 19 glasses-main tests, 6 new SSE parser tests cover streaming edge cases, null-body guard prevents runtime crash**

## Performance

- **Duration:** 9 min
- **Started:** 2026-03-12T18:41:17Z
- **Completed:** 2026-03-12T18:49:45Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Fixed vi.mock hoisting error in glasses-main.test.ts: 4 groups of mock variables (persistence/db, conversation-store, session-store, boot-restore) wrapped with vi.hoisted()
- Added 6 SSE streaming tests covering happy path, response_start dedup, malformed JSON skip, chunked delivery reassembly, null body guard, and error event
- Replaced response.body! non-null assertion with graceful error emission in parseServerSentEventsFromResponse
- Added loadMessages to mockRenderer (required by glasses-main.ts after quick-46 batch loadMessages changes)

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix broken glasses-main test vi.mock hoisting and add response.body null guard** - `8cf450a` (fix)
2. **Task 2: Add SSE parser test coverage for gateway-client** - `f47fb70` (test)

## Files Created/Modified
- `src/__tests__/glasses-main.test.ts` - Fixed vi.mock hoisting with vi.hoisted() for 4 mock variable groups; added loadMessages to mockRenderer
- `src/__tests__/gateway-client.test.ts` - Added 6 SSE streaming tests in new describe('sendVoiceTurn SSE streaming') block
- `src/api/gateway-client.ts` - Replaced response.body! with null guard that emits error chunk

## Decisions Made
- Used vi.hoisted() destructuring pattern (`const { mock } = vi.hoisted(() => ({ mock: vi.fn() }))`) for all mock variables referenced inside vi.mock factories -- this is the canonical Vitest pattern for hoisted mocks
- Used emitChunkCallback for null-body error emission (consistent with other error paths in gateway-client) instead of throwing

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript ReadableStream type mismatch in SSE tests**
- **Found during:** Task 2 (SSE test implementation)
- **Issue:** `ReadableStream<Uint8Array>` expands to `ReadableStream<Uint8Array<ArrayBufferLike>>` which is not assignable to `ReadableStream<Uint8Array<ArrayBuffer>>` (Response.body type)
- **Fix:** Used explicit `ReadableStream<Uint8Array<ArrayBuffer>>` generic and `as Uint8Array<ArrayBuffer>` cast on encoder.encode() output
- **Files modified:** src/__tests__/gateway-client.test.ts
- **Verification:** `npx tsc --noEmit` passes with zero errors
- **Committed in:** f47fb70 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Type fix necessary for typecheck pass. No scope creep.

## Issues Encountered
None beyond the TypeScript type strictness issue documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All glasses-main tests pass (19/19)
- All gateway-client tests pass (34/34 including 6 new SSE tests)
- Full suite: 679 passing (8 pre-existing failures in nav-switching/confirm-modal unrelated to this task)
- Typecheck clean

---
*Phase: quick-48*
*Completed: 2026-03-12*

## Self-Check: PASSED

- All 3 modified files exist on disk
- Both task commits verified in git log (8cf450a, f47fb70)
- 19/19 glasses-main tests pass
- 34/34 gateway-client tests pass (6 new SSE tests)
- typecheck clean (0 errors)
