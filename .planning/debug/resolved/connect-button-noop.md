---
status: resolved
trigger: "Connect button on hub home page doesn't actually connect glasses on real device after QR launch. Nothing works."
created: 2026-03-01T00:00:00Z
updated: 2026-03-01T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - Two root causes: (1) Launcher serves raw .ts files instead of built dist/, (2) Connect button lies about what it can do since SDK has no connect API
test: n/a - evidence confirmed
expecting: n/a
next_action: Fix both issues - update launcher path to dist/ and replace misleading Connect button with honest status indicator

## Symptoms

expected: Tapping Connect button should connect to Even G2 glasses (or UX should be truthful about capabilities)
actual: Button appears to do nothing on real device after QR launch. "Nothing works."
errors: Unknown - real device, no console access described
reproduction: QR scan to launch app -> app loads in Even App WebView -> tap Connect button -> nothing happens
started: Discovered on first real-device test after v1.3 shipped

## Eliminated

## Evidence

- timestamp: 2026-03-01T00:10:00Z
  checked: Even SDK type definitions (node_modules/@evenrealities/even_hub_sdk/dist/index.d.ts)
  found: SDK has NO connect() or disconnect() method. Only has onDeviceStatusChanged (listen), getDeviceInfo (query), and display/audio/storage methods. Connection is managed by the Even App shell.
  implication: The Connect button's toggleGlassesConnection() function is fundamentally incapable of initiating a connection.

- timestamp: 2026-03-01T00:11:00Z
  checked: main.ts router
  found: When flutter_inappwebview is present (Even App WebView), boots glasses-main.ts which has NO hub UI and NO Connect button. Hub UI with Connect button only shows in regular browser.
  implication: User either (a) is viewing in regular browser not Even App WebView, or (b) the JS isn't loading at all so the router never runs.

- timestamp: 2026-03-01T00:12:00Z
  checked: launcher-data.json appPath vs source/dist structure
  found: Launcher appPath is "/samples/even-g2-openclaw-chat-app/" (project root, not dist/). The root index.html has <script src="/src/main.ts"> which requires Vite dev server. Express serves raw .ts files which browsers cannot execute.
  implication: When QR launches the app, NO JavaScript executes. The static HTML renders with the Connect button visible but completely inert. This explains "nothing works."

- timestamp: 2026-03-01T00:13:00Z
  checked: toggleGlassesConnection() in hub-main.ts
  found: Accesses window.EvenAppBridge directly. In Even App WebView, this exists but hub-main never boots (glasses-main boots instead). In regular browser, EvenAppBridge doesn't exist, so refreshBridgeStatus returns false and shows toast "Even bridge unavailable."
  implication: Even if JS loaded, the Connect button in the hub shows an error toast at best.

## Resolution

root_cause: |
  TWO root causes work together to produce "nothing works":
  1. CRITICAL: Launcher appPath "/samples/even-g2-openclaw-chat-app/" serves the project root index.html which imports raw TypeScript (/src/main.ts). Without Vite dev server, browsers cannot execute .ts files. Result: HTML renders but zero JS runs. Every button is dead.
  2. DESIGN: Even if JS loaded, the "Connect" button in hub-main.ts calls toggleGlassesConnection() which tries to access window.EvenAppBridge -- but this only exists inside Even App WebView, where glasses-main.ts boots instead (no hub UI). The SDK has no connect() API; connection is managed by the Even App shell. The button is fundamentally misleading.
fix: |
  1. Update launcher-data.json appPath to point to dist/ (where Vite builds compiled JS)
  2. Replace the misleading Connect/Disconnect button with an honest status-only indicator that shows connection state from bridge events but doesn't claim it can initiate connections
verification: |
  - All 503 tests pass (0 failures)
  - TypeScript compilation clean
  - Vite build succeeds, dist/ output verified
  - dist/index.html has no Connect button, no toggle-glasses action, no glassesConnBtn
  - dist/index.html has honest "Glasses connect automatically via Even App" text
  - Launcher validation script passes
  - launcher-data.json now points to dist/index.html
files_changed:
  - /home/forge/bibele.kingdom.lv/sample-launcher/launcher-data.json (appPath -> dist/index.html)
  - /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app/index.html (removed Connect button, added status text)
  - /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app/src/hub-main.ts (removed toggleGlassesConnection, renamed renderGlassesButton -> renderGlassesStatus, auto-subscribe to bridge events on boot)
