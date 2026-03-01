---
status: resolved
trigger: "Investigate and FIX two urgent UI issues: stuck confirm popup in hub app, and glasses showing generic 'open companion app to configure text'"
created: 2026-03-01T00:00:00Z
updated: 2026-03-01T00:00:00Z
---

## Current Focus

hypothesis: Issue 1 - confirm modal lacks null guard on pendingConfirm; Issue 2 - generic text is a default/placeholder not overridden by app
test: Search codebase for modal code and glasses text strings
expecting: Find source of both issues
next_action: Search for "Confirm" modal, "pendingConfirm", "companion app", "configure text"

## Symptoms

expected: (1) Confirm modal dismisses reliably on Cancel/Confirm/backdrop. (2) Glasses show app-specific text, not generic placeholder.
actual: (1) Modal gets stuck, cannot dismiss. (2) Glasses show "open companion app to configure text".
errors: No crash errors reported, pure UX bugs.
reproduction: (1) Trigger any confirm action in hub. (2) Look at glasses display when app loads.
started: Unknown, likely since implementation.

## Eliminated

## Evidence

## Resolution

root_cause: "Issue 1: Even SDK external CSS defines .modal { display: flex } which overrode inline .modal { display: none } in Vite production builds (external <link> loads after inline <style>, same specificity, later source order wins). This caused both modals to render as invisible full-screen overlays blocking all pointer events, including the bottom nav. Additionally, confirmAction() had an execution order issue where pendingConfirm was used before being cleared. Issue 2: glasses-renderer.ts showed generic 'Open companion app to configure' text instead of actionable guidance."
fix: "Commit 54af22e: three UI hotfixes (stuck modal reorder, glasses text, menu double-tap debounce). Commit 7776c48: CSS specificity override using #app ~ .modal selector (0,1,1,0 beats 0,0,1,0). Commit 8593545: defense-in-depth with !important, pointer-events:none, visibility:hidden on hidden modals, plus boot-time classList.remove('active') on both modals."
verification: "524 tests pass including 20 new regression tests for modal defense, nav switching, confirm modal safety, gesture debounce, and CSS specificity verification."
files_changed: [index.html, src/hub-main.ts, src/display/glasses-renderer.ts, src/gestures/gesture-handler.ts, src/__tests__/nav-switching.test.ts, src/__tests__/confirm-modal.test.ts, src/__tests__/gesture-handler.test.ts, src/__tests__/glasses-renderer.test.ts]
