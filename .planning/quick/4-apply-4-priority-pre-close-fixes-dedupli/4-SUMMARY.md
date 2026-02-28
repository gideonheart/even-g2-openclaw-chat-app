---
phase: quick-4
plan: 1
subsystem: code-quality
tags: [cleanup, dedup, dead-code, async-safety, resource-cleanup]

# Dependency graph
requires:
  - phase: 10-dynamic-sessions
    provides: session-store, sync-bridge, hub-main, glasses-main
provides:
  - Single-source-of-truth localStorage key constant
  - Hub syncBridge cleanup on page unload
  - Async-safe sync message handlers in glasses-main
  - Clean createSyncBridge signature with no unused params
  - Removed dead Session interface from types.ts
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Import shared constants instead of duplicating across modules"
    - "Always add .catch() on fire-and-forget async calls in event handlers"
    - "Resources created in init should have cleanup in teardown"

key-files:
  created: []
  modified:
    - src/persistence/session-store.ts
    - src/sync/sync-bridge.ts
    - src/types.ts
    - src/__tests__/sync-bridge.test.ts
    - src/hub-main.ts
    - src/glasses-main.ts

key-decisions:
  - "Hub syncBridge cleanup uses beforeunload listener (matches glasses pattern of cleanup on page close)"
  - "Async .catch() guards use empty callbacks since these are fire-and-forget sync handlers"

patterns-established:
  - "Shared constants: ACTIVE_CONVERSATION_KEY defined once in boot-restore.ts, imported where needed"
  - "Resource cleanup: all created resources (syncBridge, etc.) have explicit destroy paths"

requirements-completed: [FIX-DEDUP, FIX-CLEANUP, FIX-UNUSED, FIX-DEAD, FIX-ASYNC]

# Metrics
duration: 4min
completed: 2026-02-28
---

# Quick Task 4: Apply 5 Priority Pre-Close Fixes Summary

**Deduplicated localStorage key constant, added hub syncBridge cleanup, removed unused createSyncBridge param, removed dead Session interface, and added async error guards on glasses sync handlers**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-28T16:28:32Z
- **Completed:** 2026-02-28T16:32:22Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Deduplicated `ACTIVE_SESSION_KEY` in session-store.ts to import `ACTIVE_CONVERSATION_KEY` from boot-restore.ts (single source of truth)
- Removed unused `_origin` parameter and `SyncOrigin` import from `createSyncBridge()`, updated all test calls
- Removed dead `Session` interface from types.ts (replaced by `ConversationRecord` in persistence/types.ts)
- Added hub syncBridge cleanup path via `beforeunload` listener in initHub()
- Added `.catch()` guards on async sync handlers in glasses-main.ts (switchToSession and listSessions)

## Task Commits

Each task was committed atomically:

1. **Task 1: Deduplicate localStorage key and remove dead code** - `4217a56` (fix)
2. **Task 2: Add hub syncBridge cleanup and async error guards** - `409eebb` (fix)

## Files Created/Modified
- `src/persistence/session-store.ts` - Replaced local ACTIVE_SESSION_KEY with imported ACTIVE_CONVERSATION_KEY from boot-restore
- `src/sync/sync-bridge.ts` - Removed unused _origin param and SyncOrigin import from createSyncBridge()
- `src/types.ts` - Removed dead Session interface (lines 18-22)
- `src/__tests__/sync-bridge.test.ts` - Updated all createSyncBridge calls to pass no arguments
- `src/hub-main.ts` - Added SyncBridge type import, module-level hubSyncBridge var, beforeunload cleanup, syncBridge in initPersistence return
- `src/glasses-main.ts` - Added .catch() on switchToSession() and sessionStore.listSessions().then() in sync message handler

## Decisions Made
- Hub syncBridge cleanup uses `beforeunload` listener (consistent with how glasses-main uses `pagehide`/`visibilitychange`)
- Async `.catch()` guards use empty callback bodies since these are fire-and-forget handlers in a message listener -- logging is optional

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Codebase is cleaner with no duplicate constants, no dead code, proper resource cleanup, and no unhandled rejection risk
- Ready for Phase 10 close or further development

## Self-Check: PASSED

All 6 modified files exist. Both task commits (4217a56, 409eebb) verified. SUMMARY.md created.

---
*Quick Task: 4*
*Completed: 2026-02-28*
