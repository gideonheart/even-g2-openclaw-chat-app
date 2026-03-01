# Phase 18: Error UX - Research

**Researched:** 2026-03-01
**Domain:** Error presentation, health indicator UI, glasses display constraints, hub component patterns
**Confidence:** HIGH — all findings verified against actual project source code, no external library uncertainty

---

## Summary

Phase 18 is a pure UI-layer phase that wires existing error/health event signals (already emitted by Phases 14-17) into visible user-facing displays. No new infrastructure is needed — all events (`persistence:error`, `persistence:health`, `storage:evicted`, `sync:drift-detected`, `fsm:watchdog-reset`) are already being emitted; Phase 18 subscribes to them and surfaces them appropriately per context.

The work splits cleanly into two domains: **glasses** (minimal, auto-clearing status bar messages constrained by the 576x288 display) and **hub** (rich toasts, persistent banners, and an enhanced health page). The glasses presenter must respect the existing 3-container layout (`status` container 1 = 30px height, `chat` container 2 = 256px height) and the non-jargon language policy (RES-19). The hub presenter extends existing `showToast()` / `setHealthDot()` / `addLog()` patterns already present in `hub-main.ts`.

The deliverable structure is: `src/display/error-presenter.ts` (glasses variant as a factory that subscribes to the bus and calls `renderer` methods), a parallel hub error presenter wired into `hub-main.ts` or a standalone module, a `health-indicator.ts` module, and HTML/CSS additions to the health page in `index.html`.

**Primary recommendation:** Implement as two thin subscriber modules (glasses + hub) that consume existing bus events. Use the unsub-array pattern already established in display-controller.ts and gesture-handler.ts. Zero new dependencies.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| RES-16 | Glasses error display hierarchy: transient errors in status bar (container 1) auto-clear 3s; recoverable in status+hint bar auto-clear 10s with "tap to retry"; fatal full-screen but with "double-tap for menu" escape; never occupy chat (container 2) for more than 5 seconds | Status container is `bridge.textContainerUpgrade(1, ...)` with 30px height. Chat container 2 is 256px. Existing `showError()` puts errors in chat container — Phase 18 needs a separate status-bar-only path. Auto-clear uses `setTimeout`. |
| RES-17 | Hub error display: toasts for transient errors (auto-clear 5s), persistent banners for ongoing issues with action buttons. Error banner component: severity, message, optional recovery action, optional dismiss. | `showToast()` already exists at 2500ms; needs duration param or separate persistent path. Banner needs new HTML element + CSS. `persistence:error` and `fsm:watchdog-reset` are the primary event sources. |
| RES-18 | Hub health page enhancement: storage quota indicator (usage/quota/percent), sync status (last heartbeat, sequence gaps), overall health level (ok/degraded/error). Use existing `status-dot` CSS pattern. | `persistence:health` event carries `usageBytes`, `quotaBytes`, `usagePercent`, `isPersisted`, `isAvailable`. `syncMonitor.getStats()` carries `heartbeatGaps`, `lastReceivedAt`, `heartbeatSeq`. `isAlive()` exists on SyncMonitor. Health page already has `setHealthDot()` / `status-dot` CSS. |
| RES-19 | Glasses health policy: no persistent health indicators; only show errors when actionable or temporary; no technical jargon; every glasses error has auto-clear or gesture dismiss. | Enforced via: auto-clear timers (3s / 10s), user-friendly message text (e.g., "Storage full" not "QuotaExceededError"), FSM/watchdog reset shows actionable "Tap to retry" text. |

</phase_requirements>

---

## Standard Stack

### Core
| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| TypeScript strict mode | 5.7 | Type-safe module authoring | Project-wide constraint |
| Vitest | 3.x | Unit tests | Existing test framework, `npm test` |
| Project event bus | in-project | Cross-module signal delivery | Already used by all prior phases |
| Browser `setTimeout`/`clearTimeout` | built-in | Auto-clear timers | RES-22: zero new runtime deps |
| DOM `classList`/`textContent` | built-in | Hub banner/health DOM manipulation | Same pattern as hub-main.ts |

### Supporting
| Component | Purpose | When to Use |
|-----------|---------|-------------|
| `bridge.textContainerUpgrade(1, ...)` | Push status text to glasses status bar | All glasses error messages |
| `renderer.showError()` | (Existing) — puts message in chat container | NOT for Phase 18 error presenter — too persistent, occupies chat container |
| `showToast()` (hub-main.ts) | Transient 2500ms hub notification | Already wired; extend with duration param for 5000ms |
| `setHealthDot()` (hub-main.ts) | Update health page indicator dots | Add storage + sync rows to health page |
| `syncMonitor.getStats()` | Read heartbeat stats for health page | Called on health page render |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Adding HTML banner to `index.html` | Dynamically creating banner via JS | Static HTML simpler; follows existing modal/toast pattern |
| Separate error-presenter module | Inline in glasses-main.ts | Module is cleaner, testable; inline is already messy in hub-main.ts |
| Custom notification library | Browser built-ins + CSS | RES-22 mandates zero new runtime deps |

**Installation:** No new packages. All features use browser built-ins and existing project infrastructure.

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── display/
│   └── error-presenter.ts      # NEW: glasses error presenter (subscribes to bus)
├── health-indicator.ts         # NEW: hub health data aggregator
├── hub-main.ts                 # MODIFIED: wire hub error presenter + health indicator
├── glasses-main.ts             # MODIFIED: wire glasses error presenter
└── index.html                  # MODIFIED: add banner CSS + health page rows
```

### Pattern 1: Unsub-Array Factory (established project pattern)
**What:** Factory function creates subscribers, returns `destroy()` that cleans all unsubs.
**When to use:** Every new bus subscriber module in this project.
**Example from display-controller.ts:**
```typescript
// Source: src/display/display-controller.ts
export function createDisplayController(opts) {
  const unsubs: Array<() => void> = [];

  async function init(): Promise<void> {
    unsubs.push(bus.on('gateway:chunk', (chunk) => { /* ... */ }));
    unsubs.push(bus.on('gesture:scroll-up', () => { /* ... */ }));
  }

  function destroy(): void {
    for (const unsub of unsubs) unsub();
    unsubs.length = 0;
  }

  return { init, destroy };
}
```

### Pattern 2: Glasses Status Bar Error (new pattern for Phase 18)
**What:** Push error text to container 1 (status bar), auto-clear after N seconds via setTimeout.
**When to use:** RES-16 — all glasses error presentations.
**Key constraint:** Never use `renderer.showError()` for Phase 18 errors — that method inserts into the chat container (container 2) and adds a fake message to the viewport. Status bar errors use `bridge.textContainerUpgrade(1, message)` directly.
```typescript
// Glasses error presenter pattern
function showStatusError(message: string, durationMs: number): void {
  bridge.textContainerUpgrade(1, message);
  // Auto-clear by restoring the icon animator's current text
  setTimeout(() => {
    bridge.textContainerUpgrade(1, iconAnimator.getCurrentText());
  }, durationMs);
}
```

### Pattern 3: Hub Toast with Duration
**What:** Extend existing `showToast()` to accept duration, or create separate persistent banner.
**Current:** `showToast()` hardcodes 2500ms. RES-17 needs 5000ms for error toasts.
**Existing showToast code (hub-main.ts line 59-65):**
```typescript
function showToast(msg: string): void {
  const container = $('toastContainer');
  $('toastText').textContent = msg;
  container.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => container.classList.add('hidden'), 2500);
}
```
**Phase 18 approach:** Add optional `durationMs` parameter or create `showToast(msg, ms)` overload.

### Pattern 4: Hub Persistent Error Banner
**What:** A banner element that shows persistent error messages with optional action button and dismiss.
**When to use:** RES-17 — ongoing issues (e.g., storage critical at 95%, database reopen failed).
**HTML structure** (follows existing `modal` / `toast` patterns in index.html):
```html
<!-- Error banner — hidden by default, shown when persistent error exists -->
<div id="errorBanner" class="error-banner hidden">
  <span id="errorBannerText" class="error-banner__text"></span>
  <button id="errorBannerAction" class="btn btn--ghost btn--tight error-banner__action hidden"></button>
  <button id="errorBannerDismiss" class="btn btn--ghost btn--tight" aria-label="Dismiss">✕</button>
</div>
```

### Pattern 5: Health Page Enhancement
**What:** Add new list-items to health page for storage quota and sync status, using existing `status-dot` CSS.
**When to use:** RES-18.
**Existing pattern:**
```html
<!-- From index.html health page: -->
<div class="list-item" id="hGateway">
  <span class="list-item__leading"><span class="status-dot status-dot--off" id="hGatewayDot"></span></span>
  <div class="list-item__content">
    <div class="list-item__title">Gateway</div>
    <div class="list-item__subtitle" id="hGatewayStatus">Not configured</div>
  </div>
</div>
```
**New rows to add:** `hStorage` (storage quota indicator) + `hSync` (sync status + heartbeat gaps).

### Anti-Patterns to Avoid
- **Using `renderer.showError()` for Phase 18 errors on glasses:** This inserts a fake assistant message into the chat viewport and a message into the messages array. Use `bridge.textContainerUpgrade(1, ...)` for status bar errors only.
- **Persisting errors in glasses chat container beyond 5 seconds:** RES-16 explicitly prohibits this (Pitfall P5). The 3s/10s timers must always fire.
- **Blocking the boot sequence with error display:** Error presenters must be wired AFTER display init (post-Layer 4). Avoid any `await` in error subscriber callbacks.
- **Using technical error strings on glasses:** Map error types to user-friendly strings. `QuotaExceededError` → "Storage full". `database-closed` → "Data connection lost".
- **Persistent health indicators on glasses:** RES-19 prohibits this. No badge, no permanent indicator, no status dot on the glasses display.
- **Re-using hub's `showToast()` for persistent banners:** Toast is auto-clearing. Persistent issues (ongoing storage warning, IDB failure) need a separate non-dismissing banner.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Auto-clear timers | Custom timer management class | `setTimeout` + `clearTimeout` directly | Existing project pattern; timers stored as module-level vars |
| Health status aggregation | Polling loop | Subscribe to `persistence:health` event + call `syncMonitor.getStats()` on page render | Data is already available; no polling needed |
| Error severity classification | Custom severity enum | Use existing `persistence:error.recoverable` boolean + `type` field | Already classified in the emitted event payload |
| DOM toast animation | CSS animation library | `opacity` transition in existing `.toast-container.hidden` CSS | Already implemented at line 136-140 of index.html |

**Key insight:** Phase 18 is a subscriber/consumer phase, not an infrastructure phase. All data is already produced. The only engineering is the display layer connecting events to the appropriate UI element.

---

## Common Pitfalls

### Pitfall 1: Icon Animator Overwrite
**What goes wrong:** Status bar error text gets overwritten 200ms later by the icon animator's next tick, which calls `bridge.textContainerUpgrade(1, ...)`.
**Why it happens:** The icon animator runs on a `setInterval` at 3-6 fps (every 167-333ms). It continuously pushes icon text to container 1. An error message pushed to container 1 will be overwritten almost immediately.
**How to avoid:** The glasses error presenter must either: (a) pause the icon animator during error display then restore it after auto-clear, or (b) track error display in the icon animator itself. Option (a) is simpler. The `iconAnimator` is accessible inside `glasses-main.ts` scope (used in `displayController`). Pass it to the error presenter or wire the auto-clear to call `iconAnimator.start()` after the timer fires.
**Warning signs:** Status bar error messages flash briefly then disappear before the auto-clear timer fires.

### Pitfall 2: Dual-Emit Ordering (persistence:error before persistence:warning)
**What goes wrong:** Phase 15 tech debt: on retry exhaustion, `persistence:error` fires BEFORE `persistence:warning`. If the error presenter handles both, it may show two messages (or the wrong one) depending on handler order.
**Why it happens:** `auto-save.ts` emits `persistence:error` in `saveWithRetry()` then the caller emits `persistence:warning`. On retry exhaustion, both fire within the same microtask.
**How to avoid:** Treat `persistence:error` as superseding `persistence:warning` for the same event. In the glasses error presenter, suppress the `persistence:warning` message if a `persistence:error` with `recoverable: false` was already shown. Use a `lastErrorLevel` flag (e.g., `'warning' | 'error' | null`).

### Pitfall 3: Hub Banner Visibility Race
**What goes wrong:** Multiple persistence errors in quick succession create overlapping banners or corrupt banner state.
**Why it happens:** IDB failures can fire `persistence:error` multiple times (write-failed on each retry attempt, then database-closed separately).
**How to avoid:** The banner should display a single "worst current error" rather than queuing errors. Keep a `currentBannerSeverity` variable and only replace with a worse severity.

### Pitfall 4: stale syncMonitor reference for isAlive()
**What goes wrong:** Health page reads `isAlive()` from `hubSyncMonitor` (module-level in hub-main.ts), which may be null if IndexedDB was unavailable.
**Why it happens:** `hubSyncMonitor` is set in `initPersistence()` which returns null if IDB fails.
**How to avoid:** Guard `hubSyncMonitor?.isAlive() ?? true` — treat null monitor as alive (same logic as `isAlive()` returns true when no heartbeat received).

### Pitfall 5: Glasses Error During Hidden State
**What goes wrong:** Error presenter pushes text to container 1 while renderer is hidden (display off). When display wakes, the icon animator may have already overwritten the error text.
**Why it happens:** `renderer.isHidden()` checks are not wired into the error presenter.
**How to avoid:** If `renderer.isHidden()` is true when an error fires, skip the status bar update or queue it for display on wake. For fatal errors, call `renderer.wake()` before showing.

### Pitfall 6: Auto-Clear Timer Persisting Across Session Switch
**What goes wrong:** A 10-second auto-clear timer fires after a session switch and overwrites the new session's status bar content.
**Why it happens:** Timer IDs are module-scoped; session switch doesn't cancel outstanding timers.
**How to avoid:** Maintain a module-level `statusClearTimer` reference and cancel it on any new error or session switch. The error presenter's `destroy()` must `clearTimeout(statusClearTimer)`.

---

## Code Examples

### Glasses Error Presenter Structure
```typescript
// Source: based on display-controller.ts factory pattern (src/display/display-controller.ts)
// src/display/error-presenter.ts (new file)

export interface GlassesErrorPresenter {
  destroy(): void;
}

export function createGlassesErrorPresenter(opts: {
  bus: EventBus<AppEventMap>;
  bridge: BridgeService;
  renderer: GlassesRenderer;
}): GlassesErrorPresenter {
  const { bus, bridge, renderer } = opts;
  const unsubs: Array<() => void> = [];
  let statusClearTimer: ReturnType<typeof setTimeout> | null = null;
  let lastErrorLevel: 'warning' | 'error' | null = null;

  function showStatusBar(message: string, durationMs: number): void {
    if (statusClearTimer) clearTimeout(statusClearTimer);
    bridge.textContainerUpgrade(1, message);
    statusClearTimer = setTimeout(() => {
      statusClearTimer = null;
      lastErrorLevel = null;
      // Icon animator will naturally overwrite on its next tick
      // OR we restore hint text: bridge.textContainerUpgrade(1, hintText);
    }, durationMs);
  }

  // RES-16: persistence:error
  unsubs.push(bus.on('persistence:error', ({ type, recoverable, message }) => {
    if (lastErrorLevel === 'error') return; // already showing worse error
    lastErrorLevel = 'error';
    const userMsg = mapErrorTypeToMessage(type);
    const duration = recoverable ? 10_000 : 3_000;
    showStatusBar(userMsg, duration);
  }));

  // RES-16: fsm:watchdog-reset — "Tap to retry" for stuck states
  unsubs.push(bus.on('fsm:watchdog-reset', ({ previousState }) => {
    showStatusBar(`${stateLabel(previousState)} timed out — tap to retry`, 5_000);
  }));

  // RES-19: friendly message mapping
  function mapErrorTypeToMessage(type: string): string {
    switch (type) {
      case 'quota-exceeded':   return 'Storage full';
      case 'database-closed':  return 'Data connection lost — reconnecting';
      case 'write-failed':     return 'Could not save message';
      case 'verify-failed':    return 'Storage check failed';
      default:                 return 'Something went wrong';
    }
  }

  function destroy(): void {
    if (statusClearTimer) clearTimeout(statusClearTimer);
    for (const unsub of unsubs) unsub();
    unsubs.length = 0;
  }

  return { destroy };
}
```

### Hub Error Banner HTML/CSS
```html
<!-- To be inserted above the #app div or as first child of #app: -->
<div id="errorBanner" class="error-banner hidden">
  <div class="error-banner__content">
    <span class="error-banner__icon" id="errorBannerIcon">⚠</span>
    <span id="errorBannerText" class="error-banner__text"></span>
  </div>
  <div class="error-banner__actions">
    <button id="errorBannerAction" class="btn btn--ghost btn--tight hidden"></button>
    <button id="errorBannerDismiss" class="error-banner__dismiss">✕</button>
  </div>
</div>
```

```css
/* To be added to index.html <style> block */
.error-banner {
  position: sticky; top: 0; z-index: 150;
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; gap: 8px;
  background: #7b2d2d; color: #fff;
  font-size: var(--text-body-base-size);
}
.error-banner--warn { background: #7b5e2d; }
.error-banner--err  { background: #7b2d2d; }
.error-banner__content { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.error-banner__text { flex: 1; min-width: 0; word-break: break-word; }
.error-banner__actions { display: flex; gap: 6px; flex-shrink: 0; }
.error-banner__dismiss { border: none; background: transparent; color: #fff; cursor: pointer; padding: 4px; }
```

### Hub Health Page New Rows
```html
<!-- Storage quota row — to be added to health page "Service checks" card -->
<div class="list-item" id="hStorage">
  <span class="list-item__leading"><span class="status-dot status-dot--off" id="hStorageDot"></span></span>
  <div class="list-item__content">
    <div class="list-item__title">Storage</div>
    <div class="list-item__subtitle" id="hStorageStatus">Unknown</div>
  </div>
</div>

<!-- Sync status row -->
<div class="list-item" id="hSync">
  <span class="list-item__leading"><span class="status-dot status-dot--off" id="hSyncDot"></span></span>
  <div class="list-item__content">
    <div class="list-item__title">Sync</div>
    <div class="list-item__subtitle" id="hSyncStatus">No heartbeat</div>
  </div>
</div>
```

### Health Indicator Logic
```typescript
// src/health-indicator.ts (new file) — pure data aggregation, no DOM

export type HealthLevel = 'ok' | 'degraded' | 'error';

export interface StorageHealthSnapshot {
  level: HealthLevel;
  label: string;        // e.g., "23% used (45 MB / 200 MB)"
  dot: string;          // 'ok' | 'warn' | 'err' | 'off'
}

export interface SyncHealthSnapshot {
  level: HealthLevel;
  label: string;        // e.g., "Active · 2 gaps"
  dot: string;
}

export function computeStorageHealth(
  usagePercent: number,
  usageBytes: number,
  quotaBytes: number,
  isPersisted: boolean,
): StorageHealthSnapshot {
  const pct = usagePercent.toFixed(1);
  const usedMb = (usageBytes / 1_048_576).toFixed(1);
  const quotaMb = (quotaBytes / 1_048_576).toFixed(1);
  const base = `${pct}% used (${usedMb} MB / ${quotaMb} MB)`;
  const suffix = isPersisted ? '' : ' — not persisted';
  if (usagePercent >= 95) return { level: 'error', label: base + suffix, dot: 'err' };
  if (usagePercent >= 80 || !isPersisted) return { level: 'degraded', label: base + suffix, dot: 'warn' };
  return { level: 'ok', label: base, dot: 'ok' };
}

export function computeSyncHealth(
  isAlive: boolean,
  heartbeatGaps: number,
  lastReceivedAt: number,
): SyncHealthSnapshot {
  if (!isAlive) return { level: 'error', label: 'Peer disconnected', dot: 'err' };
  const gapStr = heartbeatGaps > 0 ? ` · ${heartbeatGaps} gap${heartbeatGaps > 1 ? 's' : ''}` : '';
  const lastSeen = lastReceivedAt > 0
    ? `Last heartbeat ${Math.round((Date.now() - lastReceivedAt) / 1000)}s ago`
    : 'Waiting for peer';
  const dot = heartbeatGaps > 0 ? 'warn' : (lastReceivedAt > 0 ? 'ok' : 'off');
  const level = heartbeatGaps > 0 ? 'degraded' : 'ok';
  return { level, label: lastSeen + gapStr, dot };
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `renderer.showError()` for all glass errors | Status bar only via `bridge.textContainerUpgrade(1, ...)` with auto-clear | Phase 18 | Chat container stays clean; errors don't pollute message history |
| `showToast()` hardcoded 2500ms | `showToast(msg, durationMs?)` with optional duration | Phase 18 | Allows 5000ms error toasts per RES-17 |
| Hub health page: 3 static dots (gateway/stt/session) | Hub health page: 5 dots (+ storage quota + sync status) | Phase 18 | Exposes persistence and sync health from Phases 14-16 |
| No glasses error presenter | `createGlassesErrorPresenter()` factory consuming bus events | Phase 18 | All Phase 14-17 error events finally have a UI consumer |

**Deprecated/outdated:**
- Direct use of `renderer.showError()` for Phase 18 error types: it adds a chat message to the viewport. Must switch to `bridge.textContainerUpgrade(1, ...)` pattern for status-bar-only errors.
- Hub `console.warn`/`console.error` for eviction and IDB close (added as stopgap in Phase 16.5): Phase 18 replaces these with proper UI.

---

## Open Questions

1. **Icon animator pause during status bar error on glasses**
   - What we know: The icon animator calls `bridge.textContainerUpgrade(1, ...)` every 167-333ms. An error message would be overwritten almost immediately.
   - What's unclear: Should the error presenter pause `iconAnimator` during error display, or should the icon animator incorporate error awareness?
   - Recommendation: Pass `iconAnimator` to `createGlassesErrorPresenter()`. Call `iconAnimator.stop()` on error show, `iconAnimator.start()` when auto-clear fires. This is surgical and avoids modifying the icon animator module.

2. **Hint bar (container 2 bottom) vs status bar (container 1 top) for "tap to retry"**
   - What we know: RES-16 says recoverable errors appear in "status + hint bar". The current layout has only 2 containers: status (container 1) and chat (container 2). There is no separate "hint bar" container 3 — the `getHintText()` function in gesture-handler.ts returns a string but it's currently NOT being pushed to any container (the hint text was planned in Phase 2 but the display never implemented a 3rd container).
   - What's unclear: Does "hint bar" mean the bottom portion of container 2, or should a 3rd container be added to the layout?
   - Recommendation: Keep 2-container layout (matches existing code). For recoverable errors, use the status bar (container 1). For fatal, update the entire chat container (container 2) briefly. Do NOT add a 3rd container — that would require layout changes and testing outside Phase 18 scope.

3. **Hub banner placement: sticky header vs page-level**
   - What we know: The hub is a mobile-style SPA with `#app` div containing all pages. The bottom nav is fixed. A sticky banner at the top of `#app` would work without conflicting with bottom nav.
   - What's unclear: Whether the banner should show across all pages or only on specific pages.
   - Recommendation: Global sticky banner at top of `#app` — error conditions (IDB failure, storage critical) affect the entire app, not a single page. Dismiss button allows clearing.

4. **hub-main.ts is already large — extract or extend?**
   - What we know: `hub-main.ts` is 1141 lines with many inline functions. Adding more event subscriptions inline will increase complexity.
   - What's unclear: Whether to add hub error subscriptions inline or extract a `hub-error-presenter.ts` module.
   - Recommendation: Extract to a thin `src/hub-error-presenter.ts` factory that accepts the same dependencies (DOM element IDs, `showToast`) and returns `destroy()`. Wire it in `initHub()`. This follows the project's factory+destroy pattern and keeps hub-main.ts from growing further.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x |
| Config file | vite.config.ts (vitest config embedded) |
| Quick run command | `npm test` |
| Full suite command | `npm test` |
| Estimated runtime | ~10-15 seconds (450 tests currently) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RES-16 | Glasses error hierarchy: status bar 3s auto-clear for transient, 10s for recoverable, never chat container >5s | unit | `npm test -- --reporter=verbose src/__tests__/glasses-error-presenter.test.ts` | ❌ Wave 0 gap |
| RES-17 | Hub error display: toast 5s, persistent banner with action + dismiss | unit | `npm test -- --reporter=verbose src/__tests__/hub-error-presenter.test.ts` | ❌ Wave 0 gap |
| RES-18 | Hub health page: storage quota, sync status, overall health level computed correctly | unit | `npm test -- --reporter=verbose src/__tests__/health-indicator.test.ts` | ❌ Wave 0 gap |
| RES-19 | Glasses health policy: no persistent indicators, no jargon, every error auto-clears | unit (covered by RES-16 tests) | `npm test -- --reporter=verbose src/__tests__/glasses-error-presenter.test.ts` | ❌ Wave 0 gap |

### Nyquist Sampling Rate
- **Minimum sample interval:** After every committed task → run: `npm test`
- **Full suite trigger:** Before merging final task of any plan wave
- **Phase-complete gate:** Full suite green before `/gsd:verify-work` runs
- **Estimated feedback latency per task:** ~12 seconds

### Wave 0 Gaps (must be created before implementation)
- [ ] `src/__tests__/glasses-error-presenter.test.ts` — covers RES-16 + RES-19 (status bar error display, auto-clear timers, message mapping, icon animator pause/resume)
- [ ] `src/__tests__/hub-error-presenter.test.ts` — covers RES-17 (toast duration, banner show/hide/dismiss, action button wiring)
- [ ] `src/__tests__/health-indicator.test.ts` — covers RES-18 (computeStorageHealth, computeSyncHealth pure functions)

---

## Event Contracts (Inputs to Phase 18)

Phase 18 consumes the following events — all verified as emitted in the codebase:

| Event | Source | Payload | Consumer |
|-------|--------|---------|----------|
| `persistence:error` | `auto-save.ts` (write-failed, verify-failed), `glasses-main.ts` (database-closed) | `{ type, recoverable, message?, conversationId? }` | Glasses + Hub error presenter |
| `persistence:health` | `glasses-main.ts` boot | `{ usageBytes, quotaBytes, usagePercent, isPersisted, isAvailable }` | Hub health page (storage row) |
| `storage:evicted` | `glasses-main.ts` boot | `{}` | Hub: already handled by 16.5 addLog+showToast; glasses: already handled by renderer.showError via flag |
| `fsm:watchdog-reset` | `gesture-handler.ts` | `{ previousState, elapsed }` | Glasses error presenter (tap-to-retry message) |
| `sync:drift-detected` | `drift-reconciler.ts` via boot | `{ localCount, remoteCount, conversationId }` | Hub health page (sync status — optional, for degraded state) |
| `sync:reconciled` | `drift-reconciler.ts` via boot | `{ conversationId, action }` | Hub health page update (back to ok) |
| `persistence:warning` | `auto-save.ts` | `{ message }` | Glasses: already subscribed at glasses-main.ts:432; Hub: Phase 18 banner |

**Key audit finding:** `persistence:error` and `fsm:watchdog-reset` have NO production UI subscriber currently. `persistence:health` bus event has no subscriber (hub uses `addLog` directly). These are the primary wiring gaps Phase 18 closes.

---

## Plan Breakdown Guidance

Based on requirements and dependencies, Phase 18 should have **2 plans**:

### Plan 18-01: Glasses Error Presenter + Health Policy
**Scope:** RES-16 + RES-19
- Create `src/display/error-presenter.ts` — factory, unsub pattern, bus subscriptions
- Wire in `glasses-main.ts` (after display controller init)
- Tests: `src/__tests__/glasses-error-presenter.test.ts`
- Address icon animator pause/resume integration
- Map error types to user-friendly strings

### Plan 18-02: Hub Error Display + Health Page Enhancement
**Scope:** RES-17 + RES-18
- Create `src/hub-error-presenter.ts` — hub error banner + extended toast
- Create `src/health-indicator.ts` — pure functions for health computation
- Modify `index.html` — banner HTML/CSS + new health page rows (storage + sync)
- Modify `hub-main.ts` — wire hub error presenter, wire `persistence:health` subscriber, call `syncMonitor.getStats()` on health page render
- Tests: `src/__tests__/hub-error-presenter.test.ts` + `src/__tests__/health-indicator.test.ts`

---

## Sources

### Primary (HIGH confidence)
- `src/display/display-controller.ts` — factory/unsub pattern for all new subscriber modules
- `src/display/glasses-renderer.ts` — showError() semantics (chat container, not status bar), bridge.textContainerUpgrade(1, ...) for status bar
- `src/types.ts` — complete AppEventMap with all event payload types
- `src/hub-main.ts` — existing showToast(), setHealthDot(), addLog() implementation
- `index.html` — existing HTML structure, status-dot CSS, health page element IDs
- `src/gestures/gesture-handler.ts` — fsm:watchdog-reset emission context
- `src/persistence/auto-save.ts` — persistence:error emission context and dual-emit ordering
- `src/sync/sync-monitor.ts` — getStats(), isAlive() API for health indicator
- `.planning/v1.3-MILESTONE-AUDIT.md` — confirmed integration gaps and Phase 18 forward hooks

### Secondary (MEDIUM confidence)
- `STATE.md` decisions — hub uses addLog+showToast (no event bus for persistence) — confirmed by 16.5-02 decision
- `ROADMAP.md` Phase 18 description — key deliverables enumerated

### Tertiary (LOW confidence)
- None — all findings verified against project source code

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all tools are existing project infrastructure, no new deps
- Architecture: HIGH — patterns verified against display-controller.ts, gesture-handler.ts, hub-main.ts
- Pitfalls: HIGH — icon animator overwrite and dual-emit ordering verified directly in source code
- Event contracts: HIGH — all events verified in AppEventMap + emitter code
- Plan split: HIGH — 2-plan split is clean by requirement groups with no cross-dependencies

**Research date:** 2026-03-01
**Valid until:** 2026-04-01 (stable codebase — patterns don't change without new phases)
