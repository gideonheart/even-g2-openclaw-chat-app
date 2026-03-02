---
phase: quick-19
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/gestures/gesture-fsm.ts
  - src/gestures/gesture-handler.ts
  - src/api/gateway-client.ts
  - src/__tests__/gesture-fsm.test.ts
  - src/__tests__/gesture-handler.test.ts
  - src/__tests__/gateway-client.test.ts
autonomous: true
requirements: [FSM-RERECORD, TRANSCRIPT-EMIT]

must_haves:
  truths:
    - "FSM resets to idle when response_end chunk arrives, allowing immediate re-record on next tap"
    - "Tapping during thinking/streaming state queues a new recording (thinking + tap -> recording)"
    - "User transcript text from WhisperX appears as a right-side bubble on glasses before assistant response"
  artifacts:
    - path: "src/gestures/gesture-fsm.ts"
      provides: "thinking + tap -> recording transition"
      contains: "thinking.*tap.*recording"
    - path: "src/gestures/gesture-handler.ts"
      provides: "response_end handler that resets FSM to idle"
      contains: "response_end"
    - path: "src/api/gateway-client.ts"
      provides: "transcript emission from gateway reply"
      contains: "transcript"
  key_links:
    - from: "src/gestures/gesture-handler.ts"
      to: "src/gestures/gesture-fsm.ts"
      via: "handleInput('reset') on response_end chunk"
      pattern: "response_end.*reset"
    - from: "src/api/gateway-client.ts"
      to: "src/display/display-controller.ts"
      via: "emitChunk({ type: 'transcript' }) triggers renderer.addUserMessage"
      pattern: "type.*transcript"
---

<objective>
Fix two related voice conversation UX bugs: (1) FSM gets stuck in thinking state after assistant response completes because response_end never resets it, and (2) user's own speech transcript is never shown on the glasses display because gateway-client never emits the transcript chunk from the gateway reply.

Purpose: Without these fixes, users must wait for the 45s watchdog timeout before they can record again, and they never see confirmation of what they said.
Output: Patched FSM transitions, gesture-handler response_end wiring, gateway-client transcript emission, and updated tests.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/gestures/gesture-fsm.ts
@src/gestures/gesture-handler.ts
@src/api/gateway-client.ts
@src/types.ts
@src/display/display-controller.ts
@src/__tests__/gesture-fsm.test.ts
@src/__tests__/gesture-handler.test.ts
@src/__tests__/gateway-client.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add FSM thinking+tap transition and response_end reset in gesture-handler</name>
  <files>
    src/gestures/gesture-fsm.ts
    src/gestures/gesture-handler.ts
    src/__tests__/gesture-fsm.test.ts
    src/__tests__/gesture-handler.test.ts
  </files>
  <action>
**gesture-fsm.ts** -- Add `tap` transition to the `thinking` state in the TRANSITIONS table:

```ts
thinking: {
    'tap':        { nextState: 'recording', action: { type: 'START_RECORDING' } },
    'double-tap': { nextState: 'menu',      action: { type: 'TOGGLE_MENU' } },
    'reset':      { nextState: 'idle',      action: null },
    // scroll-up, scroll-down ignored during thinking
},
```

This allows users to tap during assistant streaming to immediately start a new recording (queue next question).

**gesture-handler.ts** -- In the `bus.on('gateway:chunk', ...)` listener (line 175-181), add a case for `response_end` that resets the FSM to idle:

```ts
unsubs.push(bus.on('gateway:chunk', (chunk) => {
    if (chunk.type === 'error') {
      handleInput('reset', Date.now());
    } else if (chunk.type === 'response_end') {
      handleInput('reset', Date.now());
    } else if (chunk.type === 'response_delta') {
      startWatchdog(); // Keep watchdog alive during active streaming
    }
}));
```

The `response_end` reset drives the FSM back to `idle` so tap-to-record works immediately. If the user already tapped during thinking (which now transitions to `recording` via the new FSM rule), the reset won't fire because the FSM is no longer in `thinking` -- the `recording` state handles `reset` by stopping recording, which is the correct behavior if audio was interrupted.

**gesture-fsm.test.ts** -- Add test in the `thinking state` describe block:

```ts
it('tap -> recording with START_RECORDING (queue re-record)', () => {
    const result = gestureTransition('thinking', 'tap');
    expect(result).toEqual({
        nextState: 'recording',
        action: { type: 'START_RECORDING' },
    });
});
```

Update the existing test "tap -> thinking with null action (ignored)" to be removed or replaced with the new test above.

**gesture-handler.test.ts** -- In the `error recovery` describe block:

1. Fix the existing test "gateway:chunk non-error types do NOT reset FSM" (line 250-266): This test currently asserts `response_end` does NOT reset FSM. Update it to assert that `response_end` DOES reset to idle, and that `response_start` and `response_delta` do NOT reset:

```ts
it('gateway:chunk response_end resets FSM to idle', () => {
    const handler = createHandler();
    bus.emit('gesture:tap', { timestamp: 1000 });
    bus.emit('gesture:tap', { timestamp: 1300 });
    expect(handler.getState()).toBe('sent');

    bus.emit('gateway:chunk', { type: 'response_end' });
    expect(handler.getState()).toBe('idle');
});

it('gateway:chunk response_start and response_delta do NOT reset FSM', () => {
    const handler = createHandler();
    bus.emit('gesture:tap', { timestamp: 1000 });
    bus.emit('gesture:tap', { timestamp: 1300 });
    expect(handler.getState()).toBe('sent');

    bus.emit('gateway:chunk', { type: 'response_start' });
    expect(handler.getState()).toBe('sent');

    bus.emit('gateway:chunk', { type: 'response_delta', text: 'hello' });
    expect(handler.getState()).toBe('sent');
});
```

2. Add a new test for the full tap-during-thinking flow:

```ts
it('tap during thinking starts new recording (queue re-record)', () => {
    const handler = createHandler();
    // idle -> recording -> sent
    bus.emit('gesture:tap', { timestamp: 1000 });
    bus.emit('gesture:tap', { timestamp: 1300 });
    expect(handler.getState()).toBe('sent');

    // Simulate gateway response_start moving to thinking
    // (response_start doesn't reset FSM, state stays sent)
    // Use reset to manually move to thinking for this test:
    // Actually the FSM goes sent->idle on response_end, but we need thinking state.
    // The 'sent' state auto-transitions externally. Let's test from thinking directly:
    // We need to get to thinking state. The comment in FSM says "auto-transitions to
    // thinking externally via event bus". For this test, go idle->recording->sent,
    // then response_end resets to idle. Instead, test the FSM transition directly.
    // The handler test above covers response_end->idle. Let's verify FSM unit test
    // covers thinking+tap->recording.
});
```

Actually, keep handler tests focused on observable behavior. The FSM unit test for `thinking + tap -> recording` is sufficient for the transition. The handler test for `response_end -> idle` is sufficient for the reset. No need for an artificial thinking-state handler test since `thinking` is set externally (not by gesture-handler itself).
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/gesture-fsm.test.ts src/__tests__/gesture-handler.test.ts --reporter=verbose 2>&1 | tail -40</automated>
  </verify>
  <done>
    - FSM transition table: thinking + tap -> recording with START_RECORDING
    - gesture-handler: response_end chunk triggers handleInput('reset')
    - gesture-fsm.test.ts: new test for thinking+tap passes
    - gesture-handler.test.ts: response_end reset test passes, existing tests updated
    - All existing gesture tests still pass (no regressions)
  </done>
</task>

<task type="auto">
  <name>Task 2: Emit transcript chunk from gateway reply before response_start</name>
  <files>
    src/api/gateway-client.ts
    src/__tests__/gateway-client.test.ts
  </files>
  <action>
**gateway-client.ts** -- Two changes:

1. Add `transcript` field to the `GatewayReply` interface (line 75-80):

```ts
interface GatewayReply {
    turnId?: string;
    transcript?: string;
    assistant?: {
        fullText?: string;
    };
}
```

2. Update `emitFromGatewayReply()` (line 172-177) to emit a transcript chunk BEFORE response_start if `reply.transcript` is present:

```ts
function emitFromGatewayReply(reply: GatewayReply): void {
    if (reply.transcript) {
        emitChunk({ type: 'transcript', text: reply.transcript, turnId: reply.turnId });
    }
    emitChunk({ type: 'response_start', turnId: reply.turnId });
    const text = reply.assistant?.fullText?.trim();
    if (text) emitChunk({ type: 'response_delta', text, turnId: reply.turnId });
    emitChunk({ type: 'response_end', turnId: reply.turnId });
}
```

The display-controller already handles `transcript` chunks at line 38-41 by calling `renderer.addUserMessage(chunk.text!)` and `renderer.setIconState('sent')`, so no display changes needed.

**gateway-client.test.ts** -- Update tests:

1. In `sendVoiceTurn` describe, update "successful voice turn emits chunks from JSON gateway reply" (line 233) to include transcript in the mock reply and verify 4 chunks instead of 3:

```ts
it('successful voice turn emits chunks from JSON gateway reply', async () => {
    const gatewayReply = {
        turnId: 't1',
        transcript: 'Hello there',
        assistant: { fullText: 'hi' },
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(gatewayReply),
    });

    const client = createGatewayClient({ reconnectBaseDelayMs: 1 });
    const chunks: VoiceTurnChunk[] = [];
    const statuses: string[] = [];
    client.onChunk((c) => chunks.push(c));
    client.onStatusChange((s) => statuses.push(s));

    await client.sendVoiceTurn(testSettings, testRequest);

    expect(chunks).toHaveLength(4);
    expect(chunks[0]).toEqual({ type: 'transcript', text: 'Hello there', turnId: 't1' });
    expect(chunks[1]).toEqual({ type: 'response_start', turnId: 't1' });
    expect(chunks[2]).toEqual({ type: 'response_delta', text: 'hi', turnId: 't1' });
    expect(chunks[3]).toEqual({ type: 'response_end', turnId: 't1' });
    expect(statuses).toContain('connected');
});
```

2. Add a new test for gateway reply WITHOUT transcript (backward compatibility):

```ts
it('successful voice turn without transcript emits 3 chunks (backward compat)', async () => {
    const gatewayReply = {
        turnId: 't1',
        assistant: { fullText: 'hi' },
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(gatewayReply),
    });

    const client = createGatewayClient({ reconnectBaseDelayMs: 1 });
    const chunks: VoiceTurnChunk[] = [];
    client.onChunk((c) => chunks.push(c));

    await client.sendVoiceTurn(testSettings, testRequest);

    expect(chunks).toHaveLength(3);
    expect(chunks[0].type).toBe('response_start');
    expect(chunks[1].type).toBe('response_delta');
    expect(chunks[2].type).toBe('response_end');
});
```

3. In `sendTextTurn` describe, update "emits chunks from the JSON gateway reply" test similarly -- add transcript to the mock reply and verify 4 chunks. Also add a backward-compat test without transcript for text turns.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/gateway-client.test.ts --reporter=verbose 2>&1 | tail -40</automated>
  </verify>
  <done>
    - GatewayReply interface has `transcript?: string` field
    - emitFromGatewayReply emits transcript chunk before response_start when reply.transcript is present
    - Skips transcript chunk when reply.transcript is absent (backward compatible)
    - gateway-client.test.ts: voice turn test verifies 4 chunks with transcript
    - gateway-client.test.ts: backward-compat test verifies 3 chunks without transcript
    - gateway-client.test.ts: text turn tests updated similarly
    - All existing gateway-client tests still pass
  </done>
</task>

<task type="auto">
  <name>Task 3: Run full test suite and validate end-to-end chunk flow</name>
  <files></files>
  <action>
Run the full vitest suite to confirm no regressions across the entire codebase. Specifically verify:

1. `npx vitest run` -- all 579+ tests pass
2. `npx tsc --noEmit` -- no TypeScript compilation errors (the new `transcript` field on GatewayReply and the FSM transition change must not break any type contracts)
3. Review the display-controller.ts chunk handler (lines 36-61) to confirm that the `transcript` case (line 38-41) correctly calls `renderer.addUserMessage(chunk.text!)` and `renderer.setIconState('sent')` -- this existing wiring means the right-side user bubble will render as soon as the transcript chunk arrives.

If any test fails, fix the root cause (likely a test assertion that hardcodes old chunk counts or old FSM behavior).
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run 2>&1 | tail -20 && npx tsc --noEmit 2>&1 | tail -10</automated>
  </verify>
  <done>
    - All tests pass (579+ including new tests)
    - TypeScript compiles cleanly with --noEmit
    - No regressions in any module
  </done>
</task>

</tasks>

<verification>
1. FSM behavior: `gestureTransition('thinking', 'tap')` returns `{ nextState: 'recording', action: { type: 'START_RECORDING' } }`
2. Handler behavior: emitting `gateway:chunk` with `type: 'response_end'` resets handler state to `idle`
3. Gateway behavior: gateway reply with `{ transcript: 'hello' }` produces a `{ type: 'transcript', text: 'hello' }` chunk before `response_start`
4. Display wiring: display-controller already handles `transcript` chunks via `renderer.addUserMessage()` -- no changes needed there
5. Full test suite passes, TypeScript compiles cleanly
</verification>

<success_criteria>
- Tapping after assistant finishes speaking immediately starts a new recording (no 45s watchdog wait)
- Tapping DURING assistant streaming starts a new recording (interrupt-and-re-record)
- User's spoken transcript appears as a right-side chat bubble on glasses before the assistant response streams in
- All existing tests pass, new tests cover the added behaviors
</success_criteria>

<output>
After completion, create `.planning/quick/19-fsm-re-record-after-response-end-queue-d/19-SUMMARY.md`
</output>
