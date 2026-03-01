---
phase: quick-15
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/quick/15-self-review-commit-4cad75a-confirm-local/15-REVIEW.md
autonomous: true
requirements: [QUICK-15]

must_haves:
  truths:
    - "False-positive and false-negative risks are enumerated with severity ratings"
    - "Custom domains, LAN IPs, 0.0.0.0, and emulator quirks are each assessed"
    - "One concrete follow-up safeguard test or UX tweak is recommended"
  artifacts:
    - path: ".planning/quick/15-self-review-commit-4cad75a-confirm-local/15-REVIEW.md"
      provides: "Self-review analysis of commit 4cad75a localhost detection"
      contains: "False-Negative"
  key_links: []
---

<objective>
Self-review commit 4cad75a: confirm the localhost-on-device detection logic is correct and safe, enumerate false-positive/false-negative risks across custom domains, LAN IPs, 0.0.0.0, emulator runtimes, and user-agent quirks, and recommend one follow-up safeguard.

Purpose: Close the review loop on a safety-critical UX guard before marking this fix as fully vetted.
Output: 15-REVIEW.md with structured risk analysis and one follow-up recommendation.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/settings.ts
@src/app-wiring.ts
@src/glasses-main.ts
@src/hub-main.ts
@src/__tests__/settings.test.ts
@src/__tests__/app-wiring.test.ts
@.planning/debug/resolved/gateway-unreachable-localhost.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Audit detection logic and produce structured risk review</name>
  <files>.planning/quick/15-self-review-commit-4cad75a-confirm-local/15-REVIEW.md</files>
  <action>
Read the three detection functions in src/settings.ts (isLocalhostUrl, isRealDeviceRuntime, localhostWarning) and their consumers in glasses-main.ts (lines 496-499), hub-main.ts (lines 1121-1137), and app-wiring.ts buildHealthViewModel (lines 187-189).

Produce .planning/quick/15-self-review-commit-4cad75a-confirm-local/15-REVIEW.md with the following structure:

## Strengths
Enumerate what the commit does well (device-aware guard, dev-mode bypass, test coverage breadth, health display override priority).

## Detection Logic Correctness
Confirm or challenge:
- LOOPBACK_RE covers localhost, 127.0.0.1, [::1] with optional port and trailing slash/end-of-string. Verify the regex is anchored correctly and cannot be bypassed by e.g. "http://localhost.evil.com" (it can't because the regex requires the hostname to end at a colon, slash, or end-of-string).
- isRealDeviceRuntime checks window.flutter_inappwebview presence -- confirm this is the canonical Even App WebView marker.
- glasses-main.ts uses `!devMode` (which is `typeof window.flutter_inappwebview === 'undefined'`) while hub-main.ts uses `isRealDeviceRuntime()`. Confirm these are equivalent and consistent.
- buildHealthViewModel accepts `isOnDevice` param, defaulting to undefined (falsy) for backward compatibility.

## False-Positive Risks
For each, state risk level (none/low/medium/high) and why:
1. Android emulator with flutter_inappwebview injected + localhost URL -- is the warning correct? (Yes: emulator localhost IS the emulator's own loopback, not the host. The 10.0.2.2 address is used for host access on Android emulator.)
2. iOS Simulator -- does it inject flutter_inappwebview? (Probably yes if running Even App; the warning would fire and be correct.)
3. URL like "http://localhost-proxy.mycompany.com:4400" -- does the regex falsely match? (No: the regex requires the hostname to be EXACTLY localhost|127.0.0.1|[::1] followed by port/slash/end.)

## False-Negative Risks
For each, state risk level and impact:
1. 0.0.0.0 (common "bind all interfaces" address) -- not in LOOPBACK_RE. On mobile, 0.0.0.0 would fail the same way as localhost. Risk: LOW (rarely used in user-facing URLs, but worth noting).
2. Custom domain resolving to 127.0.0.1 (e.g., "http://mygateway.local:4400" in /etc/hosts) -- regex only checks hostname string, not DNS resolution. Risk: LOW (niche, and if user configures a custom domain they likely know what they're doing).
3. LAN IPs like 192.168.x.x or 10.x.x.x -- these ARE reachable from the phone if on the same WiFi network. Not a loopback issue. Risk: NONE (not a false negative; these should NOT trigger the warning).
4. IPv4-mapped IPv6 like ::ffff:127.0.0.1 -- not matched by regex. Risk: VERY LOW (browsers normalize these before presenting to JS, and no user would type this).
5. "http://[::1]" without port -- already tested and handled by regex. Risk: NONE.

## Emulator and User-Agent Quirks
- Android Emulator: flutter_inappwebview present, localhost = emulator loopback (correct warning).
- iOS Simulator: flutter_inappwebview present when running Even App (correct warning).
- Chrome DevTools "Toggle Device Toolbar": Does NOT inject flutter_inappwebview (correct: no warning, dev mode).
- flutter_inappwebview debug overlay in development builds: still present (correct behavior -- warning fires if localhost URL is set, which is appropriate since even in debug builds on a device, localhost is the phone).

## Follow-Up Recommendation
Recommend ONE concrete follow-up (pick the highest-value one):
- Option A: Add `0.0.0.0` to LOOPBACK_RE (trivial regex change, covers an edge case).
- Option B: Add a settings-time validation warning (not just boot-time) -- when user edits Gateway URL in settings and types localhost while on a real device, show inline field warning immediately rather than only at next boot.
- Option C: Add an integration test that mocks flutter_inappwebview + localhost URL and asserts the glasses-main boot path emits the error log and calls renderer.showError.

Recommend the single highest-value option with a brief rationale (2-3 sentences). This should be a concrete test or small UX improvement, not an architectural change.
  </action>
  <verify>
    <automated>test -f .planning/quick/15-self-review-commit-4cad75a-confirm-local/15-REVIEW.md && grep -q "False-Negative" .planning/quick/15-self-review-commit-4cad75a-confirm-local/15-REVIEW.md && grep -q "False-Positive" .planning/quick/15-self-review-commit-4cad75a-confirm-local/15-REVIEW.md && grep -q "Follow-Up" .planning/quick/15-self-review-commit-4cad75a-confirm-local/15-REVIEW.md && echo "PASS"</automated>
  </verify>
  <done>15-REVIEW.md exists with all sections: Strengths, Detection Logic Correctness, False-Positive Risks (with severity), False-Negative Risks (with severity), Emulator/UA Quirks, and one concrete Follow-Up Recommendation.</done>
</task>

</tasks>

<verification>
- 15-REVIEW.md covers all six sections with severity ratings
- Every risk item has a risk level (none/low/medium/high) and rationale
- Follow-up recommendation is concrete and actionable (not vague)
- No false claims about the regex behavior (verify against LOOPBACK_RE pattern)
</verification>

<success_criteria>
Review document exists with structured risk analysis covering: localhost detection correctness confirmed, 3+ false-positive scenarios assessed, 5+ false-negative scenarios assessed, emulator quirks addressed, and one specific follow-up recommended with rationale.
</success_criteria>

<output>
After completion, create `.planning/quick/15-self-review-commit-4cad75a-confirm-local/15-SUMMARY.md`
</output>
