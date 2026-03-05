---
phase: quick-46
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - src/display/glasses-renderer.ts
  - src/glasses-main.ts
autonomous: true
requirements: [QUICK-46]

must_haves:
  truths:
    - "Session switching does not visibly scroll through all messages on glasses display"
    - "Only the final viewport state is pushed to the SDK when restoring/switching sessions"
    - "Boot restore, switchToSession, and sync:reconciled all use batch loading"
  artifacts:
    - path: "src/display/glasses-renderer.ts"
      provides: "Batch message loading method"
      contains: "loadMessages"
    - path: "src/glasses-main.ts"
      provides: "Updated switchToSession/restore using batch load"
      contains: "loadMessages"
  key_links:
    - from: "src/glasses-main.ts"
      to: "src/display/glasses-renderer.ts"
      via: "renderer.loadMessages(messages) replaces per-message loop"
      pattern: "renderer\\.loadMessages"
---

<objective>
Fix the visible scroll-through flash when switching chat sessions on G2 glasses.

Purpose: When switching sessions, all messages are loaded one-by-one via addUserMessage/startStreaming/appendStreamChunk/endStreaming, each triggering renderAndPush() to the SDK. This causes a visible scroll-through of every message until reaching the bottom. The fix adds a batch loading method that populates viewport state without intermediate renders, then pushes a single final render.

Output: Updated glasses-renderer.ts with loadMessages() batch method, updated glasses-main.ts switchToSession/boot-restore/sync-reconciled to use it.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/display/glasses-renderer.ts
@src/display/viewport.ts
@src/glasses-main.ts
@src/persistence/boot-restore.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add loadMessages batch method to GlassesRenderer</name>
  <files>src/display/glasses-renderer.ts</files>
  <action>
Add a `loadMessages(messages: Array<{ role: 'user' | 'assistant'; text: string }>): void` method to the GlassesRenderer interface and implementation.

Implementation:
1. Clear viewport state (messages array, scrollOffset=0, autoScroll=true) -- same as destroy() does for viewport, but WITHOUT stopping icon animator or resetting hidden/welcomeShown.
2. Iterate through the input messages array and build ChatMessage objects in memory, adding them to `viewport.messages` directly. For each message:
   - Create a ChatMessage with incrementing nextMsgId, the role, text, complete=true, and Date.now() timestamp.
   - Push to viewport.messages array.
3. Apply trimTurnBuffer() once after all messages are loaded (not per-message).
4. Call renderAndPush() exactly ONCE at the end.
5. Set welcomeShown=true (messages exist, no welcome needed).

This is the critical difference from the current per-message approach: NO intermediate renderAndPush() calls during loading. The glasses SDK only receives one textContainerUpgrade call with the final viewport state.

Do NOT call startStreaming/endStreaming/addUserMessage -- those each trigger renderAndPush(). Build the viewport state directly.
  </action>
  <verify>
    <automated>npx vitest run src/__tests__/glasses-renderer.test.ts --reporter=verbose 2>&1 | tail -5</automated>
    <manual>Verify loadMessages method exists on GlassesRenderer interface</manual>
  </verify>
  <done>GlassesRenderer has loadMessages() that populates viewport from message array with a single render push</done>
</task>

<task type="auto">
  <name>Task 2: Replace per-message loops with batch loadMessages in glasses-main.ts</name>
  <files>src/glasses-main.ts</files>
  <action>
Replace all three per-message loading loops in glasses-main.ts with the new renderer.loadMessages() call:

1. **switchToSession** (around line 392-403): Replace the `for (const msg of messages)` loop with:
   ```ts
   renderer.loadMessages(messages.map(m => ({ role: m.role, text: m.text })));
   ```
   Keep the renderer.destroy() + renderer.init() calls before it (they reset the display layout).

2. **sync:reconciled handler** (around line 413-424): Same replacement -- replace the for loop with renderer.loadMessages().

3. **Boot restore** (around line 345-358): Replace the for loop with renderer.loadMessages(). Keep the `if (restoreResult.restored && restoreResult.messages.length > 0)` guard. Keep the bus.emit('persistence:restored') after.

All three sites follow the same pattern:
- Before: `for (const msg of messages) { if user -> addUserMessage; else -> startStreaming+append+endStreaming }`
- After: `renderer.loadMessages(messages.map(m => ({ role: m.role, text: m.text })))`

The renderer.destroy() + renderer.init() calls before each site should remain -- they reset the page container layout. Only the message loading loop changes.
  </action>
  <verify>
    <automated>npx vitest run src/__tests__/glasses-main.test.ts --reporter=verbose 2>&1 | tail -10</automated>
    <manual>Search for the old pattern (addUserMessage in a for loop with getMessages) to confirm all three sites are updated</manual>
  </verify>
  <done>All three message-loading sites in glasses-main.ts use renderer.loadMessages() for single-render batch loading</done>
</task>

<task type="auto">
  <name>Task 3: Add test for loadMessages batch rendering</name>
  <files>src/__tests__/glasses-renderer.test.ts</files>
  <action>
Add a test group "loadMessages batch loading" with these tests:

1. "loads messages with single render push": Create renderer, init, call loadMessages with 5 messages (mix of user/assistant). Assert bridge.textContainerUpgrade was called for container 2 exactly ONCE after loadMessages (not 5+ times). Use mock bridge to count calls.

2. "replaces existing messages on loadMessages": Add a user message via addUserMessage, then call loadMessages with different messages. Assert viewport only contains the loadMessages content (getViewportState().messages.length equals the loaded count).

3. "handles empty message array": Call loadMessages([]). Assert no bridge.textContainerUpgrade call for container 2 (empty viewport renders empty string, which is still a valid single push -- either 0 or 1 call is acceptable).

4. "trims to MAX_TURNS after batch load": Call loadMessages with 20 messages. Assert viewport.messages.length <= MAX_TURNS * 2.

Use the existing test patterns from the file -- createGlassesRenderer with a mock bridge and bus.
  </action>
  <verify>
    <automated>npx vitest run src/__tests__/glasses-renderer.test.ts --reporter=verbose 2>&1 | tail -15</automated>
  </verify>
  <done>loadMessages has 4 test cases covering single-render, replacement, empty, and trim behavior</done>
</task>

</tasks>

<verification>
All tests pass: `npx vitest run src/__tests__/glasses-renderer.test.ts src/__tests__/glasses-main.test.ts`
No regressions in full suite: `npx vitest run`
</verification>

<success_criteria>
- loadMessages() method exists on GlassesRenderer interface and implementation
- All three per-message loading loops in glasses-main.ts replaced with loadMessages()
- Bridge textContainerUpgrade for container 2 called exactly once per loadMessages invocation (not N times for N messages)
- All existing tests continue to pass
- 4 new tests for loadMessages behavior pass
</success_criteria>

<output>
After completion, create `.planning/quick/46-research-chat-session-switching-scroll-b/46-SUMMARY.md`
</output>
