---
phase: 18-error-ux
plan: 01
subsystem: display
tags: [error-presenter, status-bar, auto-clear, icon-animator, event-bus, glasses]

# Dependency graph
requires:
  - phase: 14-data-integrity-foundation
    provides: "persistence:error event emission (write-failed, verify-failed, database-closed, quota-exceeded)"
  - phase: 17-fsm-gateway-resilience
    provides: "fsm:watchdog-reset event emission from gesture-handler watchdog timer"
  - phase: 16.5-integration-hardening
    provides: "reopenDB handle propagation, eviction flag pattern, cleanup teardown ordering"
provides:
  - "createGlassesErrorPresenter factory subscribing to persistence:error and fsm:watchdog-reset bus events"
  - "User-friendly error message mapping (no technical jargon on glasses display)"
  - "Auto-clearing status bar errors: 3s transient, 10s recoverable, 5s watchdog"
  - "Icon animator pause/resume during error display via getIconAnimator() accessor"
  - "GlassesRenderer.getIconAnimator() interface method for external icon animator access"
affects: [18-02, 19-observability]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Status bar error display via bridge.textContainerUpgrade(1, message) with auto-clear setTimeout"
    - "Icon animator pause/resume: stop() before error show, start() after auto-clear fires"
    - "lastErrorLevel guard to prevent dual-emit overwrite (Pitfall 2 from research)"
    - "getIconAnimator() accessor on GlassesRenderer to expose private iconAnimator to error presenter"

key-files:
  created:
    - src/display/error-presenter.ts
    - src/__tests__/glasses-error-presenter.test.ts
  modified:
    - src/display/glasses-renderer.ts
    - src/glasses-main.ts
    - src/__tests__/glasses-main.test.ts

key-decisions:
  - "Icon animator exposed via getIconAnimator() accessor on GlassesRenderer rather than passing iconAnimator through renderer constructor"
  - "Error presenter wired at Layer 4.5 (after displayController.init but before sync heartbeat start)"
  - "Fallback no-op iconAnimator used when getIconAnimator() returns null (display not yet initialized)"
  - "glassesErrorPresenter.destroy() placed before displayController.destroy() in cleanup sequence"

patterns-established:
  - "Status bar error presenter pattern: subscribe to bus, map to user-friendly message, show via bridge.textContainerUpgrade(1, ...), auto-clear with setTimeout"
  - "getIconAnimator() accessor pattern: expose private module internals through typed getter for cross-module coordination"

requirements-completed: [RES-16, RES-19]

# Metrics
duration: 9min
completed: 2026-03-01
---

# Phase 18 Plan 01: Glasses Error Presenter Summary

**Glasses error presenter with auto-clearing status bar messages, user-friendly error mapping, and icon animator pause/resume for RES-16 error hierarchy and RES-19 no-jargon policy**

## Performance

- **Duration:** 9 min
- **Started:** 2026-03-01T01:29:00Z
- **Completed:** 2026-03-01T01:38:32Z
- **Tasks:** 2 (TDD: RED then GREEN)
- **Files modified:** 5

## Accomplishments
- Created error presenter factory that subscribes to persistence:error and fsm:watchdog-reset bus events
- Maps technical error types to user-friendly messages (database-closed -> "Data connection lost", quota-exceeded -> "Storage full", write-failed -> "Could not save message", verify-failed -> "Storage check failed")
- Implements 3-tier auto-clear timing: 3s for transient errors, 10s for recoverable errors with "tap to retry" suffix, 5s for FSM watchdog reset
- Pauses icon animator during error display to prevent immediate overwrite (Pitfall 1 mitigation)
- Added getIconAnimator() to GlassesRenderer interface and wired error presenter in glasses-main.ts
- 15 new test cases covering all error hierarchy levels, message mapping, timer behavior, dual-emit guard, and destroy cleanup
- Full test suite: 484 tests passing (15 new, zero regressions)

## Task Commits

Each task was committed atomically:

1. **Task 1: Write failing tests for glasses error presenter (RED)** - `460e9ed` (test)
2. **Task 2: Implement glasses error presenter and wire into glasses-main.ts (GREEN)** - `b7e6c70` (feat)

## Files Created/Modified
- `src/display/error-presenter.ts` - createGlassesErrorPresenter factory with auto-clear status bar, message mapping, icon animator pause/resume, destroy cleanup
- `src/__tests__/glasses-error-presenter.test.ts` - 15 test cases covering RES-16 error hierarchy and RES-19 message mapping
- `src/display/glasses-renderer.ts` - Added getIconAnimator() to interface and return object
- `src/glasses-main.ts` - Import and wire createGlassesErrorPresenter after displayController.init(), add destroy() to cleanup
- `src/__tests__/glasses-main.test.ts` - Added getIconAnimator mock, error presenter mock, and mock reset

## Decisions Made
- Exposed icon animator via getIconAnimator() accessor on GlassesRenderer rather than passing it through the constructor -- cleaner API boundary and follows existing accessor pattern (isHidden)
- Error presenter wired at Layer 4.5 between display init and sync heartbeat start -- ensures display exists before error messages can be shown
- Fallback no-op iconAnimator { stop: () => {}, start: () => {} } used when getIconAnimator() returns null -- defensive coding for edge case where renderer not yet initialized
- glassesErrorPresenter.destroy() placed before displayController.destroy() in cleanup -- error presenter must unsubscribe before icon animator is destroyed

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated glasses-main.test.ts mocks for new renderer method**
- **Found during:** Task 2 (implementation)
- **Issue:** Existing glasses-main.test.ts mock renderer lacked getIconAnimator() method, causing all 5 glasses-main tests to fail with "renderer.getIconAnimator is not a function"
- **Fix:** Added getIconAnimator mock returning { stop: vi.fn(), start: vi.fn() }, added showMenuOverlay and restoreConversation mocks, and added error presenter module mock
- **Files modified:** src/__tests__/glasses-main.test.ts
- **Verification:** All 484 tests pass
- **Committed in:** b7e6c70 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Auto-fix necessary to prevent test regression from new GlassesRenderer interface method. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Glasses error presenter complete, all bus events (persistence:error, fsm:watchdog-reset) now have UI consumers
- Ready for Plan 18-02 (hub error display + health page enhancement)
- Hub can follow same pattern: subscribe to bus events, show toasts/banners, wire in hub-main.ts

## Self-Check: PASSED

- [x] src/display/error-presenter.ts exists and exports createGlassesErrorPresenter
- [x] src/__tests__/glasses-error-presenter.test.ts exists with 15 test cases
- [x] src/display/glasses-renderer.ts has getIconAnimator() in interface and return object
- [x] src/glasses-main.ts imports and wires createGlassesErrorPresenter with destroy in cleanup
- [x] Commit 460e9ed exists (test RED)
- [x] Commit b7e6c70 exists (feat GREEN)
- [x] Full test suite: 484 tests passing

---
*Phase: 18-error-ux*
*Completed: 2026-03-01*
