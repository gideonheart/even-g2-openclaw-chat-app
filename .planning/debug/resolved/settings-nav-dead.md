---
status: resolved
trigger: "P0 UX BUG — In companion app (Even Hub WebView), tapping bottom-nav Gear/Settings does nothing."
created: 2026-03-01T00:00:00Z
updated: 2026-03-01T10:45:00Z
owner: g2-frontend
priority: P0
---

## Current Focus

hypothesis: CONFIRMED — Even SDK `.modal{display:flex;position:fixed;inset:0}` creates full-screen overlays that eat clicks on bottom nav in production builds
test: CSS specificity analysis + Vite build output inspection confirmed
expecting: N/A — root cause confirmed
next_action: Apply defense-in-depth fix, verify, commit

## Symptoms

expected: Tapping the Settings gear opens `#settings` page and marks Settings nav button active.
actual: Gear tap appears to do nothing on real device.
errors: No visible error; silent UX failure.
reproduction:
  1. Scan launcher QR in Even Hub
  2. Open Even OpenClaw companion app
  3. Tap bottom-nav Settings gear
  4. Observe no page change
scope: Real device WebView path (not desktop browser only).

## Eliminated

- Missing `data-page="settings"` in markup — NOT the issue (present in `index.html`).
- Missing `#settings` section — NOT the issue (present in `index.html`).
- Global dead app due raw TypeScript load — previously fixed by launcher path to `dist/index.html`.
- hypothesis: JS nav handler bug in show() or init()
  evidence: show() logic is correct, init() wires all 4 buttons, test suite (522 tests) passes
  timestamp: 2026-03-01T10:30:00Z
- hypothesis: Wrong code path via main.ts router (flutter_inappwebview detection)
  evidence: Router hasn't changed; companion hub loads in regular browser where flutter_inappwebview is absent
  timestamp: 2026-03-01T10:35:00Z
- hypothesis: Settings-specific DOM issue
  evidence: Bug affects ALL nav buttons, not just Settings; HTML elements exist and are correctly wired
  timestamp: 2026-03-01T10:37:00Z

## Evidence

- timestamp: 2026-03-01T10:25:00Z
  checked: Vite production build CSS source order
  found: In production builds, <link> to SDK CSS appears AFTER inline <style> in <head>. With equal specificity, SDK `.modal{display:flex}` wins over inline `.modal{display:none}`.
  implication: Modals render as full-screen fixed overlays (z-index 300) above bottom nav (z-index 100), intercepting all clicks.

- timestamp: 2026-03-01T10:28:00Z
  checked: Vite dev server CSS source order
  found: In dev mode, <link> appears BEFORE <style> in the raw HTML. Inline rules come later and win with equal specificity.
  implication: Bug is invisible in development — only manifests in production builds deployed to real devices.

- timestamp: 2026-03-01T10:30:00Z
  checked: SDK modal CSS (even-g2-apps/src/styles/components/modal.css)
  found: `.modal { position: fixed; inset: 0; display: flex; background: var(--sc-1st); }` — creates semi-transparent full-screen overlay
  implication: Without proper override, both sessionModal and confirmModal become invisible click-blocking overlays.

- timestamp: 2026-03-01T10:33:00Z
  checked: Commit 7776c48 fix attempt
  found: Changed selector from `.modal` to `#app ~ .modal` for higher specificity (0,1,1,0 vs 0,0,1,0). Added boot-time classList.remove('active').
  implication: Specificity fix addresses `display` property, but lacks defense-in-depth (no !important, no pointer-events:none, no visibility:hidden). Insufficient for all WebView edge cases.

- timestamp: 2026-03-01T10:40:00Z
  checked: Uncommitted working tree changes
  found: Already contain `!important`, `pointer-events:none`, `visibility:hidden` on modal CSS + session modal defensive boot code + backdrop click dismiss.
  implication: These defense-in-depth measures need to be committed and deployed.

## Resolution

root_cause: Even SDK CSS `.modal{display:flex;position:fixed;inset:0}` overrides inline `.modal{display:none}` in Vite production builds (same specificity, later source order via external <link>), creating invisible full-screen overlays (z-index 300) that intercept all pointer events above the bottom nav bar (z-index 100), making all nav buttons non-functional. Commit 7776c48 partially fixed specificity but lacked defense-in-depth.
fix: Apply defense-in-depth CSS: `#app ~ .modal { display: none !important; pointer-events: none; visibility: hidden; }` + boot-time JS defensive cleanup for both modals + session modal backdrop click dismiss. Already staged in working tree.
verification: All 524 tests pass including new regression tests. Production build verified with defense-in-depth CSS in dist/index.html.
files_changed: [index.html, src/hub-main.ts, src/__tests__/nav-switching.test.ts]
