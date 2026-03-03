---
phase: quick-23
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/gestures/gesture-handler.ts
  - src/__tests__/gesture-handler.test.ts
autonomous: true
requirements: [BUG-23]

must_haves:
  truths:
    - "After executing /new from glasses menu, tap-to-record works immediately"
    - "After executing any menu command (/new, /switch, /rename, /reset, /delete), FSM returns to idle"
    - "Double-tap close of menu still works correctly (FSM -> idle)"
    - "Auto-close timeout of menu still resets FSM to idle"
  artifacts:
    - path: "src/gestures/gesture-handler.ts"
      provides: "menu:close bus listener that resets FSM to idle"
      contains: "menu:close"
    - path: "src/__tests__/gesture-handler.test.ts"
      provides: "Regression tests for menu close -> FSM idle reset"
      contains: "menu:close"
  key_links:
    - from: "src/menu/menu-controller.ts"
      to: "src/gestures/gesture-handler.ts"
      via: "bus event menu:close"
      pattern: "bus\\.on\\('menu:close'"
---

<objective>
Fix bug: After opening /new session from glasses menu, tap-to-record becomes inactive.

**Root cause:** When a menu command executes (e.g., /new), `menu-controller.ts` calls `closeMenu()` which sets `menuState = null` and emits `menu:close` on the bus, but the gesture FSM in `gesture-handler.ts` never transitions out of `menu` state. The FSM remains stuck in `menu` state where `tap` produces `MENU_SELECT` (which menu-controller ignores since the menu UI is closed), so `START_RECORDING` never fires.

The only way the FSM exits `menu` state is via `double-tap` (TOGGLE_MENU) or `reset`. When the user selects a command via tap (MENU_SELECT), the menu-controller closes the menu UI but the FSM stays in `menu` state permanently.

**Fix:** Subscribe the gesture handler to the `menu:close` bus event and reset the FSM to `idle` via `handleInput('reset', ...)`. This ensures the FSM always returns to idle when the menu closes, regardless of how it closes (command execution, auto-close timeout, or sync from hub).

Purpose: Restore tap-to-record functionality after any menu command execution.
Output: Patched gesture-handler.ts + regression tests.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/gestures/gesture-handler.ts
@src/gestures/gesture-fsm.ts
@src/menu/menu-controller.ts
@src/__tests__/gesture-handler.test.ts
@src/types.ts (AppEventMap includes 'menu:close': {})
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add menu:close listener to gesture handler that resets FSM to idle</name>
  <files>src/gestures/gesture-handler.ts</files>
  <action>
In `createGestureHandler`, add a bus subscription for `menu:close` that resets the FSM to idle. Place it after the existing `gateway:chunk` subscription (around line 183), before the `destroy` function.

Add this subscription:
```typescript
unsubs.push(bus.on('menu:close', () => {
  if (state === 'menu') {
    handleInput('reset', Date.now());
  }
}));
```

The guard `state === 'menu'` prevents spurious resets if menu:close fires when FSM is already in another state (e.g., if menu auto-closed while user was already recording).

The `reset` input in `menu` state transitions to `idle` with `null` action (per the FSM table), which is exactly what we want -- no side effects, just state correction.

Do NOT modify the FSM table in gesture-fsm.ts. The FSM is correct -- the issue is that the gesture handler never receives the signal that the menu closed after command execution.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/gesture-handler.test.ts --reporter=verbose 2>&1 | tail -30</automated>
    <manual>Existing tests still pass, no regressions</manual>
  </verify>
  <done>gesture-handler.ts subscribes to menu:close and resets FSM from menu to idle</done>
</task>

<task type="auto">
  <name>Task 2: Add regression tests for menu:close FSM reset</name>
  <files>src/__tests__/gesture-handler.test.ts</files>
  <action>
Add a new `describe('menu:close FSM reset (bug #23)')` block inside the top-level `createGestureHandler` describe. Place it after the existing 'error recovery' describe block. Add these test cases:

1. **"menu:close resets FSM from menu to idle"** -- Enter menu state via double-tap, emit `menu:close` on bus, assert `handler.getState() === 'idle'`.

2. **"tap works after menu:close (regression: /new session)"** -- Enter menu state via double-tap, emit `menu:close`, then emit `gesture:tap` with timestamp well past debounce window (e.g., +1000ms). Assert `handler.getState() === 'recording'` and `audioCapture.startRecording` was called. This directly reproduces the reported bug.

3. **"menu:close does NOT reset FSM when already in idle"** -- Start in idle (default), emit `menu:close`. Assert state is still `idle`. Emit a tap, assert state is `recording`. Proves no interference when menu:close fires spuriously.

4. **"menu:close does NOT reset FSM when in recording state"** -- Enter recording via tap, emit `menu:close`. Assert state is still `recording` (guard prevents abort of active recording).

5. **"menu:close resets FSM after menu select (simulated /new flow)"** -- This is the full end-to-end simulation: double-tap to enter menu, emit `menu:select` (FSM stays in menu, action is MENU_SELECT), then emit `menu:close` (simulating menu-controller closing after executing /new). Assert FSM is `idle`. Then tap to record, assert FSM is `recording`.

All timestamps must respect the 275ms debounce window between tap events.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/gesture-handler.test.ts --reporter=verbose 2>&1 | tail -40</automated>
  </verify>
  <done>5 regression tests pass, covering menu:close reset and the exact /new session bug scenario</done>
</task>

<task type="auto">
  <name>Task 3: Build, typecheck, and run full test suite</name>
  <files></files>
  <action>
Run the following verification commands in sequence:
1. `npm run typecheck` -- Confirm no type errors from the new bus subscription
2. `npm run build` -- Confirm production build succeeds
3. `npx vitest run` -- Run full test suite to confirm no regressions across all 595+ tests

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
- `npx vitest run` passes all tests (595+ existing + 5 new regression tests)
- The gesture-handler.test.ts specifically tests the exact bug scenario: double-tap -> menu -> select -> menu:close -> tap -> recording
</verification>

<success_criteria>
- FSM resets to idle when menu:close fires while in menu state
- Tap-to-record works immediately after any menu command execution
- No regressions in existing gesture, menu, or voice loop tests
- Build and typecheck clean
</success_criteria>

<output>
After completion, create `.planning/quick/23-bug-fix-tap-to-record-inactive-after-new/23-SUMMARY.md`
</output>
