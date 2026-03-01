# Self-Review: Commit e89ede3

**Commit:** `fix(hub): boot hub-main alongside glasses-main in Even App WebView`
**Date:** 2026-03-01
**Files changed:** `src/main.ts`, `.planning/debug/settings-nav-dead.md`

---

## What Was Done Well

### 1. Root cause analysis: systematic hypothesis elimination

The debug doc (`settings-nav-dead.md`) records two eliminated hypotheses before arriving at the true root cause:

- **Hypothesis 1 (CSS overlay):** Even SDK `.modal{display:flex}` overriding inline styles to create invisible overlays eating pointer events. Eliminated with evidence: the `!important` defense-in-depth already handled this, and the issue was not CSS at all -- no click handlers were ever attached.
- **Hypothesis 2 (JS init error):** An exception during `init()` preventing handler attachment. Eliminated with evidence: `initHub()` was never called at all, so init errors are irrelevant.

Each hypothesis was eliminated with a specific evidence statement, not just "I checked and it didn't seem right." The CSS hypothesis was eliminated by tracing the specificity rules in the production bundle. The JS init hypothesis was eliminated by noting that `initHub()` itself never runs. This is high-quality elimination because each piece of evidence is independently verifiable.

### 2. Fix design: minimal, correct, architecturally sound

The fix changed exactly 28 lines (18 net additions) in one file. The change is structurally simple: instead of an if/else XOR branch, hub-main always boots, and glasses-main conditionally boots on top. The fix also split the compound `isEvenApp` boolean into two named variables (`hasFlutterBridge`, `forceEvenDev`), making the detection logic self-documenting.

The fix preserved the `?even` dev flag pathway, which means existing development workflows are unbroken. The new code is easier to reason about than the old code because the default path (hub-main always runs) matches the default expectation (the phone screen UI should always work).

### 3. Architectural reasoning backed by evidence

The commit message claims "The two modules are architecturally independent (no shared state, separate event buses, zero DOM overlap)." This claim is backed by specific evidence gathered during debugging:

- **glasses-main has zero DOM calls:** Verified at 11:07 in the debug doc. glasses-main communicates exclusively through the SDK bridge (`flutter_inappwebview`) and its own event bus instance. The only DOM interaction is a `document.addEventListener('visibilitychange', ...)` for lifecycle cleanup -- not a UI interaction.
- **hub-main has zero SDK bridge calls:** hub-main never references `flutter_inappwebview`. It operates entirely on the phone-screen DOM (`querySelector`, `getElementById`, click handlers).
- **Each module creates its own `createEventBus()` instance:** Verified by examining imports -- both call `createEventBus()` which returns a fresh closure-scoped instance with no module-level singleton. Events emitted on one bus are invisible to the other.

This is genuine independence verification, not assumed independence. The evidence trail is traceable.

### 4. Debug doc discipline

The `settings-nav-dead.md` doc follows a structured format: frontmatter with status/trigger/timestamps, a Current Focus section for the active hypothesis, Symptoms with expected/actual/reproduction, Eliminated hypotheses with evidence and timestamps, an Evidence log with implication chains, and a Resolution section.

Specific strengths:
- Eliminated hypotheses are preserved (not deleted), making the debugging process reproducible.
- Each evidence entry has a timestamp, creating a chronological narrative.
- The "implication" field on each evidence entry drives toward the next investigation step, showing the logical chain.
- Status was moved from active to `verified` after the fix was confirmed.
- The document is self-contained: a new reader can understand the full debugging arc without external context.

### 5. Commit message quality

The commit message covers all three critical axes:

- **WHY:** "The runtime router in main.ts was mutually exclusive -- it ran EITHER glasses-main OR hub-main, never both." This is the root cause, stated clearly.
- **WHAT:** "Now hub-main always boots (phone-screen companion UI) and glasses-main is additionally loaded when inside the Even App or using ?even dev flag." The new behavior in one sentence.
- **Safety argument:** "The two modules are architecturally independent (no shared state, separate event buses, zero DOM overlap)." This preempts the obvious question: "Is it safe to run both simultaneously?"

The message also references prior work ("Quick-9 modal defense-in-depth remains correct and in place"), establishing that the CSS fixes from the previous hotfix cycle are not regressed.

---

## Assumptions That Could Still Fail on Real Devices

### 1. Boot order timing: initHub() blocks boot()

**Assumed:** `initHub()` completes fast enough that `boot()` starts promptly. The Even App SDK is patient enough to wait for glasses-main to initialize.

**Why it might not hold:** In `main.ts`, `await initHub()` runs to completion BEFORE `boot()` is even imported. `initHub()` performs IndexedDB open, DOM queries, session store creation, sync bridge creation, drift reconciler setup, gateway client creation, error presenter creation, and BroadcastChannel setup. On a cold start with a large IDB database, the `openDB()` call alone could take hundreds of milliseconds. Meanwhile, the Even App SDK expects the WebView to initialize the glasses bridge. If the SDK has an internal startup deadline (e.g., "if the WebView doesn't call bridge.init() within 3 seconds, assume it crashed and show an error"), then `initHub()` latency could cause the glasses bridge to fail.

**Severity: Medium-High.** If the SDK times out, the glasses display would show an error or go blank while the phone UI works fine. The user would see a working phone interface but broken glasses -- a partial failure that is confusing to diagnose. The fix would be to run `initHub()` and `boot()` concurrently with `Promise.all` or to at least not await `initHub()` before starting `boot()`.

### 2. Double IndexedDB open: two connections to the same database

**Assumed:** "No shared state" between modules. But both modules open the same IndexedDB database (`openclaw-chat`).

**Why it might not hold:** `glasses-main` calls `openDB()` directly (line 16 of its imports, used in the boot function). `hub-main` also calls `openDB()` (line 1141 via dynamic import). Both obtain separate `IDBDatabase` connection objects to the same database. Under normal operation this works, but:

- The `db.ts` module has module-level mutable state: `onUnexpectedClose` callback and `reopenAttempts` counter. Since both modules import from the same `db.ts` module (bundled as a single module instance by Vite), calling `setOnUnexpectedClose()` from one module overwrites the callback set by the other. Whichever module registers last wins. If glasses-main's IDB connection closes unexpectedly, but hub-main registered the `onUnexpectedClose` callback last, only hub-main's recovery logic fires.
- `reopenDB()` uses a module-level `reopenAttempts` counter. If both modules attempt to reopen after an unexpected close, they share the counter, meaning 3 combined attempts (not 3 each) exhaust the retry budget.

**Severity: Medium.** Under normal operation, IDB works fine with multiple connections. The risk is specifically during error recovery -- the shared module-level state in `db.ts` means the recovery paths interfere. This contradicts the "no shared state" claim in a subtle but real way.

### 3. Memory and performance in constrained WebView

**Assumed:** Running both modules simultaneously is acceptable for mobile phone WebView memory/CPU.

**Why it might not hold:** Even App uses `flutter_inappwebview`, which runs a WebView inside a Flutter app. The combined footprint includes:

- **Hub-main:** DOM event listeners on all nav buttons, IDB connection, session store with in-memory cache, conversation store, sync bridge (BroadcastChannel or localStorage listener), sync monitor (setInterval timer), drift reconciler, gateway client (WebSocket), error presenter, BroadcastChannel listener, `beforeunload` listener.
- **Glasses-main:** Audio capture (MediaStream, AudioContext, potentially Web Audio worklet), gateway WebSocket, SDK bridge, gesture handler (touch event listeners), glasses renderer, display controller, voice loop controller, integrity checker, storage health monitor, auto-save timer, sync bridge, sync monitor, drift reconciler, menu controller, error presenter, `visibilitychange` + `pagehide` listeners.

That is two WebSocket connections to the gateway, two sync bridges (two BroadcastChannel instances on the same channel name), two sync monitors with interval timers, two drift reconcilers, two IDB connections, an AudioContext, and a full DOM event tree.

**Severity: Low-Medium.** Modern phones generally handle this fine. However, `flutter_inappwebview` runs inside Flutter's rendering engine, which already consumes memory. On older or budget Android devices that Even G2 might pair with, WebView memory limits could be tighter than a standalone Chrome tab. The most likely symptom would be increased battery drain rather than a crash, making it hard to diagnose.

### 4. BroadcastChannel cross-module message echo

**Assumed:** "Cross-tab sync via BroadcastChannel works correctly with both modules in the same page."

**Why it might not hold:** Both `glasses-main` and `hub-main` call `createSyncBridge()`, which calls `new BroadcastChannel('openclaw-sync')`. BroadcastChannel's native behavior is: a message posted on one channel instance is received by ALL other instances on the same channel name in the same origin, EXCLUDING the sender. Since both modules create separate instances, when glasses-main posts a sync message, hub-main's BroadcastChannel instance receives it (and vice versa).

This is actually the designed cross-tab sync behavior. The concern is: in the original architecture (XOR routing), these two instances were always in separate tabs/contexts. Now they are in the same page. If glasses-main writes a conversation to IDB and posts a `sync:conversation-updated` message, hub-main receives it and tries to re-read from IDB to update its UI. This is probably fine -- it is essentially local sync. But if hub-main also writes and syncs, glasses-main receives it and also re-reads. This creates a potential ping-pong if sync message handling triggers further writes that trigger further sync messages.

**Severity: Low-Medium.** The sync bridge design uses idempotent operations (read latest from IDB), so ping-pong is unlikely to cause data corruption. The worst case is redundant IDB reads. However, if any sync handler both writes and re-posts, this would create an infinite loop. This should be verified by tracing the sync message handlers in both modules.

### 5. initHub() failure makes glasses-main unreachable

**Assumed:** It is acceptable that `initHub()` failure prevents `boot()` from running.

**Why it might not hold:** In the current `main.ts`:

```typescript
const { initHub } = await import('./hub-main');
await initHub();
// If initHub() throws, boot() never runs
if (hasFlutterBridge || forceEvenDev) {
  const { boot } = await import('./glasses-main');
  await boot();
}
```

If `initHub()` throws (IDB open failure on corrupted database, `document.querySelector` returning null for a missing DOM element, etc.), the error propagates to `main().catch()` which only logs it. `boot()` never executes. The glasses display stays blank.

In the OLD code, when `flutter_inappwebview` was present, only `boot()` ran. `initHub()` failure was impossible because it was never called. The new code introduced a regression: a hub-side failure now takes down the glasses-side too.

**Severity: High.** The glasses display is the primary user-facing output for Even G2. A phone-side failure (missing DOM element, IDB corruption) should not prevent the glasses from showing at minimum a "config required" or error message. This is an availability regression. The fix would be to wrap `initHub()` in a try/catch so glasses-main always gets a chance to boot.

### 6. Zero test coverage of the dual-boot path

**Assumed:** 524/524 passing tests provide confidence that the fix is correct.

**Why it might not hold:** The debug doc explicitly states: "tests do not cover the real-device boot path where flutter_inappwebview is present." This gap still exists. No test verifies:

- That `main()` calls both `initHub()` and `boot()` when `flutter_inappwebview` is present.
- That `initHub()` failure does not prevent `boot()`.
- That the boot order (hub first, then glasses) is correct.
- That two simultaneous IDB connections do not conflict.

The existing test files (`glasses-main.test.ts`, `nav-switching.test.ts`) test each module in isolation. `glasses-main.test.ts` sets `window.flutter_inappwebview = {}` but tests `boot()` directly -- it never goes through `main.ts`. `nav-switching.test.ts` tests DOM manipulation logic without involving `main.ts` at all.

**Severity: High.** The changed behavior has zero automated coverage. If a future refactor breaks the dual-boot path, no test will catch it. The fix is passing all 524 tests is a true statement but a misleading signal -- the tests never exercised the code that was broken and never exercise the code that was fixed.

---

## Recommended Follow-Up

### What: Integration test for `src/main.ts` dual-boot path

**File:** `src/__tests__/main-boot.test.ts`
**Test name:** `main() boots both initHub and boot when flutter_inappwebview is present`

### Why this one

This addresses the two highest-severity assumptions simultaneously: (5) `initHub()` failure blocking `boot()` and (6) zero test coverage of the dual-boot path. A single test file for `main.ts` would cover the actual code that was changed, verify the boot order, and establish a regression guard for the specific failure mode that caused the original P0 bug. Every other assumption (timing, memory, BroadcastChannel echo) requires real-device testing or load testing, but this one can be tested in Vitest with mocks.

### Sketch

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock both module entry points
const mockInitHub = vi.fn().mockResolvedValue(undefined);
const mockBoot = vi.fn().mockResolvedValue(undefined);

vi.mock('../hub-main', () => ({ initHub: mockInitHub }));
vi.mock('../glasses-main', () => ({ boot: mockBoot }));

describe('main.ts runtime router', () => {
  beforeEach(() => {
    mockInitHub.mockClear().mockResolvedValue(undefined);
    mockBoot.mockClear().mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete (window as any).flutter_inappwebview;
  });

  it('boots ONLY hub-main in plain browser (no flutter bridge)', async () => {
    delete (window as any).flutter_inappwebview;
    // Remove ?even param if present
    // Dynamically import and call main()
    const { main } = await import('../main');
    await main();

    expect(mockInitHub).toHaveBeenCalledOnce();
    expect(mockBoot).not.toHaveBeenCalled();
  });

  it('boots BOTH hub-main AND glasses-main when flutter_inappwebview present', async () => {
    (window as any).flutter_inappwebview = {};

    const { main } = await import('../main');
    await main();

    expect(mockInitHub).toHaveBeenCalledOnce();
    expect(mockBoot).toHaveBeenCalledOnce();
  });

  it('boots hub-main BEFORE glasses-main (order matters)', async () => {
    (window as any).flutter_inappwebview = {};
    const callOrder: string[] = [];
    mockInitHub.mockImplementation(async () => { callOrder.push('hub'); });
    mockBoot.mockImplementation(async () => { callOrder.push('glasses'); });

    const { main } = await import('../main');
    await main();

    expect(callOrder).toEqual(['hub', 'glasses']);
  });

  it('initHub failure does NOT prevent boot from running', async () => {
    // This test currently FAILS -- documenting the regression.
    // Fix: wrap initHub() in try/catch in main.ts.
    (window as any).flutter_inappwebview = {};
    mockInitHub.mockRejectedValue(new Error('IDB open failed'));

    const { main } = await import('../main');
    await main();

    // Even though initHub failed, boot should still run
    expect(mockBoot).toHaveBeenCalledOnce();
  });
});
```

### What it would catch

1. **Regression to XOR routing:** If anyone changes `main.ts` back to an if/else, the "boots BOTH" test fails immediately.
2. **Boot order reversal:** If someone moves `boot()` before `initHub()` (perhaps to address the timing concern), the order test catches it, forcing a deliberate decision.
3. **initHub failure cascade:** The fourth test explicitly documents and guards against assumption 5 -- that hub failure should not take down glasses. Note: this test would FAIL against the current code, which is the point. It surfaces the regression as a failing test that demands a design decision: either fix main.ts to wrap initHub in try/catch, or mark the test as `.skip` with an explicit rationale ("hub failure intentionally prevents glasses boot because X").

This is the highest-leverage single addition because it protects the exact code that was broken, tests the exact behavior that was fixed, and surfaces the most dangerous remaining assumption as a concrete, actionable failing test.

---

**Note on `main()` export:** The current `main.ts` defines `main()` as a local `async function` and calls it at module scope (`main().catch(...)`). To make it testable, `main` would need to be exported. This is a one-line change (`export async function main()`) with no behavior impact, but should be paired with ensuring the module-level call still happens (e.g., via a side-effect guard or by keeping the `main().catch()` call outside the function).
