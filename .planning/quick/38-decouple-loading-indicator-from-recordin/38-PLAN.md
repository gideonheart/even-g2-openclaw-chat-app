---
phase: quick-38
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/display/icon-animator.ts
  - src/display/glasses-renderer.ts
  - src/display/display-controller.ts
  - src/__tests__/icon-animator.test.ts
  - src/__tests__/display-controller.test.ts
autonomous: true
requirements: [DECOUPLE-LOADING-RECORDING]

must_haves:
  truths:
    - "Recording indicator and loading dots are visible simultaneously when user re-records while prior turn is pending"
    - "Loading dots clear per-turn on response_end/error, not globally"
    - "Recording indicator shows blinking dot + elapsed timer independent of loading state"
    - "When only loading (not recording), loading dots display alone"
    - "When only recording (no pending turns), recording indicator displays alone"
    - "Idle icon shows when neither recording nor pending"
  artifacts:
    - path: "src/display/icon-animator.ts"
      provides: "Composite status animator with independent recording + loading segments"
      exports: ["createIconAnimator", "IconAnimator"]
    - path: "src/display/display-controller.ts"
      provides: "Direct condition-flag updates to renderer instead of single resolved IconState"
    - path: "src/__tests__/display-controller.test.ts"
      provides: "Overlap scenario tests: recording + loading visible simultaneously"
  key_links:
    - from: "src/display/display-controller.ts"
      to: "src/display/glasses-renderer.ts"
      via: "renderer.setRecordingActive() + renderer.setPendingTurns() + renderer.setStreamingActive()"
      pattern: "renderer\\.(setRecordingActive|setPendingTurns|setStreamingActive)"
    - from: "src/display/glasses-renderer.ts"
      to: "src/display/icon-animator.ts"
      via: "iconAnimator.setConditions()"
      pattern: "iconAnimator\\.setConditions"
---

<objective>
Decouple loading indicator from recording indicator so both can display simultaneously on the glasses status bar.

Purpose: Currently the status bar shows ONE icon state (recording OR loading OR thinking OR idle) via a priority resolver. Users cannot see loading dots for a pending turn while recording a new one. This makes the voice pipeline feel broken -- the user loses visual feedback that their prior turn is still processing.

Output: Composite status bar that renders `[recording dot + timer]  [loading dots]` when both conditions are active, with independent lifecycle per concern.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/analysis/02-loading-indicator-parallel-with-recording.md
@src/display/icon-animator.ts
@src/display/glasses-renderer.ts
@src/display/display-controller.ts
@src/display/icon-bitmaps.ts
@src/types.ts
@src/__tests__/icon-animator.test.ts
@src/__tests__/display-controller.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Refactor icon-animator to composite status renderer</name>
  <files>
    src/display/icon-animator.ts
    src/display/icon-bitmaps.ts
    src/display/glasses-renderer.ts
    src/types.ts
    src/__tests__/icon-animator.test.ts
  </files>
  <action>
Refactor `icon-animator.ts` to render a **composite status string** from independent condition flags instead of a single `IconState` enum.

**New interface for IconAnimator:**
Replace `setState(state: IconState)` with `setConditions(conditions: StatusConditions)`:

```ts
interface StatusConditions {
  recording: boolean;
  pendingTurns: number;   // > 0 means show loading dots
  streaming: boolean;     // true means show thinking spinner (only when not recording and no pending)
}
```

**Composite tick logic** (replaces the current single-state tick):
1. Build left segment: if `recording` is true, render blinking dot frame (`ICON_FRAMES.recording[recordingFrameIdx]`) + elapsed timer (`formatElapsed()`). Maintain independent `recordingFrameIdx` and `recordingStartedAt`.
2. Build right segment: if `pendingTurns > 0`, render loading dot frame (`ICON_FRAMES.sent[loadingFrameIdx]`). Maintain independent `loadingFrameIdx`.
3. Compose output string:
   - Both active: `"${recordingFrame} ${timer}  ${loadingFrame}"` (two spaces between segments for visual separation)
   - Recording only: `"${recordingFrame} ${timer}"`
   - Loading only: `"${loadingFrame}"`
   - Streaming only (no recording, no pending): thinking spinner frame (`ICON_FRAMES.thinking[thinkingFrameIdx]`)
   - Neither: idle frame (`ICON_FRAMES.idle[0]`)
4. Each segment maintains its own independent frame counter. Recording frame counter resets when `recording` flips to true. Loading frame counter resets when `pendingTurns` transitions from 0 to >0. Thinking frame counter resets when entering thinking display.

**Keep `getState(): IconState` for backward compatibility** -- derive from conditions: recording > sent (pending>0) > thinking (streaming) > idle. This is used by `error-presenter.ts` via `getIconAnimator()`.

**Update `glasses-renderer.ts`:**
Replace `setIconState(state: IconState)` with three methods:
- `setRecordingActive(active: boolean): void`
- `setPendingTurns(count: number): void`
- `setStreamingActive(active: boolean): void`

Each method updates the renderer's local copy of conditions and calls `iconAnimator.setConditions({...})`.

Also keep `setIconState` as a deprecated pass-through that maps the single state to conditions (for any callers outside display-controller, though there should be none). Actually, check if `setIconState` is called from anywhere other than display-controller. If not, remove it from the interface and only keep the new three methods.

**Update `GlassesRenderer` interface** in `glasses-renderer.ts` to expose the three new methods instead of `setIconState`.

**Do NOT change `types.ts`** -- keep `IconState` type as-is since it's used by icon-bitmaps and the backward-compat `getState()`.

**Update icon-animator tests** (`icon-animator.test.ts`):
- Replace `setState(state)` calls with `setConditions({...})` calls
- Add tests for composite rendering:
  - `setConditions({ recording: true, pendingTurns: 1, streaming: false })` outputs string containing both recording dot+timer AND loading dots
  - `setConditions({ recording: false, pendingTurns: 2, streaming: false })` outputs loading dots only
  - `setConditions({ recording: true, pendingTurns: 0, streaming: false })` outputs recording dot+timer only
  - `setConditions({ recording: false, pendingTurns: 0, streaming: true })` outputs thinking spinner
  - `setConditions({ recording: false, pendingTurns: 0, streaming: false })` outputs idle icon
- Test independent frame counters: recording frame counter resets independently when recording flips, loading frame counter resets independently when pendingTurns goes from 0->positive
- Preserve existing frame-drop, start/stop, cycling, timer tests adapted to new interface
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/icon-animator.test.ts --reporter=verbose 2>&1 | tail -40</automated>
  </verify>
  <done>Icon animator accepts composite conditions and renders independent segments. All icon-animator tests pass with new interface. Recording dot+timer and loading dots render in the same output string when both conditions are active.</done>
</task>

<task type="auto">
  <name>Task 2: Rewire display-controller to pass independent conditions + overlap tests</name>
  <files>
    src/display/display-controller.ts
    src/__tests__/display-controller.test.ts
  </files>
  <action>
**Update `display-controller.ts`:**

Remove the `resolveIcon()` function and the `ICON_PRIORITY` array. The icon animator now handles composition internally.

Replace calls to `renderer.setIconState(resolved)` with direct condition updates:
- `bus.on('audio:recording-start')`: call `renderer.setRecordingActive(true)` (was: `recordingActive = true; resolveIcon()`)
- `bus.on('audio:stop-requested')`: call `renderer.setRecordingActive(false)` and `renderer.setPendingTurns(++pendingTurns)` (was: `recordingActive = false; pendingTurns++; resolveIcon()`)
- `bus.on('gateway:chunk', chunk.type === 'response_start')`: call `renderer.setStreamingActive(true)` (was: `streamingActive = true; resolveIcon()`)
- `bus.on('gateway:chunk', chunk.type === 'response_end')`: call `renderer.setStreamingActive(false)`, then after 500ms settle: `renderer.setPendingTurns(Math.max(0, --pendingTurns))` (was: same but with resolveIcon)
- `bus.on('gateway:chunk', chunk.type === 'error')`: same as response_end pattern
- `bus.on('gateway:chunk', chunk.type === 'transcript')`: no icon change needed (already was no-op for icon)

Keep the `pendingTurns` counter and `streamingActive`/`recordingActive` flags in display-controller for bookkeeping, but pass them through to the renderer immediately on each change.

The settle timer pattern stays the same (500ms delay before decrementing pendingTurns), but instead of calling `resolveIcon()` it calls `renderer.setPendingTurns(pendingTurns)`.

The `clearSettle()` on `recording-start` stays (prevents stale settle from decrementing during new recording).

**Update `display-controller.test.ts`:**

The mock renderer needs the three new methods instead of `setIconState`:
- `setRecordingActive: vi.fn()`
- `setPendingTurns: vi.fn()`
- `setStreamingActive: vi.fn()`

Update ALL existing tests to assert on the new methods instead of `setIconState`. For example:
- "audio:recording-start -> setRecordingActive(true)" instead of "setIconState('recording')"
- "audio:stop-requested -> setRecordingActive(false) + setPendingTurns(1)" instead of "setIconState('sent')"
- "response_end after 500ms settle -> setPendingTurns(0)" instead of "setIconState('idle')"

**Add NEW overlap tests (the core requirement):**

1. "recording + loading parallel: stop A, start B while A pending -> both setRecordingActive(true) and pendingTurns still > 0":
   - `emit('audio:stop-requested')` -> pendingTurns=1
   - `emit('audio:recording-start')` -> recordingActive=true
   - Assert: `setRecordingActive(true)` called AND `setPendingTurns` last called with value >= 1
   - This proves both conditions are active simultaneously (no single-winner priority)

2. "transcript A arrives during B recording -> loading(A) clears, recording(B) remains":
   - Stop A (pendingTurns=1), start B (recording=true)
   - `emit('gateway:chunk', { type: 'response_end' })`
   - After 500ms settle: `setPendingTurns(0)` called, `setRecordingActive` NOT called with false
   - Recording is independent of pending turn lifecycle

3. "multiple pending turns: second response_end clears last pending":
   - Stop A (pending=1), stop B (pending=2)
   - response_end + 500ms -> pending=1 (still shows loading)
   - response_end + 500ms -> pending=0 (loading gone)

Update the mock renderer interface to match the new `GlassesRenderer` interface (remove `setIconState`, add the three new methods).
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/display-controller.test.ts --reporter=verbose 2>&1 | tail -50</automated>
    <manual>After both tasks, run full test suite: npx vitest run --reporter=verbose</manual>
  </verify>
  <done>Display controller passes independent condition flags to renderer. Overlap tests prove recording and loading are visible simultaneously. All display-controller tests pass. Full test suite passes (npm run build clean).</done>
</task>

</tasks>

<verification>
1. `npx vitest run src/__tests__/icon-animator.test.ts` -- all pass
2. `npx vitest run src/__tests__/display-controller.test.ts` -- all pass including overlap scenarios
3. `npx vitest run` -- full suite passes (640+ tests, no regressions)
4. `npm run build` -- clean TypeScript compilation, no errors
5. Overlap scenario specifically tested: stop turn A -> start recording B -> A's response_end arrives -> recording indicator still visible AND loading dots cleared for A only
</verification>

<success_criteria>
- Recording indicator (blinking dot + timer) and loading dots render simultaneously in the status bar when both conditions are active
- Loading dots lifecycle is per-turn (pendingTurns counter), not global
- Recording indicator lifecycle is independent (recordingActive flag)
- No dead or duplicated state logic (old resolveIcon priority removed)
- All existing tests adapted to new interface and passing
- New overlap scenario tests proving parallel display
- Clean build (tsc + vite)
</success_criteria>

<output>
After completion, create `.planning/quick/38-decouple-loading-indicator-from-recordin/38-SUMMARY.md`
</output>
