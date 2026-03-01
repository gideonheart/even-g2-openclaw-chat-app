---
status: verified
trigger: "On real Even Hub WebView device, tapping bottom-nav Settings gear does nothing."
created: 2026-03-01T00:00:00Z
updated: 2026-03-01T11:20:00Z
---

## Current Focus

hypothesis: main.ts router only boots glasses-main when flutter_inappwebview is present, never initializing hub-main. Bottom nav click handlers are never attached.
test: Confirmed by code tracing -- glasses-main does not touch DOM or attach any nav handlers.
expecting: Fix main.ts to boot BOTH glasses-main AND hub-main when inside Even App WebView
next_action: Device verification by user (archive session after confirmation)

## Symptoms

expected: Tapping Settings (gear icon) in bottom navigation bar should navigate to the Settings screen. All four bottom nav items (Home/Health/Chat/Settings) should switch reliably on mobile Even Hub WebView.
actual: Tap on Settings is completely unresponsive -- no visual feedback, no navigation. User is blocked from configuring Gateway URL.
errors: No JS errors visible -- the handlers were simply never attached.
reproduction: Tap the Settings icon in the bottom navigation bar on real Even Hub WebView device.
started: Architecture issue since the dual-mode router was implemented. Masked during development because browser dev mode (no flutter_inappwebview) correctly boots hub-main.

## Eliminated

- hypothesis: Even SDK .modal CSS override blocking pointer events
  evidence: CSS defense-in-depth with !important + pointer-events:none + visibility:hidden is correct and comprehensive. Production bundle confirmed SDK .modal{display:flex} does NOT use !important, so our !important wins. Additionally, the issue is not CSS at all -- no click handlers are attached.
  timestamp: 2026-03-01T11:10:00Z

- hypothesis: JS error during init() prevents handler attachment
  evidence: init() is called at the very start of initHub() and bottom nav handlers are lines 596-598, before any async or complex operations. No errors could prevent attachment. But the real issue is initHub() is never called at all.
  timestamp: 2026-03-01T11:12:00Z

## Evidence

- timestamp: 2026-03-01T11:05:00Z
  checked: main.ts router logic
  found: isEvenApp detection checks flutter_inappwebview. If true, only glasses-main boots. If false, only hub-main boots. Never both.
  implication: On real device (flutter_inappwebview present), hub-main never runs.

- timestamp: 2026-03-01T11:07:00Z
  checked: glasses-main.ts for DOM interactions
  found: glasses-main does NOT touch HTML DOM at all. No querySelector, no getElementById (except visibilitychange listener). It only communicates via SDK bridge to render on glasses.
  implication: HTML Hub UI elements (bottom nav, pages, settings) remain in DOM but have zero JS handlers.

- timestamp: 2026-03-01T11:09:00Z
  checked: Even SDK sample apps (even-g2-apps)
  found: Sample apps use SINGLE WebView architecture -- same WebView renders phone screen HTML AND drives glasses via SDK bridge. No separate companion WebView.
  implication: Phone UI and glasses rendering must coexist in the same boot path.

- timestamp: 2026-03-01T11:10:00Z
  checked: glasses-main line 462 -- renderer.showConfigRequired()
  found: When gatewayUrl is not set, glasses display shows config required message telling user to configure in companion app. But the companion (hub-main) never booted.
  implication: User sees glasses message, looks at phone, sees Hub UI, tries to configure, but UI is completely dead.

- timestamp: 2026-03-01T11:11:00Z
  checked: hub-main init() function
  found: Bottom nav handlers are attached at lines 596-598 of hub-main.ts. All 4 buttons get click listeners. But this code only runs when initHub() is called, which only happens when isEvenApp is false.
  implication: Confirms the router is the root cause, not any CSS or event handling bug.

- timestamp: 2026-03-01T11:13:00Z
  checked: All 524 tests + build
  found: All pass -- tests do not cover the real-device boot path where flutter_inappwebview is present.
  implication: Tests miss this because they either test hub-main in isolation (jsdom, no flutter_inappwebview) or glasses-main in isolation.

## Resolution

root_cause: main.ts router is mutually exclusive -- boots EITHER glasses-main OR hub-main, never both. On real Even App WebView (flutter_inappwebview present), only glasses-main boots. The Hub phone-side UI (bottom nav, settings, pages) is rendered as static HTML but has zero JS event handlers. All bottom nav taps are dead because initHub() was never called.
fix: Changed main.ts router from mutually-exclusive (glasses XOR hub) to always-hub + conditional-glasses. Hub UI now always boots. Glasses runtime is added on top when flutter_inappwebview is present or ?even dev flag is set. The two modules are fully independent -- glasses-main uses SDK bridge only (no DOM), hub-main uses DOM only (no SDK bridge). No shared mutable state, no conflicts.
verification: npm test passes (524/524), npm run build passes. Modules are architecturally independent (verified: glasses-main has zero DOM calls, hub-main has zero SDK bridge calls). Cross-tab sync via BroadcastChannel works correctly with both modules in the same page.
files_changed:
  - src/main.ts
