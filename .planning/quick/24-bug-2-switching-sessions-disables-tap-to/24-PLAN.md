---
phase: quick-24
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/gestures/gesture-handler.ts
  - src/__tests__/gesture-handler.test.ts
autonomous: true
requirements: [BUG-24]

must_haves:
  truths:
    - "After switching sessions via /switch command from glasses menu, tap-to-record works immediately"
    - "After hub-initiated session switch (sync), tap-to-record works immediately on glasses"
    - "If FSM is in recording state when session switches, recording is stopped cleanly before reset"
    - "If FSM is already idle when session switches, no unnecessary side effects occur"
  artifacts:
    - path: "src/gestures/gesture-handler.ts"
      provides: "session:switched bus listener that resets FSM to idle"
      contains: "session:switched"
    - path: "src/__tests__/gesture-handler.test.ts"
      provides: "Regression tests for session:switched FSM reset"
      contains: "session:switched"
  key_links:
    - from: "src/glasses-main.ts"
      to: "src/gestures/gesture-handler.ts"
      via: "bus event session:switched"
      pattern: "bus\\.on\\('session:switched'"
---

<objective>
Fix bug: After switching sessions (via glasses /switch command or hub-initiated sync), tap-to-record becomes inactive because the gesture FSM remains in a stale state.

**Root cause:** When a session switch occurs, `switchToSession()` in glasses-main.ts destroys and reinitializes the renderer, then emits `session:switched` on the bus. However, the gesture FSM in gesture-handler.ts has no listener for `session:switched`. If the FSM was in `menu`, `sent`, `thinking`, or `recording` state when the switch happened, it stays in that state. With the new session loaded:
- In `menu` state: taps produce MENU_SELECT but no menu overlay exists (renderer was destroyed/rebuilt)
- In `sent`/`thinking` state: FSM waits for a response_end from the OLD session's voice turn
- In `recording` state: audio capture continues for the old session context

The `menu:close` fix from quick-23 only covers the case where session switch goes through the glasses menu (which emits `menu:close`). It does NOT cover hub-initiated session switches via sync, which bypass the menu entirely.

**Fix:** Add a `session:switched` bus listener in the gesture handler that resets FSM to idle via `handleInput('reset', ...)`. This mirrors the quick-23 `menu:close` pattern. The FSM transition table correctly handles all states: `recording` + `reset` fires STOP_RECORDING, all other states produce null action (clean reset).

Purpose: Ensure FSM is always in a known-good idle state after any session switch, regardless of origin.
Output: Patched gesture-handler.ts + regression tests.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/gestures/gesture-handler.ts
@src/gestures/gesture-fsm.ts
@src/__tests__/gesture-handler.test.ts
@src/types.ts (AppEventMap includes 'session:switched': { id: string; previousId: string })
@src/glasses-main.ts (switchToSession emits session:switched on bus at line 369)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add session:switched listener to gesture handler that resets FSM to idle</name>
  <files>src/gestures/gesture-handler.ts</files>
  <action>
In `createGestureHandler`, add a bus subscription for `session:switched` that resets the FSM to idle. Place it after the existing `menu:close` subscription (around line 191), before the `destroy` function.

Add this subscription:
```typescript
// When sessions switch (glasses menu /switch, hub sync, or any source), reset FSM to idle.
// Prevents stale FSM state (menu/sent/thinking/recording) from blocking tap-to-record
// in the new session context. The reset input correctly handles all states:
// recording -> idle (with STOP_RECORDING action), all others -> idle (null action).
unsubs.push(bus.on('session:switched', () => {
  if (state !== 'idle') {
    handleInput('reset', Date.now());
  }
}));
```

The guard `state !== 'idle'` avoids unnecessary watchdog timer restarts when the FSM is already idle (the common case for hub-initiated switches when user is not interacting).

The `reset` input in the FSM transition table correctly handles every state:
- `recording` + `reset` -> `idle` with `STOP_RECORDING` (cleans up active recording)
- `sent` + `reset` -> `idle` with `null` (clean reset)
- `thinking` + `reset` -> `idle` with `null` (clean reset)
- `menu` + `reset` -> `idle` with `null` (clean reset)

Do NOT modify the FSM table in gesture-fsm.ts. The FSM transitions are correct -- the issue is that the gesture handler never receives a signal that the session context changed.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/gesture-handler.test.ts --reporter=verbose 2>&1 | tail -30</automated>
    <manual>Existing tests still pass, no regressions</manual>
  </verify>
  <done>gesture-handler.ts subscribes to session:switched and resets FSM from any non-idle state to idle</done>
</task>

<task type="auto">
  <name>Task 2: Add regression tests for session:switched FSM reset</name>
  <files>src/__tests__/gesture-handler.test.ts</files>
  <action>
Add a new `describe('session:switched FSM reset (bug #24)')` block inside the top-level `createGestureHandler` describe. Place it after the existing 'menu:close FSM reset (bug #23)' describe block (around line 384). Add these test cases:

1. **"session:switched resets FSM from menu to idle"** -- Enter menu state via double-tap, emit `session:switched` with `{ id: 'new-sess', previousId: 'old-sess' }`. Assert `handler.getState() === 'idle'`.

2. **"tap works after session:switched (regression: /switch command)"** -- Enter menu state via double-tap, emit `session:switched`. Then emit `gesture:tap` with timestamp well past debounce window (+1000ms). Assert `handler.getState() === 'recording'` and `audioCapture.startRecording` was called. This directly reproduces the reported bug.

3. **"session:switched resets FSM from sent to idle"** -- Enter recording via tap, stop via second tap (state = sent). Emit `session:switched`. Assert state is `idle`. Then tap, assert state is `recording`. This covers the case where a voice turn was in-flight when hub switched sessions.

4. **"session:switched stops recording if FSM in recording state"** -- Enter recording via tap. Emit `session:switched`. Assert state is `idle`. Assert `bridge.stopAudio` was called (the STOP_RECORDING action from recording + reset transition). This ensures active recording is cleaned up on session switch.

5. **"session:switched is no-op when FSM already idle"** -- Start in idle (default). Emit `session:switched`. Assert state is still `idle`. Emit tap, assert state is `recording`. Proves no interference from spurious session:switched events.

6. **"session:switched from hub sync resets FSM (simulated hub-initiated switch)"** -- Enter recording via tap, then emit `session:switched` (simulating hub sync pushing a session change). Assert state is `idle`. Then tap to record with new session, verify `audioCapture.startRecording` is called. Update `sessionId` variable to `'new-session-2'` before the second tap to verify the new session ID is used.

All timestamps must respect the 275ms debounce window between tap events.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/gesture-handler.test.ts --reporter=verbose 2>&1 | tail -40</automated>
  </verify>
  <done>6 regression tests pass, covering session:switched reset from all FSM states and the exact session-switch bug scenario</done>
</task>

<task type="auto">
  <name>Task 3: Typecheck, build, and run full test suite</name>
  <files></files>
  <action>
Run the following verification commands in sequence:
1. `npm run typecheck` -- Confirm no type errors from the new bus subscription
2. `npm run build` -- Confirm production build succeeds
3. `npx vitest run` -- Run full test suite to confirm no regressions across all 600+ tests

If any command fails, diagnose and fix the issue before proceeding.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npm run typecheck && npm run build && npx vitest run 2>&1 | tail -20</automated>
  </verify>
  <done>typecheck passes, build succeeds, all tests pass with 0 failures</done>
</task>

</tasks>

<verification>
- `npm run typecheck` passes with 0 errors
- `npm run build` completes successfully
- `npx vitest run` passes all tests (600+ existing + 6 new regression tests)
- The gesture-handler.test.ts specifically tests: menu state + session switch + tap = recording (the exact bug)
- The gesture-handler.test.ts tests hub-initiated switch scenario: recording + session:switched + tap = recording with new session
</verification>

<success_criteria>
- FSM resets to idle when session:switched fires while in any non-idle state
- Active recording is stopped cleanly (STOP_RECORDING action) if FSM was recording during switch
- Tap-to-record works immediately after any session switch (glasses menu or hub sync)
- No regressions in existing gesture, menu, voice loop, or session tests
- Build and typecheck clean
</success_criteria>

<output>
After completion, create `.planning/quick/24-bug-2-switching-sessions-disables-tap-to/24-SUMMARY.md`
</output>
