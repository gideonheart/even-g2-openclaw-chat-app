---
phase: quick-48
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - src/__tests__/glasses-main.test.ts
  - src/__tests__/gateway-client.test.ts
  - src/api/gateway-client.ts
autonomous: true
requirements: [QUICK-48]
must_haves:
  truths:
    - "glasses-main.test.ts passes all 19+ tests (broken uncommitted mock fixed)"
    - "SSE parser has test coverage for happy path, chunked delivery, malformed JSON, null body guard, and abort"
    - "response.body null case is handled gracefully instead of throwing via non-null assertion"
  artifacts:
    - path: "src/__tests__/glasses-main.test.ts"
      provides: "Fixed vi.mock hoisting for persistence/db mocks"
    - path: "src/__tests__/gateway-client.test.ts"
      provides: "SSE streaming tests for parseServerSentEventsFromResponse"
    - path: "src/api/gateway-client.ts"
      provides: "Null-body guard in parseServerSentEventsFromResponse"
  key_links:
    - from: "src/__tests__/gateway-client.test.ts"
      to: "src/api/gateway-client.ts"
      via: "SSE mock response with ReadableStream body"
      pattern: "text/event-stream"
---

<objective>
Fix broken glasses-main test (uncommitted vi.mock hoisting error), add SSE parser test coverage, and harden response.body null guard.

Purpose: The 5 most recent commits introduced a broken test file in the working tree (quick-47 leftover), shipped ~90 lines of untested SSE parsing code (quick-1), and used a non-null assertion on response.body that can crash at runtime. This plan fixes the blocker test failure, adds SSE test coverage, and hardens the null-body edge case.

Output: All glasses-main tests pass again, SSE parser has 5+ tests, response.body null is handled gracefully.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/api/gateway-client.ts
@src/__tests__/gateway-client.test.ts
@src/__tests__/glasses-main.test.ts
@src/display/glasses-renderer.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix broken glasses-main test vi.mock hoisting and add response.body null guard</name>
  <files>src/__tests__/glasses-main.test.ts, src/api/gateway-client.ts</files>
  <action>
**Part A: Fix glasses-main.test.ts vi.mock hoisting error**

The working tree has uncommitted changes from quick-47 that break ALL glasses-main tests. The issue: `vi.mock('../persistence/db', () => ({ isIndexedDBAvailable: mockIsIndexedDBAvailable, ... }))` references `const mockIsIndexedDBAvailable` -- but Vitest hoists vi.mock to the top of the file, so the const isn't initialized yet, causing `ReferenceError: Cannot access 'mockIsIndexedDBAvailable' before initialization`.

Fix using `vi.hoisted()` to declare the mock variables in hoisted scope. The pattern:

```typescript
const { mockIsIndexedDBAvailable, mockOpenDB, mockSetOnUnexpectedClose, mockReopenDB } = vi.hoisted(() => ({
  mockIsIndexedDBAvailable: vi.fn().mockReturnValue(false),
  mockOpenDB: vi.fn(),
  mockSetOnUnexpectedClose: vi.fn(),
  mockReopenDB: vi.fn(),
}));
```

Similarly, any other mock variables referenced inside vi.mock factories that were added in the uncommitted diff need the same `vi.hoisted()` treatment: `mockRestoreOrCreateConversation`, `mockStore`, `mockSessionStore`.

For mockStore and mockSessionStore, they are plain objects with vi.fn() methods. These also need vi.hoisted():

```typescript
const { mockStore } = vi.hoisted(() => ({
  mockStore: {
    getMessages: vi.fn().mockResolvedValue([]),
    addMessage: vi.fn(),
    getConversation: vi.fn(),
    createConversation: vi.fn(),
    updateConversation: vi.fn(),
    countMessages: vi.fn().mockResolvedValue(0),
  },
}));
```

Same for `mockSessionStore` and `mockRestoreOrCreateConversation`.

After fixing, the mockRenderer also needs `loadMessages: vi.fn()` added to it (already present in working tree, keep it).

Do NOT also add `getViewportState` to mockRenderer -- it is not called by glasses-main.ts.

**Part B: Add response.body null guard in gateway-client.ts**

In `parseServerSentEventsFromResponse` (line 214), replace the non-null assertion:
```typescript
const reader = response.body!.getReader();
```

With a null guard that throws a meaningful error:
```typescript
if (!response.body) {
  emitChunkCallback({ type: 'error', error: 'SSE response has no body' });
  return;
}
const reader = response.body.getReader();
```

This uses the emitChunkCallback pattern (same as other error paths in the gateway client) to surface the error to the UI rather than crashing with an unhandled TypeError.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest --run src/__tests__/glasses-main.test.ts 2>&1 | tail -10</automated>
    <manual>Verify all 19+ glasses-main tests pass, no ReferenceError in output</manual>
  </verify>
  <done>All glasses-main tests pass (19+ including any new ones from the uncommitted quick-47 work). response.body null case emits an error chunk instead of crashing.</done>
</task>

<task type="auto">
  <name>Task 2: Add SSE parser test coverage for gateway-client</name>
  <files>src/__tests__/gateway-client.test.ts</files>
  <action>
Add a new `describe('sendVoiceTurn SSE streaming')` block inside the existing `describe('sendVoiceTurn')` section. These tests exercise the SSE path that was added in commit d7c08d1 but has zero test coverage.

To mock an SSE response, create a helper that builds a mock Response with a ReadableStream body:

```typescript
function createSSEResponse(events: string): Partial<Response> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(events));
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body: stream as ReadableStream<Uint8Array>,
  };
}
```

For chunked delivery tests, use a stream that enqueues multiple small chunks with a microtask delay between them.

**Tests to add (5 minimum):**

1. **"SSE: full voice turn emits transcript + response_start + delta + done"**
   - SSE body:
     ```
     event: transcript\ndata: {"transcript":"Hello","turnId":"t1"}\n\nevent: assistant_delta\ndata: {"text":"Hi ","turnId":"t1"}\n\nevent: assistant_delta\ndata: {"text":"there","turnId":"t1"}\n\nevent: done\ndata: {"turnId":"t1"}\n\n
     ```
   - Assert chunks: transcript, response_start (first delta triggers it), response_delta("Hi "), response_delta("there"), response_end
   - Assert: 5 total chunks

2. **"SSE: response_start emitted only once (before first assistant_delta)"**
   - SSE body with 3 assistant_delta events
   - Assert: exactly 1 response_start chunk, 3 response_delta chunks

3. **"SSE: malformed JSON in data line is silently skipped"**
   - SSE body with one valid event, one `data: {invalid json}`, one valid event
   - Assert: only the two valid events emit chunks, no error emitted for malformed JSON

4. **"SSE: event split across multiple stream chunks is reassembled"**
   - Use a ReadableStream that delivers the SSE in two chunks, splitting mid-event (e.g., first chunk ends with `event: trans` and second starts with `cript\ndata: ...`)
   - Assert: the split event is correctly parsed and emits the right chunk

5. **"SSE: null response body emits error chunk"** (validates Part B of Task 1)
   - Mock fetch to return `{ ok: true, headers: { 'content-type': 'text/event-stream' }, body: null }`
   - Assert: exactly 1 error chunk with message containing "no body"

6. **"SSE: error event emits error chunk"**
   - SSE body with `event: error\ndata: {"error":"STT failed"}\n\n`
   - Assert: 1 error chunk with error "STT failed"

Each test should use `globalThis.fetch = vi.fn().mockResolvedValue(...)` with the SSE response mock, then call `client.sendVoiceTurn(testSettings, testRequest)` and collect chunks via `client.onChunk`.

Note: The existing test infrastructure already does beforeEach/afterEach save/restore of globalThis.fetch -- use the same pattern. Place the new describe block after the existing "transcript-first rendering guarantee" describe block.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest --run src/__tests__/gateway-client.test.ts 2>&1 | tail -10</automated>
    <manual>Verify 6+ new SSE tests pass alongside all existing gateway-client tests</manual>
  </verify>
  <done>SSE parser has 6 tests covering: happy path, response_start dedup, malformed JSON skip, chunked delivery reassembly, null body guard, and error event. All existing gateway-client tests still pass.</done>
</task>

</tasks>

<verification>
- `npx vitest --run src/__tests__/glasses-main.test.ts` -- all 19+ tests pass (0 ReferenceError)
- `npx vitest --run src/__tests__/gateway-client.test.ts` -- all existing + 6 new SSE tests pass
- `npx tsc --noEmit` -- zero type errors
- `npx vitest --run` -- full suite passes (pre-existing nav-switching/confirm-modal failures excluded)
</verification>

<success_criteria>
- glasses-main.test.ts vi.mock hoisting fixed -- all tests pass
- SSE parser has 6 dedicated tests covering edge cases
- response.body null guard emits error chunk instead of crashing
- Zero regressions in existing tests
- typecheck passes
</success_criteria>

<output>
After completion, create `.planning/quick/48-review-last-commits-for-edge-cases-tech-/48-SUMMARY.md`
</output>
