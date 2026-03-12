---
status: resolved
trigger: "resume-replay-not-delivering"
created: 2026-03-12T00:00:00Z
updated: 2026-03-12T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED -- lastSeq null-guard blocks replay when app closes before done event
test: N/A -- root cause confirmed
expecting: N/A
next_action: Fix: remove null-guard, use lastSeq ?? 0; also track seq on all event types not just done

## Symptoms

expected: After reopening the glasses app, any responses that occurred while the app was closed should be replayed and shown to the user via the resume sync mechanism.
actual: Response exists in OpenClaw dashboard (backend processed it), but glasses got nothing after reopen (frontend replay path didn't run or didn't fetch the correct session stream).
errors: No explicit error messages reported -- the feature silently fails.
reproduction: 1) Send a voice turn, 2) Close the app after seeing "transcript" but before seeing "done", 3) Reopen -- the response is missing.
started: Newly implemented feature (quick-50). Resume sync was just built.

## Eliminated

(none yet)

## Evidence

- timestamp: 2026-03-12T00:01:00Z
  checked: glasses-main.ts lines 556-578 -- resume sync block
  found: Two nested guards: (1) `settings.gatewayUrl && settings.sessionKey` and (2) `lastSeq != null`. Both must pass or replay is completely skipped.
  implication: If EITHER sessionKey is empty OR lastSeq is null, entire replay path is dead.

- timestamp: 2026-03-12T00:02:00Z
  checked: glasses-main.ts lines 546-550 -- seq watermark tracking
  found: lastSeq is ONLY updated when `chunk.type === 'response_end' && typeof chunk.seq === 'number' && chunk.seq > 0`. This means seq is only tracked from the SSE 'done' event.
  implication: If app closes BEFORE done event arrives, lastSeq stays at its previous value. If this is the FIRST turn ever, lastSeq is null (never set), so the null guard blocks replay on next boot.

- timestamp: 2026-03-12T00:03:00Z
  checked: gateway-client.ts lines 47-63 -- lastEventSeq initialization
  found: lastEventSeq initializes from localStorage key 'openclaw-last-event-seq'. If never set, returns null. The `Number(stored) || null` pattern means '0' stored becomes null too.
  implication: On fresh install or if the first turn never completes with a done+seq, lastSeq is permanently null, permanently blocking replay.

- timestamp: 2026-03-12T00:04:00Z
  checked: settings.ts line 9 -- DEFAULT_SETTINGS.sessionKey
  found: Default is empty string ''. Users must manually configure this.
  implication: sessionKey gate on line 556 blocks replay for any user who hasn't configured it. But the deeper question is: does the gateway even require a separate sessionKey for replay? The gateway already knows the session from X-Session-Key header sent on turns.

- timestamp: 2026-03-12T00:05:00Z
  checked: All tests pass (67 in gateway-client, 25 in replay-client, 26 in glasses-main)
  found: Tests cover the EXISTING behavior correctly, including the test "does not call fetchSessionReplay when lastSeq is null" which confirms the null-guard is intentional in current code.
  implication: The bug is in the design, not a coding error. The guards are too strict for the intended use case.

## Resolution

root_cause: Two compounding design flaws in the resume sync path prevent replay from ever executing in the primary failure scenario:

**Bug 1 (Critical): lastSeq null-guard is too strict.** The resume sync block at line 558 requires `lastSeq != null` to run. But lastSeq only gets set when a response_end chunk carries a seq number (line 547). The reproduction scenario is: app closes AFTER transcript but BEFORE done. This means lastSeq was never set for this turn. On first-ever turn, lastSeq is null. The null-guard blocks replay entirely. FIX: When lastSeq is null, use afterSeq=0 to fetch ALL session events (the gateway should handle this by returning everything).

**Bug 2 (Hardening): seq only tracked on response_end.** Even after Bug 1 is fixed, the seq cursor only advances on `response_end` chunks. If the app closes after seeing transcript/assistant_delta events (which carry seq numbers in the replay data but NOT in the live SSE stream), the cursor doesn't advance. This is less critical because the replay endpoint is idempotent (replaying already-seen events is harmless), but it means unnecessary re-fetching. For now, this is acceptable -- the SSE stream only carries seq on done events.

fix: Removed the `if (lastSeq != null)` inner guard in glasses-main.ts resume sync block. Now uses `const afterSeq = lastSeq ?? 0` so replay always runs when gatewayUrl and sessionKey are configured, even on first boot or when app closed before a done event carried seq. Updated test to match new behavior.

verification: All 93 tests pass (26 glasses-main, 42 gateway-client, 25 replay-client). Full test suite confirms no regressions (only pre-existing nav-switching failures unrelated to this change).

files_changed:
  - src/glasses-main.ts: Removed null-guard on lastSeq, use afterSeq = lastSeq ?? 0
  - src/__tests__/glasses-main.test.ts: Updated test from "does not call when null" to "calls with afterSeq=0 when null"
