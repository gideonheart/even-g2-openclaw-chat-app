---
phase: quick-9
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/quick/9-review-hotfix-commits-for-risks-edge-cas/9-REVIEW.md
  - .planning/debug/ui-hotfix-confirm-and-glasses-text.md
  - src/hub-main.ts
autonomous: true
requirements: [REVIEW-HOTFIX]

must_haves:
  truths:
    - "Comprehensive written review exists documenting what went well, what risks remain, and what follow-up work is needed"
    - "Debug doc is updated to resolved status with root causes documented"
    - "Any zero-cost safety improvements are applied inline"
  artifacts:
    - path: ".planning/quick/9-review-hotfix-commits-for-risks-edge-cas/9-REVIEW.md"
      provides: "Structured hotfix review with strengths, risks, and follow-up backlog"
  key_links: []
---

<objective>
Review the five recent hotfix commits (8593545, 7776c48, 54af22e, 3492822, dffcde2) for strengths, remaining risks/edge-cases (CSS specificity, modal stacking, pointer-events, z-index interactions), and produce a follow-up action list.

Purpose: Ensure the hotfix chain is fully understood, risks are documented, and the unfinished debug doc is closed out.
Output: 9-REVIEW.md with structured analysis + resolved debug doc + any zero-cost inline fixes.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@index.html (lines 1-200 — inline CSS with z-index/modal rules)
@src/hub-main.ts (1330 lines — modal open/close/boot defense logic)
@src/__tests__/nav-switching.test.ts (250 lines — regression tests)
@src/__tests__/confirm-modal.test.ts (90 lines — confirm modal safety tests)
@.planning/debug/ui-hotfix-confirm-and-glasses-text.md (unresolved debug doc)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write structured hotfix review</name>
  <files>.planning/quick/9-review-hotfix-commits-for-risks-edge-cas/9-REVIEW.md</files>
  <action>
Analyze commits 8593545, 7776c48, 54af22e, 3492822, dffcde2 and produce a structured review document covering:

**A. What went well (Strengths):**
1. Root cause analysis quality: The CSS source-order / specificity bug in Vite production builds was correctly identified as `#app ~ .modal` specificity (0,1,1,0) beating SDK `.modal` (0,0,1,0), with the critical insight that Vite production builds flip `<link>` vs `<style>` ordering vs dev mode.
2. Defense-in-depth layering: Three independent CSS defenses (display:none !important, pointer-events:none, visibility:hidden) plus JS boot-time classList.remove('active') for both modals.
3. Regression test quality: 250-line nav-switching test suite with CSS assertion tests that verify the inline HTML structure, not just runtime DOM.
4. Incremental fix chain: 54af22e -> 7776c48 -> 8593545 progressively hardened rather than rushing a single commit.
5. Commit messages: Excellent root cause documentation in commit bodies (searchable for future archaeology).
6. Gesture debounce fix (54af22e): Correctly identified SDK trailing tap quirk and added 275ms debounce.
7. Connect button removal (3492822): Honest UX — replaced non-functional button with read-only status indicator.

**B. Remaining risks and edge cases:**

1. **Modal stacking (MEDIUM):** If confirmModal opens while sessionModal is active (e.g., deleting a session triggers confirmModal), both modals compete at z-index:300. Currently works because sessionModal stays open behind confirmModal, but there is no z-index stacking order between the two modals. If both have `.active`, both get `display:flex !important` — the DOM order determines visual stacking. Document this is safe because confirmModal is a child action of sessionModal flows, but note it would break if a third modal is added.

2. **`!important` escalation (LOW):** Three `!important` declarations now exist (modal display:none, modal display:flex, #app padding). If Even SDK ever adds `!important` to their rules, we lose the specificity war entirely and have no further CSS escalation path. The only remaining defense would be inline `style=""` attributes set via JS. Document this as a known ceiling.

3. **z-index map not centralized (LOW):** Current z-index stack: bottom-nav=100, error-banner=150(sticky), toast=200, modals=300. These are scattered across inline `<style>` with no CSS custom properties or documented z-index scale. Adding new positioned elements risks accidental overlap.

4. **Backdrop click race condition (LOW):** Both modals use `e.target === $('modalId')` for backdrop dismiss. If modal content has `padding:0` and the user clicks on the modal panel's edge, clicks might propagate to the backdrop. Currently safe because `.modal__panel` has padding, but fragile if panel styling changes.

5. **confirmAction execution-after-close (LOW):** `confirmAction()` clears `pendingConfirm` then closes modal then executes action. The action callback (e.g., delete session) runs async operations AFTER the modal is already closed. If the action fails, the user sees no feedback other than a toast. The confirm modal cannot be re-shown to retry. Currently acceptable but worth noting for future error handling.

6. **No focus trap in modals (LOW):** Neither modal traps focus — keyboard users can tab to elements behind the modal. Not a P0 but relevant for accessibility.

7. **Even SDK CSS coupling (MEDIUM):** The entire fix chain is defensive AGAINST the SDK's CSS. If the SDK changes its modal class name from `.modal` to something else, or changes from `display:flex` to `display:grid`, the defense-in-depth rules would still apply (they target our own `.modal` class) but might not cover new SDK patterns. The `#app ~ .modal` selector assumes modals are siblings of `#app` in the DOM.

**C. Follow-up refactors / action items:**

| Priority | Item | Effort | Why |
|----------|------|--------|-----|
| P2 | Extract z-index values into CSS custom properties (--z-nav, --z-toast, --z-modal) | 15min | Prevents accidental overlap when adding new positioned elements |
| P2 | Add z-index stacking order comment/map in index.html | 5min | Documentation for future maintainers |
| P3 | Add aria-modal="true" and focus trap to both modals | 30min | Accessibility — keyboard users can currently tab behind modals |
| P3 | Extract modal open/close into a reusable function | 20min | DRY — confirmModal and sessionModal have duplicated open/close patterns |
| P3 | Resolve debug doc .planning/debug/ui-hotfix-confirm-and-glasses-text.md | 5min | Close the loop on the original investigation |
| P4 | Consider extracting modal CSS to a dedicated `<style>` block or component | 30min | Reduces inline CSS sprawl, easier to maintain |
| P4 | Add E2E test for modal interaction on production build | 1hr | Current tests verify HTML structure, not actual CSS cascade in built output |

**D. Test coverage assessment:**
- nav-switching.test.ts: 250 lines covering all 4 pages, CSS defense assertions, boot state
- confirm-modal.test.ts: 90 lines covering null guard, callback execution, cancel behavior, CSS specificity
- gesture-handler.test.ts: Added trailing tap debounce tests
- Total hotfix-related tests: ~20 new test cases across 3 files
- Gap: No tests verify actual CSS cascade behavior (would require real browser/headless Chrome)
  </action>
  <verify>
    <automated>test -f .planning/quick/9-review-hotfix-commits-for-risks-edge-cas/9-REVIEW.md && grep -c "##" .planning/quick/9-review-hotfix-commits-for-risks-edge-cas/9-REVIEW.md</automated>
    <manual>Review document covers strengths, risks, and follow-up items</manual>
  </verify>
  <done>9-REVIEW.md exists with sections: Strengths, Remaining Risks, Follow-up Actions, Test Coverage Assessment. Each risk has severity rating and explanation.</done>
</task>

<task type="auto">
  <name>Task 2: Resolve debug doc and apply zero-cost fixes</name>
  <files>.planning/debug/ui-hotfix-confirm-and-glasses-text.md, src/hub-main.ts</files>
  <action>
1. Update `.planning/debug/ui-hotfix-confirm-and-glasses-text.md`:
   - Set `status: resolved`
   - Fill in root_cause: "Issue 1: confirmAction() called pendingConfirm before clearing it, causing re-entrant modal open if callback triggered another confirm. Fixed in 54af22e by reordering (clear -> close -> execute). Issue 2: glasses-renderer.ts showed generic 'Open companion app to configure' text — changed to specific 'Set Gateway URL in companion app Settings' in 54af22e."
   - Fill in fix: "Commits 54af22e (initial fixes), 7776c48 (CSS specificity), 8593545 (defense-in-depth)"
   - Fill in verification: "524 tests pass including 20 new regression tests for modal defense and nav switching"
   - Fill in files_changed: `[index.html, src/hub-main.ts, src/display/glasses-renderer.ts, src/gestures/gesture-handler.ts, src/__tests__/nav-switching.test.ts, src/__tests__/confirm-modal.test.ts, src/__tests__/gesture-handler.test.ts, src/__tests__/glasses-renderer.test.ts]`

2. In `src/hub-main.ts`, add a brief z-index reference comment near the top of the file (after the imports block) as a zero-cost documentation fix:
   ```
   // z-index stacking order (defined in index.html inline <style>):
   //   100 = bottom-nav-wrap (fixed bottom navigation)
   //   150 = error-banner (sticky top, within scroll flow)
   //   200 = toast-container (fixed, above nav)
   //   300 = modals (sessionModal, confirmModal — full-screen overlay)
   ```
   Place this comment right before the first function or after the last import/const declaration block, wherever is most natural.

3. Run `npx vitest run` to confirm all 524 tests still pass after changes.
  </action>
  <verify>
    <automated>grep -q "status: resolved" .planning/debug/ui-hotfix-confirm-and-glasses-text.md && grep -q "z-index stacking order" src/hub-main.ts && npx vitest run --reporter=dot 2>&1 | tail -5</automated>
    <manual>Debug doc shows resolved status; hub-main.ts has z-index reference comment</manual>
  </verify>
  <done>Debug doc resolved with root cause and fix references. hub-main.ts has z-index stacking reference comment. All 524 tests pass.</done>
</task>

</tasks>

<verification>
- 9-REVIEW.md exists with all required sections
- Debug doc status is "resolved" with filled root_cause, fix, verification, files_changed
- hub-main.ts has z-index stacking comment
- All 524 tests pass (npx vitest run)
</verification>

<success_criteria>
- Written review covers all 5 hotfix commits with strengths, 7+ identified risks with severity, and prioritized follow-up action table
- Debug doc fully resolved (no open investigation docs remaining from this hotfix chain)
- Zero-cost z-index documentation applied to hub-main.ts
- No test regressions
</success_criteria>

<output>
After completion, create `.planning/quick/9-review-hotfix-commits-for-risks-edge-cas/9-SUMMARY.md`
</output>
