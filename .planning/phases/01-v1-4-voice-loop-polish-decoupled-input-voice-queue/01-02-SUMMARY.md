---
phase: 01-v1-4-voice-loop-polish-decoupled-input-voice-queue
plan: 02
subsystem: voice-loop
tags: [fifo-queue, voice-turn, gateway-client, event-bus, sequential-execution]

# Dependency graph
requires:
  - phase: quick-19
    provides: FSM re-record after response_end, queue during streaming
provides:
  - FIFO voice turn queue with bounded size and busy flag
  - Sequential voice turn execution (no abort of in-flight requests)
  - Queue drain on response_end and error chunks
  - getQueueLength() API for testability and monitoring
affects: [01-03-PLAN, voice-loop-controller, glasses-integration]

# Tech tracking
tech-stack:
  added: []
  patterns: [synchronous-busy-flag-queue, drop-oldest-overflow]

key-files:
  created: []
  modified:
    - src/voice-loop-controller.ts
    - src/__tests__/voice-loop-controller.test.ts

key-decisions:
  - "Synchronous busy flag (not Promise-based) because gateway signals completion via synchronous bus chunks"
  - "Drop-oldest overflow strategy when queue exceeds MAX_QUEUE (5) to prevent unbounded memory"
  - "Queue drains on both response_end AND error to prevent deadlock on gateway failures"

patterns-established:
  - "Busy-flag queue: enqueue -> processQueue() checks busy, shifts one item, sets busy=true, calls gateway. On completion signal: busy=false, processQueue() again"
  - "Bounded queue with drop-oldest: pendingTurns.length >= MAX_QUEUE triggers shift() before push()"

requirements-completed: [VLQ-03, VLQ-04, VLQ-06]

# Metrics
duration: 6min
completed: 2026-03-02
---

# Phase 01 Plan 02: Voice Turn Queue Summary

**FIFO voice turn queue with bounded size, busy-flag gating, and automatic drain on gateway response_end/error**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-02T10:49:30Z
- **Completed:** 2026-03-02T10:55:40Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Replaced immediate-send pattern with bounded FIFO queue (max 5 turns) in VoiceLoopController
- First voice turn fires immediately; subsequent turns queue until response_end or error arrives
- Added 10 comprehensive queue tests covering sequential drain, error recovery, overflow, destroy cleanup
- All 595 tests pass with 0 regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Add voice turn queue with busy flag** - `18e459c` (feat)
2. **Task 2: Add comprehensive queue tests** - `279be9a` (test)

## Files Created/Modified
- `src/voice-loop-controller.ts` - Added FIFO queue (pendingTurns, busy flag, processQueue, MAX_QUEUE=5, getQueueLength), modified onChunk to drain queue, updated destroy to clear queue state
- `src/__tests__/voice-loop-controller.test.ts` - Added 10 new queue tests in `describe('voice turn queue')` block, fixed existing settings-getter test for queue semantics

## Decisions Made
- Used synchronous busy boolean (not Promise/async) because gateway completion is signaled via synchronous chunk events on the event bus, not via Promise resolution
- Drop-oldest overflow strategy: when queue exceeds MAX_QUEUE (5), oldest pending turn is discarded with a warning log
- Queue drains on both response_end AND error chunk types to prevent deadlock when gateway fails

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed existing settings-getter test for queue semantics**
- **Found during:** Task 1 (queue implementation)
- **Issue:** The `uses settings getter for current values` test emitted two audio:recording-stop events and expected both to immediately call sendVoiceTurn. With the new queue, the second turn queues instead of sending immediately.
- **Fix:** Added `gateway.simulateChunk({ type: 'response_end' })` between the two assertions to drain the queue before checking the second call's settings
- **Files modified:** src/__tests__/voice-loop-controller.test.ts
- **Verification:** All 6 existing tests pass
- **Committed in:** 18e459c (Task 1 commit)

**2. [Rule 1 - Bug] Fixed TypeScript errors in test filter callbacks**
- **Found during:** Task 2 (test implementation)
- **Issue:** Destructuring type annotations `([entry]: [{ level: string; msg: string }])` in mock.calls.filter() caused TS2769 errors due to mock.calls being `any[][]`
- **Fix:** Changed to simpler `(args) => args[0].level` access pattern without destructuring type annotations
- **Files modified:** src/__tests__/voice-loop-controller.test.ts
- **Verification:** `npx tsc --noEmit` passes cleanly
- **Committed in:** 279be9a (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs)
**Impact on plan:** Both auto-fixes necessary for correctness. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Voice turn queue operational, ready for Plan 03 (FSM input-path decoupling)
- getQueueLength() available for monitoring/UI integration if needed
- 595 tests passing, TypeScript clean

## Self-Check: PASSED

- FOUND: src/voice-loop-controller.ts
- FOUND: src/__tests__/voice-loop-controller.test.ts
- FOUND: .planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-02-SUMMARY.md
- FOUND: 18e459c (Task 1 commit)
- FOUND: 279be9a (Task 2 commit)

---
*Phase: 01-v1-4-voice-loop-polish-decoupled-input-voice-queue*
*Completed: 2026-03-02*
