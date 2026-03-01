---
phase: 14-data-integrity-foundation
plan: 02
subsystem: database
tags: [indexeddb, integrity-checker, orphan-detection, sentinel, tdd]

# Dependency graph
requires:
  - phase: 14-data-integrity-foundation
    plan: 01
    provides: "SENTINEL_ID constant, persistence event types, ConversationRecord type"
  - phase: 09-persistence-data-layer
    provides: "ConversationStore, db.ts openDB/closeDB, IDB schema"
provides:
  - "createIntegrityChecker factory with check(), writeSentinel(), cleanupOrphans()"
  - "IntegrityReport interface for boot-time diagnostic data"
  - "IntegrityChecker interface for typed consumer usage"
affects: [14-03-storage-health, boot-wiring, glasses-main, hub-main]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-phase orphan cleanup: readonly re-verification then readwrite deletion"
    - "Single readonly IDB transaction for multi-store integrity scan (conversations + messages)"
    - "getAllKeys() for fast key-only conversation enumeration (no value deserialization)"
    - "Cursor scan for message orphan detection (read conversationId from value)"
    - "localStorage dangling pointer check deferred to tx.oncomplete for consistent convIds Set"

key-files:
  created:
    - src/persistence/integrity-checker.ts
    - src/persistence/__tests__/integrity-checker.test.ts
  modified: []

key-decisions:
  - "localStorage dangling pointer check runs after tx.oncomplete to guarantee convIds Set is fully populated"
  - "cleanupOrphans uses Promise.then chain (not nested callbacks) for two-phase transaction sequencing"
  - "IntegrityReport and IntegrityChecker interfaces exported from integrity-checker.ts (co-located with implementation)"

patterns-established:
  - "Two-phase mutation pattern: readonly verify then readwrite mutate, for safe IDB deletions"
  - "Factory/closure module pattern continued for IntegrityChecker (matches conversation-store, session-store)"

requirements-completed: [RES-01, RES-04, RES-05]

# Metrics
duration: 4min
completed: 2026-02-28
---

# Phase 14 Plan 02: IntegrityChecker Summary

**Boot-time IntegrityChecker with single-tx orphan detection, sentinel verification, dangling pointer check, and two-phase re-verified orphan cleanup**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-28T19:16:46Z
- **Completed:** 2026-02-28T19:20:34Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments
- IntegrityChecker module created with factory/closure pattern matching project conventions
- check() performs orphan detection, sentinel verification, dangling pointer check in a single readonly IDB transaction
- writeSentinel() creates idempotent sentinel record for eviction detection on subsequent boots
- cleanupOrphans() re-verifies orphan status in new readonly transaction before deletion, preventing false-positive deletions from cross-context races
- 16 tests covering all specified behaviors including empty DB, re-verification, mixed orphans, and idempotency
- 388 total tests passing (16 new + 372 existing), zero regressions
- Zero new runtime dependencies (browser built-ins only)

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Write failing tests for IntegrityChecker** - `afd7809` (test)
2. **Task 2 (GREEN): Implement IntegrityChecker to pass all tests** - `4aea396` (feat)

_No REFACTOR commit needed -- implementation was clean on first pass._

## Files Created/Modified
- `src/persistence/integrity-checker.ts` - IntegrityChecker factory: check(), writeSentinel(), cleanupOrphans() with IDB callback pattern
- `src/persistence/__tests__/integrity-checker.test.ts` - 16 tests covering all integrity check behaviors and edge cases

## Decisions Made
- localStorage dangling pointer check deferred to tx.oncomplete (not inline with IDB callbacks) to ensure convIds Set is fully populated before comparison
- cleanupOrphans uses Promise.then chain for two-phase transaction sequencing (readonly verify, then readwrite delete) rather than nested Promise constructors
- IntegrityReport and IntegrityChecker interfaces co-located in integrity-checker.ts rather than in types.ts, since they are specific to this module

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed dangling pointer check timing**
- **Found during:** Task 2 (GREEN implementation)
- **Issue:** Research example placed localStorage read inside the Promise constructor but outside tx.oncomplete, meaning convIds Set might not be populated yet when the dangling pointer check runs
- **Fix:** Moved localStorage read into tx.oncomplete callback so convIds is guaranteed complete
- **Files modified:** src/persistence/integrity-checker.ts
- **Verification:** Dangling pointer test passes correctly
- **Committed in:** 4aea396 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix from research example)
**Impact on plan:** Essential correctness fix. No scope creep.

## Issues Encountered
- Unused type import (IntegrityReport) in test file triggered tsc error -- removed the unused import

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- IntegrityChecker ready for boot wiring: `createIntegrityChecker(db)` returns checker with check/writeSentinel/cleanupOrphans
- IntegrityReport provides all data needed for storage-health (Plan 03) to emit persistence:health events
- Sentinel write/check mechanism ready for eviction detection flow
- All 388 tests passing, clean TypeScript compilation

## Self-Check: PASSED

All files exist (src/persistence/integrity-checker.ts, src/persistence/__tests__/integrity-checker.test.ts, 14-02-SUMMARY.md). All commits verified (afd7809, 4aea396).

---
*Phase: 14-data-integrity-foundation*
*Completed: 2026-02-28*
