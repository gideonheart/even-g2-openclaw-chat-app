---
phase: quick-36
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/display/icon-bitmaps.ts
  - src/__tests__/icon-animator.test.ts
autonomous: true
requirements: [QUICK-36]

must_haves:
  truths:
    - "Sent state shows animated loading dots instead of static checkmark"
    - "Dots cycle through frames at 200ms interval (existing animator cadence)"
    - "All existing icon-animator and display-controller tests still pass"
  artifacts:
    - path: "src/display/icon-bitmaps.ts"
      provides: "Multi-frame animated dot sequence for sent state"
      contains: "sent:"
    - path: "src/__tests__/icon-animator.test.ts"
      provides: "Test verifying sent state cycles through multiple frames"
      contains: "sent.*cycles"
  key_links:
    - from: "src/display/icon-bitmaps.ts"
      to: "src/display/icon-animator.ts"
      via: "ICON_FRAMES[currentState] lookup in tick()"
      pattern: "ICON_FRAMES\\[currentState\\]"
---

<objective>
Replace the static checkmark icon in the `sent` state with animated loading dots.

Purpose: The `sent` state occurs between when the user stops recording and when the gateway starts responding. A static checkmark gives no visual feedback that processing is happening. Animated dots (`. -> .. -> ...`) provide clear "waiting for response" feedback on the glasses display.

Output: Updated icon frames + test confirming multi-frame cycling for sent state.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/display/icon-bitmaps.ts
@src/display/icon-animator.ts
@src/__tests__/icon-animator.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Replace sent icon frames with animated loading dots and add cycling test</name>
  <files>src/display/icon-bitmaps.ts, src/__tests__/icon-animator.test.ts</files>
  <action>
In `src/display/icon-bitmaps.ts`, replace the `sent` entry:

FROM: `sent: ['\u2713'],  // checkmark`
TO:   `sent: ['.', '..', '...'],  // loading dots`

Use plain ASCII dots -- they render reliably on the Even G2 glasses text container and are visually distinct from the braille spinner used for `thinking`. Three frames at the existing 200ms tick rate gives a 600ms cycle, which is a natural "processing" cadence.

In `src/__tests__/icon-animator.test.ts`, add a new test in the main describe block (after the "cycles through all frames of a multi-frame state" test):

```typescript
it('sent state cycles through loading dot frames', async () => {
  const updateFn = vi.fn(() => Promise.resolve());
  const animator = createIconAnimator(updateFn);

  animator.setState('sent');
  expect(updateFn).toHaveBeenLastCalledWith(ICON_FRAMES.sent[0]); // '.'

  animator.start();

  await vi.advanceTimersByTimeAsync(200);
  expect(updateFn).toHaveBeenLastCalledWith(ICON_FRAMES.sent[1]); // '..'

  await vi.advanceTimersByTimeAsync(200);
  expect(updateFn).toHaveBeenLastCalledWith(ICON_FRAMES.sent[2]); // '...'

  // Wraps back to frame 0
  await vi.advanceTimersByTimeAsync(200);
  expect(updateFn).toHaveBeenLastCalledWith(ICON_FRAMES.sent[0]); // '.'

  animator.stop();
});
```

Verify that the existing test "timer resets when switching away from recording" (line ~221) still works -- it asserts `ICON_FRAMES.sent[0]` which will now be `'.'` instead of `'\u2713'`. Since it references `ICON_FRAMES.sent[0]` (not the literal checkmark), it auto-adapts.
  </action>
  <verify>
    <automated>npx vitest run src/__tests__/icon-animator.test.ts src/__tests__/display-controller.test.ts --reporter=verbose 2>&1 | tail -40</automated>
    <manual>Confirm sent frames are ['.', '..', '...'] in icon-bitmaps.ts</manual>
  </verify>
  <done>sent state shows 3-frame animated loading dots instead of static checkmark; all 15+ existing tests pass plus new cycling test passes; display-controller tests unaffected</done>
</task>

</tasks>

<verification>
- `npx vitest run` -- all 639+ tests pass (no regressions)
- `ICON_FRAMES.sent` contains 3 frames: `['.', '..', '...']`
- No references to `\u2713` (checkmark) remain in icon-bitmaps.ts
</verification>

<success_criteria>
- The `sent` icon state displays animated loading dots (`.` -> `..` -> `...`) cycling at 200ms
- All existing icon-animator and display-controller tests pass without modification
- New test verifies sent state frame cycling and wrap-around
</success_criteria>

<output>
After completion, create `.planning/quick/36-replace-stop-icon-with-animated-loading-/36-SUMMARY.md`
</output>
