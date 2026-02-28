# Feature Landscape: v1.1 Integration

**Domain:** Smart glasses voice/chat companion app (Even G2 + OpenClaw AI agent) -- integration milestone
**Researched:** 2026-02-28
**Scope:** NEW features only -- end-to-end voice loop wiring, runtime initialization, EvenHub submission
**Confidence:** HIGH for voice loop (wiring existing tested modules), MEDIUM for EvenHub submission (early-access program with limited public docs)

---

## Context: What Already Exists

v1.0 shipped 27 requirements across 5 phases (5,484 LOC, 240 tests). Every module below exists as a tested library component. The gap is that `main.ts` does not instantiate any of them -- they have never run together end-to-end.

| Module | Status | File |
|--------|--------|------|
| Gesture FSM (5 states x 4 inputs) | Complete, 77 tests | `src/gestures/gesture-fsm.ts` |
| Gesture handler (bus wiring + debounce) | Complete | `src/gestures/gesture-handler.ts` |
| EvenBridge SDK wrapper | Complete | `src/bridge/even-bridge.ts` |
| Dev-mode bridge mock (keyboard shortcuts) | Complete | `src/bridge/bridge-mock.ts` |
| Audio capture (PCM + MediaRecorder) | Complete | `src/audio/audio-capture.ts` |
| Gateway API client (SSE + reconnect) | Complete | `src/api/gateway-client.ts` |
| Icon animator (4-state HUD) | Complete | `src/display/icon-animator.ts` |
| Glasses renderer (3-container layout) | Complete | `src/display/glasses-renderer.ts` |
| Display controller (bus-to-renderer glue) | Complete | `src/display/display-controller.ts` |
| Viewport (virtualized windowing) | Complete | `src/display/viewport.ts` |
| Event bus (typed, synchronous) | Complete | `src/events.ts` |
| Settings store + companion hub UI | Complete | `src/main.ts` (hub only) |

---

## Table Stakes

Features the v1.1 milestone MUST deliver. Without these the app does not function and cannot ship.

### 1. End-to-End Voice Loop Wiring

| Feature | Why Required | Complexity | Dependencies |
|---------|-------------|------------|--------------|
| `audio:recording-stop` -> gateway dispatch | Without this subscriber, recorded audio goes nowhere. The gesture handler emits `audio:recording-stop` with a Blob, but nothing calls `gatewayClient.sendVoiceTurn()`. This is the single most critical missing wire. | LOW | `gesture-handler.ts` (emitter), `gateway-client.ts` (receiver), `settings.ts` (gateway URL + session config) |
| `gatewayClient.onChunk()` -> `bus.emit('gateway:chunk')` | Gateway client has its own internal event system (`onChunk` callbacks). The display controller listens on the event bus for `gateway:chunk`. Without this bridge, SSE streaming data never reaches the glasses display. | LOW | `gateway-client.ts` (source), `events.ts` (bus), `display-controller.ts` (consumer) |
| `bridge:audio-frame` -> `audioCapture.onFrame()` | In glasses mode, PCM frames arrive on the event bus via `bridge:audio-frame`. No subscriber feeds them to `audioCapture.onFrame()`. Without this, glasses-mode recording captures zero audio. Dev-mode MediaRecorder is unaffected. | LOW | `even-bridge.ts` (emitter), `audio-capture.ts` (receiver) |
| `gateway:status` -> companion hub health UI | Gateway client emits status changes via `onStatusChange()`. The companion hub health display and log system need to reflect connection state. Without this, the health page stays static. | LOW | `gateway-client.ts` (source), `main.ts` hub UI (consumer) |

**Confidence:** HIGH -- These are documented in the v1.0 milestone audit (INT-01, FLOW-05, cross-phase tech debt). The code on both sides already exists and is tested. This is purely subscription wiring.

### 2. Runtime Initialization (`main.ts` Assembly)

| Feature | Why Required | Complexity | Dependencies |
|---------|-------------|------------|--------------|
| Module instantiation sequence | The app currently boots into the companion hub only. `main.ts` must create the event bus, bridge (real or mock), audio capture, gesture handler, glasses renderer, display controller, and gateway client in the correct order. | MEDIUM | All modules, initialization order matters (see below) |
| Dev-mode detection and bridge selection | Must detect whether running inside the Even App WebView (real bridge available) or in a regular browser (use mock bridge). The SDK injects `window.flutter_inappwebview` when running inside the Even App. | LOW | `even-bridge.ts`, `bridge-mock.ts` |
| Initialization order enforcement | Bus must exist before bridge init. Bridge must init before gesture handler (so events flow). Gesture handler must register before display controller (ordering constraint for hint text). Display controller calls `renderer.init()` which calls `bridge.rebuildPageContainer()`. Gateway client can init independently. | MEDIUM | All modules -- ordering documented in `display-controller.ts` source comments |
| Graceful degradation on init failure | Bridge init can fail (SDK not loaded, glasses not connected). Gateway health check can fail (server down). The app must handle partial initialization -- companion hub should work even if glasses are not connected. | MEDIUM | Error handling across all module init paths |
| Cleanup / destroy on app exit | `FOREGROUND_EXIT_EVENT` and `ABNORMAL_EXIT_EVENT` from the SDK signal app lifecycle changes. Must call `destroy()` on all services to release resources (audio streams, intervals, event listeners). | LOW | All module `destroy()` methods, SDK lifecycle events |

**Confidence:** HIGH -- The factory pattern used by all modules makes instantiation straightforward. The ordering constraint is already documented in source code comments. The main risk is error handling during partial init.

### 3. EvenHub Submission Package

| Feature | Why Required | Complexity | Dependencies |
|---------|-------------|------------|--------------|
| `app.json` manifest file | Required by the EvenHub platform. Defines `package_id`, `name`, `version`, `entrypoint`, `permissions`, `tagline`, `description`, `author`, `edition`, `min_app_version`. Without this, the `evenhub pack` CLI cannot produce a package. | LOW | None -- static metadata file |
| Single-file build via `vite-plugin-singlefile` | EvenHub apps load via the Even App's WebView. A self-contained `dist/index.html` with all JS/CSS inlined eliminates external dependency loading issues in the WebView environment. The `.ehpk` format packages this. | LOW | `vite.config.ts` modification, `vite-plugin-singlefile` npm dependency |
| `.ehpk` packaging via `evenhub pack` | The `.ehpk` file is the submission artifact for the EvenHub portal. Created by running `evenhub pack app.json dist`. This bundles the built HTML with the manifest metadata. | LOW | `app.json`, built `dist/` directory, `evenhub` CLI tool |
| Build script updates | Add `pack` and `qr` npm scripts: `"pack": "npm run build && evenhub pack app.json dist"` and `"qr": "evenhub qr --http --port 3200"` for dev workflow. | LOW | `package.json` |

**Confidence:** MEDIUM -- The `app.json` format is documented in community notes but the EvenHub portal for actual submission is not yet operational (early-access). The `.ehpk` packaging format and `evenhub` CLI are referenced in community docs but official documentation is limited. The self-contained HTML approach via `vite-plugin-singlefile` is well-established.

---

## Differentiators

Features not strictly required for the voice loop but that add meaningful value during v1.1.

| Feature | Value Proposition | Complexity | Dependencies | Recommendation |
|---------|-------------------|------------|--------------|----------------|
| CLICK_EVENT quirk handling | The SDK normalizes `CLICK_EVENT` (value 0) to `undefined`. Current bridge code checks `eventType === OsEventTypeList.CLICK_EVENT` which may fail on real hardware. Fixing this prevents tap-to-record from silently breaking on actual glasses. | LOW | `even-bridge.ts` event mapping | BUILD -- silent failure on real hardware is unacceptable |
| Companion hub gateway integration | Wire the companion hub's "Connect/Disconnect" buttons to actually call `gatewayClient.checkHealth()` and reflect real gateway status in the health page. Currently these are mock stubs. | LOW | `gateway-client.ts`, `main.ts` hub code | BUILD -- makes the companion hub functional instead of decorative |
| Startup page container -> chat layout transition | The bridge's `init()` creates a single-container startup layout. The renderer's `init()` rebuilds to a 3-container chat layout. This transition should be seamless. Need to verify there is no flicker or race condition between bridge init and renderer init. | LOW | `even-bridge.ts`, `glasses-renderer.ts` | BUILD -- verify the transition path works correctly |
| QR code dev workflow | Add `evenhub qr` integration for rapid on-device testing. Generates a QR code that the Even App scans to load the dev server URL on glasses. | LOW | `evenhub` CLI, `package.json` script | BUILD -- essential for testing on real hardware |
| Error toast for voice loop failures | When `gateway:chunk` delivers a `type: 'error'` event, show a user-visible error on the glasses display (brief text in status container) and log to companion hub. Currently errors are emitted but not surfaced to the user. | LOW | `display-controller.ts`, `glasses-renderer.ts` | BUILD -- users need to know when something fails |

**Confidence:** HIGH for CLICK_EVENT quirk (documented in community SDK notes). MEDIUM for others (straightforward wiring of existing modules).

---

## Anti-Features

Features that seem relevant to v1.1 but should NOT be built in this milestone.

| Anti-Feature | Why It Seems Relevant | Why Avoid | What to Do Instead |
|--------------|----------------------|-----------|-------------------|
| Persistent conversation history | "If we are wiring the voice loop, shouldn't we save conversations?" | localStorage has 5MB limits, WebView storage can be cleared by the OS, and privacy implications of storing voice transcripts locally. This is a gateway-side concern. | Keep in-memory conversation state during a session. Clear on app restart. Gateway owns persistence. |
| Microphone permission prompt UX | "What if the user denies microphone access?" | Dev-mode MediaRecorder already handles `getUserMedia` rejection gracefully (the Promise rejects). Glasses-mode PCM comes from the SDK with no browser permission needed. Over-engineering permission UX adds complexity for a rare edge case. | Let the browser's native permission prompt handle it. Log a warning if denied. The app degrades to "no recording" state naturally via the FSM. |
| Multi-page companion hub routing | "The hub has 4 pages -- should we add URL routing?" | The companion hub is a single HTML page with show/hide navigation. Adding a router (hash or history) introduces state management complexity and potential issues in the EvenHub WebView for zero user benefit -- the bottom nav works. | Keep the existing show/hide page pattern. It works, has zero dependencies, and does not interfere with EvenHub's WebView URL loading. |
| Custom error recovery strategies | "What if the gateway is down? Should we queue voice turns?" | Offline queueing adds significant complexity (IndexedDB, retry queues, conflict resolution). The gateway client already has exponential backoff reconnection (5 attempts). The app's core value requires real-time connectivity. | Rely on existing auto-reconnect. Show clear status indicators when disconnected. Let the user retry manually by recording again. |
| R1 ring gesture integration | "The R1 ring is an Even G2 accessory -- should we support it?" | The R1 ring has its own SDK surface. Ring events may map differently than temple gestures. Adding ring support changes the gesture input model and requires testing with hardware most users may not own. | Defer to v1.2+. The 4-gesture temple touch model is sufficient for v1.1. Ring support can be added as a separate input driver later. |
| Automated integration tests for the voice loop | "We have 240 unit tests -- shouldn't we add E2E tests?" | True E2E testing requires either real glasses hardware or a faithful SDK simulator. The dev-mode mock is sufficient for verifying wiring. Adding Playwright/Cypress for WebView testing would be fragile and time-consuming to set up for minimal confidence gain. | Manually verify the voice loop flow (tap -> record -> gateway -> stream -> display) using the dev-mode mock with keyboard shortcuts. Add integration tests in a future milestone when the SDK simulator matures. |

---

## Feature Dependencies (v1.1 Scope)

```
[Event Bus] (exists)
    |
    +-- [Bridge Service] (exists, needs init in main.ts)
    |       |
    |       +-- Dev detection: window.flutter_inappwebview?
    |       |       YES -> createEvenBridgeService(bus)
    |       |       NO  -> createBridgeMock(bus)
    |       |
    |       +-- bridge:audio-frame -> audioCapture.onFrame()  [NEW WIRE]
    |
    +-- [Audio Capture] (exists, needs init in main.ts)
    |       |
    |       +-- audio:recording-stop -> gatewayClient.sendVoiceTurn()  [NEW WIRE]
    |
    +-- [Gesture Handler] (exists, needs init in main.ts)
    |       |
    |       +-- MUST init BEFORE display controller (ordering constraint)
    |
    +-- [Display Controller] (exists, needs init in main.ts)
    |       |
    |       +-- MUST init AFTER gesture handler
    |       +-- Calls renderer.init() internally
    |
    +-- [Gateway Client] (exists, needs init in main.ts)
    |       |
    |       +-- gatewayClient.onChunk() -> bus.emit('gateway:chunk')  [NEW WIRE]
    |       +-- gatewayClient.onStatusChange() -> bus.emit('gateway:status')  [NEW WIRE]
    |       +-- startHeartbeat(settings.gatewayUrl)
    |
    +-- [Companion Hub] (exists in main.ts, needs gateway integration)
            |
            +-- Wire health display to real gateway status
            +-- Wire connect/disconnect to bridge lifecycle

[app.json] -----> [vite-plugin-singlefile] -----> [evenhub pack] -----> .ehpk
 (metadata)         (build config)                  (CLI tool)          (submission)
```

### Initialization Order (Critical)

The modules must be created and initialized in this sequence:

```
1. createEventBus<AppEventMap>()           -- foundation, no deps
2. loadSettings()                          -- read persisted config
3. createAudioCapture(devMode)             -- needs devMode flag
4. createGatewayClient()                   -- independent, no deps
5. createBridgeService(bus) OR createBridgeMock(bus)  -- needs bus
6. bridge.init()                           -- await; creates page container
7. createGestureHandler({bus, bridge, audioCapture, activeSessionId})  -- needs all above
8. createGlassesRenderer({bridge, bus})    -- needs bridge, bus
9. createDisplayController({bus, renderer, gestureHandler})  -- needs all above
10. displayController.init()               -- await; rebuilds page to 3-container chat layout
11. Wire: bus.on('bridge:audio-frame') -> audioCapture.onFrame()
12. Wire: bus.on('audio:recording-stop') -> gatewayClient.sendVoiceTurn()
13. Wire: gatewayClient.onChunk() -> bus.emit('gateway:chunk')
14. Wire: gatewayClient.onStatusChange() -> bus.emit('gateway:status')
15. gatewayClient.startHeartbeat(settings.gatewayUrl)
16. Init companion hub UI (existing code)
```

Steps 7-10 MUST be in this order (gesture handler before display controller). Steps 11-14 can be in any order but must be after step 10. Step 15 can happen anytime after step 4.

---

## Tech Debt Cleanup (v1.1 Scope)

Items explicitly tagged as tech debt in the v1.0 audit that should be resolved during integration.

| Item | Severity | Action | Complexity |
|------|----------|--------|------------|
| 4 orphaned event types in `AppEventMap` | INFO | Remove `display:state-change`, `display:viewport-update`, `display:hide`, `display:wake` from the type definition. These were planned during Phase 3 design but the actual implementation uses direct audio/gateway/gesture events instead. | LOW |
| `bridge:audio-frame` subscription gap | Non-critical | Add `bus.on('bridge:audio-frame', ({pcm}) => audioCapture.onFrame(pcm))` during runtime init. | LOW |
| Runtime wiring gaps (all E2E flows) | Structural | The entire `main.ts` assembly (this milestone's primary deliverable). | MEDIUM |

---

## EvenHub `app.json` Manifest Specification

Based on community documentation (MEDIUM confidence -- not official docs, but the only available reference).

```json
{
  "package_id": "com.openclaw.even-g2-chat",
  "edition": "202603",
  "name": "OpenClaw Chat",
  "version": "1.1.0",
  "min_app_version": "1.0.0",
  "tagline": "Voice conversations with AI through your Even G2 glasses",
  "description": "Chat with OpenClaw AI agents using voice. Tap to record, see streaming responses as bubble chat on your glasses display. Supports multiple agent sessions, full conversation history, and a companion hub for settings and diagnostics.",
  "author": "OpenClaw",
  "entrypoint": "index.html",
  "permissions": {
    "network": ["*"],
    "fs": []
  }
}
```

**Field notes:**
- `package_id`: Reverse-domain, lowercase alphanumeric only, no hyphens within segments
- `edition`: Release date code (YYYYMM format)
- `entrypoint`: Must be `index.html` -- the single-file build output
- `permissions.network`: `["*"]` because the gateway URL is user-configurable (not known at build time)
- `permissions.fs`: Empty -- no filesystem access needed (settings use localStorage)

---

## `vite-plugin-singlefile` Configuration

```typescript
// vite.config.ts additions
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    // vite-plugin-singlefile sets recommended defaults:
    // - assetsInlineLimit: Infinity
    // - cssCodeSplit: false
    // - rollupOptions.output.inlineDynamicImports: true
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        // NOTE: simulator page may need separate handling or exclusion
      },
    },
  },
});
```

**Key consideration:** The current vite config has two entry points (`index.html` and `preview-glasses.html`). The `vite-plugin-singlefile` plugin inlines assets into a single HTML file. For EvenHub submission, only `index.html` needs to be self-contained. The simulator page is a dev tool and does not need to be in the `.ehpk` package.

---

## MVP Recommendation (v1.1 Scope)

### Must Ship

1. **Runtime initialization in `main.ts`** -- The voice loop cannot work without module assembly
2. **Four event bus wires** (audio-frame -> onFrame, recording-stop -> sendVoiceTurn, onChunk -> gateway:chunk, onStatusChange -> gateway:status) -- These connect the data flow
3. **CLICK_EVENT quirk fix** -- Without this, tap-to-record may silently fail on real glasses
4. **`app.json` manifest** -- Cannot submit without it
5. **`vite-plugin-singlefile` build** -- Self-contained HTML for EvenHub packaging
6. **`evenhub pack` script** -- Produces the `.ehpk` submission artifact
7. **Orphaned event type cleanup** -- Dead code removal, trivial

### Defer to v1.2+

- **R1 ring input integration** -- Separate hardware, separate SDK surface
- **Persistent conversation history** -- Gateway-side concern
- **Custom error recovery / offline queueing** -- Over-engineering for v1.1
- **Automated E2E tests** -- SDK simulator not mature enough
- **Multi-language UI** -- EvenHub is English-first early-access

---

## Sources

- [Even Hub Developer Portal](https://evenhub.evenrealities.com/) -- SDK overview, pilot program info (MEDIUM confidence)
- [nickustinov/even-g2-notes G2.md](https://github.com/nickustinov/even-g2-notes/blob/main/G2.md) -- app.json format, .ehpk packaging, CLICK_EVENT quirk, container limits, audio PCM specs, SDK lifecycle events (HIGH confidence -- most comprehensive community reference)
- [Even Realities GitHub](https://github.com/even-realities) -- Official org with SDK and demo repos (MEDIUM confidence)
- [vite-plugin-singlefile npm](https://www.npmjs.com/package/vite-plugin-singlefile) -- Plugin docs, configuration options (HIGH confidence)
- [vite-plugin-singlefile GitHub](https://github.com/richardtallent/vite-plugin-singlefile) -- Source, README, options reference (HIGH confidence)
- [WebProNews - Even Hub Launch](https://www.webpronews.com/even-realities-launches-even-hub-for-g2-smart-glasses-app-developers/) -- Developer program context (MEDIUM confidence)
- v1.0 Milestone Audit (`.planning/milestones/v1.0-MILESTONE-AUDIT.md`) -- Tech debt inventory, integration gaps, wiring requirements (HIGH confidence -- internal source)

---
*Feature research for: Even G2 OpenClaw Chat App v1.1 Integration*
*Researched: 2026-02-28*
