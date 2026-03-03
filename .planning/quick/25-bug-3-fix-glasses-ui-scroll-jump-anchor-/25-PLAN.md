---
phase: quick-25
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/display/glasses-renderer.ts
  - src/__tests__/glasses-renderer.test.ts
  - src/__tests__/viewport.test.ts
autonomous: true
requirements: [SCROLL-ANCHOR-FIX]

must_haves:
  truths:
    - "Scroll position stays where user placed it across response end, new streaming, and error events"
    - "Auto-scroll to bottom works by default when user has NOT manually scrolled"
    - "User scrolling down to offset=0 re-enables auto-scroll"
    - "All existing viewport and renderer tests still pass"
  artifacts:
    - path: "src/display/glasses-renderer.ts"
      provides: "Fixed endStreaming that respects manual scroll position"
      contains: "autoScroll"
    - path: "src/__tests__/glasses-renderer.test.ts"
      provides: "Regression tests for scroll anchoring across update cycles"
    - path: "src/__tests__/viewport.test.ts"
      provides: "Additional viewport tests for auto-scroll preservation"
  key_links:
    - from: "src/display/glasses-renderer.ts endStreaming()"
      to: "viewport.autoScroll"
      via: "conditional reset instead of unconditional"
      pattern: "autoScroll"
---

<objective>
Fix glasses UI scroll-jump-to-top bug: when user has manually scrolled up in the glasses chat display, endStreaming() unconditionally resets autoScroll=true, causing the next render cycle to jump scroll position back to bottom (offset=0).

Purpose: Ensure bottom-anchored scrolling is the default, but manual scroll position is preserved across response completions, new streaming starts, and error events -- the user should only return to bottom when they explicitly scroll down to offset=0.

Output: Patched glasses-renderer.ts with conditional autoScroll reset + regression tests proving scroll stability across repeated update cycles.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/display/viewport.ts
@src/display/glasses-renderer.ts
@src/display/display-controller.ts
@src/__tests__/viewport.test.ts
@src/__tests__/glasses-renderer.test.ts
@src/__tests__/display-controller.test.ts
</context>

<root_cause>
In `glasses-renderer.ts`, the `endStreaming()` function (line 240) unconditionally sets `viewport.autoScroll = true` regardless of whether the user had manually scrolled away from the bottom. This means:

1. User scrolls up (autoScroll becomes false, scrollOffset > 0)
2. Assistant response finishes streaming -> endStreaming() fires
3. endStreaming() sets autoScroll = true (WRONG - ignores user's scroll position)
4. Next render event (new message, flush, error) finds autoScroll=true -> resets scrollOffset to 0 -> scroll jumps to bottom

The fix: endStreaming() should NOT reset autoScroll when the user has a non-zero scrollOffset (indicating manual scroll). Only when scrollOffset is already 0 (user is at bottom) should autoScroll remain/become true.
</root_cause>

<tasks>

<task type="auto">
  <name>Task 1: Fix endStreaming autoScroll reset to respect manual scroll position</name>
  <files>src/display/glasses-renderer.ts</files>
  <action>
In `glasses-renderer.ts`, modify the `endStreaming()` function:

**Current code (line 239-240):**
```ts
// Reset auto-scroll at end of turn (per user decision)
viewport.autoScroll = true;
```

**Replace with:**
```ts
// Only reset auto-scroll if user is already at the bottom (scrollOffset === 0).
// If user manually scrolled up (scrollOffset > 0), preserve their position --
// they will re-enable auto-scroll by scrolling back down to offset 0.
if (viewport.scrollOffset === 0) {
  viewport.autoScroll = true;
}
```

This preserves the existing behavior for users who haven't scrolled (scrollOffset=0, autoScroll was already true or gets set to true). For users who scrolled up, their scroll position and autoScroll=false are preserved across turn boundaries.

No other files need changes -- the viewport.ts pure functions already handle autoScroll correctly (scrollDown sets autoScroll=true when reaching offset 0), and all other render paths in glasses-renderer.ts already check `if (viewport.autoScroll)` before resetting scrollOffset.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/glasses-renderer.test.ts src/__tests__/viewport.test.ts src/__tests__/display-controller.test.ts --reporter=verbose 2>&1 | tail -30</automated>
    <manual>Verify endStreaming only resets autoScroll when scrollOffset === 0</manual>
  </verify>
  <done>endStreaming() conditionally resets autoScroll -- only when scrollOffset===0 (user at bottom). Manual scroll position preserved across turn ends.</done>
</task>

<task type="auto">
  <name>Task 2: Add regression tests for scroll anchoring across update cycles</name>
  <files>src/__tests__/glasses-renderer.test.ts, src/__tests__/viewport.test.ts</files>
  <action>
**In `src/__tests__/glasses-renderer.test.ts`**, add a new describe block `'scroll anchoring (bug fix: scroll jump)'` with these tests:

1. **"endStreaming preserves scroll position when user scrolled up"**
   - renderer.init(), add 3 user messages, scrollUp twice (scrollOffset=2, autoScroll=false)
   - startStreaming, appendStreamChunk, endStreaming
   - Verify: the last textContainerUpgrade call to containerID=2 does NOT contain the newest message text (because scrollOffset is preserved above 0)
   - Start another stream cycle: startStreaming, appendStreamChunk('new chunk'), advance 200ms
   - Verify: the rendered text still does NOT jump to include the newest content (scrollOffset preserved)

2. **"endStreaming resets autoScroll when user is at bottom (scrollOffset=0)"**
   - renderer.init(), add 1 user message (at bottom, scrollOffset=0)
   - startStreaming, appendStreamChunk, endStreaming
   - Start new cycle: startStreaming, appendStreamChunk('next response'), advance 200ms
   - Verify: textContainerUpgrade IS called (auto-scroll active, rendering happens)

3. **"scroll position survives multiple rapid response cycles"**
   - renderer.init(), add 3 messages, scrollUp once
   - Run 5 cycles of: startStreaming, appendStreamChunk, advance 200ms, endStreaming
   - Verify after all 5 cycles: the scrollOffset-based viewport still does not show the latest messages (no jump back to bottom)

4. **"scrolling back to bottom re-enables auto-scroll after preserved scroll"**
   - renderer.init(), add 2 messages, scrollUp (autoScroll=false)
   - endStreaming (from a previous stream -- autoScroll should stay false)
   - scrollDown to offset=0 (autoScroll becomes true)
   - startStreaming, appendStreamChunk, advance 200ms
   - Verify: auto-scroll is active again -- new content IS rendered

5. **"showError does not jump scroll when user scrolled up"**
   - renderer.init(), add 3 messages, scrollUp twice
   - renderer.showError('test error')
   - Verify: textContainerUpgrade call does NOT show the error at the bottom (user is scrolled up, autoScroll is false, so error is added to messages but viewport shows older messages based on scrollOffset position)

   NOTE: Looking at the showError implementation -- it adds the error to messages and only sets scrollOffset=0 when autoScroll is true. Since autoScroll is false (user scrolled up), scrollOffset stays non-zero. The viewport renders based on the preserved scrollOffset, so the error message (which is at the end) will NOT be in the visible viewport window. This is correct behavior -- the error is in the message history and user will see it when they scroll down.

**In `src/__tests__/viewport.test.ts`**, add:

6. **"renderViewport with autoScroll=false and scrollOffset>0 shows older messages after new messages added"**
   - Create 5 messages, set scrollOffset=2, autoScroll=false
   - renderViewport should show messages up to index 3 (length 5 - offset 2 = endIdx 3)
   - Add a 6th message to the array, keep scrollOffset=2
   - renderViewport should show messages up to index 4 (length 6 - offset 2 = endIdx 4) -- the new message is NOT visible because scrollOffset pushes the window up

All tests should use the existing test helper patterns (msg(), state() helpers, vi.fn mocks, fake timers).
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/glasses-renderer.test.ts src/__tests__/viewport.test.ts --reporter=verbose 2>&1 | tail -50</automated>
  </verify>
  <done>At least 5 new regression tests pass covering: preserved scroll across endStreaming, preserved scroll across multiple cycles, re-enable auto-scroll on scroll-to-bottom, error does not jump scroll, viewport renders correctly with scrollOffset during message additions.</done>
</task>

<task type="auto">
  <name>Task 3: Run full build, typecheck, and test suite</name>
  <files></files>
  <action>
Run all verification commands in sequence:
1. `npm run typecheck` -- ensure no type errors from the change
2. `npm run build` -- ensure production build succeeds
3. `npx vitest run` -- ensure ALL 606+ tests pass (not just the changed test files)

If any failures, fix them before marking complete. Document the changed files list and test counts in the summary.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npm run typecheck && npm run build && npx vitest run 2>&1 | tail -20</automated>
  </verify>
  <done>typecheck passes, build succeeds, all tests pass (606+ including new regression tests). No regressions introduced.</done>
</task>

</tasks>

<verification>
- `npm run typecheck` passes with no errors
- `npm run build` completes successfully
- `npx vitest run` passes all tests including new regression tests
- The endStreaming() fix is a 3-line change (conditional instead of unconditional autoScroll reset)
- New tests specifically cover the reported bug scenario (scroll up -> response ends -> scroll stays)
</verification>

<success_criteria>
1. The one-line root cause (unconditional `viewport.autoScroll = true` in endStreaming) is fixed with a conditional check
2. At least 5 new regression tests cover scroll anchoring across response cycles, error events, and re-enable scenarios
3. All existing tests pass unchanged (the only existing test that references endStreaming+autoScroll -- "endStreaming resets auto-scroll to true" -- may need a minor update since that test starts at scrollOffset=0 which is the default, so the conditional still fires)
4. Full build + typecheck + test suite green
</success_criteria>

<output>
After completion, create `.planning/quick/25-bug-3-fix-glasses-ui-scroll-jump-anchor-/25-SUMMARY.md`
</output>
