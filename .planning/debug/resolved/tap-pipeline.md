---
status: resolved
trigger: "Tap-to-record pipeline broken - tapping on Even G2 glasses does nothing, recording does not start."
created: 2026-03-01T00:00:00Z
updated: 2026-03-01T00:03:00Z
---

## Current Focus

hypothesis: CONFIRMED -- CHAT_LAYOUT and BLANK_LAYOUT had isEventCapture: 0 on all containers. Fix applied and verified.
test: All 528 tests pass. TypeScript compiles clean.
expecting: On-device taps will now flow through the gesture pipeline.
next_action: Archive session.

## Symptoms

expected: Tap starts recording, second tap stops, audio is sent to STT, transcript displayed, assistant responds.
actual: Glasses shows 'tap to speak' / 'tap to...' but tap does nothing (recording does not start).
errors: None -- silent failure (no gesture events arrive at WebView after layout rebuild).
reproduction: Boot glasses app, wait for CHAT_LAYOUT to be applied by renderer.init(), then tap.
started: Since CHAT_LAYOUT was introduced in glasses-renderer.ts with isEventCapture: 0 on both containers.

## Eliminated

(none -- root cause found on first hypothesis)

## Evidence

- timestamp: 2026-03-01T00:00:10Z
  checked: even-bridge.ts STARTUP_LAYOUT
  found: isEventCapture: 1 on the single text container -- this is correct and enables events during initial boot.
  implication: Tap works briefly during the "Connecting..." phase before renderer.init() is called.

- timestamp: 2026-03-01T00:00:20Z
  checked: glasses-renderer.ts CHAT_LAYOUT (STATUS_CONTAINER + CHAT_CONTAINER)
  found: BOTH containers have isEventCapture: 0.
  implication: After rebuildPageContainer(CHAT_LAYOUT), NO container captures events. Glasses OS stops forwarding taps to the WebView.

- timestamp: 2026-03-01T00:00:30Z
  checked: SDK README.md for isEventCapture semantics
  found: "When creating multiple containers, exactly one container must have isEventCapture=1 (all others must be 0)" -- applies equally to createStartUpPageContainer and rebuildPageContainer (docs say "functionally identical").
  implication: This is a hard SDK requirement. Having zero containers with isEventCapture=1 silently disables all gesture events.

- timestamp: 2026-03-01T00:00:40Z
  checked: Boot sequence in glasses-main.ts
  found: bridge.init() creates STARTUP_LAYOUT (isEventCapture=1), then renderer.init() calls rebuildPageContainer(CHAT_LAYOUT) with isEventCapture=0 on both containers. The gesture handler is wired between these two calls, but bus events stop arriving once CHAT_LAYOUT replaces the startup layout.
  implication: The entire tap-to-record pipeline is dead after renderer.init() completes.

- timestamp: 2026-03-01T00:00:45Z
  checked: BLANK_LAYOUT in glasses-renderer.ts (used by hide())
  found: BLANK_LAYOUT also has isEventCapture: 0. Same bug would apply on wake() after hide().
  implication: BLANK_LAYOUT needs the same fix.

## Resolution

root_cause: glasses-renderer.ts defines CHAT_LAYOUT and BLANK_LAYOUT with isEventCapture: 0 on ALL containers. The Even SDK requires exactly one container per page to have isEventCapture=1 to receive gesture events. When renderer.init() calls rebuildPageContainer(CHAT_LAYOUT), the glasses OS stops forwarding gesture events (tap, double-tap, scroll) to the WebView. The entire gesture pipeline from bridge -> bus -> FSM -> recording is silently disabled.
fix: Set isEventCapture: 1 on CHAT_CONTAINER (containerID=2) in CHAT_LAYOUT, and on the single container in BLANK_LAYOUT. Updated corresponding test assertion.
verification: All 528 tests pass. TypeScript compiles clean. No regressions.
files_changed:
  - src/display/glasses-renderer.ts (CHAT_CONTAINER.isEventCapture: 0->1, BLANK_LAYOUT container.isEventCapture: 0->1)
  - src/__tests__/glasses-renderer.test.ts (updated test to assert correct isEventCapture values)
