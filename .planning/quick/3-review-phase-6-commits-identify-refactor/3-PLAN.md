---
phase: quick-03
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/quick/3-review-phase-6-commits-identify-refactor/3-REVIEW.md
  - src/glasses-main.ts
  - src/display/glasses-renderer.ts
  - src/voice-loop-controller.ts
  - src/display/display-controller.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "A structured review document exists cataloging Phase 6 strengths, refactoring opportunities, and technical debt"
    - "Any low-risk, obvious fixes identified during review are applied and tests still pass"
  artifacts:
    - path: ".planning/quick/3-review-phase-6-commits-identify-refactor/3-REVIEW.md"
      provides: "Structured code review of Phase 6 commits"
      contains: "## 1. What Was Done Well"
  key_links: []
---

<objective>
Critically review all Phase 6 source files (the actual .ts files committed between daf3e97..5febf55), identify concrete refactoring opportunities and technical debt, produce a structured review document, and apply any low-risk obvious fixes.

Purpose: Capture learnings and debt before Phase 7 (Error Handling & Lifecycle) begins, so Phase 7 plans can account for existing issues.
Output: 3-REVIEW.md document + any atomic fix commits
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/phases/06-runtime-wiring/06-01-SUMMARY.md
@.planning/phases/06-runtime-wiring/06-02-SUMMARY.md
@.planning/phases/06-runtime-wiring/06-VERIFICATION.md
@.planning/quick/1-review-last-commits-and-document-what-wa/1-REVIEW.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Critical code review of all Phase 6 source files</name>
  <files>
    .planning/quick/3-review-phase-6-commits-identify-refactor/3-REVIEW.md
  </files>
  <action>
Read every source file that was created or modified during Phase 6 execution (commits 63c7044, 83eee18, 2a1a64a, 678f9d7). The full list of files to review:

**Created in Phase 6:**
- src/voice-loop-controller.ts (51 lines)
- src/__tests__/voice-loop-controller.test.ts (151 lines)
- src/glasses-main.ts (84 lines)
- src/hub-main.ts (440 lines -- extracted from old main.ts)

**Modified in Phase 6:**
- src/main.ts (reduced to 23-line router)
- src/types.ts (4 orphaned events removed)
- src/bridge/even-bridge.ts (CLICK_EVENT quirk fix)
- src/bridge/bridge-mock.ts (spacebar shortcut)
- src/display/display-controller.ts (hint bar removed, settle period added)
- src/display/glasses-renderer.ts (2-container layout, welcome, buffer, scroll)
- src/__tests__/display-controller.test.ts
- src/__tests__/glasses-renderer.test.ts
- src/__tests__/even-bridge.test.ts
- src/__tests__/bridge-mock.test.ts

For each file, critically evaluate:
1. **Correctness** -- Are there logic bugs, race conditions, unhandled edge cases?
2. **Error handling** -- Are failures caught? What happens when things go wrong?
3. **Type safety** -- Any `as any`, `!` assertions, type holes?
4. **Resource cleanup** -- Are timers cleared? Event listeners removed? Memory leaks?
5. **Test coverage gaps** -- Is the behavior tested? What cases are missing?
6. **Code quality** -- Dead code, unclear naming, violation of established patterns?

Cross-reference with Phase 7 requirements (ERR-01, ERR-02, ERR-03) to identify what Phase 6 code needs error handling that it currently lacks.

Also compare against the Quick Task 1 review (1-REVIEW.md) to check: which P1/P2/P3 items from that earlier review were addressed by Phase 6, and which still remain?

Produce the review as `.planning/quick/3-review-phase-6-commits-identify-refactor/3-REVIEW.md` with these sections:

```
# Code Review: Phase 6 Runtime Wiring

**Scope:** [files reviewed]
**Commits:** 63c7044, 83eee18, 2a1a64a, 678f9d7
**Reviewed:** [date]
**Baseline:** 247 tests passing

## 1. What Was Done Well
[Specific patterns, decisions, code quality highlights with file:line references]

## 2. What to Refactor Now (Pre-Phase-7)
[Concrete issues that should be fixed before Phase 7 starts, with file:line, code snippets, and recommended fixes. Focus on things that would make Phase 7 harder if left unfixed.]

## 3. Technical Debt Inventory
[Prioritized table: P1 (blocks Phase 7), P2 (should fix during Phase 7), P3 (defer to Phase 8 or later)]

## 4. Edge Cases and Missing Test Coverage
[Specific untested scenarios with reproduction steps]

## 5. Phase 7 Readiness Assessment
[What Phase 6 code needs for ERR-01 (error recovery to idle), ERR-02 (30s timeout), ERR-03 (cleanup on close). Identify exact files and methods that need modification.]

## 6. Status of Previous Review Items
[Cross-reference 1-REVIEW.md items -- mark as resolved, partially resolved, or still open]
```
  </action>
  <verify>
    <automated>test -f .planning/quick/3-review-phase-6-commits-identify-refactor/3-REVIEW.md && grep -c "^##" .planning/quick/3-review-phase-6-commits-identify-refactor/3-REVIEW.md | xargs test 6 -le</automated>
    <manual>Review document exists with all 6 required sections and contains specific file:line references</manual>
  </verify>
  <done>3-REVIEW.md exists with all 6 sections, contains specific file references and line numbers, references Phase 7 requirements, and cross-references previous review items</done>
</task>

<task type="auto">
  <name>Task 2: Apply low-risk obvious fixes found during review</name>
  <files>
    src/glasses-main.ts
    src/display/glasses-renderer.ts
    src/voice-loop-controller.ts
    src/display/display-controller.ts
  </files>
  <action>
Based on the review from Task 1, apply any fixes that meet ALL of these criteria:
- Low risk: change is mechanical/obvious, not a design decision
- Self-contained: does not require changes across multiple subsystems
- Test-safe: existing tests still pass after the change (or new tests are trivially added)

Examples of acceptable fixes:
- Remove dead code or unused imports
- Add missing null/undefined guards where the lack is obviously a bug
- Fix type assertions that can be replaced with proper typing
- Add missing error handling where the omission is clearly an oversight (not a Phase 7 design choice)
- Fix obvious resource leak (e.g., timer not cleared on a code path)

Examples of things NOT to fix in this task (save for Phase 7 plans):
- Architectural changes (e.g., restructuring the boot sequence)
- Adding error recovery logic (that is Phase 7's job -- ERR-01, ERR-02, ERR-03)
- Changing public interfaces or adding new features
- Anything that requires a design decision

For each fix applied:
1. Make the change
2. Run `npx vitest run` to verify all 247+ tests still pass
3. Commit atomically with message: `fix(06): [description of what was fixed]`

If no fixes meet the criteria, skip this task and note "No low-risk fixes identified" in the summary. Do not force fixes.

Update 3-REVIEW.md section 2 to mark any items that were fixed with "[FIXED in this review]".
  </action>
  <verify>
    <automated>npx vitest run 2>&1 | tail -5</automated>
    <manual>All tests pass, any commits are atomic and well-described</manual>
  </verify>
  <done>All low-risk fixes applied and committed atomically, tests still pass (247+), review document updated to reflect fixes</done>
</task>

</tasks>

<verification>
- 3-REVIEW.md exists with all 6 required sections
- All 247+ tests pass after any fixes
- Any fix commits are atomic with clear messages
- Review contains specific file:line references, not vague observations
- Phase 7 readiness section maps ERR-01/02/03 to specific Phase 6 files
</verification>

<success_criteria>
- Structured review document produced at .planning/quick/3-review-phase-6-commits-identify-refactor/3-REVIEW.md
- Review identifies concrete, actionable items (not generic advice)
- Previous review (1-REVIEW.md) items are cross-referenced for continuity
- Any obvious fixes are applied without breaking tests
- Phase 7 planning has clear input on what Phase 6 code needs modification
</success_criteria>

<output>
After completion, create `.planning/quick/3-review-phase-6-commits-identify-refactor/3-SUMMARY.md`
</output>
