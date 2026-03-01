---
phase: quick-12
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - src/__tests__/glasses-renderer.test.ts
  - .planning/quick/12-self-review-the-tap-pipeline-fix-commit-/12-SUMMARY.md
autonomous: true
requirements: []

must_haves:
  truths:
    - "Commit 6fe259e correctly fixes the root cause: all rebuilt layouts now have exactly one container with isEventCapture=1"
    - "Every rebuildPageContainer call in tests asserts the isEventCapture SDK invariant"
    - "Edge cases (multiple capture containers, layout swap sequences, BLANK_LAYOUT after hide) are documented and tested"
  artifacts:
    - path: "src/__tests__/glasses-renderer.test.ts"
      provides: "isEventCapture assertions on hide() and wake() layout configs"
      contains: "isEventCapture"
    - path: ".planning/quick/12-self-review-the-tap-pipeline-fix-commit-/12-SUMMARY.md"
      provides: "Self-review analysis documenting fix sufficiency, edge cases, and safeguard"
  key_links:
    - from: "src/__tests__/glasses-renderer.test.ts"
      to: "src/display/glasses-renderer.ts"
      via: "mock bridge assertions on rebuildPageContainer config"
      pattern: "isEventCapture.*toBe"
---

<objective>
Self-review commit 6fe259e (tap-pipeline gesture event capture fix) for sufficiency, identify remaining edge cases, and add a safeguard test to prevent regression.

Purpose: The fix changed isEventCapture from 0 to 1 on CHAT_CONTAINER and BLANK_LAYOUT. The init() test was updated, but the hide() and wake() tests were NOT updated to assert the isEventCapture invariant. This leaves BLANK_LAYOUT vulnerable to silent regression. This plan closes that gap and documents the full analysis.

Output: Updated test file with isEventCapture assertions on all layout paths, plus a self-review summary document.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/display/glasses-renderer.ts
@src/__tests__/glasses-renderer.test.ts
@src/bridge/bridge-types.ts
@.planning/debug/resolved/tap-pipeline.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add isEventCapture safeguard assertions to hide() and wake() tests</name>
  <files>src/__tests__/glasses-renderer.test.ts</files>
  <action>
Add isEventCapture assertions to the two existing tests that currently lack them:

1. In the "hide() calls rebuildPageContainer with blank layout" test (around line 186):
   After the existing assertions for containerName and content, add:
   ```typescript
   // SDK invariant: exactly one container with isEventCapture=1 per page
   expect(config.textObject[0].isEventCapture).toBe(1);
   ```

2. In the "wake() calls rebuildPageContainer with 2-container layout and re-renders" test (around line 201):
   After the existing assertion for containerTotalNum (line 212), add:
   ```typescript
   // SDK invariant: exactly one container with isEventCapture=1 per page
   const statusC = config.textObject.find((t) => t.containerName === 'status')!;
   const chatC = config.textObject.find((t) => t.containerName === 'chat')!;
   expect(statusC.isEventCapture).toBe(0);
   expect(chatC.isEventCapture).toBe(1);
   ```

These additions ensure that if anyone changes BLANK_LAYOUT or CHAT_LAYOUT isEventCapture values in the future, tests will catch it immediately -- not just on init() but also on hide() and wake() paths.

Do NOT modify any other tests. Do NOT add new test cases. Just add assertions to the two existing tests.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/glasses-renderer.test.ts --reporter=verbose 2>&1 | tail -25</automated>
    <manual>Confirm the hide() test now asserts isEventCapture=1 on blank container, and wake() test asserts status=0 chat=1</manual>
  </verify>
  <done>All three layout rebuild paths (init, hide, wake) now assert the SDK isEventCapture invariant in tests. 528 tests still pass.</done>
</task>

<task type="auto">
  <name>Task 2: Write self-review summary documenting fix analysis, edge cases, and safeguard</name>
  <files>.planning/quick/12-self-review-the-tap-pipeline-fix-commit-/12-SUMMARY.md</files>
  <action>
Create the summary document with the following self-review analysis:

## Fix Sufficiency Analysis

**Commit 6fe259e is sufficient.** The fix correctly addresses the root cause:
- CHAT_CONTAINER.isEventCapture changed from 0 to 1 (the gesture-capturing container in the 2-container chat layout)
- BLANK_LAYOUT's single container.isEventCapture changed from 0 to 1 (the only container in the hide layout)
- STATUS_CONTAINER remains isEventCapture=0 (correct -- only one container per page should capture)

**What was done well:**
- Root cause was identified precisely via the debug session protocol
- The SDK contract ("exactly one container per page with isEventCapture=1") was correctly understood and applied
- The init() test was updated to assert the invariant with per-container checks (not just a blanket assertion)

## Edge Cases Reviewed

1. **Multiple capture containers:** Not a risk. CHAT_LAYOUT has status=0, chat=1 (exactly one). BLANK_LAYOUT has blank=1 (exactly one). SDK docs say having >1 is undefined behavior -- current code is correct.

2. **Dynamic layout swaps (hide/wake cycles):** The sequence init()->CHAT_LAYOUT, hide()->BLANK_LAYOUT, wake()->CHAT_LAYOUT always passes through rebuildPageContainer. Each layout now has exactly one capture container. No intermediate state exists where events would be lost.

3. **SDK contract drift:** isEventCapture is typed as `number` in bridge-types.ts. The SDK uses 0/1 (not boolean). If a future SDK version changes this contract, the type system won't catch it since it's just `number`. This is an accept-and-monitor risk -- the type comes from the SDK's own TypeScript definitions.

4. **No other layout definitions exist:** Grep confirms CHAT_LAYOUT and BLANK_LAYOUT are the only two PageContainerConfig objects in the codebase (plus STARTUP_LAYOUT in even-bridge.ts which already had isEventCapture=1). No risk of undiscovered layouts.

5. **STARTUP_LAYOUT -> CHAT_LAYOUT transition:** STARTUP_LAYOUT in even-bridge.ts has isEventCapture=1. When renderer.init() rebuilds to CHAT_LAYOUT, events continue flowing. Before this fix, this transition was the exact point where events stopped.

## Safeguard Applied

Added isEventCapture assertions to the hide() and wake() tests in glasses-renderer.test.ts. Previously only the init() test checked this invariant. Now all three rebuildPageContainer call sites are covered:
- init() -> CHAT_LAYOUT: status=0, chat=1 (existing test, updated in 6fe259e)
- hide() -> BLANK_LAYOUT: blank=1 (NEW assertion)
- wake() -> CHAT_LAYOUT: status=0, chat=1 (NEW assertion)

## Recommendation

No further action needed. The fix is complete, the debug session is archived, and all three layout paths are now tested for the SDK isEventCapture invariant.
  </action>
  <verify>
    <automated>test -f /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app/.planning/quick/12-self-review-the-tap-pipeline-fix-commit-/12-SUMMARY.md && echo "PASS: summary exists"</automated>
  </verify>
  <done>Self-review summary documents fix sufficiency (yes, it is sufficient), 5 edge cases reviewed (none are active risks), and the safeguard test additions made in Task 1.</done>
</task>

</tasks>

<verification>
All 528 tests pass (no regressions). The three layout rebuild paths (init, hide, wake) all assert the SDK isEventCapture invariant. Summary document captures the full self-review analysis.
</verification>

<success_criteria>
- hide() test asserts isEventCapture=1 on blank container
- wake() test asserts status.isEventCapture=0, chat.isEventCapture=1
- All 528 tests pass
- Summary document covers: fix sufficiency, 5 edge cases, safeguard rationale
</success_criteria>

<output>
After completion, the summary already lives at `.planning/quick/12-self-review-the-tap-pipeline-fix-commit-/12-SUMMARY.md`
</output>
