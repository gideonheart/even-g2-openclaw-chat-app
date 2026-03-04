---
phase: quick-35
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/api/gateway-client.ts
  - src/__tests__/gateway-client.test.ts
autonomous: true
requirements: [QUICK-35]
must_haves:
  truths:
    - "User transcript renders on glasses display before assistant response_start/delta/end begins"
    - "Transcript chunk emission and response chunk emission are separated by an async yield"
    - "No artificial sleeps or timeout-based delays introduced"
    - "Error handling preserved: if assistant response fails, transcript remains visible"
    - "If STT returns no transcript, response_start/delta/end still emit normally"
  artifacts:
    - path: "src/api/gateway-client.ts"
      provides: "Decoupled transcript emission from response lifecycle in emitFromGatewayReply"
      contains: "await.*emitFromGatewayReply"
    - path: "src/__tests__/gateway-client.test.ts"
      provides: "Tests proving transcript chunk is emitted before microtask yield, response chunks after"
  key_links:
    - from: "src/api/gateway-client.ts:emitFromGatewayReply"
      to: "display-controller.ts gateway:chunk listener"
      via: "gateway onChunk -> VoiceLoopController -> bus gateway:chunk"
      pattern: "emitChunk.*transcript.*await.*emitChunk.*response_start"
---

<objective>
Decouple user transcript rendering from assistant response lifecycle in the gateway client so the glasses display shows the user's speech-to-text result before any assistant open/stream/close indicators begin.

Purpose: Currently `emitFromGatewayReply` emits transcript, response_start, response_delta, and response_end synchronously in a single execution frame. The glasses bridge receives all display updates with no yield between them, so the hardware cannot render the user transcript before the assistant response overwrites the display. By making `emitFromGatewayReply` async and inserting a microtask yield after the transcript chunk, the bridge gets a chance to push the user message to the glasses before the assistant response lifecycle begins.

Output: Patched gateway-client.ts with async yield, updated tests confirming emission ordering with yield.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/api/gateway-client.ts
@src/__tests__/gateway-client.test.ts
@src/display/display-controller.ts
@src/voice-loop-controller.ts
@src/types.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Make emitFromGatewayReply async with microtask yield between transcript and response</name>
  <files>src/api/gateway-client.ts</files>
  <action>
In `gateway-client.ts`, refactor `emitFromGatewayReply` from synchronous to async:

1. Change the function signature from `function emitFromGatewayReply(reply: GatewayReply): void` to `async function emitFromGatewayReply(reply: GatewayReply): Promise<void>`.

2. After emitting the transcript chunk (if present), insert a microtask yield using `await Promise.resolve()`. This gives the synchronous event bus listeners (VoiceLoopController -> bus -> DisplayController -> renderer.addUserMessage -> bridge.textContainerUpgrade) time to propagate the user message to the glasses display before the response lifecycle begins. Comment: "// Yield: let transcript propagate to glasses display before response lifecycle"

3. The rest of the function (response_start, response_delta, response_end) remains unchanged after the yield.

4. Update both call sites — `sendVoiceTurn` (line ~224) and `sendTextTurn` (line ~264) — to `await emitFromGatewayReply(reply)` since the function is now async. Both are already in async functions, so this is a trivial change.

5. Do NOT introduce any setTimeout, requestAnimationFrame, or fixed delay. Only `await Promise.resolve()` (microtask yield). This maintains the "no artificial sleeps/offset timers" constraint.

6. Add a brief inline comment above the yield explaining WHY: the glasses bridge textContainerUpgrade is fire-and-forget but the Even SDK processes updates asynchronously — the microtask boundary lets the JS event loop flush pending bridge calls before queuing the response lifecycle updates.

The resulting function should look approximately like:
```typescript
async function emitFromGatewayReply(reply: GatewayReply): Promise<void> {
  if (reply.transcript) {
    emitChunk({ type: 'transcript', text: reply.transcript, turnId: reply.turnId });
    // Yield: let transcript propagate to glasses display before response lifecycle.
    // The display controller commits the user message synchronously on this chunk,
    // and the bridge.textContainerUpgrade call needs a microtask boundary to flush
    // to the Even SDK before response_start overwrites the display state.
    await Promise.resolve();
  }
  emitChunk({ type: 'response_start', turnId: reply.turnId });
  const text = reply.assistant?.fullText?.trim();
  if (text) emitChunk({ type: 'response_delta', text, turnId: reply.turnId });
  emitChunk({ type: 'response_end', turnId: reply.turnId });
}
```
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/gateway-client.test.ts --reporter=verbose 2>&1 | tail -30</automated>
    <manual>Existing gateway-client tests should still pass (chunk ordering is preserved, just with a microtask boundary between transcript and response_start)</manual>
  </verify>
  <done>emitFromGatewayReply is async, transcript chunk is emitted before a microtask yield, response_start/delta/end chunks follow after yield. Both sendVoiceTurn and sendTextTurn await the result. No setTimeout or artificial delay introduced.</done>
</task>

<task type="auto">
  <name>Task 2: Add tests proving transcript-first ordering with microtask yield</name>
  <files>src/__tests__/gateway-client.test.ts</files>
  <action>
Add targeted tests to `gateway-client.test.ts` that prove the transcript-before-response ordering with the microtask boundary:

1. **Test: "transcript chunk is emitted before microtask yield, response chunks after"**
   - Create a gateway client and subscribe to onChunk.
   - Mock fetch to return a reply with both transcript and assistant fullText.
   - In the onChunk handler, when the transcript chunk arrives, record `transcriptMicrotask = false`, then schedule `queueMicrotask(() => { transcriptMicrotask = true })`.
   - When response_start arrives, assert that `transcriptMicrotask` is true — proving that at least one microtask boundary passed between transcript and response_start.
   - await sendVoiceTurn and verify the assertion held.

2. **Test: "transcript-first ordering holds for sendTextTurn as well"**
   - Same pattern as above but using sendTextTurn instead of sendVoiceTurn, to confirm both code paths have the yield.

3. **Test: "response chunks still emit immediately when no transcript in reply"**
   - Mock fetch to return a reply WITHOUT transcript (only assistant.fullText).
   - Verify the chunks are still [response_start, response_delta, response_end] with no spurious yield or delay.
   - This test likely already exists ("successful voice turn without transcript emits 3 chunks") — if so, just verify it still passes; no need to duplicate.

Add these tests in a new `describe('transcript-first rendering guarantee')` block inside the `sendVoiceTurn` describe, and a parallel test inside `sendTextTurn` describe.

Keep the existing chunk-ordering assertions in "successful voice turn emits chunks from JSON gateway reply" — those tests now validate the same ordering but through an async boundary.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/gateway-client.test.ts --reporter=verbose 2>&1 | tail -40</automated>
    <manual>New tests appear in output, all pass, proving microtask boundary between transcript and response_start</manual>
  </verify>
  <done>At least 2 new tests exist proving: (1) a microtask boundary separates transcript emission from response_start emission for voice turns, (2) same guarantee holds for text turns. All existing gateway-client tests pass without modification.</done>
</task>

</tasks>

<verification>
Run full test suite to confirm no regressions:
```bash
cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run --reporter=verbose 2>&1 | tail -50
```

Specifically verify:
- gateway-client.test.ts: all existing + new tests pass
- display-controller.test.ts: all tests pass (no changes needed — it tests via mock renderer, unaffected by async change in gateway-client)
- voice-loop-controller.test.ts: all tests pass (VoiceLoopController forwards chunks synchronously from gateway.onChunk — the async boundary is upstream in gateway-client, not in the controller)
</verification>

<success_criteria>
1. `emitFromGatewayReply` is async with `await Promise.resolve()` between transcript and response_start emission
2. Both `sendVoiceTurn` and `sendTextTurn` await `emitFromGatewayReply`
3. New tests prove microtask boundary separates transcript from response lifecycle
4. No artificial sleeps, setTimeout, or offset timers introduced
5. All 631+ existing tests pass without modification
6. Event ordering is preserved: transcript -> (yield) -> response_start -> response_delta -> response_end
</success_criteria>

<output>
After completion, create `.planning/quick/35-g2-frontend-transcript-must-render-befor/35-SUMMARY.md`
</output>
