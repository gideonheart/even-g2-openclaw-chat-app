---
phase: quick-20
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/gestures/gesture-fsm.ts
  - src/__tests__/gesture-fsm.test.ts
  - src/gestures/gesture-handler.ts
  - src/__tests__/gesture-handler.test.ts
  - src/voice-loop-controller.ts
  - src/__tests__/voice-loop-controller.test.ts
autonomous: true
requirements: [DECOUPLE-FSM-01, DECOUPLE-FSM-02, DECOUPLE-FSM-03]

must_haves:
  truths:
    - "User can tap to start recording even while a previous turn is in 'sent' state"
    - "response_end from gateway does NOT abort a recording the user started mid-stream"
    - "Multiple voice turns queue and execute sequentially without aborting in-flight requests"
    - "Taps are never blocked in any non-menu state (idle, recording, sent, thinking)"
  artifacts:
    - path: "src/gestures/gesture-fsm.ts"
      provides: "sent + tap -> recording transition"
      contains: "'tap'"
    - path: "src/gestures/gesture-handler.ts"
      provides: "State-aware reset that skips recording/idle/menu states"
      contains: "getState"
    - path: "src/voice-loop-controller.ts"
      provides: "Voice turn queue with busy flag"
      contains: "pendingTurns"
  key_links:
    - from: "src/gestures/gesture-handler.ts"
      to: "src/gestures/gesture-fsm.ts"
      via: "gestureTransition('sent', 'tap') now returns recording"
      pattern: "sent.*tap.*recording"
    - from: "src/voice-loop-controller.ts"
      to: "src/api/gateway-client.ts"
      via: "processQueue drains one turn at a time"
      pattern: "processQueue"
---

<objective>
Decouple the input FSM from the response lifecycle so taps are never blocked by gateway processing state. Add a voice turn queue so multiple recordings execute sequentially without aborting in-flight requests.

Purpose: Users should be able to tap-record-tap-stop at any time, even while a previous turn is being processed or the AI is streaming a response. Currently `sent` state blocks all taps, and `response_end` resets can abort an active recording.

Output: Updated FSM, state-aware reset logic, and voice turn queue.
</objective>

<context>
@src/gestures/gesture-fsm.ts
@src/gestures/gesture-handler.ts
@src/voice-loop-controller.ts
@src/__tests__/gesture-fsm.test.ts
@src/__tests__/gesture-handler.test.ts
@src/__tests__/voice-loop-controller.test.ts
@src/api/gateway-client.ts
@src/types.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add sent + tap -> recording transition to FSM</name>
  <files>src/gestures/gesture-fsm.ts, src/__tests__/gesture-fsm.test.ts</files>
  <action>
In `src/gestures/gesture-fsm.ts`, add a `tap` transition to the `sent` state entry in the TRANSITIONS table:

```typescript
sent: {
  'tap':   { nextState: 'recording', action: { type: 'START_RECORDING' } },
  'reset': { nextState: 'idle', action: null },
},
```

Update the comment on the `sent` block -- remove "All other inputs ignored while audio is being processed" and replace with a comment noting tap starts a new recording while previous turn is processing.

In `src/__tests__/gesture-fsm.test.ts`:
- Find the `sent state (all inputs ignored)` describe block.
- Rename it to `sent state`.
- Change the `tap -> sent with null action` test to verify `tap -> recording with START_RECORDING`:
  ```typescript
  it('tap -> recording with START_RECORDING (re-record while processing)', () => {
    const result = gestureTransition('sent', 'tap');
    expect(result).toEqual({
      nextState: 'recording',
      action: { type: 'START_RECORDING' },
    });
  });
  ```
- Keep the double-tap, scroll-up, scroll-down tests as-is (they still return sent with null action via the fallback).
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/gesture-fsm.test.ts 2>&1 | tail -20</automated>
  </verify>
  <done>FSM transition table allows tap in sent state, transitioning to recording with START_RECORDING. All 5 states now accept tap (idle->recording, recording->sent, sent->recording, thinking->recording, menu->MENU_SELECT). Test updated and passing.</done>
</task>

<task type="auto">
  <name>Task 2: Make response_end/error resets state-aware in gesture-handler</name>
  <files>src/gestures/gesture-handler.ts, src/__tests__/gesture-handler.test.ts</files>
  <action>
In `src/gestures/gesture-handler.ts`, modify the `gateway:chunk` listener (around line 175-183). Replace the unconditional `handleInput('reset', ...)` calls with state-aware logic:

```typescript
unsubs.push(bus.on('gateway:chunk', (chunk) => {
  if (chunk.type === 'error') {
    // Only reset if in sent/thinking -- do NOT abort an active recording or clobber idle/menu
    if (state === 'sent' || state === 'thinking') {
      handleInput('reset', Date.now());
    }
  } else if (chunk.type === 'response_end') {
    // Only reset if in sent/thinking -- user may have started a new recording mid-stream
    if (state === 'sent' || state === 'thinking') {
      handleInput('reset', Date.now());
    }
  } else if (chunk.type === 'response_delta') {
    startWatchdog(); // Keep watchdog alive during active streaming
  }
}));
```

The key change: `state` is captured by closure, so we can read it directly. Only call `handleInput('reset', ...)` when `state === 'sent' || state === 'thinking'`. In `recording`, `idle`, or `menu` states, the reset is silently ignored.

Also update `getHintText` for `sent` state to reflect that tapping is now allowed:
```typescript
case 'sent':
  return 'Processing... | Tap to record next';
```

In `src/__tests__/gesture-handler.test.ts`, update the error recovery describe block:

1. Keep existing test `gateway:chunk error resets FSM from sent to idle` -- still passes (sent is in the allowed set).

2. **Change** the test `gateway:chunk error resets FSM from recording to idle` -- this must now verify the OPPOSITE behavior: error chunk while recording does NOT reset:
   ```typescript
   it('gateway:chunk error does NOT reset FSM from recording (preserves active recording)', () => {
     const handler = createHandler();
     bus.emit('gesture:tap', { timestamp: 1000 });
     expect(handler.getState()).toBe('recording');
     bus.emit('gateway:chunk', { type: 'error', error: 'connection lost' });
     expect(handler.getState()).toBe('recording'); // NOT reset!
   });
   ```

3. Keep existing test `gateway:chunk response_end resets FSM to idle` -- passes (from sent state).

4. **Add** new test: `gateway:chunk response_end does NOT reset FSM from recording`:
   ```typescript
   it('gateway:chunk response_end does NOT reset FSM from recording (preserves active recording)', () => {
     const handler = createHandler();
     bus.emit('gesture:tap', { timestamp: 1000 });
     expect(handler.getState()).toBe('recording');
     bus.emit('gateway:chunk', { type: 'response_end' });
     expect(handler.getState()).toBe('recording'); // NOT reset!
   });
   ```

5. **Add** new test: `gateway:chunk error does NOT reset FSM from idle`:
   ```typescript
   it('gateway:chunk error does NOT reset FSM from idle', () => {
     const handler = createHandler();
     expect(handler.getState()).toBe('idle');
     bus.emit('gateway:chunk', { type: 'error', error: 'stale error' });
     expect(handler.getState()).toBe('idle');
   });
   ```

6. Update the hint text test for `sent` to expect `'Processing... | Tap to record next'`.

7. In the watchdog test `clears watchdog on state transition to idle (no double-fire after error reset)` -- this test puts FSM in sent state then fires an error chunk to reset. Since sent is in the allowed set, this test still works as-is.

8. In the watchdog test `resets watchdog timer on response_delta chunks` -- this puts FSM in sent state and receives deltas. Still valid since sent allows reset on response_end/error.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/gesture-handler.test.ts 2>&1 | tail -20</automated>
  </verify>
  <done>response_end and error chunks only reset FSM when in sent or thinking states. Recording, idle, and menu states are immune to gateway lifecycle resets. Updated hint text for sent state. Tests prove recording is preserved when response_end/error arrives mid-recording.</done>
</task>

<task type="auto">
  <name>Task 3: Add voice turn queue to VoiceLoopController</name>
  <files>src/voice-loop-controller.ts, src/__tests__/voice-loop-controller.test.ts</files>
  <action>
In `src/voice-loop-controller.ts`, add a sequential voice turn queue so recordings are sent one at a time without aborting in-flight requests.

Replace the current `audio:recording-stop` handler with queue-based logic:

```typescript
export function createVoiceLoopController(opts: {
  bus: EventBus<AppEventMap>;
  gateway: GatewayClient;
  settings: () => AppSettings;
}): VoiceLoopController {
  const { bus, gateway, settings } = opts;
  const unsubs: Array<() => void> = [];

  // Voice turn queue -- ensures sequential execution, no abort of in-flight requests
  interface PendingTurn { sessionId: string; blob: Blob }
  const pendingTurns: PendingTurn[] = [];
  let busy = false;

  function processQueue(): void {
    if (busy || pendingTurns.length === 0) return;
    busy = true;
    const turn = pendingTurns.shift()!;
    const s = settings();
    bus.emit('log', {
      level: 'info',
      msg: `Sending voice turn: ${turn.blob.size} bytes ${turn.blob.type} to ${s.gatewayUrl || '(not set)'} stt=${s.sttProvider} (queue: ${pendingTurns.length} remaining)`,
    });
    gateway.sendVoiceTurn(s, {
      sessionId: turn.sessionId,
      audio: turn.blob,
      sttProvider: s.sttProvider,
    });
  }

  // Forward gateway chunks to bus (with error logging)
  unsubs.push(gateway.onChunk((chunk) => {
    if (chunk.type === 'error') {
      bus.emit('log', {
        level: 'error',
        msg: `Gateway error: ${chunk.error ?? 'unknown'}`,
      });
    }
    bus.emit('gateway:chunk', chunk);

    // Drain queue on response_end or error (turn is complete)
    if (chunk.type === 'response_end' || chunk.type === 'error') {
      busy = false;
      processQueue();
    }
  }));

  // Forward gateway status changes to bus (with logging)
  unsubs.push(gateway.onStatusChange((status) => {
    bus.emit('log', {
      level: status === 'error' ? 'error' : 'info',
      msg: `Gateway status: ${status}`,
    });
    bus.emit('gateway:status', { status });
  }));

  // When recording stops, enqueue voice turn (not immediate send)
  unsubs.push(bus.on('audio:recording-stop', ({ sessionId, blob }) => {
    pendingTurns.push({ sessionId, blob });
    processQueue();
  }));

  function destroy(): void {
    for (const unsub of unsubs) {
      unsub();
    }
    unsubs.length = 0;
    pendingTurns.length = 0;
    busy = false;
  }

  return { destroy };
}
```

Key design:
- `pendingTurns` array holds queued voice turns
- `busy` flag tracks whether a turn is in-flight
- `processQueue()` shifts one turn and sends it, setting busy=true
- On `response_end` or `error` chunk from gateway, set busy=false and call processQueue() to drain next
- First turn goes through immediately (busy starts false), subsequent turns queue until the previous completes
- `destroy()` clears the queue and resets busy

In `src/__tests__/voice-loop-controller.test.ts`, add these tests:

1. **Existing test `sends voice turn on recording stop`** -- still passes. First recording-stop fires immediately (queue is empty, busy is false).

2. **Add** test: `queues second voice turn while first is in-flight`:
   ```typescript
   it('queues second voice turn while first is in-flight', () => {
     createVoiceLoopController({ bus, gateway, settings: () => settings });

     const blob1 = new Blob(['audio1']);
     const blob2 = new Blob(['audio2']);

     bus.emit('audio:recording-stop', { sessionId: 's1', blob: blob1 });
     bus.emit('audio:recording-stop', { sessionId: 's2', blob: blob2 });

     // Only first should have been sent (second is queued)
     expect(gateway.sendVoiceTurn).toHaveBeenCalledTimes(1);
     expect(gateway.sendVoiceTurn).toHaveBeenCalledWith(
       settings,
       expect.objectContaining({ sessionId: 's1' }),
     );
   });
   ```

3. **Add** test: `drains queued turn after response_end`:
   ```typescript
   it('drains queued turn after response_end', () => {
     createVoiceLoopController({ bus, gateway, settings: () => settings });

     const blob1 = new Blob(['audio1']);
     const blob2 = new Blob(['audio2']);

     bus.emit('audio:recording-stop', { sessionId: 's1', blob: blob1 });
     bus.emit('audio:recording-stop', { sessionId: 's2', blob: blob2 });
     expect(gateway.sendVoiceTurn).toHaveBeenCalledTimes(1);

     // Simulate first turn completing
     gateway.simulateChunk({ type: 'response_end' });

     // Second turn should now be sent
     expect(gateway.sendVoiceTurn).toHaveBeenCalledTimes(2);
     expect(gateway.sendVoiceTurn).toHaveBeenLastCalledWith(
       settings,
       expect.objectContaining({ sessionId: 's2' }),
     );
   });
   ```

4. **Add** test: `drains queued turn after error chunk`:
   ```typescript
   it('drains queued turn after error chunk', () => {
     createVoiceLoopController({ bus, gateway, settings: () => settings });

     const blob1 = new Blob(['audio1']);
     const blob2 = new Blob(['audio2']);

     bus.emit('audio:recording-stop', { sessionId: 's1', blob: blob1 });
     bus.emit('audio:recording-stop', { sessionId: 's2', blob: blob2 });
     expect(gateway.sendVoiceTurn).toHaveBeenCalledTimes(1);

     // First turn fails
     gateway.simulateChunk({ type: 'error', error: 'timeout' });

     // Second turn should still be sent
     expect(gateway.sendVoiceTurn).toHaveBeenCalledTimes(2);
     expect(gateway.sendVoiceTurn).toHaveBeenLastCalledWith(
       settings,
       expect.objectContaining({ sessionId: 's2' }),
     );
   });
   ```

5. **Add** test: `destroy clears pending queue`:
   ```typescript
   it('destroy clears pending queue', () => {
     const controller = createVoiceLoopController({ bus, gateway, settings: () => settings });

     const blob1 = new Blob(['audio1']);
     const blob2 = new Blob(['audio2']);

     bus.emit('audio:recording-stop', { sessionId: 's1', blob: blob1 });
     bus.emit('audio:recording-stop', { sessionId: 's2', blob: blob2 });
     expect(gateway.sendVoiceTurn).toHaveBeenCalledTimes(1);

     controller.destroy();

     // Simulate first turn completing -- should NOT drain s2 (destroyed)
     gateway.simulateChunk({ type: 'response_end' });
     expect(gateway.sendVoiceTurn).toHaveBeenCalledTimes(1);
   });
   ```
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/voice-loop-controller.test.ts 2>&1 | tail -20</automated>
  </verify>
  <done>VoiceLoopController enqueues voice turns and drains sequentially. First turn fires immediately, subsequent turns queue until response_end or error. No in-flight request is ever aborted by a new recording. Tests prove queue, drain-on-complete, drain-on-error, and destroy-clears-queue.</done>
</task>

</tasks>

<verification>
Run the full test suite to confirm zero regressions across all 3 changed modules and the rest of the codebase:

```bash
cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run
```

All tests must pass. Specific checks:
- gesture-fsm.test.ts: sent + tap now produces recording/START_RECORDING
- gesture-handler.test.ts: response_end/error do NOT reset recording state; DO reset sent/thinking
- voice-loop-controller.test.ts: queue drains sequentially, no concurrent sends
</verification>

<success_criteria>
- Tap works in ALL non-menu states: idle, recording, sent, thinking
- response_end and error chunks only reset FSM from sent/thinking (not recording/idle/menu)
- Voice turns queue and execute one at a time -- no abort of in-flight requests
- All existing tests pass with updates; new tests cover the 3 behavioral changes
- `npx vitest run` shows 0 failures
</success_criteria>

<output>
After completion, create `.planning/quick/20-decouple-input-fsm-from-response-lifecyc/20-SUMMARY.md`
</output>
