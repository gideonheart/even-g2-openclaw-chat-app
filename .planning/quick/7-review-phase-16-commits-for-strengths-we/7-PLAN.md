---
phase: quick-7
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/quick/7-review-phase-16-commits-for-strengths-we/7-REVIEW.md
autonomous: true
requirements: [REVIEW-16]

must_haves:
  truths:
    - "Review document identifies concrete strengths with file:line references"
    - "Review document identifies concrete weaknesses with file:line references and fix suggestions"
    - "Review document identifies unhandled edge cases with severity and impact"
    - "Review document lists required fixes before milestone audit"
  artifacts:
    - path: ".planning/quick/7-review-phase-16-commits-for-strengths-we/7-REVIEW.md"
      provides: "Phase 16 code review with strengths, weaknesses, edge cases, fixes"
      min_lines: 80
  key_links: []
---

<objective>
Review all Phase 16 (sync-hardening) commits for code quality, edge cases, and required fixes before milestone audit.

Purpose: Pre-audit quality gate -- identify anything that would fail a milestone review so it can be fixed proactively.
Output: Structured review document with exact file paths and actionable findings.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/phases/16-sync-hardening/16-01-SUMMARY.md
@.planning/phases/16-sync-hardening/16-02-SUMMARY.md
@.planning/phases/16-sync-hardening/16-VERIFICATION.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Deep code review of Phase 16 source and test files</name>
  <files>.planning/quick/7-review-phase-16-commits-for-strengths-we/7-REVIEW.md</files>
  <action>
Read every Phase 16 source and test file, plus the boot wiring sections in glasses-main.ts and hub-main.ts. Produce a structured review document with these exact sections:

**Files to review:**
- src/sync/sync-monitor.ts (109 lines)
- src/sync/drift-reconciler.ts (54 lines)
- src/sync/sync-types.ts (lines 1-44, focus on new additions)
- src/persistence/conversation-store.ts (countMessages at lines 252-260)
- src/persistence/types.ts (countMessages interface addition)
- src/types.ts (sync:drift-detected and sync:reconciled event additions)
- src/__tests__/sync-monitor.test.ts (336 lines, 13 tests)
- src/__tests__/drift-reconciler.test.ts (146 lines, 7 tests)
- src/glasses-main.ts (Phase 16 additions: lines 25-26, 157-183, 249, 279-294, 406-407)
- src/hub-main.ts (Phase 16 additions: lines 24-25, 41, 954-956, 1059-1080)

**Review document structure:**

## Strengths
For each strength: what pattern, why it matters, exact file:line reference.
Evaluate: TDD discipline, API design, error handling, performance, type safety, test coverage quality.

## Weaknesses
For each weakness: what the issue is, severity (P0-P3), exact file:line, concrete fix suggestion.
Evaluate: missing error handling, potential memory leaks, race conditions, type safety gaps, test coverage gaps, code duplication, separation of concerns.

Specific areas to scrutinize:
1. SyncMonitor heartbeat interval -- does setInterval leak if startHeartbeat called twice? (check guard at line 64)
2. DriftReconciler handleHeartbeat -- is the conversation-change reset logic correct? (lines 27-29 vs line 32 ordering)
3. countMessages error handling -- reject vs resolve(0) on IDB error
4. Boot wiring null guards -- are all paths safe when store is null?
5. Hub driftReconciler.onReconciled calling loadLiveConversation() -- is this safe during streaming?
6. Glasses sync:reconciled handler -- does renderer.destroy()+init() leak if called during active streaming?
7. Hub beforeunload teardown -- does it cover driftReconciler.destroy()?
8. Test mocks -- do they accurately represent real SyncBridge behavior?
9. SyncMonitor.send() not used by existing callers -- is it wired or orphaned?
10. seq field optional on SyncMessage -- do existing postMessage callers still work without seq?

## Unhandled Edge Cases
For each: scenario description, likelihood (high/med/low), impact if triggered, affected file:line.
Consider: rapid session switching during heartbeat, IDB errors during countMessages in heartbeat callback, BroadcastChannel closure mid-heartbeat, concurrent drift reconciliation from both contexts, destroy() called during pending async handleHeartbeat.

## Required Fixes (Before Milestone Audit)
Ordered by priority. For each: what to fix, why it blocks audit, file:line, estimated effort (trivial/small/medium).
Only list genuine blockers -- not style preferences.

## Test Coverage Assessment
List any behaviors that lack test coverage and should have it.
  </action>
  <verify>
    <automated>test -f .planning/quick/7-review-phase-16-commits-for-strengths-we/7-REVIEW.md && wc -l .planning/quick/7-review-phase-16-commits-for-strengths-we/7-REVIEW.md | awk '{if ($1 >= 80) print "PASS: "$1" lines"; else print "FAIL: only "$1" lines"}'</automated>
    <manual>Review document contains all 5 sections with file:line references</manual>
  </verify>
  <done>7-REVIEW.md exists with Strengths, Weaknesses, Unhandled Edge Cases, Required Fixes, and Test Coverage Assessment sections, each with exact file:line references and actionable specifics</done>
</task>

</tasks>

<verification>
- 7-REVIEW.md exists and has all 5 required sections
- Every finding has an exact file:line reference
- Weaknesses have severity ratings and fix suggestions
- Edge cases have likelihood and impact ratings
- Required fixes are ordered by priority with effort estimates
</verification>

<success_criteria>
- Review document is comprehensive enough that a developer can act on every finding without re-reading the source
- No vague findings like "could be better" -- every item is specific and actionable
- Strengths section is honest, not filler
</success_criteria>

<output>
After completion, the review is self-contained in 7-REVIEW.md. No SUMMARY needed for quick tasks.
</output>
