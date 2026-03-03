---
phase: quick-27
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/gestures/gesture-handler.ts
autonomous: true
requirements: [DRY-GUARD-COMMENTS]

must_haves:
  truths:
    - "Guard asymmetry between menu:close and session:switched listeners is explained inline"
    - "Watchdog timer dependency on handleInput('reset') clearWatchdog path is documented"
    - "No behavioral code changes -- comments only"
  artifacts:
    - path: "src/gestures/gesture-handler.ts"
      provides: "Inline documentation for guard asymmetry and watchdog dependency"
      contains: "menu:close only fires from the menu controller"
  key_links:
    - from: "session:switched listener (state !== 'idle' guard)"
      to: "handleInput('reset') -> startWatchdog() -> clearWatchdog()"
      via: "FSM reset path clears any running watchdog timer"
      pattern: "clearWatchdog|startWatchdog"
---

<objective>
Add inline comments to gesture-handler.ts documenting two subtle design decisions from the quick-23/24 self-review: (1) the intentional guard asymmetry between menu:close and session:switched listeners, and (2) the watchdog timer dependency when session:switched resets FSM from sent state.

Purpose: Prevent future maintainers from "normalizing" the guard conditions or missing the watchdog timer interaction.
Output: Two enhanced comment blocks in gesture-handler.ts, zero behavioral changes.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/gestures/gesture-handler.ts
@src/gestures/gesture-fsm.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add guard asymmetry and watchdog dependency comments</name>
  <files>src/gestures/gesture-handler.ts</files>
  <action>
Add inline documentation to two bus listener blocks in gesture-handler.ts. No code changes -- comments only.

**1. menu:close listener (line ~186-191):**
Enhance the existing comment to explain WHY the guard is `state === 'menu'` (narrow):
- menu:close only fires from the menu controller when it closes the menu
- Therefore the only valid FSM state at that point is 'menu'
- Contrast with session:switched which uses a broader guard

**2. session:switched listener (line ~193-201):**
Enhance the existing comment to:
- Explain WHY the guard is `state !== 'idle'` (broad): session:switched can fire from ANY state (recording, sent, thinking, menu) since the user can switch sessions at any time
- Document the watchdog timer dependency: if FSM is in 'sent' state with a running watchdog timer, the reset path through handleInput('reset') transitions to idle, which calls startWatchdog(), which calls clearWatchdog() at the top (line 70). This correctly cancels any pending watchdog. Without this, the watchdog would fire later on an already-idle handler and spuriously reset it.

Keep comments concise and technical. Use the existing comment style in this file (// prefix, block grouped with the listener). Do NOT add JSDoc blocks -- use plain inline comments matching the existing style.

Existing tests must continue passing with zero changes since this is comments-only.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/gesture-handler.test.ts --reporter=verbose 2>&1 | tail -5</automated>
    <manual>Read the updated comments and confirm they accurately describe the guard asymmetry rationale and watchdog dependency chain</manual>
  </verify>
  <done>Both listener blocks have concise inline comments explaining: (1) why menu:close uses narrow state === 'menu' guard vs session:switched broad state !== 'idle' guard, and (2) the watchdog timer clearance dependency through the handleInput('reset') -> startWatchdog() -> clearWatchdog() chain. All existing tests pass unchanged.</done>
</task>

</tasks>

<verification>
- `npx vitest run src/__tests__/gesture-handler.test.ts` passes (zero test changes)
- `npx vitest run src/__tests__/gesture-fsm.test.ts` passes (no FSM changes)
- `git diff src/gestures/gesture-handler.ts` shows only comment additions, no code changes
</verification>

<success_criteria>
- Guard asymmetry between the two listeners is explained with rationale
- Watchdog timer dependency through handleInput('reset') path is documented
- Zero behavioral changes (comments only)
- All 613+ tests still pass
</success_criteria>

<output>
After completion, create `.planning/quick/27-dry-srp-fixes-guard-asymmetry-comments-w/27-SUMMARY.md`
</output>
