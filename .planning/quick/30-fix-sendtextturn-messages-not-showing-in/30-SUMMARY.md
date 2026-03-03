---
phase: quick-30
plan: 01
subsystem: sync
tags: [sync-bridge, dual-boot, renderer, text-turn, glasses]

requires:
  - phase: 10-multi-session-sync
    provides: sync bridge infrastructure and message types
  - phase: 12-hub-ui-live-conversation
    provides: hub text input and sync message emission
provides:
  - "Glasses-side sync bridge handlers for message:added, streaming:start, streaming:end"
  - "Hub text turn messages render on glasses display"
affects: [glasses-main, sync-bridge, text-turn]

tech-stack:
  added: []
  patterns: ["Direct renderer calls for cross-context message display (not bus events)"]

key-files:
  created:
    - ".planning/analysis/text-turn-sync-gap.md"
  modified:
    - "src/glasses-main.ts"
    - "src/__tests__/glasses-main.test.ts"

key-decisions:
  - "Direct renderer calls (not bus.emit) to avoid auto-save double-write of hub-saved messages"

patterns-established:
  - "Sync bridge message handlers use direct renderer calls for display, matching restore and drift reconciliation patterns"

requirements-completed: [QUICK-30]

duration: 6min
completed: 2026-03-03
---

# Quick 30: Fix sendTextTurn Messages Not Showing on Glasses Summary

**Glasses sync bridge handles hub text turn events (message:added, streaming:start/end) via direct renderer calls to avoid auto-save double-write**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-03T15:52:51Z
- **Completed:** 2026-03-03T15:58:56Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Hub text turn user messages now render on glasses display via sync bridge
- Hub text turn assistant responses stream on glasses display via sync bridge
- 6 new tests verify sync bridge text turn rendering with conversation ID and origin filtering
- Root cause analysis documents the dual-boot sync gap and architectural lesson

## Task Commits

Each task was committed atomically:

1. **Task 1: Add message:added, streaming:start, streaming:end handlers** - `6d407cd` (feat)
2. **Task 2: Add tests for sync bridge text turn rendering** - `b9aa7d0` (test)
3. **Task 3: Document root cause analysis** - `d44b41f` (docs)

## Files Created/Modified
- `src/glasses-main.ts` - Added 3 sync bridge case handlers for text turn message display
- `src/__tests__/glasses-main.test.ts` - Added sync bridge mock, boot-restore mock, 6 new test cases
- `.planning/analysis/text-turn-sync-gap.md` - Root cause analysis with architectural lesson

## Decisions Made
- Used direct renderer calls instead of bus.emit('gateway:chunk') to avoid auto-save double-write. Hub already saves messages to IDB; emitting gateway:chunk on glasses bus would trigger glasses auto-save to duplicate them.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed vi.mock hoisting of TEST_CONV_ID constant**
- **Found during:** Task 2 (test writing)
- **Issue:** `vi.mock` factories are hoisted above variable declarations, so `TEST_CONV_ID` was not accessible inside the boot-restore mock factory
- **Fix:** Inlined the string literal `'test-conv-id'` directly in the mock factory instead of referencing the constant
- **Files modified:** `src/__tests__/glasses-main.test.ts`
- **Verification:** All 16 tests pass
- **Committed in:** b9aa7d0 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Minor test infrastructure fix. No scope creep.

## Issues Encountered
None beyond the vi.mock hoisting issue documented above.

## User Setup Required
None - no external service configuration required.

## Verification Results
- All 619 tests pass (38 test files)
- TypeScript compiles cleanly (`npx tsc --noEmit`)
- No `gateway:chunk` emissions in sync handler (confirmed by grep)
- 6 new sync bridge tests cover: user message, streaming start/end, assistant chunk, conversation filtering, origin filtering

## Self-Check: PASSED

- All 3 source/test/doc files exist on disk
- All 3 task commits verified in git log (6d407cd, b9aa7d0, d44b41f)
- 619 tests pass, TypeScript compiles cleanly

---
*Phase: quick-30*
*Completed: 2026-03-03*
