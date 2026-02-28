# Phase 7: Error Handling & Lifecycle - Research

**Researched:** 2026-02-28
**Domain:** Error recovery, request timeouts, resource cleanup in browser/WebView voice loop
**Confidence:** HIGH

## Summary

Phase 7 adds error resilience and resource lifecycle management to the voice loop wired in Phase 6. The scope is narrow and well-defined: three requirements (ERR-01, ERR-02, ERR-03) targeting three specific failure modes -- gateway error recovery, request timeout with feedback, and graceful shutdown on app close.

The codebase is well-prepared for this phase. All modules already follow the factory+interface+destroy pattern established in Phases 1-5. The Phase 6 code review (Quick Task 3) identified every file that needs modification and the specific gaps. The primary work is: (1) adding a `reset` input to the gesture FSM so errors can transition the FSM back to idle, (2) adding `AbortSignal.timeout(30000)` to the gateway's `sendVoiceTurn` fetch call, and (3) restructuring `glasses-main.ts` boot function to retain module references and register a cleanup handler.

No new libraries are needed. All required browser APIs (`AbortSignal.timeout`, `AbortSignal.any`, `visibilitychange` event, `pagehide` event) are available in the ES2022 target environment and modern Android WebView (Chrome 116+, which ships with Android 14+ and is auto-updated on older versions).

**Primary recommendation:** Implement all three requirements by modifying existing files only. No new modules needed. The gesture FSM gets a `reset` input, the gateway client gets a timeout signal, and `glasses-main.ts` gets a cleanup function wired to `visibilitychange`/`pagehide` events.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ERR-01 | FSM transitions to idle state when gateway returns an error mid-turn | Add `reset` input to gesture FSM transition table. VoiceLoopController (or display-controller) emits a bus event on error chunk; gesture-handler listens and resets FSM to idle. |
| ERR-02 | Gateway requests timeout after 30 seconds with user-visible feedback | Compose `AbortSignal.timeout(30000)` with the existing `AbortController.signal` using `AbortSignal.any()`. Detect `TimeoutError` in the catch block, emit a timeout-specific error chunk. Display controller shows timeout message via renderer. |
| ERR-03 | App performs graceful shutdown on unload | Restructure `glasses-main.ts` boot to retain module refs and return a cleanup function. Wire cleanup to `visibilitychange` (hidden) and `pagehide` events. Cleanup calls `destroy()` on gateway, voiceLoopController, displayController, gestureHandler, bridge in reverse init order. |
</phase_requirements>

## Standard Stack

### Core

No new libraries. Phase 7 uses only browser-native APIs and existing project modules.

| API/Module | Availability | Purpose | Why Standard |
|------------|-------------|---------|--------------|
| `AbortSignal.timeout()` | ES2022 / Chrome 103+ | 30-second timeout on fetch requests | Browser-native timeout signal, no polyfill needed |
| `AbortSignal.any()` | Chrome 116+ / Firefox 124+ | Compose timeout signal with manual abort signal | Browser-native signal composition, replaces manual AbortController wiring |
| `visibilitychange` event | All modern browsers | Detect app backgrounding/closing | Most reliable cleanup signal on mobile/WebView; fires when `beforeunload` may not |
| `pagehide` event | All modern browsers | Fallback cleanup signal | Secondary cleanup signal, complementary to `visibilitychange` |
| `TimeoutError` DOMException | Chrome 103+ | Distinguish timeout from network error | Standard DOMException name for timeout aborts |

### Supporting

No additional supporting libraries needed.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `AbortSignal.any()` | Manual listener on timeout signal forwarding to AbortController | More code, same behavior; `AbortSignal.any()` is cleaner. Available in Chrome 116+ which covers Even G2's WebView. |
| `visibilitychange` + `pagehide` | `beforeunload` only | `beforeunload` is unreliable on mobile WebView and may not fire when the Flutter host app navigates away. `visibilitychange` is more reliable. |
| Adding `reset` FSM input | External state mutation of gesture-handler's `state` variable | Breaks encapsulation. A proper FSM input maintains the pure transition table pattern. |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended Project Structure

No new files needed. All changes are to existing files:

```
src/
├── gestures/
│   ├── gesture-fsm.ts        # Add 'reset' input to GestureInput union + transition table
│   └── gesture-handler.ts    # Listen for error bus event, dispatch 'reset' to FSM
├── api/
│   └── gateway-client.ts     # Add timeout signal, detect TimeoutError
├── voice-loop-controller.ts  # No changes needed (already forwards error chunks)
├── display/
│   ├── display-controller.ts # Show timeout feedback, emit FSM reset event
│   └── glasses-renderer.ts   # Add showError(message) method for user-visible feedback
├── glasses-main.ts           # Retain module refs, register cleanup handlers
└── types.ts                  # Add 'voice-loop:error' event to AppEventMap (if needed)
```

### Pattern 1: FSM Reset Input

**What:** Add a `reset` input to the gesture FSM that unconditionally transitions any state to `idle` with no action.

**When to use:** When an external event (gateway error) requires the FSM to return to idle regardless of its current state.

**Example:**
```typescript
// In gesture-fsm.ts -- add to GestureInput union
export type GestureInput = 'tap' | 'double-tap' | 'scroll-up' | 'scroll-down' | 'reset';

// In TRANSITIONS table -- every state transitions to idle on reset
idle:      { 'reset': { nextState: 'idle',  action: null } },
recording: { 'reset': { nextState: 'idle',  action: null } },
sent:      { 'reset': { nextState: 'idle',  action: null } },
thinking:  { 'reset': { nextState: 'idle',  action: null } },
menu:      { 'reset': { nextState: 'idle',  action: null } },
```

**Why `reset` and not error-specific input:** The FSM is pure and domain-agnostic. It shouldn't know about gateway errors. A `reset` input is a general-purpose "return to idle" that can be triggered by any error or recovery scenario.

### Pattern 2: Timeout Signal Composition

**What:** Compose a manual `AbortController.signal` (for user cancellation / `.abort()`) with `AbortSignal.timeout(30000)` using `AbortSignal.any()`.

**When to use:** When a fetch request needs both manual cancellation AND automatic timeout.

**Example:**
```typescript
// In gateway-client.ts sendVoiceTurn
abortController = new AbortController();
const timeoutMs = 30000;
const combinedSignal = AbortSignal.any([
  abortController.signal,
  AbortSignal.timeout(timeoutMs),
]);

const resp = await fetch(url, {
  method: 'POST',
  body: formData,
  signal: combinedSignal,
});
```

**Error detection in catch block:**
```typescript
catch (err: unknown) {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return; // Intentional user cancellation
  }
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    emitChunk({ type: 'error', error: 'Request timed out' });
    setStatus('error');
    return; // Do NOT retry on timeout
  }
  // ... existing network error handling with retry
}
```

### Pattern 3: Lifecycle Cleanup via visibilitychange

**What:** Register a cleanup function on `visibilitychange` and `pagehide` events. Call `destroy()` on all modules in reverse initialization order.

**When to use:** When the app runs in a WebView that may be torn down without `beforeunload` firing.

**Example:**
```typescript
// In glasses-main.ts boot()
function cleanup(): void {
  voiceLoopController.destroy();
  gateway.destroy();
  displayController.destroy();
  gestureHandler.destroy();
  audioCapture.stopRecording().catch(() => {}); // best-effort
  bridge.destroy();
  bus.clear();
}

// Register cleanup handlers
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    cleanup();
  }
});
window.addEventListener('pagehide', cleanup);
```

### Pattern 4: Error Event Flow Through Bus

**What:** When gateway emits an error chunk, the display controller handles display recovery AND emits a bus event that the gesture handler uses to reset the FSM.

**Flow:**
```
gateway error chunk
  -> VoiceLoopController forwards to bus as 'gateway:chunk' (already wired)
  -> DisplayController handles display: endStreaming(), show error message, settle to idle icon
  -> DisplayController (or VoiceLoopController) emits 'voice-loop:error' bus event
  -> GestureHandler listens for 'voice-loop:error', calls handleInput('reset', Date.now())
  -> FSM transitions to idle
  -> User can immediately tap to start a new voice turn
```

### Anti-Patterns to Avoid

- **Directly mutating FSM state from outside gesture-handler:** Breaks encapsulation. Use the bus event -> handleInput('reset') pattern to keep the FSM transition table as the single source of truth.
- **Using `beforeunload` as the sole cleanup event:** Unreliable on mobile WebViews. Flutter InAppWebView may navigate away without firing `beforeunload`. Use `visibilitychange` + `pagehide` instead.
- **Retrying on timeout:** A 30-second timeout means the gateway is unresponsive. Retrying immediately wastes resources and delays recovery. Return to idle and let the user retry manually.
- **Cleanup racing with active operations:** The cleanup function should be idempotent. Calling `destroy()` on already-destroyed modules must be safe (all existing destroy methods handle this gracefully already).
- **Adding a global error dialog/modal:** The glasses display is 576x288px with a 4-bit greyscale monochrome font. There's no room for modals. Use inline text in the existing chat container (e.g., "Timed out. Tap to retry.").

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Request timeout | Manual setTimeout + abort wiring | `AbortSignal.timeout(30000)` | Browser-native, handles cleanup automatically, produces correct `TimeoutError` DOMException |
| Composing abort signals | Listener-based signal forwarding | `AbortSignal.any([...signals])` | Browser-native, no leak risk, no race conditions |
| Timeout error detection | String matching on error messages | `err.name === 'TimeoutError'` | Standard DOMException name, won't break across browsers |
| Cleanup event detection | Custom polling or framework-specific hooks | `visibilitychange` + `pagehide` events | W3C standard, works in WebView, most reliable on mobile |

**Key insight:** All error handling and lifecycle patterns needed here are solved by browser-native APIs. There is zero reason to add libraries or build custom timeout/cleanup infrastructure.

## Common Pitfalls

### Pitfall 1: FSM Stuck in `sent` or `thinking` After Error

**What goes wrong:** Gateway returns an error chunk, display resets to idle icon, but the gesture FSM remains in `sent` or `thinking`. User taps to start a new voice turn but the tap is ignored (because `sent` and `thinking` have no tap transition).

**Why it happens:** Phase 6 wired error handling to the display controller but not to the gesture handler. The FSM and display icon are not synchronized on error.

**How to avoid:** Add a bus event (e.g., `voice-loop:error`) that the gesture handler listens for, and dispatch a `reset` input to the FSM when it fires.

**Warning signs:** After an error, user taps produce no visual or audio feedback. Test by mocking a gateway error mid-turn and verifying FSM state returns to `idle`.

### Pitfall 2: Timeout Triggers Exponential Backoff Retry

**What goes wrong:** The 30-second timeout is implemented as a `TimeoutError`, but the existing catch block treats it like a network error and retries with exponential backoff. This means a hung gateway causes 30s + 30s + 30s... of waiting before the user gets feedback.

**Why it happens:** The existing catch block in `sendVoiceTurn` retries on all non-AbortError errors.

**How to avoid:** Add an explicit `TimeoutError` check BEFORE the retry logic. Timeout errors should NOT trigger retry -- they should emit an error chunk and return immediately.

**Warning signs:** After gateway timeout, the UI stays in "thinking" state for much longer than 30 seconds.

### Pitfall 3: Cleanup Handler Fires During Active Recording

**What goes wrong:** User is mid-recording when the app is backgrounded. `visibilitychange` fires, cleanup destroys the audio capture and bridge, but the MediaRecorder is still running. MediaRecorder callback fires after bridge is destroyed, causing an unhandled error.

**Why it happens:** MediaRecorder's `onstop` callback is asynchronous and may fire after the bridge is destroyed.

**How to avoid:** In the cleanup function, stop recording first (call `audioCapture.stopRecording()`) before destroying the bridge. Use `.catch(() => {})` to suppress errors from stopping a non-recording capture.

**Warning signs:** Console errors about accessing properties of null bridge after app backgrounding.

### Pitfall 4: Double Cleanup

**What goes wrong:** `visibilitychange` fires (hidden), then `pagehide` fires immediately after. Cleanup runs twice, calling `destroy()` on already-destroyed modules.

**Why it happens:** Both events can fire in sequence during page teardown.

**How to avoid:** Use a `let cleaned = false` guard flag. First call sets it to true, subsequent calls return immediately.

**Warning signs:** "Cannot read properties of null" errors in console during app close.

### Pitfall 5: Settle Timer Races With Error Reset

**What goes wrong:** Gateway error fires, display controller starts 500ms settle timer, gesture handler resets FSM to idle. User taps to start new recording. 500ms later, settle timer fires and sets icon to idle, overwriting the recording icon.

**Why it happens:** The 500ms settle timer from `response_end` or `error` is not cancelled when a new recording starts.

**How to avoid:** Clear the settle timer when `audio:recording-start` fires. The display controller already tracks `settleTimer` (fixed in Quick Task 3) -- add a clear in the `recording-start` handler.

**Warning signs:** Recording icon briefly flickers to idle during a voice turn that immediately follows an error.

### Pitfall 6: Error Message Not Visible on Glasses

**What goes wrong:** Error occurs and FSM resets to idle, but user has no visual indication that something went wrong. They may think the AI had no response.

**Why it happens:** Current error handling in display-controller calls `endStreaming()` which marks the assistant message as complete, but an empty or partial response looks like a normal (short) reply.

**How to avoid:** Add an explicit error message to the chat display. The renderer needs a `showError(message)` method (or reuse the existing `addUserMessage` / chat message pattern with an error role). Simplest approach: append a system-style message like "Error: timed out. Tap to retry."

**Warning signs:** User sees empty or truncated response with no indication of failure.

## Code Examples

Verified patterns from the existing codebase and browser API documentation:

### ERR-01: FSM Reset Transition

```typescript
// gesture-fsm.ts additions
export type GestureInput = 'tap' | 'double-tap' | 'scroll-up' | 'scroll-down' | 'reset';

// Add to each state in TRANSITIONS:
idle:      { ..., 'reset': { nextState: 'idle', action: null } },
recording: { ..., 'reset': { nextState: 'idle', action: { type: 'STOP_RECORDING' } } },
sent:      { 'reset': { nextState: 'idle', action: null } },
thinking:  { ..., 'reset': { nextState: 'idle', action: null } },
menu:      { ..., 'reset': { nextState: 'idle', action: null } },
```

Note: `recording` state on reset should dispatch `STOP_RECORDING` to properly stop the bridge audio and flush the MediaRecorder. The `sent` state on reset has no action because the audio has already been sent.

### ERR-01: Gesture Handler Error Listener

```typescript
// gesture-handler.ts additions -- subscribe to error event
unsubs.push(bus.on('gateway:chunk', (chunk) => {
  if (chunk.type === 'error') {
    handleInput('reset', Date.now());
  }
}));
```

Alternative: use a dedicated `voice-loop:error` bus event if the team prefers separation of concerns.

### ERR-02: Timeout Signal in Gateway Client

```typescript
// gateway-client.ts sendVoiceTurn modification
const TURN_TIMEOUT_MS = 30_000;

abortController = new AbortController();

const resp = await fetch(`${settings.gatewayUrl}/voice/turn`, {
  method: 'POST',
  body: formData,
  headers: {
    ...(settings.sessionKey ? { 'X-Session-Key': settings.sessionKey } : {}),
  },
  signal: AbortSignal.any([
    abortController.signal,
    AbortSignal.timeout(TURN_TIMEOUT_MS),
  ]),
});

// In catch block, BEFORE existing retry logic:
if (err instanceof DOMException && err.name === 'TimeoutError') {
  emitChunk({ type: 'error', error: 'Request timed out. Tap to retry.' });
  setStatus('error');
  return; // No retry on timeout
}
```

### ERR-02: User-Visible Timeout Feedback

```typescript
// display-controller.ts -- enhance error chunk handling
case 'error':
  renderer.endStreaming();
  if (chunk.error) {
    renderer.showError(chunk.error);
  }
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => { settleTimer = null; renderer.setIconState('idle'); }, 500);
  break;

// glasses-renderer.ts -- add showError method
function showError(message: string): void {
  trimTurnBuffer();
  const msg: ChatMessage = {
    id: `msg-${nextMsgId++}`,
    role: 'assistant',  // or add 'system' role if desired
    text: `[Error] ${message}`,
    complete: true,
    timestamp: Date.now(),
  };
  viewport.messages.push(msg);
  if (viewport.autoScroll) {
    viewport.scrollOffset = 0;
  }
  renderAndPush();
}
```

### ERR-03: Graceful Shutdown in glasses-main.ts

```typescript
// glasses-main.ts -- restructured boot
export async function boot(): Promise<void> {
  // ... existing Layer 0-5 initialization ...

  // Lifecycle cleanup
  let cleaned = false;
  function cleanup(): void {
    if (cleaned) return;
    cleaned = true;

    // Reverse initialization order
    voiceLoopController.destroy();
    gateway.destroy();        // stops heartbeat, aborts in-flight fetch
    displayController.destroy(); // stops icon animator, clears flush timer
    gestureHandler.destroy();    // unsubscribes bus listeners
    // audioCapture has no destroy -- stopRecording is sufficient
    bridge.destroy();            // unsubscribes SDK, shuts down page container
    bus.clear();                 // clear all remaining subscriptions
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      cleanup();
    }
  });
  window.addEventListener('pagehide', cleanup);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `beforeunload` for cleanup | `visibilitychange` + `pagehide` | Chrome 2020+ spec update | `beforeunload` unreliable on mobile; `visibilitychange` is the recommended cleanup signal |
| Manual timeout with `setTimeout` + `AbortController.abort()` | `AbortSignal.timeout()` | Chrome 103 (June 2022) | Native API, auto-cleanup, produces standard `TimeoutError` |
| Manual signal forwarding to compose abort signals | `AbortSignal.any()` | Chrome 116 (Aug 2023) | Cleaner API, no leak risk from manual listeners |

**Deprecated/outdated:**
- `window.onbeforeunload` / `window.addEventListener('unload', ...)`: May not fire on mobile WebView. Use `visibilitychange` as primary, `pagehide` as fallback.

## Open Questions

1. **AbortSignal.any() in Even App WebView**
   - What we know: Chrome 116+ supports it. Android WebView auto-updates and is typically up-to-date. Even G2 targets recent Android devices.
   - What's unclear: The exact minimum Android/WebView version for Even G2 users. If running on Android 12 with an older non-updating system WebView, `AbortSignal.any()` might not be available.
   - Recommendation: Use `AbortSignal.any()` as the primary approach. As a safety net, add a try/catch wrapper or feature detection: `if (typeof AbortSignal.any === 'function')`. If unavailable, fall back to manual signal forwarding (4 lines of code). Given the Even G2 is a 2024 product targeting tech-forward users, this is LOW risk.

2. **Error message format on glasses display**
   - What we know: The glasses display is 576x288px with 4-bit greyscale. Messages appear in a compact bubble chat format.
   - What's unclear: Whether error messages should appear as system-style messages (distinct from user/assistant) or as assistant messages with "[Error]" prefix.
   - Recommendation: Use assistant-role messages with `[Error]` prefix for simplicity. This avoids adding a new message role to the viewport renderer. The text like `[Error] Request timed out. Tap to retry.` fits within the chat bubble pattern and is immediately understandable.

3. **visibilitychange fires on tab switch in dev mode**
   - What we know: In browser dev mode, switching tabs fires `visibilitychange` with `hidden`, which would trigger cleanup and destroy the voice loop.
   - What's unclear: Whether devMode should skip cleanup on `visibilitychange`.
   - Recommendation: Only register `visibilitychange`/`pagehide` cleanup handlers in glasses mode (non-devMode). In dev mode, the user explicitly closes the tab to end the session. The `boot()` function already has a `devMode` flag.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/api/gateway-client.ts`, `src/gestures/gesture-fsm.ts`, `src/gestures/gesture-handler.ts`, `src/voice-loop-controller.ts`, `src/display/display-controller.ts`, `src/display/glasses-renderer.ts`, `src/glasses-main.ts`, `src/types.ts`
- Phase 6 code review: `.planning/quick/3-review-phase-6-commits-identify-refactor/3-REVIEW.md` -- Section 5 (Phase 7 Readiness Assessment) identifies every file change needed
- [MDN: AbortSignal.timeout()](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static) -- timeout signal API
- [MDN: AbortSignal.any()](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static) -- signal composition API
- [MDN: visibilitychange event](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event) -- recommended cleanup event
- [MDN: pagehide event](https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event) -- fallback cleanup event
- [Can I Use: AbortSignal.any()](https://caniuse.com/mdn-api_abortsignal_any_static) -- Chrome 116+, Firefox 124+, Safari 17.4+

### Secondary (MEDIUM confidence)
- [Flutter InAppWebView GitHub](https://github.com/pichillilorenzo/flutter_inappwebview) -- WebView lifecycle events, onJsBeforeUnload callback
- [Flutter InAppWebView beforeunload issue #2170](https://github.com/pichillilorenzo/flutter_inappwebview/issues/2170) -- confirms beforeunload limitations

### Tertiary (LOW confidence)
- Even G2 minimum Android version / WebView engine version -- assumed modern (Android 13+) based on 2024 product launch, but not verified

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All APIs are browser-native, well-documented, and already used in the project (AbortController pattern in gateway-client.ts)
- Architecture: HIGH - Phase 6 code review already identified every file change and the exact modification needed; the patterns follow existing codebase conventions
- Pitfalls: HIGH - All pitfalls identified from direct codebase analysis of current code paths and known race conditions

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (stable -- browser APIs don't change)
