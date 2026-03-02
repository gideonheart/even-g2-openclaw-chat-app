---
phase: quick-21
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-01-PLAN.md
  - .planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-02-PLAN.md
  - .planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-03-PLAN.md
autonomous: true
requirements: [VLQ-01, VLQ-02, VLQ-03, VLQ-04, VLQ-05, VLQ-06, VLQ-07, VLQ-08]

must_haves:
  truths:
    - "All verify/cd paths in all three plans use /home/forge/even-g2-openclaw-chat-app (the symlink)"
    - "01-02 has test requirements for stale response_end/error while idle (busy=false guard)"
    - "01-02 has test requirement for out-of-order chunk while queue idle proving no side effects"
    - "All typecheck commands use npm run typecheck (not npx tsc --noEmit)"
    - "01-03 transcript-first verification references the exact display-controller test name"
  artifacts:
    - path: ".planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-01-PLAN.md"
      provides: "Patched verify paths"
      contains: "cd /home/forge/even-g2-openclaw-chat-app"
    - path: ".planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-02-PLAN.md"
      provides: "Patched verify paths, idle guard tests, npm run typecheck"
      contains: "stale response_end while idle"
    - path: ".planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-03-PLAN.md"
      provides: "Patched verify paths, npm run typecheck, explicit transcript-first test name"
      contains: "gateway:chunk type=transcript -> addUserMessage"
  key_links: []
---

<objective>
Patch the three Phase 1 plan files for correctness before execution begins.

Purpose: The plans have incorrect absolute paths in verify commands (use the full repo path instead of the symlink), miss two important queue edge-case test requirements in 01-02, use `npx tsc --noEmit` instead of the project's `npm run typecheck` script, and 01-03's transcript-first verification is too vague. Fixing these before execution prevents executor confusion and ensures edge cases are tested.

Output: Three corrected PLAN.md files ready for execution.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-01-PLAN.md
@.planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-02-PLAN.md
@.planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-03-PLAN.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix verify paths and typecheck commands in all three plan files</name>
  <files>.planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-01-PLAN.md, .planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-02-PLAN.md, .planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-03-PLAN.md</files>
  <action>
In ALL THREE plan files, apply these two global replacements:

**Path fix (all three files):**
Replace every occurrence of:
  `cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app`
with:
  `cd /home/forge/even-g2-openclaw-chat-app`

Occurrences by file:
- 01-01-PLAN.md: 3 occurrences (line 102 Task 1 verify, line 145 Task 2 verify, line 157 verification section)
- 01-02-PLAN.md: 3 occurrences (line 159 Task 1 verify, line 235 Task 2 verify, line 247 verification section)
- 01-03-PLAN.md: 3 occurrences (line 96 Task 1 verify, line 115 Task 2 verify, line 133 verification section)

**Typecheck command fix (01-02 and 01-03):**

In 01-02-PLAN.md:
- Line 159: Change `npx tsc --noEmit 2>&1 | head -20` to `npm run typecheck 2>&1 | head -20`
- Line 267 (success_criteria): Change `npx tsc --noEmit` to `npm run typecheck`

In 01-03-PLAN.md:
- Line 89 (Task 1 action step 6): Change `npx tsc --noEmit` to `npm run typecheck`
- Line 96 (Task 1 verify automated): Change `npx tsc --noEmit && npx vitest run` to `npm run typecheck && npx vitest run`
- Line 118 (Task 2 verify manual step 2): Change `npx tsc --noEmit` to `npm run typecheck`
- Line 134 (verification section): Change `npx tsc --noEmit` to `npm run typecheck`
- Line 151 (success_criteria): Change `npx tsc --noEmit` to `npm run typecheck`

Do NOT change `npx vitest run` commands -- only `npx tsc --noEmit` becomes `npm run typecheck`. The project has `"typecheck": "tsc --noEmit"` in package.json, making `npm run typecheck` the canonical way.
  </action>
  <verify>
    <automated>cd /home/forge/even-g2-openclaw-chat-app && grep -c "bibele.kingdom.lv" .planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-0*-PLAN.md | grep -v ":0$" | wc -l</automated>
    <manual>The automated check should output 0 (no files contain the old path). Also spot-check that npm run typecheck appears where npx tsc --noEmit used to be.</manual>
  </verify>
  <done>Zero occurrences of the old bibele.kingdom.lv path remain in any plan file. All typecheck commands use `npm run typecheck` instead of `npx tsc --noEmit`.</done>
</task>

<task type="auto">
  <name>Task 2: Add idle-guard and stale-chunk tests to 01-02 plan, and explicit transcript-first verification to 01-03 plan</name>
  <files>.planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-02-PLAN.md, .planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-03-PLAN.md</files>
  <action>
**In 01-02-PLAN.md, Task 2 action section** (the test list starting at line 172), add two new tests after test 9 (the log spy test):

10. **`stale response_end while idle (busy=false) does NOT trigger processQueue or send`**:
   - Create controller, do NOT emit any recording-stop (queue empty, busy=false)
   - Call `gateway.simulateChunk({ type: 'response_end' })`
   - Assert `gateway.sendVoiceTurn` was never called
   - Assert `controller.getQueueLength()` is 0
   - This proves the `if (busy || pendingTurns.length === 0) return` guard in processQueue works: a stale response_end arriving while the queue is idle does not cause unexpected sends.

11. **`stale error chunk while idle does NOT trigger processQueue or corrupt state`**:
   - Create controller, do NOT emit any recording-stop
   - Call `gateway.simulateChunk({ type: 'error', error: 'stale timeout' })`
   - Assert `gateway.sendVoiceTurn` was never called
   - Assert `controller.getQueueLength()` is 0
   - Then emit one recording-stop (to prove state is not corrupted)
   - Assert `gateway.sendVoiceTurn` was called once (first turn fires immediately, proving busy flag was not left in corrupt state)

Also add to 01-02-PLAN.md must_haves truths (in the frontmatter):
- Add: `"Stale response_end/error while busy=false (idle queue) does NOT trigger processQueue or send"`
- Add: `"Stale error while idle does not corrupt busy flag (subsequent recording still fires immediately)"`

Also add to 01-02-PLAN.md success_criteria section:
- Add: `- Stale response_end while idle does not trigger processQueue or any send`
- Add: `- Stale error while idle does not corrupt busy flag (next recording still fires immediately)`

Also add to 01-02-PLAN.md done for Task 2:
- Append: `, stale response_end/error while idle proven harmless`

**In 01-03-PLAN.md, make transcript-first verification explicit:**

In the must_haves truths (frontmatter), change:
  `"Transcript-first rendering on glasses is not regressed (display-controller test still passes)"`
to:
  `"Transcript-first rendering on glasses is not regressed (display-controller test 'gateway:chunk type=transcript -> addUserMessage + setIconState(sent)' still passes)"`

In Task 1 action step 7, change:
  `npx vitest run src/__tests__/display-controller.test.ts -- all tests must pass`
  `This verifies VLQ-05 (transcript rendering preserved)`
to:
  `npx vitest run src/__tests__/display-controller.test.ts -- all tests must pass`
  `Specifically verify the test 'gateway:chunk type=transcript -> addUserMessage + setIconState(sent)' passes. This test proves transcript-first behavior: when a transcript chunk arrives, addUserMessage renders the user's speech bubble BEFORE the AI response stream begins (setIconState changes to sent). This is the core VLQ-05 assertion.`

In 01-03-PLAN.md success_criteria, change:
  `- display-controller tests pass (VLQ-05 transcript preservation)`
to:
  `- display-controller test 'gateway:chunk type=transcript -> addUserMessage + setIconState(sent)' passes (VLQ-05: user bubble renders before AI response)`

In 01-03-PLAN.md verification section specific checks, add:
  `- display-controller: test 'gateway:chunk type=transcript -> addUserMessage + setIconState(sent)' passes (transcript-first rendering preserved)`
  </action>
  <verify>
    <automated>cd /home/forge/even-g2-openclaw-chat-app && grep -c "stale response_end while idle" .planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-02-PLAN.md && grep -c "addUserMessage + setIconState" .planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-03-PLAN.md</automated>
    <manual>01-02 should have 2+ mentions of the idle guard test. 01-03 should have 3+ mentions of the exact display-controller test name.</manual>
  </verify>
  <done>01-02 has two new test requirements proving stale response_end/error while idle are harmless (no processQueue trigger, no state corruption). 01-03 references the exact display-controller test name for transcript-first verification with explicit explanation of what it proves.</done>
</task>

</tasks>

<verification>
After both tasks complete, verify all patches applied correctly:

```bash
cd /home/forge/even-g2-openclaw-chat-app

# Patch 1: No old paths remain
grep -r "bibele.kingdom.lv" .planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-0*-PLAN.md && echo "FAIL: old path found" || echo "PASS: old paths removed"

# Patch 2: Idle guard tests exist in 01-02
grep "stale response_end while idle" .planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-02-PLAN.md && echo "PASS: idle guard test present" || echo "FAIL: missing"

# Patch 3: Stale error test exists in 01-02
grep "stale error chunk while idle" .planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-02-PLAN.md && echo "PASS: stale error test present" || echo "FAIL: missing"

# Patch 4: npm run typecheck used (not npx tsc --noEmit) in 01-02 and 01-03
grep "npx tsc --noEmit" .planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-02-PLAN.md .planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-03-PLAN.md && echo "FAIL: npx tsc still present" || echo "PASS: all converted to npm run typecheck"

# Patch 5: Exact transcript test name in 01-03
grep "addUserMessage + setIconState" .planning/phases/01-v1-4-voice-loop-polish-decoupled-input-voice-queue/01-03-PLAN.md && echo "PASS: exact test name present" || echo "FAIL: missing"
```

All 5 patches should report PASS.
</verification>

<success_criteria>
- Zero occurrences of `bibele.kingdom.lv` in any of the three plan files
- All `cd` paths in verify commands use `/home/forge/even-g2-openclaw-chat-app`
- 01-02 Task 2 has test 10 (stale response_end while idle) and test 11 (stale error while idle)
- 01-02 must_haves truths include idle guard behavior
- 01-02 success_criteria include idle guard verification
- All `npx tsc --noEmit` in 01-02 and 01-03 replaced with `npm run typecheck`
- 01-03 must_haves truth references exact test name: `gateway:chunk type=transcript -> addUserMessage + setIconState(sent)`
- 01-03 success_criteria references exact test name for VLQ-05
- 01-03 Task 1 action step 7 explains what transcript-first means and which test proves it
</success_criteria>

<output>
After completion, create `.planning/quick/21-patch-phase-1-plan-files-for-correctness/21-SUMMARY.md`
</output>
