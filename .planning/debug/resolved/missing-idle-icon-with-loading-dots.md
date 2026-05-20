---
status: resolved
trigger: "missing-idle-icon-with-loading-dots: STATUS_CONTAINER shows only loading dots but should show idle icon + loading dots after stop-recording"
created: 2026-03-04T00:00:00Z
updated: 2026-03-04T00:00:01Z
---

## Current Focus

hypothesis: CONFIRMED - icon-animator tick() has no code path to prefix idle icon when not-recording + pendingTurns > 0
test: Read tick() logic in icon-animator.ts lines 72-118
expecting: Found the gap -- "loading only" branch (lines 87-98) outputs only the loading frame with no idle prefix
next_action: Fix tick() to prefix idle icon when not-recording + pendingTurns > 0, then update tests

## Symptoms

expected: After stop-recording, STATUS_CONTAINER shows `◌ . → .. → ...` (idle icon prefix + loading dots) — indicates "ready to record" while prior turn is pending
actual: After stop-recording, STATUS_CONTAINER shows only `. → .. → ...` (no idle icon) — user doesn't know they can tap to record
errors: No errors, just missing visual indicator
reproduction: Tap to record → speak → tap to stop → observe STATUS_CONTAINER shows only dots, no idle icon
started: Since quick-38 refactored to composite renderer. The old single-state model showed `sent` state which also had no idle indicator, so this was never implemented.

## Eliminated

## Evidence

- timestamp: 2026-03-04T00:00:01Z
  checked: icon-animator.ts tick() function, lines 72-118
  found: |
    The tick() function has four mutually exclusive branches:
    1. recording (lines 78-84): builds recording dot + timer, then loading dots appended if pendingTurns > 0
    2. loading only (lines 87-98): when NOT recording but pendingTurns > 0, outputs ONLY the loading frame with NO idle prefix
    3. thinking (lines 101-106): only when not recording, no pending, streaming
    4. idle (lines 108-111): only when not recording, no pending, no streaming
    Branch 2 is the problem: when recording stops but turns are still pending, the user sees only dots (`.`, `..`, `...`) with no idle icon prefix.
    The composite pattern works for recording+loading (branch 1 appends loading to recording), but there is no equivalent composition for idle+loading.
  implication: The idle icon prefix was never implemented for the loading-only state. This is a missing feature, not a regression.

- timestamp: 2026-03-04T00:00:01Z
  checked: display-controller.ts audio:stop-requested handler, lines 146-150
  found: On stop-requested, setRecordingActive(false) + pendingTurns++ + setPendingTurns(). This correctly transitions conditions to {recording: false, pendingTurns: N, streaming: false}, which hits the "loading only" branch in tick().
  implication: The display-controller wiring is correct. The fix belongs entirely in icon-animator.ts tick() function.

- timestamp: 2026-03-04T00:00:01Z
  checked: icon-bitmaps.ts
  found: ICON_FRAMES.idle = ['\u25CC'] (◌ open circle). This is the character that should prefix loading dots.
  implication: The idle glyph is already defined; tick() just needs to use it.

## Resolution

root_cause: In icon-animator.ts tick(), the "loading only" branch (pendingTurns > 0, not recording) outputs only the loading dots frame without prefixing the idle icon. The composite pattern that combines recording+loading exists, but no equivalent idle+loading composition was implemented.
fix: Changed the "loading only" branch in tick() (line 97) from `output = frame` to `output = \`${ICON_FRAMES.idle[0]} ${frame}\``, which prefixes the idle open-circle icon before loading dots.
verification: All 669 tests pass across 38 test files. TypeScript compiles cleanly. Updated 6 test assertions in icon-animator.test.ts to expect the new idle-prefixed loading format.
files_changed:
  - src/display/icon-animator.ts
  - src/__tests__/icon-animator.test.ts
