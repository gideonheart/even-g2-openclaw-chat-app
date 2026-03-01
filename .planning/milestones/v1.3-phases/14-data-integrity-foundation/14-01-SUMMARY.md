---
phase: 14-data-integrity-foundation
plan: 01
subsystem: database
tags: [indexeddb, event-bus, persistence, data-integrity, sentinel]

# Dependency graph
requires:
  - phase: 09-persistence-data-layer
    provides: "ConversationStore, db.ts openDB/closeDB, AppEventMap"
provides:
  - "persistence:error, persistence:health, storage:evicted event types in AppEventMap"
  - "IDBDatabase.onclose handler with setOnUnexpectedClose callback"
  - "reopenDB() retry function with cooldown and max attempts"
  - "SENTINEL_ID constant and filtering in ConversationStore queries"
affects: [14-02-integrity-checker, 14-03-storage-health, boot-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "IDB onclose hook for unexpected database closure detection"
    - "Module-level callback registration for loose coupling (setOnUnexpectedClose)"
    - "Sentinel record pattern: special ID filtered from user-facing queries"
    - "Promise-based retry with setTimeout cooldown (reopenDB)"

key-files:
  created: []
  modified:
    - src/types.ts
    - src/persistence/db.ts
    - src/persistence/conversation-store.ts

key-decisions:
  - "reopenDB uses Promise chain with setTimeout (not async/await) to stay safe outside IDB transactions"
  - "SENTINEL_ID exported as named constant for reuse by integrity-checker in Plan 02"
  - "Sentinel filtered in 3 query methods (getAllConversations, getLastConversation, searchMessages) but not in getConversation to allow direct lookup"

patterns-established:
  - "Persistence event types: persistence:error, persistence:health, storage:evicted added to AppEventMap"
  - "DB lifecycle hooks: setOnUnexpectedClose for registration, reopenDB for recovery"
  - "Sentinel filtering: SENTINEL_ID constant checked in cursor loops"

requirements-completed: [RES-15, RES-20, RES-22]

# Metrics
duration: 3min
completed: 2026-02-28
---

# Phase 14 Plan 01: Data Integrity Foundation Summary

**Persistence event types in AppEventMap, IDBDatabase.onclose with retry reopenDB(), and sentinel record filtering in ConversationStore**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-28T19:11:32Z
- **Completed:** 2026-02-28T19:14:19Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Three new event types (persistence:error, persistence:health, storage:evicted) added to AppEventMap for downstream integrity and health plans
- IDBDatabase.onclose handler with setOnUnexpectedClose callback and reopenDB() retry (3 attempts, 1s cooldown)
- Sentinel record (__sentinel__) filtered from all three user-facing ConversationStore query methods
- All 372 existing tests pass with zero regressions and zero new runtime dependencies

## Task Commits

Each task was committed atomically:

1. **Task 1: Add persistence event types and IDBDatabase.onclose** - `ab710e8` (feat)
2. **Task 2: Filter sentinel records from ConversationStore queries** - `5190e77` (feat)

## Files Created/Modified
- `src/types.ts` - Added persistence:error, persistence:health, storage:evicted to AppEventMap
- `src/persistence/db.ts` - Added onclose handler, setOnUnexpectedClose(), reopenDB() with retry logic
- `src/persistence/conversation-store.ts` - Added SENTINEL_ID export and filtering in getAllConversations, getLastConversation, searchMessages

## Decisions Made
- reopenDB uses Promise chain with setTimeout (not async/await) to stay safe outside IDB transactions
- SENTINEL_ID exported as named constant for reuse by integrity-checker in Plan 02
- Sentinel filtered in 3 query methods but not in getConversation (direct lookup by ID should still work for the sentinel)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Event types ready for integrity-checker (Plan 02) to emit persistence:error and for storage-health (Plan 03) to emit persistence:health
- setOnUnexpectedClose and reopenDB ready for boot wiring
- SENTINEL_ID exported for integrity-checker to write and read the sentinel record
- All foundational infrastructure in place for Plans 02 and 03

## Self-Check: PASSED

All files exist (src/types.ts, src/persistence/db.ts, src/persistence/conversation-store.ts, 14-01-SUMMARY.md). All commits verified (ab710e8, 5190e77).

---
*Phase: 14-data-integrity-foundation*
*Completed: 2026-02-28*
