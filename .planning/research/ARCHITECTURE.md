# Architecture Patterns: Voice Loop Integration & EvenHub Submission

**Domain:** Even G2 smart glasses voice-chat app (v1.1 integration wiring)
**Researched:** 2026-02-28
**Confidence:** HIGH (based on direct codebase analysis + SDK documentation)

## Context

This is NOT a greenfield architecture document. v1.0 shipped 38 files with a clean, well-tested module graph. The question is strictly: how do the existing modules wire together at runtime in main.ts to create the end-to-end voice loop, and what build changes produce a self-contained EvenHub submission package?

## Existing Architecture (Verified from Source)

```
                    Even Hub SDK (WebView bridge)
                           |
                    even-bridge.ts   <-- ONLY SDK import boundary
                           |
                      Event Bus      <-- createEventBus<AppEventMap>()
                     /    |    \
            gesture-   audio-    gateway-
            handler    capture    client
               |          |          |
          gesture-fsm  (PCM/WebM)  (SSE stream)
               |                     |
         display-controller  --------+
               |
         glasses-renderer
          /       |       \
    viewport  icon-animator  bridge (SDK calls)
```

**Key invariants from v1.0:**
- Pure-function core modules (gesture-fsm.ts, viewport.ts, icon-animator.ts) have zero SDK imports
- All SDK interaction goes through BridgeService interface (even-bridge.ts or bridge-mock.ts)
- Event bus is synchronous dispatch, registration order matters (display controller AFTER gesture handler)
- Factory pattern for all services: `createXxx(opts)` returns interface object
- GatewayClient has its own internal event system (onChunk/onStatusChange) separate from the bus

## Recommended Architecture: Voice Loop Wiring

### The Missing Piece: VoiceLoopController

The voice loop is the data flow: `gesture:tap -> record -> audio blob -> gateway -> SSE chunks -> display`. All the individual segments exist. What is missing is a single orchestrator that:

1. Listens for `audio:recording-stop` on the bus (gesture handler already emits this)
2. Takes the audio blob and calls `gatewayClient.sendVoiceTurn()`
3. Forwards gateway chunks to the bus as `gateway:chunk` events
4. Manages the gateway status forwarding to the bus

This is the **VoiceLoopController** -- a new, thin glue module.

### Component Boundaries

| Component | Responsibility | Communicates With | Status |
|-----------|---------------|-------------------|--------|
| **EventBus** | Typed pub/sub backbone | All modules | EXISTS |
| **EvenBridge / BridgeMock** | SDK boundary, gesture/audio forwarding | EventBus (publishes gesture:*, bridge:*) | EXISTS |
| **AudioCapture** | PCM frame buffering / MediaRecorder | GestureHandler (lifecycle), Bridge (PCM frames) | EXISTS |
| **GestureHandler** | FSM + action dispatch | EventBus (subscribes gesture:*, emits audio:*) | EXISTS |
| **GatewayClient** | HTTP+SSE to voice gateway | VoiceLoopController (called directly) | EXISTS |
| **GlassesRenderer** | Display layout, streaming, scroll | BridgeService (SDK calls), DisplayController | EXISTS |
| **DisplayController** | Event-to-renderer wiring | EventBus (subscribes all), GlassesRenderer | EXISTS |
| **VoiceLoopController** | Audio->gateway->bus orchestration | EventBus, GatewayClient, Settings | **NEW** |
| **main.ts** | Bootstrap + dependency wiring | Creates all of the above | **REWRITE** |

### VoiceLoopController Design

```typescript
// src/voice-loop/voice-loop-controller.ts

export interface VoiceLoopController {
  destroy(): void;
}

export function createVoiceLoopController(opts: {
  bus: EventBus<AppEventMap>;
  gateway: GatewayClient;
  settings: () => AppSettings;
}): VoiceLoopController {
  const { bus, gateway, settings } = opts;
  const unsubs: Array<() => void> = [];

  // 1. When recording stops, send audio to gateway
  unsubs.push(
    bus.on('audio:recording-stop', ({ sessionId, blob }) => {
      const s = settings();
      gateway.sendVoiceTurn(s, {
        sessionId,
        audio: blob,
        sttProvider: s.sttProvider,
      });
    }),
  );

  // 2. Forward gateway chunks to the event bus
  unsubs.push(
    gateway.onChunk((chunk) => {
      bus.emit('gateway:chunk', chunk);
    }),
  );

  // 3. Forward gateway status to the event bus
  unsubs.push(
    gateway.onStatusChange((status) => {
      bus.emit('gateway:status', { status });
    }),
  );

  function destroy(): void {
    for (const unsub of unsubs) unsub();
    unsubs.length = 0;
    gateway.destroy();
  }

  return { destroy };
}
```

**Why a separate module instead of inline in main.ts:** Testability. The voice loop controller can be unit-tested by injecting a mock bus, mock gateway, and mock settings -- same pattern as every other v1.0 module. Inlining this logic in main.ts would make it untestable.

### Audio Frame Subscription (Tech Debt Fix)

There is a known gap: `bridge:audio-frame` events are emitted by even-bridge.ts but nothing subscribes to route them to `audioCapture.onFrame()`. This subscription belongs in main.ts wiring:

```typescript
bus.on('bridge:audio-frame', ({ pcm }) => {
  audioCapture.onFrame(pcm);
});
```

This is a one-liner but is critical for glasses-mode PCM recording (non-dev-mode).

## Data Flow: Complete Voice Turn

```
User taps glasses touchpad
       |
       v
even-bridge.ts detects OsEventTypeList.CLICK_EVENT
       |
       v
bus.emit('gesture:tap', { timestamp })
       |
       v
gesture-handler.ts: gestureTransition('idle', 'tap')
  -> state = 'recording', action = START_RECORDING
  -> audioCapture.startRecording(sessionId)
  -> bridge.startAudio()
  -> bus.emit('audio:recording-start', { sessionId })
       |
       v
display-controller.ts hears 'audio:recording-start'
  -> renderer.setIconState('recording')
  -> icon shows blinking dot
       |
       v
[PCM frames flow: bridge -> bus:'bridge:audio-frame' -> audioCapture.onFrame()]
       |
       v
User taps again
       |
       v
gesture-handler.ts: gestureTransition('recording', 'tap')
  -> state = 'sent', action = STOP_RECORDING
  -> bridge.stopAudio()
  -> audioCapture.stopRecording() -> Promise<Blob>
  -> bus.emit('audio:recording-stop', { sessionId, blob })
       |
       v
display-controller.ts hears 'audio:recording-stop'
  -> renderer.setIconState('sent')
       |
       v
voice-loop-controller.ts hears 'audio:recording-stop'
  -> gateway.sendVoiceTurn(settings, { sessionId, audio: blob, sttProvider })
       |
       v
gateway-client.ts POSTs FormData to gateway /voice/turn
  -> reads SSE stream from response body
  -> emits chunks via onChunk callbacks
       |
       v
voice-loop-controller.ts forwards chunk to bus
  -> bus.emit('gateway:chunk', chunk)
       |
       v
display-controller.ts hears 'gateway:chunk'
  chunk.type === 'transcript':
    -> renderer.addUserMessage(text)
    -> renderer.setIconState('sent')
  chunk.type === 'response_start':
    -> renderer.startStreaming()
    -> renderer.setIconState('thinking')
  chunk.type === 'response_delta':
    -> renderer.appendStreamChunk(text)
  chunk.type === 'response_end':
    -> renderer.endStreaming()
    -> renderer.setIconState('idle')
       |
       v
glasses-renderer.ts pushes text to glasses display
  -> bridge.textContainerUpgrade(containerID, content)
```

## Initialization Dependency Graph for main.ts

The initialization order is constrained by several dependency and registration-order requirements.

### Dependency Constraints

```
EventBus         -- no deps, create first
Settings         -- no deps, load from localStorage
AudioCapture     -- needs devMode flag only
BridgeService    -- needs EventBus (to emit gesture/audio events)
GatewayClient    -- no deps at creation time
GestureHandler   -- needs EventBus, BridgeService, AudioCapture, activeSessionId
GlassesRenderer  -- needs BridgeService, EventBus
DisplayController-- needs EventBus, GlassesRenderer, GestureHandler (MUST be after GestureHandler)
VoiceLoopController -- needs EventBus, GatewayClient, Settings
```

### Registration Order Constraint

The event bus dispatches synchronously in registration order. The display-controller.ts file documents this explicitly:

> "The display controller's hint-update handlers must be registered AFTER the gesture handler is created."

This means: GestureHandler subscribes to gesture events FIRST, then DisplayController subscribes SECOND. When a gesture event fires, the gesture handler processes the state transition first, then the display controller reads the post-transition hint text.

### Correct Initialization Sequence

```typescript
// src/glasses-main.ts (glasses runtime entry point)

export async function boot(): Promise<void> {
  // -- Layer 0: Foundation (no deps) ---------------------
  const bus = createEventBus<AppEventMap>();
  const settings = loadSettings();
  const devMode = !('__EVEN_BRIDGE__' in window)
    || new URLSearchParams(location.search).has('dev');

  // -- Layer 1: Hardware boundary ------------------------
  const bridge = devMode
    ? createBridgeMock(bus)
    : createEvenBridgeService(bus);
  await bridge.init();
  // After init: page container exists, gesture/audio events flowing

  // -- Layer 2: Audio capture ----------------------------
  const audioCapture = createAudioCapture(devMode);

  // Wire PCM frames from bridge to audio capture (tech debt fix)
  bus.on('bridge:audio-frame', ({ pcm }) => {
    audioCapture.onFrame(pcm);
  });

  // -- Layer 3: Gesture handling (subscribes to bus FIRST) --
  const gestureHandler = createGestureHandler({
    bus,
    bridge,
    audioCapture,
    activeSessionId: () => 'gideon', // or from settings
  });

  // -- Layer 4: Display pipeline (subscribes AFTER gesture) --
  const renderer = createGlassesRenderer({ bridge, bus });
  const displayController = createDisplayController({
    bus,
    renderer,
    gestureHandler,
  });
  await displayController.init();
  // After init: 3-container layout rebuilt, icon animator running

  // -- Layer 5: Gateway + voice loop ---------------------
  const gateway = createGatewayClient();
  const voiceLoop = createVoiceLoopController({
    bus,
    gateway,
    settings: () => settings,
  });

  // Start gateway health monitoring
  if (settings.gatewayUrl) {
    gateway.startHeartbeat(settings.gatewayUrl);
  }

  // -- Cleanup on page unload ----------------------------
  window.addEventListener('beforeunload', () => {
    voiceLoop.destroy();
    displayController.destroy();
    gestureHandler.destroy();
    gateway.destroy();
    bridge.destroy();
    bus.clear();
  });
}
```

### Layer Rationale

| Layer | What | Why This Order |
|-------|------|----------------|
| 0 | Bus, settings | Zero dependencies. Everything else needs these. |
| 1 | Bridge | Must call `init()` before any SDK operations. Creates startup page container. Starts emitting gesture/audio events to bus. |
| 2 | AudioCapture + PCM wiring | Must exist before GestureHandler calls `audioCapture.startRecording()`. PCM bus subscription must exist before bridge emits frames. |
| 3 | GestureHandler | Subscribes to gesture events on bus. Must subscribe BEFORE DisplayController so FSM transitions happen first. |
| 4 | DisplayController + Renderer | Subscribes to gesture events AFTER GestureHandler. Calls `renderer.init()` which does `rebuildPageContainer` (overrides the startup 1-container layout with the 3-container chat layout). |
| 5 | Gateway + VoiceLoop | Only needed after the full input/display pipeline is running. VoiceLoopController subscribes to `audio:recording-stop` which comes from gesture handler. |

### Dev Mode Detection

The bridge mock should be used when running outside the Even App WebView. Detection strategy:

```typescript
// The SDK injects EvenAppBridge into the WebView context.
// Simple detection:
const devMode = !('__EVEN_BRIDGE__' in window);
// Or use URL parameter for explicit override: ?dev=1
```

**Recommendation:** Use URL parameter `?dev=1` for explicit dev mode, with fallback to SDK detection. This is the approach used by the pong-even-g2 community app.

## Patterns to Follow

### Pattern 1: Factory + Interface Separation
**What:** Every service is created via `createXxx(opts)` and returns a plain interface object. No classes.
**When:** All new modules (VoiceLoopController, any future additions).
**Why:** Consistent with v1.0 patterns. Enables trivial mocking in tests.

```typescript
export interface VoiceLoopController {
  destroy(): void;
}

export function createVoiceLoopController(opts: {
  bus: EventBus<AppEventMap>;
  gateway: GatewayClient;
  settings: () => AppSettings;
}): VoiceLoopController {
  // ... implementation
  return { destroy };
}
```

### Pattern 2: Bus Subscription Cleanup via unsubs Array
**What:** Every module that subscribes to the bus collects `() => void` unsubscribe functions in an array, then iterates on `destroy()`.
**When:** Any module that calls `bus.on()`.
**Why:** Prevents memory leaks and dangling subscriptions. Already used in gesture-handler.ts and display-controller.ts.

### Pattern 3: Settings as Getter Function
**What:** Pass `settings: () => AppSettings` instead of `settings: AppSettings` to modules that need current settings at call time.
**When:** VoiceLoopController needs current gatewayUrl/sttProvider when sending a voice turn, not the values from boot time.
**Why:** Settings can change via the companion hub. A getter ensures fresh values.

### Pattern 4: Bridge Rebuild for Layout Changes
**What:** `rebuildPageContainer()` for layout changes, `textContainerUpgrade()` for content updates.
**When:** The pong-even-g2 community app confirms this: "During gameplay, only textContainerUpgrade is called -- no page rebuilds until the game ends."
**Why:** Page rebuilds are expensive. The chat layout (3 containers: status/chat/hint) should be set once at init and updated via textContainerUpgrade thereafter.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Gateway Chunks Directly on the Bus
**What:** Having gatewayClient directly emit to the event bus.
**Why bad:** GatewayClient has its own internal event system (onChunk/onStatusChange) that is intentionally decoupled from AppEventMap. Coupling them would break the gateway client's independence and testability.
**Instead:** VoiceLoopController bridges the two systems. Gateway client remains bus-agnostic.

### Anti-Pattern 2: Inline Wiring Logic in main.ts
**What:** Putting the audio->gateway->bus forwarding logic directly in main.ts.
**Why bad:** Untestable. main.ts should only do dependency creation and wiring, not contain business logic.
**Instead:** Extract to VoiceLoopController module. main.ts only creates instances and passes them together.

### Anti-Pattern 3: Multiple Page Rebuilds During Init
**What:** Both `bridge.init()` (creates startup page) and `renderer.init()` (rebuilds to 3-container chat layout) do page container operations.
**Why this is fine:** The startup page from `bridge.init()` is immediately replaced by `renderer.init()`. This is the correct pattern -- the startup page is required by the SDK before any other operations work, and the chat layout replaces it once the renderer is ready. Do NOT try to skip the startup page.

### Anti-Pattern 4: Synchronous Settings Snapshot
**What:** Passing `settings` object directly instead of `() => settings` getter.
**Why bad:** Settings change at runtime (user edits in companion hub). A snapshot taken at boot would have stale gatewayUrl/apiKey.
**Instead:** Always pass a getter that returns current settings.

## EvenHub Submission: Build Architecture

### Single-File Output

EvenHub apps run inside the Even App's WebView. The simplest distribution is a self-contained `dist/index.html` with all JS/CSS inlined. Use `vite-plugin-singlefile` (v2.3.0).

**Vite config change:**

```typescript
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  plugins: [viteSingleFile()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    // Single input for EvenHub submission
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
  server: {
    port: 3200,
    open: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
```

**Key changes from current config:**
1. Add `viteSingleFile()` plugin
2. Remove multi-entry (`simulator` input) from build -- preview-glasses.html is dev-only
3. Install: `npm install -D vite-plugin-singlefile`

### Dual Entry Points: Glasses Runtime vs Companion Hub

The current `main.ts` is the companion hub (settings, health, logs). The glasses runtime is a DIFFERENT code path. These serve different purposes:

| Entry Point | Runs In | Purpose |
|-------------|---------|---------|
| Companion hub code | Browser / mobile | Configure settings, view health, manage sessions |
| Glasses runtime code | Even App WebView | Voice loop, display pipeline, gesture handling |

**Recommendation:** Detect environment at runtime. If running inside Even App WebView, boot the glasses runtime. If in a regular browser, show the companion hub. This keeps a single index.html for EvenHub submission.

```typescript
// src/main.ts
async function main() {
  const isEvenApp = '__EVEN_BRIDGE__' in window
    || new URLSearchParams(location.search).has('even');

  if (isEvenApp) {
    const { boot } = await import('./glasses-main');
    await boot();
  } else {
    const { initHub } = await import('./hub-main');
    initHub();
  }
}
main();
```

**Why this approach:** One index.html, two code paths. vite-plugin-singlefile will inline both code paths (they are small -- total app is ~5,500 LOC). This avoids maintaining two separate HTML files and simplifies EvenHub submission. The dynamic import means tree-shaking separates the code paths at the chunk level, but singlefile inlines everything anyway.

### App Metadata

EvenHub submission requires metadata. Based on community apps and SDK documentation, this includes:

| Field | Value | Notes |
|-------|-------|-------|
| name | "OpenClaw Chat" | Short, descriptive |
| description | "Voice chat with AI through your Even G2" | One-liner |
| icon | 512x512 PNG | App store icon |
| permissions | `audio`, `network` | Microphone access, gateway API calls |
| version | "1.1.0" | Semantic versioning |

**LOW confidence** on exact metadata schema -- EvenHub submission portal specifics are not publicly documented. Validate with Even Realities pilot program team.

### Orphaned Event Types Cleanup

The AppEventMap contains 4 event types that are defined but never emitted or consumed:

```typescript
'display:state-change': { state: IconState };
'display:viewport-update': { text: string };
'display:hide': Record<string, never>;
'display:wake': Record<string, never>;
```

These were likely planned during v1.0 but superseded by direct method calls in the display controller. Remove them to keep the event map clean. This is safe because:
- No module emits these events (verified by searching the entire codebase)
- No module subscribes to these events
- The display controller uses direct renderer method calls instead

## Component Wiring Diagram

```
main.ts creates:
  |
  +-- bus = createEventBus<AppEventMap>()
  |
  +-- settings = loadSettings()
  |
  +-- bridge = createBridgeMock(bus) OR createEvenBridgeService(bus)
  |     |
  |     +-- await bridge.init()  --> SDK startup page created
  |
  +-- audioCapture = createAudioCapture(devMode)
  |     |
  |     +-- bus.on('bridge:audio-frame') --> audioCapture.onFrame()
  |
  +-- gestureHandler = createGestureHandler({ bus, bridge, audioCapture, ... })
  |     |
  |     +-- subscribes: gesture:tap, gesture:double-tap, gesture:scroll-*
  |     +-- emits: audio:recording-start, audio:recording-stop, gesture:menu-toggle
  |
  +-- renderer = createGlassesRenderer({ bridge, bus })
  |
  +-- displayController = createDisplayController({ bus, renderer, gestureHandler })
  |     |
  |     +-- await displayController.init()  --> 3-container layout, icon animator
  |     +-- subscribes: gateway:chunk, gesture:*, audio:*, gesture:menu-toggle
  |
  +-- gateway = createGatewayClient()
  |
  +-- voiceLoop = createVoiceLoopController({ bus, gateway, settings: () => settings })
        |
        +-- subscribes: audio:recording-stop
        +-- bridges: gateway.onChunk() --> bus.emit('gateway:chunk')
        +-- bridges: gateway.onStatusChange() --> bus.emit('gateway:status')
```

## New Files Required

| File | Type | Purpose | Complexity |
|------|------|---------|------------|
| `src/voice-loop/voice-loop-controller.ts` | NEW | Audio->gateway->bus bridge | Low (thin glue, ~40 lines) |
| `src/glasses-main.ts` | NEW | Glasses runtime bootstrap (init sequence above) | Medium (~60 lines) |
| `src/hub-main.ts` | RENAME/EXTRACT | Current main.ts companion hub logic | Low (move existing code) |
| `src/main.ts` | REWRITE | Environment detection + dynamic import | Low (~15 lines) |
| `src/__tests__/voice-loop-controller.test.ts` | NEW | Voice loop unit tests | Low |

## Modified Files

| File | Change | Reason |
|------|--------|--------|
| `src/types.ts` | Remove 4 orphaned event types from AppEventMap | Tech debt cleanup |
| `vite.config.ts` | Add viteSingleFile plugin, single entry point for build | EvenHub packaging |
| `package.json` | Add vite-plugin-singlefile dev dependency | Build tooling |

## FSM State Transition Gap: sent -> thinking

The gesture FSM has a `sent` state (after recording stops, before gateway responds) and a `thinking` state (while streaming response arrives). Currently, the transition from `sent` to `thinking` is NOT in the FSM transition table -- the FSM comment says "auto-transitions to 'thinking' externally via event bus."

This means the display controller handles the visual transition (setting icon to 'thinking' on `response_start`), but the gesture FSM state stays at `sent`. This is acceptable for v1.1 because:
- The `sent` state ignores all inputs (correct behavior while waiting)
- The display controller independently manages the icon state
- The gesture handler does not need to know about `thinking` for input handling

However, if future features need the gesture handler to behave differently during `thinking` vs `sent`, the FSM will need an external state-set mechanism. Flag for future consideration only.

## Scalability Considerations

| Concern | At v1.1 (now) | At v2.0 (future) |
|---------|---------------|-------------------|
| Conversation length | Viewport windowing handles it (1800-char SDK limit) | Same -- viewport already windows |
| Multiple sessions | Settings store has activeSession | Could add session-specific conversation history |
| Bundle size | Single-file inlining is fine (app is <50KB) | May need code splitting if app grows significantly |
| Audio format | PCM (glasses) / WebM (browser fallback) | Gateway handles transcoding -- frontend does not care |
| Reconnection | Gateway client has exponential backoff (5 retries) | Could add offline queue for messages |

## Sources

- [Even G2 SDK Notes (nickustinov)](https://github.com/nickustinov/even-g2-notes/blob/main/G2.md) -- HIGH confidence, comprehensive SDK documentation verified against codebase
- [Pong for Even G2](https://github.com/nickustinov/pong-even-g2) -- HIGH confidence, working community app showing SDK patterns and initialization
- [vite-plugin-singlefile](https://github.com/richardtallent/vite-plugin-singlefile) -- HIGH confidence, v2.3.0, well-maintained
- [EvenHub Developer Portal](https://evenhub.evenrealities.com/) -- LOW confidence on submission specifics (pilot program, limited public docs)
- [Even Realities EvenDemoApp](https://github.com/even-realities/EvenDemoApp) -- MEDIUM confidence, official but focused on G1 hardware
- [Even Realities launch announcement](https://www.webpronews.com/even-realities-launches-even-hub-for-g2-smart-glasses-app-developers/) -- MEDIUM confidence, describes developer program
- Direct codebase analysis of all 38 source files -- HIGH confidence
