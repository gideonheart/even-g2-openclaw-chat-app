# Code Review: Phase 6 Runtime Wiring

**Scope:** 14 files (4 created, 10 modified) across 4 commits
**Commits:** 63c7044, 83eee18, 2a1a64a, 678f9d7
**Reviewed:** 2026-02-28
**Baseline:** 247 tests passing

---

## 1. What Was Done Well

### 1.1 Clean Layer-Based Boot Sequence (glasses-main.ts)

`src/glasses-main.ts:17-84` implements a strict Layer 0-5 initialization order with dependency comments on each layer. The boot function reads top-to-bottom as a dependency graph: bus and settings (Layer 0) have no dependencies, bridge (Layer 1) depends on bus, audio (Layer 2) depends on bridge events, gesture handler (Layer 3) depends on bus + bridge + audio, display (Layer 4) depends on bus + renderer, and voice loop (Layer 5) depends on bus + gateway. This ordering is explicit and verifiable.

Critical ordering constraint at line 38 (`bus.on('bridge:audio-frame', ...)`) is placed in Layer 2 before `createGestureHandler` in Layer 3, ensuring PCM frames are captured before the first tap can trigger recording. The comment at line 36-38 explains why this subscription must exist before Layer 3.

**File:** `src/glasses-main.ts:17-84`

### 1.2 Thin Environment Router (main.ts)

`src/main.ts` is 23 lines -- a textbook environment detection router. Dynamic imports (`await import('./glasses-main')` and `await import('./hub-main')`) ensure only the relevant code path is loaded. The detection logic is two-tier: primary (`flutter_inappwebview`) for production, secondary (`?even` URL param) for development. The `.catch()` on line 20-22 provides a global safety net for fatal boot errors.

**File:** `src/main.ts:1-23`

### 1.3 VoiceLoopController Factory Pattern (voice-loop-controller.ts)

`src/voice-loop-controller.ts` follows the established factory+interface pattern consistently: separate interface export (line 11-13), factory function (line 15-51), `unsubs` array for cleanup (line 21), and `destroy()` that drains all subscriptions (line 43-48). The settings getter pattern (`settings: () => AppSettings` at line 18) ensures the controller always reads fresh settings at voice turn dispatch time.

**File:** `src/voice-loop-controller.ts:15-51`

### 1.4 Comprehensive VoiceLoopController Tests (voice-loop-controller.test.ts)

6 tests covering: chunk forwarding (line 55-66), status forwarding (line 68-78), voice turn dispatch with correct settings (line 80-91), settings getter freshness across multiple calls (line 93-113), destroy cleanup (line 115-134), and multi-chunk sequencing (line 136-150). The `createMockGateway()` helper (line 17-42) with `simulateChunk`/`simulateStatus` helpers is well-designed test infrastructure.

**File:** `src/__tests__/voice-loop-controller.test.ts:1-152`

### 1.5 CLICK_EVENT SDK Quirk Fix (even-bridge.ts)

`src/bridge/even-bridge.ts:77` handles the SDK's `fromJson` normalization of `CLICK_EVENT=0` to `undefined`. Instead of silently dropping tap events on real hardware, the fix maps both `OsEventTypeList.CLICK_EVENT` and `undefined` to `gesture:tap`. The fix is documented in-code with a comment (line 76-78) and tested explicitly (even-bridge.test.ts line 182-194).

**File:** `src/bridge/even-bridge.ts:71-91`

### 1.6 Display Turn Lifecycle (display-controller.ts + glasses-renderer.ts)

The streaming flow in `display-controller.ts:33-57` maps each chunk type to the correct renderer method in a clean switch statement. The 500ms settle period (line 50, 54) prevents accidental double-trigger after response completion. The pattern is symmetric -- both `response_end` and `error` get the same settle treatment.

`glasses-renderer.ts` implements a robust streaming pipeline: `startStreaming()` creates an empty assistant message and starts a 200ms flush timer (line 203-216), `appendStreamChunk()` buffers text (line 218-220), `flushStreamBuffer()` appends to the current assistant message and renders (line 120-137), and `endStreaming()` does a final flush and marks the message complete (line 222-240).

**Files:** `src/display/display-controller.ts:33-57`, `src/display/glasses-renderer.ts:139-240`

### 1.7 Turn Buffer Management (glasses-renderer.ts)

`MAX_TURNS=8` constant (line 68) limits memory growth. `trimTurnBuffer()` (line 151-155) evicts oldest messages when the buffer exceeds 16 messages (8 pairs). This is called in both `addUserMessage` (line 185) and `startStreaming` (line 204), ensuring the buffer is trimmed before adding new messages regardless of entry point.

**File:** `src/glasses-renderer.ts:68, 151-155, 185, 204`

### 1.8 Hub Extraction (hub-main.ts)

`src/hub-main.ts` is a clean extraction of the companion hub code from the original monolithic `main.ts`. The only export is `initHub()` (line 438-440), which wraps the private `init()` function. The file is self-contained with no imports from glasses-specific modules.

**File:** `src/hub-main.ts:1-441`

---

## 2. What to Refactor Now (Pre-Phase-7)

### 2.1 Module-level `nextMsgId` counter in glasses-renderer.ts

**File:** `src/display/glasses-renderer.ts:91`

```typescript
let nextMsgId = 1;
```

This counter is declared at module scope, outside the factory function. If `createGlassesRenderer` is called more than once (e.g., after a destroy/reinit cycle, or in tests), the counter continues incrementing from its previous value. This is not a bug today (the renderer is only created once in production), but it creates subtle test coupling: test order affects message IDs.

**Recommended fix:** Move `nextMsgId` inside the factory function's closure, alongside the other mutable state (viewport, hidden, streamBuffer, etc.).

### 2.2 `glasses-main.ts` boot() has no error handling

**File:** `src/glasses-main.ts:17-84`

The entire `boot()` function is a single `async function` with no try/catch. If any initialization step throws (e.g., `bridge.init()` at line 25, `displayController.init()` at line 56, `gateway.checkHealth()` at line 74), the error propagates to `main.ts:20-22` where it is caught by `console.error('[main] Fatal boot error:', err)`. This provides no recovery -- the user sees nothing on the glasses display.

While Phase 7 (ERR-03) will add proper lifecycle management, the boot function should at least show an error message on the glasses before Phase 7 begins, so development-time failures are visible.

**Recommended fix:** Wrap the body of `boot()` in try/catch. On error, attempt to show a diagnostic message via bridge.textContainerUpgrade (if bridge initialized) or console.error.

### 2.3 `glasses-main.ts` creates modules with no cleanup path

**File:** `src/glasses-main.ts:17-84`

None of the module references (bus, bridge, audioCapture, gestureHandler, displayController, gateway, voiceLoopController) are retained after boot. The function creates them, wires them, and returns `void`. There is no way to call `destroy()` on any of them when the app unloads (ERR-03 requirement).

Phase 7 will need to restructure this to return or store references to all modules for graceful shutdown. This is an architectural concern (Rule 4), but noting it here as a P1 item for Phase 7 planning.

### 2.4 `display-controller.ts` settle setTimeout leak

**File:** `src/display/display-controller.ts:50-51, 54-55`

```typescript
setTimeout(() => renderer.setIconState('idle'), 500);
```

These `setTimeout` calls (lines 50 and 54) are not tracked and cannot be cancelled. If `destroy()` is called during the 500ms settle period, the callback will fire after the controller is destroyed, calling `renderer.setIconState('idle')` on a potentially destroyed renderer. The renderer's `setIconState` calls `iconAnimator?.setState()` which safely no-ops if null, but this is relying on defensive checks in the renderer rather than proper cleanup in the controller.

**Recommended fix:** Track the settle timeout ID and clear it in `destroy()`:

```typescript
let settleTimer: ReturnType<typeof setTimeout> | null = null;

// In the handler:
settleTimer = setTimeout(() => renderer.setIconState('idle'), 500);

// In destroy:
if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
```

### 2.5 `gesture-handler.ts` STOP_RECORDING has unhandled promise rejection

**File:** `src/gestures/gesture-handler.ts:90-95`

```typescript
audioCapture.stopRecording().then((blob) => {
  bus.emit('audio:recording-stop', {
    sessionId: activeSessionId(),
    blob,
  });
});
```

The `.then()` call has no `.catch()` handler. If `audioCapture.stopRecording()` rejects (e.g., MediaRecorder is in wrong state, permission revoked mid-recording), the promise rejection is unhandled. This would trigger a browser `unhandledrejection` event and silently leave the FSM in a stuck state (the FSM transitions to `sent` but no `audio:recording-stop` ever fires, so the gateway never receives the audio).

**Recommended fix:** Add a `.catch()` that emits a bus event or resets state:

```typescript
audioCapture.stopRecording()
  .then((blob) => {
    bus.emit('audio:recording-stop', { sessionId: activeSessionId(), blob });
  })
  .catch((err) => {
    console.error('[GestureHandler] stopRecording failed:', err);
    // Phase 7 ERR-01 will handle recovery to idle
  });
```

### 2.6 `hub-main.ts` non-null assertions on every DOM element

**File:** `src/hub-main.ts:29-31`

```typescript
function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}
```

This was identified in the Quick Task 1 review (item 2.1) and remains unchanged. Every `$()` call assumes the element exists. If any element ID is misspelled or the HTML changes, the non-null assertion produces a runtime error with no diagnostic context.

This is in `hub-main.ts` (not a Phase 6 creation), so it's out of Phase 6 review scope for fixing, but noted for Phase 7 planning.

---

## 3. Technical Debt Inventory

| Priority | Item | File(s) | Phase 7 Impact | Effort |
|----------|------|---------|----------------|--------|
| **P1** | boot() has no cleanup path -- no module refs retained | `src/glasses-main.ts:17-84` | Blocks ERR-03 (graceful shutdown on unload). Must restructure boot to return/store module refs. | 1-2h |
| **P1** | boot() has no error handling | `src/glasses-main.ts:17-84` | Blocks ERR-01 (error recovery). Currently any boot failure is a silent black screen. | 30m |
| **P1** | display-controller settle setTimeout not tracked | `src/display/display-controller.ts:50,54` | Blocks ERR-03 (cleanup on close). Timer fires after destroy, calling methods on destroyed renderer. | 15m |
| **P2** | gesture-handler stopRecording has no .catch() | `src/gestures/gesture-handler.ts:90-95` | Should fix during Phase 7 ERR-01. Unhandled rejection leaves FSM stuck in `sent` state. | 15m |
| **P2** | Module-level nextMsgId in glasses-renderer | `src/display/glasses-renderer.ts:91` | Test isolation issue. Not blocking but creates coupling between test runs. | 5m |
| **P2** | hub-main.ts $() uses non-null assertion (from 1-REVIEW 2.1) | `src/hub-main.ts:29-31` | Not blocking Phase 7 (hub-main is browser-only). Fix during Phase 8 polish. | 30m |
| **P3** | hardcoded sessionId 'gideon' in glasses-main | `src/glasses-main.ts:48` | Acceptable for v1.1 -- session selection on glasses deferred. | N/A |
| **P3** | welcome message shows even if gateway health check fails | `src/glasses-main.ts:59,73-83` | showWelcome() runs before health check. If gateway is down, user sees "Tap to ask" then "Open companion app to configure" in sequence. | 15m |

---

## 4. Edge Cases and Missing Test Coverage

### 4.1 glasses-main.ts boot sequence has zero test coverage

The entire glasses boot function (`src/glasses-main.ts:17-84`) is untested. It's the integration layer that wires all modules together. Testing it would require mocking all 8 module factories, but without tests there is no regression safety for:
- Layer ordering (what if Layer 4 is moved before Layer 3?)
- Bridge init failure (what happens if `bridge.init()` throws?)
- Health check failure path
- Mock audio detection logic

**File:** `src/glasses-main.ts`

### 4.2 display-controller: no test for rapid response_end followed by new recording

If a user taps to record during the 500ms settle period after response_end, the settle timer will fire and set icon to 'idle' even though the user is now recording. The test suite does not cover this scenario.

**Reproduction:**
1. Emit `gateway:chunk` with `type: 'response_end'`
2. Within 500ms, emit `audio:recording-start`
3. Advance timer by remaining settle time
4. Observe: `setIconState('idle')` fires AFTER `setIconState('recording')`, overwriting it

**File:** `src/__tests__/display-controller.test.ts`

### 4.3 glasses-renderer: no test for streaming when hidden

If `hide()` is called during an active streaming session, `flushStreamBuffer()` will still call `renderAndPush()` which calls `bridge.textContainerUpgrade(2, ...)` on a container that no longer exists (the blank layout has only container 1). The SDK behavior when updating a non-existent container is unknown.

**Reproduction:**
1. `renderer.init()` + `renderer.startStreaming()` + `appendStreamChunk('text')`
2. `renderer.hide()` (switches to blank layout)
3. Advance 200ms (flush timer fires)
4. `bridge.textContainerUpgrade(2, ...)` is called on a non-existent container

**File:** `src/__tests__/glasses-renderer.test.ts`

### 4.4 voice-loop-controller: no test for gateway.sendVoiceTurn failure

The test suite verifies that `sendVoiceTurn` is called, but does not test what happens when `sendVoiceTurn` rejects (e.g., network error). Since VoiceLoopController calls `gateway.sendVoiceTurn()` without `.catch()` (line 36-40 in voice-loop-controller.ts), a rejection would be an unhandled promise rejection.

**File:** `src/__tests__/voice-loop-controller.test.ts`, `src/voice-loop-controller.ts:36-40`

### 4.5 glasses-renderer: endStreaming without startStreaming

If `endStreaming()` is called without a preceding `startStreaming()`, it calls `flushStreamBuffer()` (which is a no-op since streamBuffer is empty), then tries to mark the last message as complete. If there are no messages, `msgs[msgs.length - 1]` is `undefined`, and `last.role === 'assistant'` would throw. If the last message is a user message, nothing breaks but the autoScroll reset runs unnecessarily.

**File:** `src/display/glasses-renderer.ts:222-240`

### 4.6 even-bridge: event with only audioEvent but also eventType

If an SDK event contains both `audioEvent` and a `textEvent` with an eventType, both handlers fire. The audio frame is emitted (line 63-67) AND the gesture event is emitted (line 70-91). This is probably correct behavior (audio frames can arrive alongside gesture events), but it is not explicitly tested.

**File:** `src/bridge/even-bridge.ts:59-91`

---

## 5. Phase 7 Readiness Assessment

Phase 7 requirements:
- **ERR-01:** FSM transitions to idle state when gateway returns an error mid-turn
- **ERR-02:** Gateway requests timeout after 30 seconds with user-visible feedback
- **ERR-03:** App performs graceful shutdown on unload

### ERR-01: Error recovery to idle state

**Current state:** When the gateway returns an error chunk, `display-controller.ts:52-55` calls `renderer.endStreaming()` + `setTimeout(() => setIconState('idle'), 500)`. This handles the display side, but the gesture FSM (`gesture-handler.ts`) is NOT notified. The FSM remains in whatever state it was in (likely `sent` or `thinking`) and does not return to `idle`. A tap in the `sent` or `thinking` state may not trigger recording.

**Files that need modification:**
- `src/gestures/gesture-handler.ts` -- Add bus listener for error events, transition FSM to idle
- `src/gestures/gesture-fsm.ts` -- Add error/reset input type to FSM transition table
- `src/display/display-controller.ts` -- Emit a bus event that FSM can listen for (or handle directly)
- `src/voice-loop-controller.ts` -- May need to emit recovery event on error

### ERR-02: 30-second timeout with user-visible feedback

**Current state:** `gateway-client.ts:157-265` has no request-level timeout. The only timeout is the 5-second health check timeout (`AbortSignal.timeout(5000)` at line 124). The `sendVoiceTurn` method relies on the `abortController` but never sets a timeout on it. A hung gateway connection will block indefinitely.

**Files that need modification:**
- `src/api/gateway-client.ts` -- Add `AbortSignal.timeout(30000)` to the fetch call (line 184) or compose the abort signals
- `src/display/display-controller.ts` -- Handle timeout error chunk type for user-visible feedback (e.g., "Request timed out. Tap to try again.")
- `src/display/glasses-renderer.ts` -- May need a `showError(message)` method for user-visible timeout feedback

### ERR-03: Graceful shutdown on unload

**Current state:** `glasses-main.ts:17-84` creates all modules but retains no references. There is no `window.addEventListener('beforeunload', ...)` or `unload` handler. The following resources need cleanup:
- `gateway.destroy()` -- stops heartbeat, aborts in-flight requests, clears handlers
- `voiceLoopController.destroy()` -- unsubscribes bus listeners
- `displayController.destroy()` -- stops icon animator, clears flush timer
- `bridge.destroy()` -- unsubscribes SDK listeners, shuts down page container
- `audioCapture` -- stop any active MediaRecorder

**Files that need modification:**
- `src/glasses-main.ts` -- Restructure boot to return module refs or store in closure. Add unload handler.
- `src/voice-loop-controller.ts` -- Already has `destroy()`, no changes needed
- `src/display/display-controller.ts` -- Already has `destroy()`, fix settle timeout leak (item 2.4)
- `src/display/glasses-renderer.ts` -- Already has `destroy()`, no changes needed
- `src/bridge/even-bridge.ts` -- Already has `destroy()`, no changes needed
- `src/api/gateway-client.ts` -- Already has `destroy()`, no changes needed

### Summary: Phase 7 readiness is GOOD

All Phase 6 modules follow the factory+interface+destroy pattern, which provides clean cleanup hooks for ERR-03. The main gap is `glasses-main.ts` not retaining module references (P1 debt), and the settle timeout leak in `display-controller.ts` (P1 debt). Both are straightforward to fix at the start of Phase 7.

---

## 6. Status of Previous Review Items

Cross-referencing items from `.planning/quick/1-review-last-commits-and-document-what-wa/1-REVIEW.md`:

| # | Item | Status | Notes |
|---|------|--------|-------|
| 2.1 | `main.ts` monolithic 450-line init | **Resolved** | main.ts decomposed into 23-line router + hub-main.ts (440 lines) + glasses-main.ts (84 lines). Commit 2a1a64a. |
| 2.2 | Hardcoded sessions, no dynamic management | **Still open** | `src/sessions.ts` unchanged. Deferred beyond v1.1 scope. |
| 2.3 | `importSettingsJson` accepts invalid sttProvider | **Still open** | `src/settings.ts:88-96` unchanged. P3 priority. |
| 2.4 | `FieldConfig.validate` returns empty string for success | **Still open** | `src/types.ts:52` unchanged. P3 priority. |
| 2.5 | Gateway reconnect logic is a no-op | **Resolved** | `src/api/gateway-client.ts:259-260` now has actual recursive retry with exponential backoff. Fixed in Quick Task 2 (commit 1ffe894). |
| 2.6 | Inline CSS + external style dependency | **Still open** | `index.html` unchanged. P3 priority. |
| 2.7 | Log store O(n) insertion | **Still open** | `src/logs.ts:19-20` unchanged. P3 priority. |
| 3.1 | No tests for main.ts (450 lines) | **Partially resolved** | Old monolithic main.ts was decomposed. hub-main.ts still has zero test coverage (440 lines), but glasses-main.ts (84 lines) is also untested. The decomposition reduces the risk since individual modules (gesture handler, display controller, etc.) have their own comprehensive tests. |
| 3.2 | sendVoiceTurn never tested with fetch mock | **Still open** | `src/__tests__/gateway-client.test.ts` still lacks sendVoiceTurn tests. P2 priority. |
| 3.3 | No test for reconnection behavior | **Still open** | Reconnection logic was implemented (Quick Task 2) but still untested. P2 priority. |
| 3.4 | importSettingsJson accepts non-object JSON | **Still open** | Unchanged. P3 priority. |
| 3.5 | parseSSELines handles `\n` but not `\r\n` | **Resolved** | `src/api/gateway-client.ts:16` now uses `raw.split(/\r?\n/)`. Fixed in Quick Task 2 (commit 1ffe894). |
| 3.6 | exportSettingsJson uses delete on spread copy | **Still open** | Unchanged. P3 priority, safe as-is. |
| 3.7 | No global error handler | **Partially resolved** | `main.ts:20-22` now catches fatal boot errors with `console.error`. However, there is still no `window.onerror` or `onunhandledrejection` handler for runtime errors. Phase 7 should address this. |
| 3.8 | console.warn in settings load bypasses log store | **Still open** | `src/settings.ts:64` unchanged. P3 priority. |

**Summary:** Of 15 items from the previous review:
- 3 fully resolved (2.1 main.ts decomposition, 2.5 gateway reconnect, 3.5 SSE \r\n handling)
- 2 partially resolved (3.1 main.ts testing, 3.7 global error handler)
- 10 still open (mostly P3 items that were deferred by design)
