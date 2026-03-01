---
status: resolved
trigger: "Investigate and fix two HIGH-risk issues from Quick Task 11 self-review of commit e89ede3"
created: 2026-03-01T15:00:00Z
updated: 2026-03-01T15:03:00Z
---

## Current Focus

hypothesis: confirmed -- initHub() failure cascades to prevent glasses boot
test: n/a (resolved)
expecting: n/a
next_action: archive

## Symptoms

expected: When running inside Even App WebView (flutter_inappwebview present), both hub-main and glasses-main should boot. If hub initialization fails, glasses should still boot successfully.
actual: In commit e89ede3, `await initHub()` was called before `boot()` without error isolation. If initHub() threw (IDB corruption, missing DOM, SDK error), the await rejects and boot() is never called -- glasses become completely non-functional. This is worse than the old XOR code which at least let glasses work alone.
errors: No runtime errors observed -- this is a latent failure mode identified by code review (Quick Task 11).
reproduction: Would manifest on real Even G2 device if hub initialization hits any error (IDB corruption, missing hub-main element, etc.)
started: Introduced in commit e89ede3 (the dual-boot fix). Never existed before.

## Eliminated

(No incorrect hypotheses -- root cause was identified by code review before investigation began.)

## Evidence

- timestamp: 2026-03-01T15:00:30Z
  checked: src/main.ts at commit e89ede3 via `git show e89ede3 -- src/main.ts`
  found: Confirmed the original commit had bare `await initHub()` on line 17 with no try/catch. If initHub() throws, the error propagates to main().catch() and boot() on line 22 is never reached.
  implication: Root cause confirmed exactly as described in the review. This is an availability regression.

- timestamp: 2026-03-01T15:01:00Z
  checked: src/main.ts on HEAD (working tree)
  found: Working tree already contained a try/catch wrapper around initHub() (lines 37-41) and a dependency injection refactor (MainDeps type) to enable testability. The module-scope main() call is guarded by `!(import.meta as any).vitest` to prevent auto-execution during tests.
  implication: Fix was partially applied by a previous session but never committed.

- timestamp: 2026-03-01T15:01:15Z
  checked: src/__tests__/main-boot.test.ts on working tree
  found: Test file existed but had a broken approach (vi.spyOn on dynamically-imported modules) causing 3 of 4 tests to fail. File was then modified (likely by another process) to use a dependency injection approach matching the main.ts refactor, with 4 correct tests.
  implication: Tests needed to be verified as passing, not just existing.

- timestamp: 2026-03-01T15:01:30Z
  checked: npm test (full suite)
  found: 528/528 tests pass (524 original + 4 new main-boot tests). Zero regressions.
  implication: Fix and tests are verified.

- timestamp: 2026-03-01T15:02:00Z
  checked: npm run build
  found: tsc + vite build completes cleanly. 43 modules transformed, all chunks emitted.
  implication: No type errors introduced. Production bundle is valid.

## Resolution

root_cause: In commit e89ede3, `main()` called `await initHub()` before the glasses `boot()` block with no error isolation. If initHub() throws (IDB corruption, missing DOM element, SDK error), the exception propagates up and boot() is never reached. The glasses display stays blank. This is an availability regression vs the old XOR routing where glasses could boot independently of hub.

fix: Two changes applied to src/main.ts:
1. Wrapped `await deps.initHub()` in try/catch so any hub initialization failure is logged but does not prevent glasses boot.
2. Refactored main() to accept optional `MainDeps` parameter for testability (dependency injection pattern). Default implementations preserve the original dynamic import behavior. Module-scope auto-execution guarded by `!(import.meta as any).vitest`.

Added src/__tests__/main-boot.test.ts with 4 tests covering:
- Plain-browser boot (hub only, no glasses)
- Dual-boot path (flutter_inappwebview present, both hub and glasses boot)
- Boot order (hub init completes before glasses boot starts)
- initHub failure isolation (glasses boot proceeds even when hub fails)

verification: 528/528 tests pass. Build compiles clean. The initHub failure isolation test directly validates the fix by injecting a rejecting initHub mock and verifying boot is still called.

files_changed:
- src/main.ts (try/catch + DI refactor for testability)
- src/__tests__/main-boot.test.ts (new, 4 tests)
