---
phase: quick-30
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/glasses-main.ts
  - src/__tests__/glasses-main.test.ts
  - .planning/analysis/text-turn-sync-gap.md
autonomous: true
requirements: [QUICK-30]

must_haves:
  truths:
    - "Hub-originated text turn user messages appear on glasses display"
    - "Hub-originated text turn assistant responses stream on glasses display"
    - "Messages for a different conversation are silently ignored"
    - "Own-origin (glasses) sync messages are still ignored (no self-echo)"
  artifacts:
    - path: "src/glasses-main.ts"
      provides: "message:added, streaming:start, streaming:end sync bridge handlers"
      contains: "case 'message:added'"
    - path: "src/__tests__/glasses-main.test.ts"
      provides: "Tests for sync bridge text turn rendering"
      contains: "message:added"
    - path: ".planning/analysis/text-turn-sync-gap.md"
      provides: "Root cause documentation"
  key_links:
    - from: "src/glasses-main.ts (syncBridge.onMessage handler)"
      to: "renderer.addUserMessage / renderer.appendStreamChunk / renderer.startStreaming / renderer.endStreaming"
      via: "direct renderer calls in sync bridge case statements"
      pattern: "case 'message:added'.*renderer\\.(addUserMessage|appendStreamChunk)"
---

<objective>
Fix hub text turn messages not appearing on G2 glasses display.

Purpose: When users type text in the hub, the glasses display shows nothing because the sync bridge handler in glasses-main.ts only handles session events (session:switched, session:deleted, etc.) but ignores message:added, streaming:start, and streaming:end events. The hub already sends these events correctly. The glasses side just needs to handle them.

Output: Patched glasses-main.ts with sync bridge message handlers, tests proving the fix, root cause analysis document.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/glasses-main.ts
@src/hub-main.ts (lines 910-1066 for handleHubChunk + handleTextSubmit)
@src/sync/sync-types.ts
@src/__tests__/glasses-main.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add message:added, streaming:start, streaming:end handlers to glasses sync bridge</name>
  <files>src/glasses-main.ts</files>
  <action>
In the `syncBridge.onMessage` handler (around line 410), add three new cases BEFORE the existing `case 'session:created'` / `case 'session:renamed'` no-op cases. The handler already filters own-origin messages (`if (msg.origin === 'glasses') return;`), so these cases only trigger for hub-originated events.

Add these cases inside the existing switch statement:

```typescript
case 'message:added': {
  if (msg.conversationId === activeConversationId) {
    if (msg.role === 'user') {
      renderer.addUserMessage(msg.text);
    } else if (msg.role === 'assistant') {
      // Hub sends full assistant text at response_end (between streaming:start and streaming:end).
      // Use appendStreamChunk to display it -- endStreaming will finalize the bubble.
      renderer.appendStreamChunk(msg.text);
    }
  }
  break;
}
case 'streaming:start': {
  if (msg.conversationId === activeConversationId) {
    renderer.startStreaming();
    renderer.setIconState('thinking');
  }
  break;
}
case 'streaming:end': {
  if (msg.conversationId === activeConversationId) {
    renderer.endStreaming();
  }
  break;
}
```

IMPORTANT: Do NOT emit `gateway:chunk` events on the glasses bus. That would cause auto-save to double-save messages (hub already saved them to IDB). Use direct renderer calls instead -- this matches the existing pattern used for message restore (lines 308-316) and drift reconciliation (lines 373-387).

The hub event sequence for a text turn is:
1. `message:added` (role=user) -- immediately after user types
2. `streaming:start` -- on response_start chunk
3. `message:added` (role=assistant) -- on response_end, with full text
4. `streaming:end` -- immediately after assistant message:added

Glasses renders: addUserMessage -> startStreaming + thinking icon -> appendStreamChunk(full text) -> endStreaming
  </action>
  <verify>
    <automated>npx vitest run src/__tests__/glasses-main.test.ts --reporter=verbose 2>&1 | tail -20</automated>
    <manual>Review the switch cases to confirm: (1) conversationId guard prevents cross-session rendering, (2) no bus.emit('gateway:chunk') calls that would trigger auto-save, (3) renderer methods match the existing restore pattern</manual>
  </verify>
  <done>glasses-main.ts sync bridge handler processes message:added (user + assistant), streaming:start, and streaming:end from hub origin. Existing tests still pass.</done>
</task>

<task type="auto">
  <name>Task 2: Add tests for sync bridge text turn rendering in glasses-main</name>
  <files>src/__tests__/glasses-main.test.ts</files>
  <action>
Add a new describe block to the existing glasses-main.test.ts file: `describe('sync bridge text turn rendering', ...)`.

The existing test file mocks `createSyncBridge` implicitly (jsdom has no BroadcastChannel, so sync-bridge falls back to localStorage). To test sync message handling, we need to:

1. Add a mock for `../sync/sync-bridge` that captures the `onMessage` handler callback, allowing tests to simulate incoming sync messages:

```typescript
let syncMessageHandler: ((msg: any) => void) | null = null;
const mockSyncBridge = {
  postMessage: vi.fn(),
  onMessage: vi.fn((handler: (msg: any) => void) => {
    syncMessageHandler = handler;
    return vi.fn(); // unsubscribe
  }),
  destroy: vi.fn(),
};

vi.mock('../sync/sync-bridge', () => ({
  createSyncBridge: vi.fn(() => mockSyncBridge),
}));
```

Place this mock alongside the other vi.mock calls at the top of the file (before `import { boot }` line).

2. Add `syncMessageHandler = null;` and `mockSyncBridge.onMessage.mockClear(); mockSyncBridge.postMessage.mockClear();` to the `beforeEach` block.

3. Add the new describe block with these test cases:

- **"message:added (role=user, origin=hub) calls renderer.addUserMessage"**: Boot, then call `syncMessageHandler` with `{ type: 'message:added', origin: 'hub', conversationId: '<active-id>', role: 'user', text: 'Hello from hub' }`. Assert `mockRenderer.addUserMessage` was called with `'Hello from hub'`.

- **"streaming:start (origin=hub) calls renderer.startStreaming and setIconState"**: Boot, call syncMessageHandler with `{ type: 'streaming:start', origin: 'hub', conversationId: '<active-id>' }`. Assert `mockRenderer.startStreaming` called, `mockRenderer.setIconState` called with `'thinking'`.

- **"message:added (role=assistant, origin=hub) calls renderer.appendStreamChunk"**: Boot, call syncMessageHandler with `{ type: 'message:added', origin: 'hub', conversationId: '<active-id>', role: 'assistant', text: 'AI response' }`. Assert `mockRenderer.appendStreamChunk` called with `'AI response'`.

- **"streaming:end (origin=hub) calls renderer.endStreaming"**: Boot, call syncMessageHandler with `{ type: 'streaming:end', origin: 'hub', conversationId: '<active-id>' }`. Assert `mockRenderer.endStreaming` called.

- **"messages for different conversation are ignored"**: Boot, call syncMessageHandler with `{ type: 'message:added', origin: 'hub', conversationId: 'different-id', role: 'user', text: 'wrong session' }`. Assert `mockRenderer.addUserMessage` NOT called.

- **"own-origin (glasses) messages are ignored"**: Boot, call syncMessageHandler with `{ type: 'message:added', origin: 'glasses', conversationId: '<active-id>', role: 'user', text: 'echo' }`. Assert `mockRenderer.addUserMessage` NOT called.

NOTE: The activeConversationId comes from `restoreOrCreateConversation` which returns `{ conversationId: 'test-conv-id', ... }` (or whatever the mock returns). Check what `boot-restore` mock returns for the conversation ID -- it is likely mocked implicitly. If not mocked yet, add:

```typescript
vi.mock('../persistence/boot-restore', () => ({
  restoreOrCreateConversation: vi.fn().mockResolvedValue({
    conversationId: 'test-conv-id',
    restored: false,
    messages: [],
    storageAvailable: false,
  }),
  writeActiveConversationId: vi.fn(),
}));
```

Clear mockRenderer method mocks before each sync bridge test to isolate from boot-time calls (renderer methods may be called during boot for welcome message etc).
  </action>
  <verify>
    <automated>npx vitest run src/__tests__/glasses-main.test.ts --reporter=verbose 2>&1 | tail -30</automated>
  </verify>
  <done>6 new test cases pass: user message rendering, streaming start with icon, assistant message streaming, streaming end, conversation ID filtering, and own-origin filtering. All existing lifecycle tests still pass.</done>
</task>

<task type="auto">
  <name>Task 3: Document root cause analysis</name>
  <files>.planning/analysis/text-turn-sync-gap.md</files>
  <action>
Create a root cause analysis document at `.planning/analysis/text-turn-sync-gap.md` with:

1. **Bug**: Text turn messages from hub don't appear on G2 glasses display
2. **Root cause**: Dual-boot architecture creates separate event buses per context. Hub gateway chunks stay on hub-side bus. Glasses sync bridge handler only handled session events, not message/streaming events.
3. **Why it wasn't caught**: Voice turns work perfectly (same gateway client in glasses context). Text input is hub-only, and the sync bridge was originally designed for session management, not message relay.
4. **Fix**: Added `message:added`, `streaming:start`, `streaming:end` case handlers to glasses-main sync bridge handler. Uses direct renderer calls (not bus events) to avoid auto-save double-write.
5. **Architectural lesson**: In dual-boot single-page apps with separate event buses, the sync bridge must handle ALL cross-context data flows. New hub-side features that produce display content must have corresponding glasses-side sync handlers.
6. **Files changed**: `src/glasses-main.ts`, `src/__tests__/glasses-main.test.ts`
  </action>
  <verify>
    <automated>test -f .planning/analysis/text-turn-sync-gap.md && echo "OK"</automated>
  </verify>
  <done>Root cause analysis document exists with architectural context, fix rationale, and lesson learned.</done>
</task>

</tasks>

<verification>
- All existing tests pass: `npx vitest run --reporter=verbose`
- New sync bridge tests pass: `npx vitest run src/__tests__/glasses-main.test.ts --reporter=verbose`
- TypeScript compiles: `npx tsc --noEmit`
- No gateway:chunk emissions in sync handler (grep confirms no auto-save double-write risk)
</verification>

<success_criteria>
- Hub text turn user messages render on glasses display via sync bridge
- Hub text turn assistant responses stream on glasses display via sync bridge
- Messages for inactive conversations are silently ignored
- Own-origin messages are still ignored (no echo)
- Zero auto-save double-write risk (direct renderer calls only)
- 6 new passing tests covering the fix
- Root cause documented for future reference
</success_criteria>

<output>
After completion, create `.planning/quick/30-fix-sendtextturn-messages-not-showing-in/30-SUMMARY.md`
</output>
