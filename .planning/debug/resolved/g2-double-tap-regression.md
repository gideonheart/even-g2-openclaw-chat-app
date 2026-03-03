---
status: resolved
trigger: "G2 glasses double-tap gesture behavior has regressed. Double-tap triggers the action twice (duplicate behavior)."
created: 2026-03-03T00:00:00Z
updated: 2026-03-03T00:02:00Z
---

## Current Focus

hypothesis: CONFIRMED AND FIXED - double-tap events were not debounced, causing duplicate TOGGLE_MENU on real hardware
test: 4 new regression tests + full suite (626 tests pass)
expecting: N/A - resolved
next_action: Archive session

## Symptoms

expected: Double-tap on G2 glasses should toggle voice recording (start/stop) as a single action
actual: Double-tap triggers the action twice, causing duplicate behavior (e.g., starts then immediately stops, or fires two recordings)
errors: No specific error messages - investigate logs and code
reproduction: Simple double-tap gesture on G2 glasses touchpad
started: Regression after quick tasks quick-23 through quick-31 (gesture-handler.ts, FSM resets, audio pipeline changes)

## Eliminated

- hypothesis: Duplicate gesture handler creation / duplicate event listeners
  evidence: glasses-main.ts creates exactly one gesture handler; bus events have single subscription per handler
  timestamp: 2026-03-03T00:00:30Z

- hypothesis: Audio frames causing phantom taps (bridge event fallthrough)
  evidence: Commit 6aad8d2 already fixed this with early return for audioEvent
  timestamp: 2026-03-03T00:00:35Z

- hypothesis: Cross-contamination between SDK window CustomEvents and callback
  evidence: SDK uses separate event names (evenHubEvent vs deviceStatusChanged); onEvenHubEvent listens only on evenHubEvent
  timestamp: 2026-03-03T00:00:40Z

- hypothesis: Menu controller or display controller causing duplicate action dispatch
  evidence: menu-controller subscribes once to gesture:menu-toggle; display-controller only uses double-tap for wake
  timestamp: 2026-03-03T00:00:45Z

## Evidence

- timestamp: 2026-03-03T00:00:10Z
  checked: gesture-handler.ts debounce logic (line 87)
  found: Debounce guard is `input === 'tap' && (timestamp - lastTapTs) < DEBOUNCE_MS` -- only protects 'tap' events, NOT 'double-tap' events
  implication: If SDK fires DOUBLE_CLICK_EVENT twice rapidly, both pass through FSM unchecked

- timestamp: 2026-03-03T00:00:15Z
  checked: gesture-fsm.ts TRANSITIONS table
  found: idle+double-tap->menu, menu+double-tap->idle -- two rapid double-taps toggle menu on then off
  implication: Menu blinks open/closed when double-tap fires twice

- timestamp: 2026-03-03T00:00:20Z
  checked: Commit 54af22e (hotfix for "menu blink on double-tap")
  found: That fix added `|| input === 'double-tap'` to lastTapTs update, which suppresses TRAILING taps. But it did NOT add double-tap to the debounce CHECK.
  implication: The hotfix was incomplete -- it handled the trailing-tap-after-double-tap case but not the duplicate-double-tap case

- timestamp: 2026-03-03T00:00:25Z
  checked: Review note in .planning/quick/9-review-hotfix-commits-for-risks-edge-cas/9-REVIEW.md
  found: "Even SDK fires DOUBLE_CLICK followed by a trailing CLICK ~50ms later on real hardware" -- confirmed SDK fires multiple events for double-tap
  implication: Hardware behavior produces rapid duplicate events that need debouncing

- timestamp: 2026-03-03T00:00:50Z
  checked: Manual FSM trace with two rapid double-tap events
  found: Two double-taps at T=1000 and T=1050 both pass through debounce (only tap checked), causing idle->menu->idle (menu blinks)
  implication: Root cause confirmed

- timestamp: 2026-03-03T00:01:30Z
  checked: Fix verification - 6 scenarios traced manually + 4 new tests + full suite
  found: All scenarios correct: duplicate double-tap suppressed, intentional close works, existing behavior preserved
  implication: Fix is correct and minimal

## Resolution

root_cause: The debounce guard in gesture-handler.ts only checked `input === 'tap'`, excluding `double-tap` from debounce protection. When the G2 SDK fires DOUBLE_CLICK_EVENT twice in rapid succession (hardware quirk documented in review notes), both events passed through, causing the FSM to toggle menu on then immediately off (idle -> menu -> idle). The trailing-tap fix in commit 54af22e updated lastTapTs for double-tap events but did not extend the debounce check itself to double-tap input.
fix: Added separate `lastDoubleTapTs` tracking variable and a parallel debounce check for double-tap events. This suppresses duplicate DOUBLE_CLICK_EVENT within the 275ms window while keeping the tap and double-tap debounce independent (so a tap followed by double-tap in the legitimate SDK sequence is not affected).
verification: 4 new regression tests added, 626 total tests pass, 6 manual scenarios verified correct
files_changed:
  - src/gestures/gesture-handler.ts
  - src/__tests__/gesture-handler.test.ts
