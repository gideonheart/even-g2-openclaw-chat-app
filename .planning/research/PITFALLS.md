# Pitfalls Research

**Domain:** End-to-end voice loop integration and EvenHub submission for Even G2 smart glasses app
**Researched:** 2026-02-28
**Confidence:** MEDIUM-HIGH (integration pitfalls verified against actual codebase; EvenHub submission details verified against sibling repo and CLI README; event bus timing verified against synchronous dispatch implementation)

## Critical Pitfalls

### Pitfall 1: Event Bus Subscription Ordering Determines Correctness

**What goes wrong:**
The display controller reads `gestureHandler.getHintText()` inside its gesture event handlers, but the gesture handler updates its FSM state in its own handlers for the same events. If the display controller subscribes BEFORE the gesture handler, it reads stale state -- the hint text reflects the previous FSM state, not the post-transition state. The display shows "Tap to record" after the user already started recording.

**Why it happens:**
The event bus (`createEventBus`) dispatches synchronously to all handlers in registration order. This is by design and is documented in `display-controller.ts` (line 8-11: "ORDERING NOTE"). When wiring modules together in `main.ts`, the subscription order is the initialization order. A developer wiring modules in a different order (e.g., alphabetical, or display-first because "it depends on everything") silently breaks hint bar correctness. There are no runtime errors -- just wrong UI state.

**How to avoid:**
- The runtime `main.ts` initialization must follow a strict dependency order: (1) create event bus, (2) create bridge, (3) create audio capture, (4) create gesture handler (subscribes to gesture events), (5) create display controller (subscribes to same gesture events AFTER gesture handler). Document this order with comments explaining why.
- Add a startup self-test: after wiring, emit a synthetic `gesture:tap` and verify the display controller reads the expected hint text. Log a warning if the hint does not match expected state.
- Consider adding a `bus.listenerCount('gesture:tap')` assertion before display controller init to verify the gesture handler is already subscribed.

**Warning signs:**
- Hint bar text lags by one state transition (shows previous state's hint)
- Hint bar text is correct on the second gesture but wrong on the first
- Tests pass because test setup happens to create handlers in the right order, but the production `main.ts` does not

**Phase to address:**
Runtime wiring phase (main.ts initialization). This must be the first concern of the integration phase.

---

### Pitfall 2: Bridge Must Initialize Before Audio Control or Display Updates

**What goes wrong:**
The voice loop attempts to start recording (`bridge.startAudio()`) or push display text (`bridge.textContainerUpgrade()`) before the bridge's `init()` has completed. The SDK's `waitForEvenAppBridge()` is asynchronous and `createStartUpPageContainer()` must complete before `audioControl()` works. Calling audio or display methods on a null bridge silently fails (the current code returns `false` or `undefined`), and the user sees no recording indicator and hears no response.

**Why it happens:**
The v1.0 modules were built and tested independently. Each module's factory function is synchronous, but `bridge.init()` is async. In `main.ts`, a developer may create all services synchronously, wire event subscriptions, then call `bridge.init()` -- but a gesture event could fire during bridge initialization (from the mock bridge or a race with real hardware). The gesture handler calls `bridge.startAudio()` which silently fails because the page container does not exist yet.

**How to avoid:**
- The `main.ts` boot sequence must be: (1) create bus, (2) create bridge, (3) `await bridge.init()`, (4) THEN create gesture handler and display controller. No gesture subscriptions should exist before the bridge is ready.
- Add a guard in the gesture handler: check `bridge.isReady()` (needs a new method or state flag) before dispatching `START_RECORDING` or `STOP_RECORDING`. Emit an error event if the bridge is not ready.
- The display controller's `init()` calls `renderer.init()` which calls `bridge.rebuildPageContainer()`. This must also await. Chain: `await bridge.init()` then `await displayController.init()`.
- Consider emitting a `bridge:ready` event that gates the rest of initialization.

**Warning signs:**
- `bridge.startAudio()` returns `false` but no error is logged
- First tap after app load does nothing; second tap works
- Display shows blank glasses for 1-2 seconds after app start, then suddenly renders
- Works in mock mode (mock bridge `init()` resolves instantly) but fails with real glasses

**Phase to address:**
Runtime wiring phase (main.ts initialization). The async initialization chain must be designed correctly from the start.

---

### Pitfall 3: Audio Frame Subscription Gap Between Bridge Init and Gesture Handler Creation

**What goes wrong:**
The `bridge:audio-frame` event fires from the bridge as soon as `audioControl(true)` is called, but the `audioCapture.onFrame()` subscription to this event does not exist yet. The PROJECT.md explicitly identifies this as tech debt: "bridge:audio-frame -> audioCapture.onFrame() bus subscription (glasses-mode PCM)". If this subscription is wired too late, early PCM frames are silently dropped. The audio blob sent to the gateway is missing the first 100-500ms of speech, cutting off the beginning of the user's utterance.

**Why it happens:**
The current `audio-capture.ts` module does NOT subscribe to `bridge:audio-frame` on its own -- it exposes a passive `onFrame(pcm)` method that must be called by someone. The missing glue is: `bus.on('bridge:audio-frame', (p) => audioCapture.onFrame(p.pcm))`. This subscription must exist BEFORE any `bridge.startAudio()` call. If the subscription is created in the same initialization block as the gesture handler, a rapid user tap could trigger recording before the subscription is active.

**How to avoid:**
- Wire the `bridge:audio-frame -> audioCapture.onFrame()` subscription immediately after creating the audio capture module and before any gesture handler that could trigger recording. Place it in the same initialization block as `bus.on('bridge:connected', ...)`.
- The subscription should be unconditional and permanent (not created/destroyed per recording session). The `audioCapture.onFrame()` method already guards with `if (recording && !devMode)`.
- Add an integration test: start recording, emit 10 `bridge:audio-frame` events, stop recording, verify the blob contains all 10 frames.

**Warning signs:**
- STT transcription misses the first word of every utterance
- Audio blob size is smaller than expected for the recording duration
- Works perfectly in dev mode (browser MediaRecorder) but cuts off on glasses
- The bug is intermittent -- depends on how fast the user speaks after tapping

**Phase to address:**
Runtime wiring phase. The audio frame subscription is explicitly listed as v1.1 active work.

---

### Pitfall 4: vite-plugin-singlefile Incompatible with Multi-Page Vite Config

**What goes wrong:**
The current `vite.config.ts` has two inputs: `main: 'index.html'` and `simulator: 'preview-glasses.html'`. Adding `vite-plugin-singlefile` causes a hard build error: "Invalid value for option 'output.inlineDynamicImports' -- multiple inputs are not supported when 'output.inlineDynamicImports' is true." The build completely fails.

**Why it happens:**
`vite-plugin-singlefile` sets `output.inlineDynamicImports = true` to merge all JS/CSS into the HTML. Rollup explicitly forbids this with multiple entry points. This is a fundamental Rollup limitation, not a plugin bug. The plugin maintainer has marked this as "won't fix" ([GitHub issue #83](https://github.com/richardtallent/vite-plugin-singlefile/issues/83)).

**How to avoid:**
- **Option A (recommended): Do not use vite-plugin-singlefile at all.** The sibling `even-g2-apps` repo ships standard Vite output (separate JS/CSS in `dist/assets/`) and uses `evenhub pack app.json dist` successfully. EvenHub packs the entire `dist/` directory into an `.ehpk` file -- it does NOT require a single HTML file. The PROJECT.md assumption about "self-contained dist/index.html" may be a misunderstanding.
- **Option B: Separate build configs.** Use `vite-plugin-singlefile` only for the main `index.html` build, and build `preview-glasses.html` separately. This requires two Vite build invocations with different configs.
- **Option C: Remove the simulator from the production build.** The `preview-glasses.html` is a development tool. Exclude it from the production build's `rollupOptions.input`, keep only `index.html`, and enable `vite-plugin-singlefile` for the single entry.

**Warning signs:**
- Build fails immediately with the inlineDynamicImports error
- Developer "fixes" it by removing the simulator entry, breaking `npm run dev` for the preview tool
- Developer disables the singlefile plugin entirely and assumes the dist structure is fine (which it is, but without understanding why)

**Phase to address:**
EvenHub submission packaging phase. Must be resolved before the first build attempt.

---

### Pitfall 5: `evenhub pack` Requires Correct app.json Schema and `dist/` Structure

**What goes wrong:**
The `evenhub pack` command silently produces a corrupt `.ehpk` file or fails validation if the `app.json` has missing fields, wrong `entrypoint` path, or the `permissions.network` array does not include the gateway domain. The app uploads to EvenHub but fails to load on glasses, or loads but cannot reach the backend gateway.

**Why it happens:**
The `app.json` schema is sparsely documented. From the sibling repo examples, the required fields are: `package_id`, `edition`, `name`, `version`, `min_app_version`, `tagline`, `description`, `author`, `entrypoint`, and `permissions`. The `permissions.network` array must whitelist every external domain the app contacts. The `entrypoint` must point to the HTML file relative to the dist root (always `index.html`). Developers forget to add their gateway domain to the network permissions, and the WebView silently blocks fetch requests.

**How to avoid:**
- Base the `app.json` on the sibling repo's working examples. Required structure:
  ```json
  {
    "package_id": "com.yourorg.openclaw-chat",
    "edition": "202602",
    "name": "OpenClaw Chat",
    "version": "1.1.0",
    "min_app_version": "0.1.0",
    "tagline": "Voice AI assistant for Even G2",
    "description": "...",
    "author": "Name <email>",
    "entrypoint": "index.html",
    "permissions": {
      "network": ["*"]
    }
  }
  ```
- Use wildcard `"*"` for `permissions.network` during development since the gateway URL is user-configurable. The user's gateway could be on any domain/IP.
- Run `evenhub pack app.json dist --check` to validate the package ID is available before submission.
- Add a `pack` npm script: `"pack": "evenhub pack app.json dist --output openclaw-chat.ehpk"`.

**Warning signs:**
- `evenhub pack` succeeds but the `.ehpk` file is very small (missing assets)
- App loads on glasses but fetch requests fail silently (blocked by network permissions)
- App shows blank screen (wrong `entrypoint` path -- e.g., `dist/index.html` instead of `index.html`)
- Package ID rejected on submission (already taken, wrong format)

**Phase to address:**
EvenHub submission packaging phase. Create the `app.json` early and validate with `evenhub pack --check`.

---

### Pitfall 6: SSE Stream Abort Does Not Clean Up Heartbeat Timer or Status Handlers

**What goes wrong:**
The gateway client starts a heartbeat timer via `startHeartbeat()` and registers status change handlers. When the app navigates away, goes to background (phone sleep), or the user switches sessions, these resources are not cleaned up. The heartbeat timer continues firing, making fetch requests to a gateway that may no longer be relevant. Status change handlers accumulate across session switches, causing duplicate UI updates and memory leaks.

**Why it happens:**
The gateway client's `sendVoiceTurn()` method has its own `abort()` call, but `startHeartbeat()` and `stopHeartbeat()` are independent lifecycle methods. The integration code in `main.ts` must pair every `startHeartbeat()` with a `stopHeartbeat()`, and every `onChunk()`/`onStatusChange()` subscription with its cleanup function. When wiring the voice loop, developers focus on the happy path (send audio, receive response) and forget cleanup.

**How to avoid:**
- The voice loop orchestrator in `main.ts` must track all cleanup functions returned by `gateway.onChunk()` and `gateway.onStatusChange()` and call them on app shutdown.
- Call `gateway.destroy()` (which calls `abort()`, `stopHeartbeat()`, and clears all handlers) when the app is shutting down or switching sessions.
- Add a `beforeunload` event listener that calls `gateway.destroy()`.
- Consider auto-starting the heartbeat inside `sendVoiceTurn()` and auto-stopping it in `destroy()` so the lifecycle is tied to the client, not to external orchestration.

**Warning signs:**
- Network tab shows periodic `/health` requests after the user has left the app
- StatusChangeHandler fires multiple times for a single status change (handlers accumulated)
- Memory usage grows over time in long sessions (handlers never garbage collected)
- Console warnings about fetch on a destroyed/detached context

**Phase to address:**
Runtime wiring phase (main.ts initialization and shutdown). Must include a teardown path, not just a startup path.

---

### Pitfall 7: Voice Loop Has No End-to-End Error Recovery

**What goes wrong:**
The voice loop (tap -> record -> gateway -> stream -> display) breaks at any point and leaves the system in a stuck state. The gesture FSM is in `sent` state but the gateway request failed, so the user is stuck seeing "Processing..." forever. Or the SSE stream errors mid-response but the display controller never receives `response_end`, so the streaming flush timer runs indefinitely and the icon stays on "thinking."

**Why it happens:**
Each module handles its own errors independently. The gateway client emits `{ type: 'error' }` chunks, the display controller handles error chunks by calling `endStreaming()` and setting icon to idle. But the gesture FSM does not listen to gateway errors -- it has no input for "error" and no transition from `sent` -> `idle` or `thinking` -> `idle` on error. The FSM only transitions on user gestures. Without an error-driven transition, the FSM is stuck.

**How to avoid:**
- Add an `error` input to the gesture FSM that transitions from any active state (`sent`, `thinking`) back to `idle`. Wire this to `gateway:chunk` events of type `error` and to `gateway:status` events with status `error`.
- Implement a timeout: if the FSM is in `sent` state for more than 30 seconds without receiving `response_start`, auto-transition to `idle` and show an error message.
- The display controller should emit a `voice-loop:error` event that the gesture handler listens to, creating a bidirectional error flow.
- Test the error path explicitly: simulate a gateway 500 error, a network timeout, and an SSE stream that aborts mid-response. Verify the FSM returns to `idle` and the display shows a user-friendly error.

**Warning signs:**
- App hangs on "Processing..." after a network error -- requires force quit
- Icon stays on "thinking" animation indefinitely after a gateway timeout
- Streaming flush timer `setInterval` runs forever after an error (memory/CPU waste)
- User taps to record again but nothing happens because FSM is stuck in `sent`

**Phase to address:**
Voice loop integration phase. Error recovery must be designed as part of the orchestration, not retrofitted.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| No `bridge:audio-frame` subscription | Avoids touching audio-capture.ts | Glasses-mode recording silently produces empty blobs | Never -- this is explicit v1.1 scope and listed as tech debt |
| Keep orphaned event types in AppEventMap | Avoids touching types.ts | Confusing API surface; developers wire handlers to events that are never emitted | Accept for v1.1 if cleanup is tracked; fix before v1.2 |
| Hardcode initialization order without comments | Faster to write main.ts | Next developer reorders initialization and breaks hint bar timing | Never -- 3 comment lines prevent hours of debugging |
| Skip gateway.destroy() on app shutdown | Happy path works fine | Heartbeat timer leaks, status handlers accumulate, stale fetch requests | Never -- `beforeunload` handler is 3 lines of code |
| Use vite-plugin-singlefile without removing simulator entry | Seems like it should "just work" | Hard build failure, blocks all packaging | Never -- verify build before committing Vite config changes |
| Skip error-to-idle FSM transition | Simplifies FSM transition table | App gets stuck on any error; requires force quit | First week of integration prototyping only; must fix before testing |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Event bus + gesture handler + display controller | Create display controller before gesture handler | Create gesture handler FIRST. Its subscriptions must fire before display controller reads hint text. Document order with comments. |
| Bridge init + audio control | Call `bridge.startAudio()` before `bridge.init()` resolves | `await bridge.init()` must complete before ANY gesture handler is created. Use sequential await chain, not parallel init. |
| Audio capture + bridge events | Forget to wire `bridge:audio-frame -> audioCapture.onFrame()` | Wire this subscription immediately after creating audioCapture, before gesture handler exists. It is passive (guards internally). |
| Gateway client + display controller | Connect gateway chunk handler but not status handler | Wire BOTH `gateway.onChunk()` AND `gateway.onStatusChange()`. Status changes drive health display. Chunk events drive glasses display. |
| vite-plugin-singlefile + multi-page config | Enable singlefile plugin with existing multi-page rollup input | Either remove simulator from production build OR do not use singlefile plugin (EvenHub does not require it). |
| app.json + gateway URL | Hardcode gateway domain in permissions.network | Use wildcard `"*"` for network permissions since gateway URL is user-configurable and could be any domain/IP. |
| MediaRecorder stop + blob read | Call `.stop()` and immediately access blob | `stopRecording()` returns a Promise. The `onstop` event fires asynchronously. Always `await` the stop. Already handled correctly in audio-capture.ts. |
| SSE auto-reconnect + duplicate requests | Gateway client retries a failed request while the user has already tapped to start a new one | Call `gateway.abort()` before starting a new voice turn. The current code does this in `sendVoiceTurn()` but the gesture handler should also abort on `START_RECORDING` if a previous turn is in flight. |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Streaming flush timer not stopped on error | CPU wakes every 200ms to flush empty buffer, icon animation runs | Always call `stopFlushTimer()` and `endStreaming()` on error events | Immediately on any gateway error -- accumulates over session lifetime |
| Icon animator runs during hidden state | setInterval fires every 166-333ms to update status container on a blank layout | `glasses-renderer.ts` already stops animator on hide, but verify integration wires `hide()` on all disconnect paths | On bridge disconnect if hide() is not called |
| Bridge.textContainerUpgrade called with unchanged content | BLE write for identical text wastes radio bandwidth and battery | Add a `lastPushedText` guard in renderAndPush: skip if text unchanged | After ~50 identical updates (e.g., during idle with no new messages) |
| Gateway heartbeat fires during active SSE stream | Unnecessary /health fetch while the SSE stream itself proves connectivity | Pause heartbeat during active `sendVoiceTurn()`, resume after stream completes | During every voice turn (doubles network requests) |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Gateway URL in app.json permissions too specific | App cannot reach gateway on a different domain/IP -- user locked to one server | Use wildcard `"*"` or omit network restrictions during early release |
| Session key transmitted without HTTPS | Key intercepted on local network (phone to gateway) | Default gateway URL to `https://` in settings validation; warn if user enters `http://` |
| Blob URL not revoked after audio submission | Audio recording blob persists in browser memory, potentially accessible | Call `URL.revokeObjectURL()` after the gateway client has finished with the blob |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No feedback during bridge initialization | User taps immediately after app load, nothing happens for 1-2 seconds | Show "Connecting to glasses..." icon/hint during bridge init; only enable gestures after init completes |
| Error leaves user stuck in "Processing..." state | User must force-quit and restart app | Auto-recover to idle after 30s timeout; show "Connection lost. Tap to retry." on glasses |
| Recording starts but no audio frames arrive (glasses not connected) | User speaks into nothing, gateway receives empty audio, STT returns empty transcript | Check bridge connection status before starting recording; show "Glasses not connected" if bridge is disconnected |
| Hint bar shows wrong state after error recovery | Hint says "Tap to stop recording" when actually back in idle after an error | Always update hint text after any FSM state transition, including error-driven transitions |

## "Looks Done But Isn't" Checklist

- [ ] **Voice loop:** Often missing error-to-idle FSM transition -- verify by simulating gateway 500 error during recording and confirming FSM returns to idle
- [ ] **Audio frame wiring:** Often missing `bridge:audio-frame -> audioCapture.onFrame()` subscription -- verify by checking `bus.listenerCount('bridge:audio-frame') >= 1` after init
- [ ] **Initialization order:** Often has display controller subscribed before gesture handler -- verify by logging subscription order or checking hint text accuracy on first tap
- [ ] **Bridge readiness:** Often calls startAudio before bridge init completes -- verify by adding a 2-second delay before bridge.init() resolves and confirming first tap still works
- [ ] **Streaming cleanup:** Often forgets to stop flush timer on error -- verify by triggering a gateway error mid-stream and confirming no interval timer leaks (check with `setInterval` spy)
- [ ] **Gateway cleanup:** Often missing `destroy()` call on shutdown -- verify by adding `beforeunload` handler and confirming heartbeat stops
- [ ] **Build output:** Often breaks with multi-page + singlefile plugin -- verify by running `npm run build` before any packaging changes
- [ ] **app.json:** Often missing gateway domain in network permissions -- verify by testing fetch to gateway URL from inside EvenHub WebView
- [ ] **Orphaned events:** display:state-change, display:viewport-update, display:hide, display:wake are in AppEventMap but never emitted -- verify these are removed or wired

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Wrong subscription ordering | LOW | Reorder 2-3 lines in main.ts initialization; add comments. ~30 minutes. |
| Bridge init race condition | LOW | Add `await` to bridge init chain; gate gesture handler creation. ~1 hour. |
| Missing audio frame subscription | LOW | Add one `bus.on()` line in main.ts. ~15 minutes plus test. |
| Singlefile + multi-page conflict | LOW | Remove singlefile plugin (not needed) or remove simulator from prod build. ~30 minutes. |
| app.json wrong/missing fields | LOW | Copy from sibling repo, adjust fields. ~30 minutes. |
| Gateway cleanup leak | LOW | Add `beforeunload` handler calling `gateway.destroy()`. ~30 minutes. |
| No error recovery in voice loop | MEDIUM | Add error input to FSM, wire gateway error events, add timeout. ~2-3 hours including tests. |
| Stuck FSM state after error | MEDIUM | Refactor FSM to accept error input; add timeout-based auto-recovery. ~2-3 hours. |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Event bus subscription ordering | Runtime wiring (main.ts) | Tap on glasses after boot; hint bar shows "Tap to stop recording" (not stale "Tap to record") |
| Bridge init before audio/display | Runtime wiring (main.ts) | Add 2s delay to bridge.init(); first tap after boot still works correctly |
| Audio frame subscription gap | Runtime wiring (main.ts) | Record 3-second utterance on glasses; blob size matches expected PCM byte count (~96KB) |
| vite-plugin-singlefile + multi-page | Build/packaging phase | `npm run build` succeeds without errors; dist/ contains expected files |
| app.json schema correctness | Build/packaging phase | `evenhub pack app.json dist --check` succeeds; .ehpk file is reasonable size |
| SSE/heartbeat cleanup | Runtime wiring (main.ts) | Navigate away from app; network tab shows no more /health requests |
| Voice loop error recovery | Voice loop integration phase | Simulate gateway 500; FSM returns to idle within 5 seconds; glasses display shows error message |
| Orphaned event types | Tech debt cleanup phase | `AppEventMap` has no event types that are never emitted by any module |

## Key Finding: vite-plugin-singlefile Is Probably Unnecessary

The sibling `even-g2-apps` repo ships standard Vite output (separate JS/CSS in `dist/assets/`) and successfully uses `evenhub pack` to create `.ehpk` packages. The `evenhub pack` command packages the entire `dist/` directory, not a single HTML file. The PROJECT.md's requirement for "self-contained dist/index.html via vite-plugin-singlefile" should be validated against EvenHub's actual acceptance criteria before adding the plugin, which introduces the multi-page build conflict and adds complexity for potentially no benefit.

**Recommendation:** Start without `vite-plugin-singlefile`. Build normally with Vite, run `evenhub pack`, and test the `.ehpk` on glasses. Only add singlefile if EvenHub specifically rejects multi-file submissions (which the sibling repo evidence suggests it does not).

## Sources

- [vite-plugin-singlefile GitHub - Issue #83 (multiple inputs)](https://github.com/richardtallent/vite-plugin-singlefile/issues/83) -- HIGH confidence, confirmed by plugin maintainer
- [vite-plugin-singlefile GitHub - Issue #69 (assets not included)](https://github.com/richardtallent/vite-plugin-singlefile/issues/69) -- MEDIUM confidence
- [Even Hub Developer Portal](https://evenhub.evenrealities.com/) -- HIGH confidence, official
- Sibling repo `even-g2-apps` at `/home/forge/bibele.kingdom.lv/samples/even-g2-apps/` -- HIGH confidence, working code with matching SDK versions, uses `evenhub pack` without singlefile plugin
- `@evenrealities/evenhub-cli` v0.1.5 README -- HIGH confidence, official CLI documentation for `pack` command
- Existing codebase analysis: `src/events.ts` (synchronous dispatch), `src/display/display-controller.ts` (ordering note on lines 8-11), `src/audio/audio-capture.ts` (passive onFrame method), `src/api/gateway-client.ts` (lifecycle methods) -- HIGH confidence, primary source
- [MDN MediaDevices.getUserMedia()](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) -- HIGH confidence
- [How to Implement an Event Bus in TypeScript](https://www.thisdot.co/blog/how-to-implement-an-event-bus-in-typescript) -- MEDIUM confidence
- [SSE Connection Lifecycle (trpc discussion)](https://github.com/trpc/trpc/discussions/5897) -- MEDIUM confidence
- [SSE Connection Leak (nodejs/undici)](https://github.com/nodejs/undici/issues/4627) -- MEDIUM confidence

---
*Pitfalls research for: Even G2 OpenClaw Chat App v1.1 -- voice loop integration and EvenHub submission*
*Researched: 2026-02-28*
