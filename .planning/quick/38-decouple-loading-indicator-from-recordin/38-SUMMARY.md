---
phase: quick-38
plan: 01
subsystem: display
tags: [icon-animator, display-controller, glasses-renderer, composite-status]
dependency_graph:
  requires: [quick-36]
  provides: [composite-icon-rendering, independent-recording-loading-display]
  affects: [icon-animator, glasses-renderer, display-controller]
tech_stack:
  added: []
  patterns: [composite-condition-renderer, edge-triggered-frame-resets, independent-segment-animation]
key_files:
  created: []
  modified:
    - src/display/icon-animator.ts
    - src/display/glasses-renderer.ts
    - src/display/display-controller.ts
    - src/__tests__/icon-animator.test.ts
    - src/__tests__/display-controller.test.ts
    - src/__tests__/glasses-main.test.ts
decisions:
  - "Keep setIconState on GlassesRenderer for backward compat with glasses-main.ts sync bridge streaming:start"
  - "Remove local recordingActive/streamingActive from display-controller (renderer tracks conditions)"
  - "Edge-triggered frame counter resets: only reset when condition transitions false->true"
metrics:
  duration: "12m"
  completed: "2026-03-04"
  tasks_completed: 2
  tasks_total: 2
  test_count: 669
  test_count_new: 22
---

# Quick Task 38: Decouple Loading Indicator from Recording Indicator Summary

Composite status bar renderer with independent recording dot+timer and loading dots segments, replacing single-winner priority resolution.

## What Changed

### Task 1: Refactor icon-animator to composite status renderer (ec0823a)

Replaced `setState(IconState)` with `setConditions(StatusConditions)` interface on `IconAnimator`. The new interface accepts three independent condition flags:

```ts
interface StatusConditions {
  recording: boolean;     // show blinking dot + elapsed timer
  pendingTurns: number;   // > 0 shows loading dots
  streaming: boolean;     // show thinking spinner (only when not recording/pending)
}
```

The tick function now builds a composite output string from independent segments:
- Both active: `"[recording-dot] [timer]  [loading-dots]"` (two-space separator)
- Recording only: `"[recording-dot] [timer]"`
- Loading only: `"[loading-dots]"`
- Streaming only: `"[thinking-spinner]"`
- Idle: `"[idle-icon]"`

Each segment maintains its own frame counter with edge-triggered resets (counter resets when condition transitions from false to true). `setState()` kept as backward-compatible pass-through mapping single IconState to conditions.

Added `setRecordingActive`, `setPendingTurns`, `setStreamingActive` to `GlassesRenderer` interface. Each updates local conditions and calls `iconAnimator.setConditions()`.

### Task 2: Rewire display-controller to independent conditions (53d98fd)

Removed `resolveIcon()` priority function and `ICON_PRIORITY` array. Bus event handlers now call renderer condition methods directly instead of setting flags and resolving a single winner:

- `audio:recording-start` -> `renderer.setRecordingActive(true)`
- `audio:stop-requested` -> `renderer.setRecordingActive(false)` + `renderer.setPendingTurns(++pending)`
- `response_start` -> `renderer.setStreamingActive(true)`
- `response_end` -> `renderer.setStreamingActive(false)` + 500ms settle -> `renderer.setPendingTurns(--pending)`

Removed local `recordingActive` and `streamingActive` bookkeeping (only `pendingTurns` counter retained for decrement logic).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript strict mode violations**
- **Found during:** Task 2 (build verification)
- **Issue:** Unused `StatusConditions` import, mock call tuple type access (`mock.calls[0][0] as string`), unused local variables `recordingActive`/`streamingActive`
- **Fix:** Removed unused import, changed to `mock.calls[0] as unknown[]` pattern, removed write-only bookkeeping variables
- **Files modified:** src/__tests__/icon-animator.test.ts, src/display/display-controller.ts
- **Commit:** 53d98fd

**2. [Rule 2 - Missing critical functionality] glasses-main.test.ts mock missing new methods**
- **Found during:** Task 2 (full test suite run)
- **Issue:** Mock renderer in glasses-main.test.ts lacked `setRecordingActive`, `setPendingTurns`, `setStreamingActive` methods, causing type mismatch
- **Fix:** Added three new vi.fn() mocks to mockRenderer
- **Files modified:** src/__tests__/glasses-main.test.ts
- **Commit:** 53d98fd

## Decisions Made

1. **Kept `setIconState` on GlassesRenderer interface** -- `glasses-main.ts` calls `renderer.setIconState('thinking')` for hub-originated `streaming:start` messages via sync bridge. Removing it would break the sync bridge path. Marked as `@deprecated` with new methods as replacement.

2. **Removed local bookkeeping flags** -- `recordingActive` and `streamingActive` in display-controller were only written to (never read after `resolveIcon()` removal). Removed to avoid TypeScript unused-variable errors and dead code. Only `pendingTurns` retained because it's read during decrement.

3. **Edge-triggered frame resets** -- Frame counters reset only on false->true transitions, not on every `setConditions` call. This prevents recording frame jumping when loading dots change (e.g., pendingTurns decrement).

## Verification Results

- `npx vitest run src/__tests__/icon-animator.test.ts` -- 31 tests passed (was 15, +16 new)
- `npx vitest run src/__tests__/display-controller.test.ts` -- 32 tests passed (was 30, rewritten + 8 new overlap)
- `npx vitest run` -- 669 tests across 38 files, all passing
- `npm run build` -- clean tsc + vite, 0 errors, 10 bundles

## Self-Check: PASSED

All 6 modified files exist. Both task commits (ec0823a, 53d98fd) verified in git log.
