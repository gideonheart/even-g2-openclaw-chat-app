---
phase: quick-31
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/display/glasses-renderer.ts
  - src/__tests__/glasses-renderer.test.ts
autonomous: true
requirements: [SCROLL-AUTO-BOTTOM]

must_haves:
  truths:
    - "When user speaks a new question after scrolling up, the display snaps to the bottom showing their message"
    - "Restored conversations display the most recent messages at the bottom"
    - "Scroll anchoring from quick-25 still works: endStreaming does NOT force-scroll when user manually scrolled up"
  artifacts:
    - path: "src/display/glasses-renderer.ts"
      provides: "addUserMessage always resets scroll to bottom"
      contains: "scrollOffset = 0"
    - path: "src/__tests__/glasses-renderer.test.ts"
      provides: "Tests for addUserMessage force-scroll behavior"
  key_links:
    - from: "src/display/glasses-renderer.ts"
      to: "addUserMessage"
      via: "autoScroll and scrollOffset always reset on new user message"
      pattern: "autoScroll.*=.*true"
---

<objective>
Fix glasses UI auto-scroll so that `addUserMessage` always scrolls to the bottom of the conversation, regardless of current scroll position.

Purpose: When the user speaks a new question after scrolling up to read older messages, the display should snap to the bottom to show their new message and the incoming response. Currently, if `autoScroll` is false (user scrolled up), `addUserMessage` silently adds the message without rendering or scrolling, leaving the user's own message invisible.

Output: Fixed `addUserMessage` in glasses-renderer.ts with updated and new tests.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/display/glasses-renderer.ts
@src/display/viewport.ts
@src/__tests__/glasses-renderer.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix addUserMessage to always scroll to bottom</name>
  <files>src/display/glasses-renderer.ts</files>
  <action>
In `addUserMessage()`, remove the `if (viewport.autoScroll)` guard so that adding a user message ALWAYS resets scroll to bottom and renders. The new logic:

```typescript
function addUserMessage(text: string): void {
    trimTurnBuffer();
    welcomeShown = true;
    const msg: ChatMessage = {
      id: `msg-${nextMsgId++}`,
      role: 'user',
      text,
      complete: true,
      timestamp: Date.now(),
    };
    viewport.messages.push(msg);

    // A new user message means a new turn was initiated (voice tap, hub text input,
    // or sync message). Always snap to bottom so the user sees their own message
    // and the upcoming response. This overrides manual scroll position intentionally --
    // the user actively started a new interaction.
    viewport.scrollOffset = 0;
    viewport.autoScroll = true;
    renderAndPush();
}
```

Update the `autoScroll` invariant comment block at the top of internal state to add a WRITE entry for addUserMessage:
```
//   WRITE: addUserMessage()    -> true + scrollOffset=0 (new turn snaps to bottom)
```

And update the READ entries to remove the old addUserMessage reference:
Remove: `//   READ:  addUserMessage()    -> gates scrollOffset=0 + render`

Do NOT change `endStreaming()` -- the conditional reset from quick-25 is correct for stream completion. Do NOT change `showError()` -- errors during scrolled-up state should stay non-intrusive.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/glasses-renderer.test.ts --reporter=verbose 2>&1 | tail -20</automated>
    <manual>Check that existing tests still pass (some may need updating in Task 2 if they relied on old gated behavior)</manual>
  </verify>
  <done>addUserMessage always resets scrollOffset=0, autoScroll=true, and calls renderAndPush regardless of prior scroll state</done>
</task>

<task type="auto">
  <name>Task 2: Add and update tests for addUserMessage force-scroll</name>
  <files>src/__tests__/glasses-renderer.test.ts</files>
  <action>
Add new tests and update any existing tests affected by the behavior change in the `scroll anchoring (bug fix: scroll jump)` describe block:

1. **New test: "addUserMessage snaps to bottom when user scrolled up"**
   - Add 3 messages, scrollUp twice (scrollOffset=2, autoScroll=false)
   - Call addUserMessage('New question')
   - Assert viewport state: scrollOffset=0, autoScroll=true
   - Assert the rendered text (last textContainerUpgrade call to containerID=2) contains 'New question'

2. **New test: "addUserMessage during scrolled-up state renders the new message"**
   - Add 3 messages, scrollUp once
   - Call addUserMessage('Visible')
   - Assert bridge.textContainerUpgrade was called with containerID=2
   - Assert the rendered text contains '> Visible'

3. **New test: "after addUserMessage snap, streaming response is visible (autoScroll re-enabled)"**
   - Add 2 messages, scrollUp (autoScroll=false)
   - addUserMessage('Question') -- should snap to bottom
   - startStreaming, appendStreamChunk('Answer'), advanceTimersByTime(200)
   - Assert rendered text contains 'Answer' (because autoScroll was re-enabled by addUserMessage)

4. **Update existing test "endStreaming preserves scroll position when user scrolled up"** if needed -- this test should still pass because it does NOT call addUserMessage after scrolling up; it only calls startStreaming/appendStreamChunk/endStreaming. Verify this test is unaffected.

5. **Update test "showError does not jump scroll when user scrolled up"** -- this should still pass unchanged since showError still has the conditional guard.

Run the full test suite to confirm no regressions.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run --reporter=verbose 2>&1 | tail -10</automated>
  </verify>
  <done>3 new tests pass covering addUserMessage force-scroll behavior, all 619+ tests pass with no regressions</done>
</task>

</tasks>

<verification>
- `npx tsc --noEmit` passes (no type errors)
- `npx vitest run` -- all tests pass (619+)
- `npx vite build` succeeds
</verification>

<success_criteria>
- addUserMessage always scrolls to bottom regardless of prior autoScroll state
- endStreaming still preserves scroll position when user manually scrolled up (quick-25 behavior preserved)
- All existing tests pass, 3 new tests added for force-scroll behavior
- Build and typecheck green
</success_criteria>

<output>
After completion, create `.planning/quick/31-fix-g2-glasses-ui-auto-scroll-to-start-a/31-SUMMARY.md`
</output>
