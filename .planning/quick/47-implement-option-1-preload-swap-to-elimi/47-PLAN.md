---
phase: quick-47
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - src/glasses-main.ts
  - src/__tests__/glasses-main.test.ts
autonomous: true
requirements: [QUICK-47]
must_haves:
  truths:
    - "Session switch shows new session messages with no blank frame between old and new content"
    - "sync:reconciled handler shows reconciled messages with no blank frame"
    - "Messages are fetched from IDB BEFORE renderer.destroy()/init() to eliminate async gap"
    - "Behavior is identical to current implementation (same messages displayed, same events emitted)"
  artifacts:
    - path: "src/glasses-main.ts"
      provides: "Preload+swap session switching (no blank flash)"
      contains: "store.getMessages.*before.*destroy"
    - path: "src/__tests__/glasses-main.test.ts"
      provides: "Regression tests for preload ordering and no-blank-window"
  key_links:
    - from: "src/glasses-main.ts switchToSession"
      to: "store.getMessages"
      via: "preload before destroy/init"
      pattern: "getMessages.*destroy.*init.*loadMessages"
---

<objective>
Eliminate the blank flash during session switching by preloading messages from IDB BEFORE calling renderer.destroy()/init(), then applying them immediately after init completes.

Purpose: Currently switchToSession and sync:reconciled both destroy+init the renderer (clearing the display), then asynchronously fetch messages from IDB, creating a visible blank gap. By fetching messages first, the display transitions directly from old content to new content with no blank window.

Output: Updated glasses-main.ts with preload+swap pattern, regression tests proving ordering and no-blank-window.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/46-research-chat-session-switching-scroll-b/46-SUMMARY.md
@src/glasses-main.ts
@src/__tests__/glasses-main.test.ts
@src/display/glasses-renderer.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Preload messages before destroy/init in switchToSession and sync:reconciled</name>
  <files>src/glasses-main.ts</files>
  <action>
Refactor `switchToSession` (lines 375-391) to preload messages BEFORE destroy/init:

```typescript
async function switchToSession(sessionId: string): Promise<void> {
  const previousId = activeConversationId;
  activeConversationId = sessionId;
  writeActiveConversationId(sessionId);

  // Preload messages BEFORE destroy/init to eliminate blank flash.
  // The async IDB read happens while old content is still visible.
  const preloaded = store
    ? (await store.getMessages(sessionId)).map(m => ({ role: m.role, text: m.text }))
    : [];

  // Now destroy+init (clears display) and immediately load preloaded messages
  renderer.destroy();
  await renderer.init();

  if (preloaded.length > 0) {
    renderer.loadMessages(preloaded);
  }

  bus.emit('session:switched', { id: sessionId, previousId });
}
```

Apply same preload pattern to `sync:reconciled` handler (lines 394-401):

```typescript
bus.on('sync:reconciled', async ({ conversationId }) => {
  if (conversationId === activeConversationId && store) {
    // Preload before destroy/init (same pattern as switchToSession)
    const preloaded = (await store.getMessages(conversationId)).map(m => ({ role: m.role, text: m.text }));
    renderer.destroy();
    await renderer.init();
    renderer.loadMessages(preloaded);
  }
});
```

Key invariant: `store.getMessages()` must complete BEFORE `renderer.destroy()` is called. This ensures old content stays visible during the IDB read.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx tsc --noEmit 2>&1 | head -20</automated>
    <manual>Review that getMessages call precedes destroy() call in both locations</manual>
  </verify>
  <done>switchToSession and sync:reconciled both preload messages before destroy/init. No async gap between display clear and message load.</done>
</task>

<task type="auto">
  <name>Task 2: Add regression tests for preload ordering and no-blank-window</name>
  <files>src/__tests__/glasses-main.test.ts</files>
  <action>
Add `loadMessages` to the mockRenderer object (it is currently missing):
```typescript
loadMessages: vi.fn(),
```

Also add `getViewportState` if missing:
```typescript
getViewportState: vi.fn().mockReturnValue({ messages: [], scrollOffset: 0, autoScroll: true }),
```

Create a new `describe('session switching preload+swap')` block. Use the mock infrastructure from the existing "sync bridge text turn rendering" describe block (dev mode, same beforeEach pattern).

Need to set up a mock store to make the persistence path activate. The current boot-restore mock returns `storageAvailable: false`, which means `store` is null. For these tests, mock `isIndexedDBAvailable` to return true and `openDB` to return a mock DB, and create mock `store.getMessages` that returns test messages.

Alternative simpler approach: Since the test file already has syncMessageHandler captured, test via the sync bridge `session:switched` message path. But store is null without IDB mocks.

Simplest viable approach: Add IDB/store mocks to a new describe block:

1. Mock `isIndexedDBAvailable` to return `true` in the new describe block
2. Mock `openDB` to return a fake DB object
3. Mock `createConversationStore` to return a store with `getMessages` that returns test messages
4. Mock `createSessionStore` to return a session store
5. Mock `createIntegrityChecker` to return a checker with `check()` returning clean report and `writeSentinel()` resolving
6. Mock `createStorageHealth` to return health with `getQuota()` returning safe values
7. Mock `restoreOrCreateConversation` to return `storageAvailable: true`

Tests to add:

**Test A: "switchToSession preloads messages before destroy/init"**
- Boot, capture syncMessageHandler
- Send `session:switched` sync message with a new sessionId
- Assert: `mockStore.getMessages` called with new sessionId
- Assert: `mockRenderer.destroy` called AFTER getMessages resolved
- Assert: `mockRenderer.init` called AFTER destroy
- Assert: `mockRenderer.loadMessages` called with the preloaded messages
- Use mock call ordering: `mockStore.getMessages.mock.invocationCallOrder[0] < mockRenderer.destroy.mock.invocationCallOrder[0]`

**Test B: "switchToSession with no messages does not call loadMessages"**
- Boot, set mockStore.getMessages to return empty array
- Send `session:switched` sync message
- Assert: `mockRenderer.loadMessages` NOT called (preloaded.length === 0)

**Test C: "sync:reconciled preloads messages before destroy/init"**
- Boot, find `bus.on('sync:reconciled')` callback
- Invoke it with activeConversationId
- Assert same ordering as Test A: getMessages before destroy before init before loadMessages

Run all tests:
```bash
npx vitest --run src/__tests__/glasses-main.test.ts
```

Ensure all 19 existing tests + new tests pass. Also run full suite:
```bash
npx vitest --run
```
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest --run src/__tests__/glasses-main.test.ts 2>&1 | tail -15</automated>
  </verify>
  <done>3+ new regression tests verify preload ordering (getMessages before destroy) and no-blank-window invariant. All existing tests still pass.</done>
</task>

</tasks>

<verification>
- `npx tsc --noEmit` passes with zero errors
- `npx vitest --run` passes all tests (681 existing + new)
- `npx vite build` succeeds
- In switchToSession: store.getMessages() call appears BEFORE renderer.destroy()
- In sync:reconciled: store.getMessages() call appears BEFORE renderer.destroy()
</verification>

<success_criteria>
- Zero blank frames during session switching (preload happens while old content visible)
- All existing behavior preserved (same messages displayed, same events emitted)
- Regression tests prove call ordering: getMessages -> destroy -> init -> loadMessages
- typecheck, build, and full test suite pass
</success_criteria>

<output>
After completion, create `.planning/quick/47-implement-option-1-preload-swap-to-elimi/47-SUMMARY.md`
</output>
