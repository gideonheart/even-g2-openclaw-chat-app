---
phase: quick-22
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/quick/22-analyze-phase-plans-critically-and-propo/22-ANALYSIS.md
  - .planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-01-PLAN.md
  - .planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-02-PLAN.md
  - .planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-03-PLAN.md
autonomous: true
requirements: [VLQ-01, VLQ-02, VLQ-03, VLQ-04, VLQ-05, VLQ-06, VLQ-07, VLQ-08]

must_haves:
  truths:
    - "Analysis document exists with concrete, actionable findings across all 6 assessment dimensions"
    - "Every plan edit recommended in the analysis is applied to the actual PLAN.md files"
    - "No stale/incorrect code references remain in the plans after edits"
  artifacts:
    - path: ".planning/quick/22-analyze-phase-plans-critically-and-propo/22-ANALYSIS.md"
      provides: "Critical analysis of plans 01-01, 01-02, 01-03 with concrete findings and plan edits"
      min_lines: 150
  key_links:
    - from: "22-ANALYSIS.md"
      to: "01-01-PLAN.md, 01-02-PLAN.md, 01-03-PLAN.md"
      via: "Findings reference specific plan sections; edits applied to plan files"
      pattern: "01-0[123]-PLAN"
---

<objective>
Critically analyze phase plans 01-01, 01-02, 01-03 for alignment with architecture/refactor goals, DRY/SRP/modularity, type safety, dead code, testability, and risks. Produce a written analysis document and apply concrete plan edits.

Purpose: The PRD (02-voice-loop-decoupled-fsm-queue-phase-prd.md) requested SRP extraction, dead code removal, and lean modular design. The research (01-RESEARCH.md) explicitly chose NOT to extract separate modules, recommending targeted modifications. This analysis determines whether the research-driven "minimal change" approach adequately satisfies the PRD intent, identifies gaps, and fixes plan-level issues found during code review.

Output: 22-ANALYSIS.md with findings + concrete edits applied to plan files.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-RESEARCH.md
@.planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-01-PLAN.md
@.planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-02-PLAN.md
@.planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-03-PLAN.md
@.planning/analysis/02-voice-loop-decoupled-fsm-queue-phase-prd.md
@src/gestures/gesture-handler.ts
@src/gestures/gesture-fsm.ts
@src/voice-loop-controller.ts
@src/__tests__/gesture-handler.test.ts
@src/__tests__/voice-loop-controller.test.ts
@src/types.ts
@src/events.ts
@src/api/gateway-client.ts
@ARCHITECTURE.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write critical analysis document (22-ANALYSIS.md)</name>
  <files>.planning/quick/22-analyze-phase-plans-critically-and-propo/22-ANALYSIS.md</files>
  <action>
Create `.planning/quick/22-analyze-phase-plans-critically-and-propo/22-ANALYSIS.md` with the following structure and content. This is a critical analysis, not a rubber stamp -- surface real issues.

## Document Structure

### 1. Architecture Alignment Assessment

Assess plans against the PRD's requested architecture (VLQ-01 through VLQ-08) and the ARCHITECTURE.md system context. Key findings to include:

**FINDING: Dead `thinking` state in gesture FSM.** The gesture FSM (`gesture-fsm.ts`) defines a `thinking` state with transitions (lines 47-52), but NO transition in the FSM ever produces `nextState: 'thinking'`. The comment on line 45 says "auto-transitions to 'thinking' externally via event bus" but there is no code in `gesture-handler.ts` or anywhere else that changes the gesture FSM state to `thinking`. The `display-controller.ts` sets `IconState` to `'thinking'` on `response_start` (line 44), but `IconState` and `GestureState` are separate types -- `IconState` drives the glasses display, `GestureState` drives the FSM. This means:
- The gesture FSM `thinking` state is **unreachable dead code**
- Plan 01-01's `must_haves` truth "response_end chunk DOES reset FSM from thinking state to idle" can NEVER be true (FSM never reaches `thinking`)
- Plan 01-01's state-aware guard `state === 'sent' || state === 'thinking'` has a dead branch (`state === 'thinking'` is always false)
- The FSM actually stays in `sent` until response_end/error resets it, even while the gateway is streaming

**Recommendation:** The plans should acknowledge this as a known dead path. The `thinking` guard branch is harmless (defensive) but the tests and must_haves should not claim to test a transition that cannot happen via the FSM. Plan 01-03 (VLQ-07) should explicitly audit and either (a) remove the `thinking` state entirely from the gesture FSM, or (b) add a `sent -> thinking` transition on `response_start` chunk to make it reachable. Option (b) is cleaner but slightly larger scope. Option (a) is safer for this phase. Document both options but recommend keeping `thinking` with a TODO for now, since removing it would cascade to the type definition which is used by the icon animator.

**FINDING: PRD vs Research -- acceptable pragmatic divergence.** The PRD requested 5 new modules (input-fsm.ts, response-pipeline.ts, voice-turn-queue.ts, voice-loop-orchestrator.ts, gateway adapter). The research correctly identified this as over-engineering for a ~14.4K LOC codebase where the queue has exactly one consumer. The plans follow the research: targeted modifications to 2 existing files. This is the right call -- SRP is satisfied at the function level (processQueue is isolated, state-aware guard is a single predicate). Extraction to separate files would add indirection with no testability benefit since both are already tested in isolation.

### 2. DRY / SRP / Modularity Assessment

**FINDING: Plan 01-02 embeds the queue type inside the factory.** The `PendingTurn` interface and `processQueue` function are defined as module-local closures inside `createVoiceLoopController`. This is acceptable DRY/SRP for now (single consumer), but the plan should note that if a second consumer ever needs queue status (e.g., hub UI showing queue count), the interface should be extracted to types.ts. No action needed now.

**FINDING: Research recommended turn ID + duplicate guard, Plan 01-02 explicitly drops it.** Plan 01-02 action says "Do NOT add turn ID generation or duplicate guard. The research recommends it but it adds complexity for a race condition that cannot occur with synchronous dispatch." This is correct -- the event bus is synchronous, `audio:recording-stop` cannot fire twice for the same recording, and the `busy` flag prevents concurrent sends. The duplicate guard in the research is YAGNI. Good decision.

**FINDING: Plan 01-02 adds `getQueueLength()` to the return interface.** This exposes internal state for testability. This is a slight SRP concern (leaking implementation detail through the interface) but acceptable for a closure-based factory pattern where the alternative is more complex dependency injection. The plan correctly justifies it.

### 3. Type Safety Assessment

**FINDING: Plan 01-02 adds `PendingTurn` as a local interface, not exported.** This is correct -- it's an implementation detail. The `VoiceLoopController` interface change (adding `getQueueLength`) needs the return type updated. Plan 01-02 correctly specifies both changes.

**FINDING: Plan 01-01 references `state` variable from closure scope.** The plan correctly identifies that `state` (line 56 of gesture-handler.ts) is a `GestureState` in closure scope. The guard `state === 'sent' || state === 'thinking'` is type-safe because GestureState is a union type. No `any` introduced.

**FINDING: No new types needed in types.ts.** The plans correctly avoid adding queue types to the shared types file. This is good -- the queue is an internal implementation detail of voice-loop-controller.

### 4. Dead Code / Testability Assessment

**FINDING: gesture-handler.ts still has stale "Phase 2 scope" comment (line 7).** Plan 01-03 correctly identifies this for removal. Good.

**FINDING: gesture-handler.ts `getHintText` JSDoc (line 24-26) says "Phase 3 will call this."** Plan 01-03 correctly identifies this for update. Good.

**FINDING: gesture-handler.test.ts has a test `gateway:chunk error resets FSM from recording to idle` (lines 239-248) that will need MODIFICATION, not just addition.** Plan 01-01 Task 2 correctly identifies this -- the test must be changed from "resets to idle" to "does NOT reset from recording." This is the most critical test change. The plan is clear about the rename and assertion change.

**FINDING: Missing test -- `thinking` state immunity to reset.** Plan 01-01 Task 2 adds tests for recording, idle, and menu immunity to reset. It does NOT add a test for `thinking` state immunity because the guard allows reset from `thinking`. However, since `thinking` is unreachable (see finding #1), the existing test `gateway:chunk error resets FSM from sent to idle` implicitly covers the actual behavior. No test gap for real behavior, but the plan should note the `thinking` unreachability.

**FINDING: voice-loop-controller.test.ts existing test `sends voice turn on recording stop` (line 81) will still pass.** Plan 01-02 correctly notes this -- the first turn fires immediately, so the existing test behavior is unchanged. Good forward compatibility.

**FINDING: Plan 01-02 Task 2 lists 9 test cases.** This is thorough. The test for `drops oldest turn when queue is full` (test #6) is the most complex and correctly verifies overflow behavior. Good.

### 5. Missing Items / Risks

**RISK: `sent -> thinking` is never triggered by the gesture FSM.** Plan 01-01's state-aware guard `state === 'sent' || state === 'thinking'` is correct as defensive code, but neither the plans nor the research acknowledge that `thinking` is dead in the gesture FSM. This should be documented.

**RISK: Watchdog fires during queue wait.** If a user records turn A, then records turn B during turn A's processing, turn B enters the queue. If turn A takes >45s, the watchdog fires from `sent` state and resets to `idle`. But the queue still has turn B pending. After reset, the voice-loop-controller's gateway onChunk will get the `response_end` or `error` for turn A, set `busy = false`, and call `processQueue()`. Turn B will then fire correctly. However, the gesture FSM state will be `idle` (from watchdog reset), not `sent`. This means the gesture-handler won't be tracking that a turn is in-flight. **This is fine** because the voice-loop-controller manages queue state independently of the gesture FSM state. But it should be documented as an edge case.

**RISK: Plan 01-02 verify command uses wrong directory path.** The verify command in Plan 01-02 Task 1 uses `cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app` which is correct, but Plan 01-01 Task 1 and Task 2 verify commands use `cd /home/forge/even-g2-openclaw-chat-app` which is a WRONG PATH. The actual working directory is `/home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app`. This needs to be fixed in Plan 01-01.

**MISSING: No plan addresses the `thinking` state transition gap.** VLQ-07 says "Remove obsolete legacy state transitions/dead paths after refactor." The `thinking` state in the gesture FSM is the most significant dead path. Plan 01-03 audits comments but does not address the unreachable `thinking` state itself. At minimum, a comment should be added to gesture-fsm.ts noting that `thinking` is currently unreachable from the FSM transition table.

**MISSING: Plan 01-03 does not test watchdog interaction with queued turns.** The research identifies Pitfall 3 (watchdog fires while queue has items) but no test covers it. This is acceptable for this phase (the interaction is safe as analyzed above), but should be noted.

### 6. Concrete Plan Edits

List each edit with the plan file, section, and exact change needed:

1. **Plan 01-01: Fix verify paths** -- Replace `cd /home/forge/even-g2-openclaw-chat-app` with `cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app` in both Task 1 and Task 2 verify commands.

2. **Plan 01-01: Add note about unreachable `thinking` state** -- In the action section of Task 1, add a comment noting that `state === 'thinking'` is defensive (currently unreachable in the FSM). The guard is still correct because if `thinking` becomes reachable in the future, the guard already handles it.

3. **Plan 01-03: Add `thinking` state audit to Task 1** -- In the action section, add step 3.5: "Add a comment to gesture-fsm.ts `thinking` block noting that no FSM transition currently produces `nextState: 'thinking'` -- the state exists for forward compatibility and display-controller uses a separate `IconState` type. Add TODO if making `thinking` reachable via `response_start` chunk is desired."

4. **Plan 01-03: Add watchdog + queue edge case note** -- In the action section, add step 5.5: "In voice-loop-controller.ts, add a comment near processQueue explaining that watchdog-triggered resets in gesture-handler do not affect queue drain (queue state is independent of FSM state)."

5. **Plan 01-01: must_haves correction** -- The truth "response_end chunk DOES reset FSM from thinking state to idle" is technically testable (you can manually set state to thinking in a test) but the FSM cannot reach thinking naturally. Change to: "response_end chunk DOES reset FSM from thinking state to idle (defensive -- thinking state unreachable in current FSM but guard is forward-compatible)".

Severity assessment:
- Edit 1 (wrong paths): **BLOCKER** -- plans will fail to execute verify commands
- Edits 2-5 (documentation/accuracy): **IMPORTANT** -- prevents confusion during execution and post-review
  </action>
  <verify>
    <automated>test -f /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app/.planning/quick/22-analyze-phase-plans-critically-and-propo/22-ANALYSIS.md && wc -l /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app/.planning/quick/22-analyze-phase-plans-critically-and-propo/22-ANALYSIS.md | awk '{if ($1 >= 150) print "PASS: "$1" lines"; else print "FAIL: only "$1" lines"}'</automated>
    <manual>Review 22-ANALYSIS.md covers all 6 dimensions with concrete code-level findings, not generic observations</manual>
  </verify>
  <done>22-ANALYSIS.md exists with 150+ lines covering architecture alignment, DRY/SRP, type safety, dead code/testability, missing items/risks, and concrete plan edits. Each finding references specific files, line numbers, and code patterns.</done>
</task>

<task type="auto">
  <name>Task 2: Apply concrete plan edits to 01-01, 01-02, and 01-03 PLAN.md files</name>
  <files>.planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-01-PLAN.md, .planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-03-PLAN.md</files>
  <action>
Apply the 5 concrete edits from the analysis document to the plan files. Read each plan file first, then apply targeted edits.

**Edit 1 -- Plan 01-01: Fix verify paths (BLOCKER)**

In `01-01-PLAN.md`, find BOTH occurrences of:
```
cd /home/forge/even-g2-openclaw-chat-app
```
Replace with:
```
cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app
```
These appear in Task 1 `<verify>` (line ~102) and Task 2 `<verify>` (line ~145).

**Edit 2 -- Plan 01-01: Add `thinking` unreachability note**

In `01-01-PLAN.md` Task 1 `<action>`, after the line that says:
```
The `state` variable is already in the closure scope (line 56).
```
Add this paragraph:
```
Note: `state === 'thinking'` is currently a defensive guard -- no FSM transition in gesture-fsm.ts produces `nextState: 'thinking'`, so the gesture FSM never reaches that state. The guard is included for forward compatibility: if a `sent -> thinking` transition is added later (e.g., on response_start chunk), the guard will already handle it correctly. The display-controller uses a separate `IconState` type for the `thinking` icon, which is unrelated to this FSM state.
```

**Edit 3 -- Plan 01-01: Fix must_haves truth about thinking**

In `01-01-PLAN.md` frontmatter `must_haves.truths`, change:
```
"response_end chunk DOES reset FSM from thinking state to idle"
```
To:
```
"response_end chunk DOES reset FSM from thinking state to idle (defensive guard -- thinking currently unreachable in FSM)"
```

**Edit 4 -- Plan 01-03: Add thinking state audit step**

In `01-03-PLAN.md` Task 1 `<action>`, after step 3 (audit gesture-fsm.ts comments), add:

```
3.5. **Document unreachable `thinking` state** in `src/gestures/gesture-fsm.ts`:
   - The `thinking` state has transitions defined (lines 47-52) but no transition in the table produces `nextState: 'thinking'`
   - The comment on line 45 says "auto-transitions to 'thinking' externally via event bus" but no such code exists
   - Add a clarifying comment above the `thinking` block: `// NOTE: No FSM transition currently produces nextState 'thinking'. This state exists for forward compatibility. Display-controller uses a separate IconState type for the thinking icon.`
   - Do NOT remove the `thinking` state -- it would cascade to the GestureState type used by the icon animator and other modules. Removal is out of scope for this phase.
```

**Edit 5 -- Plan 01-03: Add queue/watchdog independence note**

In `01-03-PLAN.md` Task 1 `<action>`, after step 5 (audit voice-loop-controller.ts comments), add:

```
5.5. **Document queue independence from FSM state** in `src/voice-loop-controller.ts`:
   - Add a comment near the queue drain logic: `// Queue state (busy flag, pendingTurns) is independent of the gesture FSM state. If a watchdog reset fires in gesture-handler (resetting FSM to idle), the queue continues to drain correctly when response_end/error arrives.`
```

Do NOT modify Plan 01-02 -- it has correct paths and accurate content.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && grep -c "bibele.kingdom.lv" .planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-01-PLAN.md | awk '{if ($1 >= 2) print "PASS: path fixed in "$1" locations"; else print "FAIL: only "$1" path fixes found"}'</automated>
    <manual>Verify: (1) Plan 01-01 has correct paths in both verify commands, (2) Plan 01-01 has thinking unreachability note in Task 1 action, (3) Plan 01-01 has updated must_haves truth, (4) Plan 01-03 has step 3.5 for thinking audit, (5) Plan 01-03 has step 5.5 for queue/watchdog note</manual>
  </verify>
  <done>All 5 plan edits applied: blocker path fix in 01-01 (2 locations), thinking state documentation in 01-01 and 01-03, must_haves accuracy fix in 01-01, queue/watchdog independence note in 01-03. Plan 01-02 unchanged (already correct).</done>
</task>

</tasks>

<verification>
After both tasks complete:

```bash
cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app

# Verify analysis document exists and has substance
wc -l .planning/quick/22-analyze-phase-plans-critically-and-propo/22-ANALYSIS.md

# Verify plan 01-01 paths are fixed (should find 0 wrong paths)
grep -c "/home/forge/even-g2-openclaw-chat-app" .planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-01-PLAN.md || echo "PASS: no wrong paths"

# Verify plan 01-01 has thinking note
grep -c "thinking.*unreachable\|defensive guard\|forward compatibility" .planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-01-PLAN.md

# Verify plan 01-03 has step 3.5
grep -c "unreachable.*thinking\|Document unreachable" .planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-03-PLAN.md
```
</verification>

<success_criteria>
- 22-ANALYSIS.md exists with 150+ lines covering all 6 assessment dimensions
- Each finding references specific files, line numbers, and code patterns (not generic advice)
- Plan 01-01 verify paths corrected from wrong path to correct path (blocker fix)
- Plan 01-01 has thinking state unreachability documentation (in action + must_haves)
- Plan 01-03 has step 3.5 for thinking state audit and step 5.5 for queue/watchdog note
- No plans introduce scope creep or unnecessary module extractions
- Analysis clearly separates "fix now" (path fix) from "document for awareness" (thinking state)
</success_criteria>

<output>
After completion, create `.planning/quick/22-analyze-phase-plans-critically-and-propo/22-SUMMARY.md`
</output>
