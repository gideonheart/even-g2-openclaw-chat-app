---
phase: quick-33
plan: 01
subsystem: sync
tags: [event-bus, sync-bridge, boot-order, glasses]

# Dependency graph
requires:
  - phase: 10-sync-bridge
    provides: syncBridge cross-context messaging
provides:
  - Bridge event forwarding registered before bridge.init() -- hub receives bridge:connected on boot
affects: [hub-connection-card, glasses-boot]

# Tech tracking
tech-stack:
  added: []
  patterns: [event-listener-before-init boot ordering]

key-files:
  created: []
  modified:
    - src/glasses-main.ts
    - src/__tests__/glasses-main.test.ts

key-decisions:
  - "Move all sync-forwarding bus listeners (bridge + gateway) before bridge.init() to capture events emitted during initialization"

patterns-established:
  - "Boot order: event forwarding listeners must be registered before the module that emits the events is initialized"

requirements-completed: [QUICK-33]

# Metrics
duration: 3min
completed: 2026-03-04
---

# Quick Task 33: Fix Glasses Connection Card Stuck on Disconnected

**Moved bridge event forwarding listeners before bridge.init() so hub connection card correctly shows "Connected" after glasses boot**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-04T09:34:13Z
- **Completed:** 2026-03-04T09:38:10Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Fixed root cause: `bus.on('bridge:connected')` was registered 232 lines after `bridge.init()` which emits the event synchronously -- event was lost
- Moved bridge event forwarding (bridge:connected, bridge:disconnected) and gateway event forwarding (gateway:chunk, gateway:status) before `bridge.init()`
- Added 3 tests verifying forwarding behavior and registration order

## Task Commits

Each task was committed atomically:

1. **Task 1: Move bridge event forwarding listeners before bridge.init()** - `2241f4a` (fix)
2. **Task 2: Add test verifying bridge:connected is forwarded during boot** - `aaa661c` (test)

## Files Created/Modified
- `src/glasses-main.ts` - Moved bridge/gateway sync-forwarding bus listeners before bridge.init() with explanatory comments
- `src/__tests__/glasses-main.test.ts` - Added 3 tests: bridge:connected forwarding, bridge:disconnected forwarding, registration order check

## Decisions Made
- Moved both bridge event forwarding AND gateway error/status forwarding before bridge.init() since gateway activity can also occur early during boot
- Added explicit comments explaining WHY listeners must be registered before init()

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Hub connection card will correctly show "Connected" after glasses boot
- All 631 tests passing (628 existing + 3 new)

## Self-Check: PASSED

- FOUND: src/glasses-main.ts
- FOUND: src/__tests__/glasses-main.test.ts
- FOUND: 33-SUMMARY.md
- FOUND: commit 2241f4a
- FOUND: commit aaa661c

---
*Phase: quick-33*
*Completed: 2026-03-04*
