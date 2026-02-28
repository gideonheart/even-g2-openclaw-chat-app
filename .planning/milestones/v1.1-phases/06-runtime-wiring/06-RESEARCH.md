# Phase 6: Runtime Wiring - Research

**Researched:** 2026-02-28
**Domain:** Module assembly, runtime initialization, environment detection, voice loop wiring
**Confidence:** HIGH

## Summary

Phase 6 wires all v1.0 library modules (event bus, bridge, audio capture, gesture FSM, gesture handler, gateway client, glasses renderer, display controller) into a working end-to-end voice loop through a new `main.ts` assembly layer. The primary challenge is not algorithmic -- it is sequencing. Every module already exists and is tested in isolation. The work is: (1) detect runtime environment (Even App WebView vs browser), (2) boot the correct code path (glasses runtime vs companion hub), (3) initialize modules in correct dependency order, (4) create a VoiceLoopController that bridges gateway client events to the app event bus, (5) wire the missing `bridge:audio-frame` -> `audioCapture.onFrame()` subscription, (6) fix the CLICK_EVENT SDK quirk so taps work on real hardware, (7) remove orphaned event types from AppEventMap, and (8) implement the user-facing boot/idle/turn lifecycle from CONTEXT.md decisions.

The architecture research from v1.1 milestone planning provides a validated initialization sequence (Layers 0-5) with correct ordering constraints. The CLICK_EVENT quirk is the only non-obvious technical risk: the SDK's `fromJson` normalizes the numeric value `0` to `undefined`, so checking `eventType === OsEventTypeList.CLICK_EVENT` silently drops all tap events on real hardware. The fix is a one-line defensive check.

**Primary recommendation:** Split current `main.ts` into `hub-main.ts` (existing companion hub code) and `glasses-main.ts` (new glasses runtime boot). Use a thin `main.ts` router that detects `window.flutter_inappwebview` to select the code path. Follow the Layer 0-5 initialization sequence from architecture research. Create a new VoiceLoopController module following the existing factory+interface pattern.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Browser dev mode uses keyboard shortcut for voice turns (no on-screen button)
- Toggle mode: press once = start recording, press again = stop (mirrors actual glasses tap-tap)
- Default to real browser microphone (MediaRecorder API) for end-to-end testing
- URL parameter or setting toggles mock audio frames for CI/automated testing without mic
- Glasses display renders in existing separate simulator window (preview-glasses.html), not inline in browser
- Brief boot indicator (~1 second) while modules initialize -- subtle icon animation or "connecting..." text on glasses display
- If gateway URL not configured: block with persistent message "Open companion app to configure" -- do NOT allow voice turns
- Ping gateway health endpoint at boot before showing "ready" state
- Auto-retry health check in background (every few seconds) -- transition to "ready" when gateway comes online
- No hint bar on glasses display -- hints take too much space on G2's 640x400 viewport
- Show "Tap to ask" welcome message after boot completes (first time only, before first voice turn)
- After first voice turn: idle state shows last conversation (chat bubbles remain visible, scrollable)
- Welcome message never reappears once first turn completed
- Continuous chat -- new turns append below previous exchange, scrollable conversation history
- Keep only last N turns in display buffer to manage memory
- Auto-scroll follows streaming text by default
- If user manually scrolls up during streaming, auto-scroll pauses until turn ends
- Brief visual settle (~500ms) after AI response finishes before accepting next tap

### Claude's Discretion
- Specific keyboard shortcut key for dev mode tap simulation (spacebar is a natural choice)
- Exact number of turns to keep in display buffer (e.g. 5-10)
- Boot indicator visual style (icon animation vs text)
- Auto-retry interval for gateway health check (should align with existing heartbeat system)
- How the ~500ms settle period is implemented (FSM guard vs display debounce)

### Deferred Ideas (OUT OF SCOPE)
- Hints in side menu option -- future companion hub feature
- Conversation history persistence across app restarts -- in-memory only for this session
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LOOP-01 | User can complete a full voice turn: tap -> record -> send -> see streaming response on glasses | Architecture research provides the complete data flow (6 layers). VoiceLoopController bridges gateway events to bus. All display wiring exists in display-controller.ts. |
| LOOP-02 | Runtime main.ts detects Even App WebView vs browser and routes to correct boot path | `window.flutter_inappwebview` detection confirmed in SDK source. Architecture research provides the router pattern (thin main.ts with dynamic import). |
| LOOP-03 | Glasses boot sequence initializes all modules in correct dependency order | Architecture research Layer 0-5 sequence validated against module dependency constraints. Registration order constraint documented in display-controller.ts. |
| LOOP-04 | VoiceLoopController bridges gateway client events to the app event bus | New module needed. Factory+interface pattern matches v1.0 conventions. Subscribes to `audio:recording-stop`, calls `gateway.sendVoiceTurn()`, forwards `onChunk` -> `bus.emit('gateway:chunk')` and `onStatusChange` -> `bus.emit('gateway:status')`. |
| LOOP-05 | bridge:audio-frame events forwarded to audioCapture.onFrame() for glasses-mode PCM recording | One-liner bus subscription: `bus.on('bridge:audio-frame', ({ pcm }) => audioCapture.onFrame(pcm))`. Must exist before first tap. |
| LOOP-06 | CLICK_EVENT SDK quirk handled so tap gestures work on real glasses hardware | SDK `fromJson` normalizes 0 to undefined. Fix: add `eventType === undefined` check in even-bridge.ts event mapping. Documented in community notes (nickustinov/even-g2-notes). |
| ERR-04 | Orphaned event types removed from AppEventMap | Remove `display:state-change`, `display:viewport-update`, `display:hide`, `display:wake`. No code emits or subscribes to these -- verified by codebase search. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @evenrealities/even_hub_sdk | ^0.0.7 | Even G2 bridge, SDK types, page containers | Required -- only way to communicate with glasses hardware |
| TypeScript | ^5.7.0 | Type safety, strict mode | Already configured, all modules use it |
| Vite | ^6.1.0 | Dev server, bundling | Already configured, handles module loading |
| Vitest | ^3.0.0 | Testing | Already configured, 240 passing tests |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | - | - | All dependencies for Phase 6 are already installed. No new npm packages needed. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual `flutter_inappwebview` detection | Try-catch around `waitForEvenAppBridge()` with timeout | Sibling demo apps use try-catch. Manual detection is more explicit and avoids uncertain timeout behavior. Use manual detection with try-catch as fallback. |
| VoiceLoopController as separate module | Inline wiring in glasses-main.ts | Separate module is testable, follows v1.0 patterns, isolates gateway-to-bus bridging logic |

**Installation:**
```bash
# No new dependencies needed for Phase 6
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── main.ts                    # Thin router: detect env, dynamic import correct entry
├── glasses-main.ts            # NEW: glasses runtime boot (Layer 0-5 init)
├── hub-main.ts                # EXTRACTED: existing companion hub code from current main.ts
├── voice-loop-controller.ts   # NEW: bridges gateway events <-> app event bus
├── events.ts                  # Existing event bus (no changes)
├── types.ts                   # Existing types (remove orphaned events)
├── app-wiring.ts              # Existing app wiring (no changes)
├── settings.ts                # Existing settings (no changes)
├── sessions.ts                # Existing sessions (no changes)
├── logs.ts                    # Existing logs (no changes)
├── utils.ts                   # Existing utils (no changes)
├── api/
│   └── gateway-client.ts      # Existing (no changes)
├── audio/
│   └── audio-capture.ts       # Existing (no changes)
├── bridge/
│   ├── bridge-types.ts        # Existing (no changes)
│   ├── bridge-mock.ts         # Existing (update keyboard shortcut for dev mode)
│   └── even-bridge.ts         # Existing (CLICK_EVENT quirk fix)
├── display/
│   ├── display-controller.ts  # Existing (minor: remove hint bar wiring per user decision)
│   ├── glasses-renderer.ts    # Existing (minor: remove hint container, add welcome msg)
│   ├── icon-animator.ts       # Existing (no changes)
│   ├── icon-bitmaps.ts        # Existing (no changes)
│   └── viewport.ts            # Existing (no changes)
└── gestures/
    ├── gesture-fsm.ts         # Existing (no changes needed, settle period via handler)
    └── gesture-handler.ts     # Existing (no changes needed)
```

### Pattern 1: Environment Detection and Code-Path Routing
**What:** Single `index.html` entry point with runtime detection that boots either glasses runtime or companion hub.
**When to use:** Always -- the EvenHub WebView and regular browsers both load the same URL.
**Example:**
```typescript
// src/main.ts -- thin router
async function main() {
  // Primary: check for SDK's flutter_inappwebview injection
  const isEvenApp = typeof (window as any).flutter_inappwebview !== 'undefined'
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
**Source:** Even Hub SDK source confirms `window.flutter_inappwebview` is the WebView marker. Sibling demo apps (even-g2-apps) use `waitForEvenAppBridge()` with try-catch as secondary detection. Architecture research recommends explicit detection.

### Pattern 2: Layered Initialization Sequence
**What:** Initialize modules in strict dependency order using numbered layers (0-5). Each layer completes before the next starts. async `init()` calls are awaited.
**When to use:** In `glasses-main.ts` boot function.
**Example:**
```typescript
// src/glasses-main.ts
export async function boot(): Promise<void> {
  // Layer 0: Foundation (no deps)
  const bus = createEventBus<AppEventMap>();
  const settings = loadSettings();
  const devMode = typeof (window as any).flutter_inappwebview === 'undefined';

  // Layer 1: Hardware boundary
  const bridge = devMode ? createBridgeMock(bus) : createEvenBridgeService(bus);
  await bridge.init();

  // Layer 2: Audio capture + PCM wiring
  const audioCapture = createAudioCapture(devMode);
  bus.on('bridge:audio-frame', ({ pcm }) => audioCapture.onFrame(pcm));

  // Layer 3: Gesture handling (subscribes to bus FIRST)
  const gestureHandler = createGestureHandler({
    bus, bridge, audioCapture,
    activeSessionId: () => settings.activeSession || 'gideon',
  });

  // Layer 4: Display pipeline (subscribes AFTER gesture handler)
  const renderer = createGlassesRenderer({ bridge, bus });
  const displayController = createDisplayController({
    bus, renderer, gestureHandler,
  });
  await displayController.init();

  // Layer 5: Gateway + voice loop
  const gateway = createGatewayClient();
  const voiceLoop = createVoiceLoopController({ bus, gateway, settings: () => settings });

  // Health check + heartbeat
  if (settings.gatewayUrl) {
    const healthy = await gateway.checkHealth(settings.gatewayUrl);
    if (healthy) {
      gateway.startHeartbeat(settings.gatewayUrl);
    }
    // Auto-retry handled by heartbeat system
  }
}
```
**Source:** Architecture research ARCHITECTURE.md, validated against display-controller.ts ordering constraint comment.

### Pattern 3: VoiceLoopController (Factory + Interface)
**What:** New module that subscribes to `audio:recording-stop` on the bus, sends the audio blob to the gateway, and forwards gateway chunks/status back to the bus.
**When to use:** Created in glasses-main.ts Layer 5.
**Example:**
```typescript
// src/voice-loop-controller.ts
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

  // Forward gateway chunks to the event bus
  unsubs.push(gateway.onChunk((chunk) => {
    bus.emit('gateway:chunk', chunk);
  }));

  // Forward gateway status to the event bus
  unsubs.push(gateway.onStatusChange((status) => {
    bus.emit('gateway:status', { status });
  }));

  // Listen for completed recordings and send to gateway
  unsubs.push(bus.on('audio:recording-stop', ({ sessionId, blob }) => {
    const s = settings();
    gateway.sendVoiceTurn(s, {
      sessionId,
      audio: blob,
      sttProvider: s.sttProvider,
    });
  }));

  function destroy(): void {
    for (const unsub of unsubs) unsub();
    unsubs.length = 0;
  }

  return { destroy };
}
```
**Source:** Follows v1.0 factory+interface pattern (gesture-handler.ts, display-controller.ts). Architecture research ARCHITECTURE.md lines 332-345.

### Pattern 4: Settle Period via Timestamp Guard
**What:** After `response_end`, record a settle timestamp. Gesture handler (or a wrapper) suppresses tap events within 500ms of the settle timestamp.
**When to use:** Prevents accidental double-trigger after AI response completes.
**Example:**
```typescript
// In glasses-main.ts or voice-loop-controller.ts
let lastResponseEndTs = 0;
bus.on('gateway:chunk', (chunk) => {
  if (chunk.type === 'response_end') {
    lastResponseEndTs = Date.now();
  }
});

// In the gesture handler's tap path (or a wrapper subscription)
// The gesture handler already has a 275ms debounce. Adding a settle check:
bus.on('gesture:tap', (payload) => {
  if (Date.now() - lastResponseEndTs < 500) {
    return; // Suppress during settle period
  }
  // ... normal tap processing
});
```
**Source:** User decision in CONTEXT.md. 275ms debounce already exists in gesture-handler.ts. The 500ms settle adds a second guard layer.

### Anti-Patterns to Avoid
- **Calling `waitForEvenAppBridge()` in a regular browser without detection first:** The SDK waits for `flutter_inappwebview` to inject the bridge. In a regular browser, this may hang indefinitely as a never-resolving Promise. Always detect environment before calling SDK init methods.
- **Initializing display controller before gesture handler:** The event bus dispatches synchronously in registration order. If display controller subscribes first, it reads stale gesture state when updating hints.
- **Creating gateway client with settings reference instead of getter:** Settings may change (user updates gateway URL). Pass `settings: () => AppSettings` to get current values at call time.
- **Forgetting `bridge:audio-frame` -> `audioCapture.onFrame()` subscription:** Without this, glasses-mode PCM recording silently produces empty blobs. The subscription is a one-liner but must exist before the first tap.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebView detection | Custom user-agent parsing | Check `window.flutter_inappwebview` | The SDK injects this specific global. User-agent strings are unreliable and vary across iOS versions. |
| Tap/double-tap disambiguation | Timer-based double-click detection | Use `OsEventTypeList.CLICK_EVENT` vs `DOUBLE_CLICK_EVENT` from SDK | The G2 firmware already disambiguates at the hardware level. Only a debounce guard is needed (already built). |
| SSE parsing | Custom parser from scratch | Use existing `parseSSELines()` in `gateway-client.ts` | Already built and tested. Handles `\r\n` line endings, multi-line data fields, comments. |
| Module lifecycle cleanup | Manual cleanup tracking | Use the `unsubs[]` array pattern from gesture-handler.ts | Already established pattern across all v1.0 modules. Prevents memory leaks. |
| Gateway health monitoring | Custom polling loop | Use existing `gateway.startHeartbeat()` | Already built with configurable interval and auto-status transitions. |

**Key insight:** Phase 6 is an assembly phase, not a building phase. Every component exists. The work is wiring and sequencing, not creating new algorithmic solutions.

## Common Pitfalls

### Pitfall 1: CLICK_EVENT Value 0 Normalized to undefined
**What goes wrong:** Tap gestures work in dev mode (mock bridge emits `gesture:tap` directly from keyboard) but silently fail on real glasses hardware. No error, no feedback -- taps are just ignored.
**Why it happens:** The SDK's `OsEventTypeList.fromJson()` normalizes the numeric value `0` to `undefined` during JSON deserialization. Since `CLICK_EVENT = 0`, the eventType for tap events becomes `undefined` on real hardware. The current code checks `eventType === OsEventTypeList.CLICK_EVENT` which compares against `0`, but `undefined !== 0`, so the tap is dropped.
**How to avoid:** Add a defensive check:
```typescript
// In even-bridge.ts onEvenHubEvent handler:
if (eventType === OsEventTypeList.CLICK_EVENT || eventType === undefined) {
  bus.emit('gesture:tap', { timestamp: now });
}
```
**Warning signs:** All tests pass. Dev mode keyboard shortcuts work. But taps do nothing when running on actual glasses through the Even App.

### Pitfall 2: waitForEvenAppBridge() Hangs in Regular Browser
**What goes wrong:** If `waitForEvenAppBridge()` is called in a regular browser (no Even App WebView), it may wait indefinitely for the bridge injection that never comes. The app appears to freeze.
**Why it happens:** The SDK listens for a `evenAppBridgeReady` window event and checks for `flutter_inappwebview`. In a regular browser, neither exists. The SDK has a fallback timeout (setTimeout after 100ms per the d.ts comments) but behavior is not guaranteed to reject cleanly.
**How to avoid:** Detect the environment BEFORE calling any SDK methods. Only call `createEvenBridgeService(bus)` and `bridge.init()` when `flutter_inappwebview` is detected. In browser mode, use `createBridgeMock(bus)`.
**Warning signs:** App loads in browser but never renders. No errors in console. The Promise from `waitForEvenAppBridge()` never resolves or rejects.

### Pitfall 3: Module Init Order Race Condition
**What goes wrong:** A tap event arrives before the display controller is initialized, causing the icon state update to fail silently. Or an audio frame arrives before the `bridge:audio-frame` -> `audioCapture.onFrame()` subscription exists.
**Why it happens:** The bridge starts emitting events as soon as `bridge.init()` completes (Layer 1). If the audio frame subscription (Layer 2) or gesture handler (Layer 3) is not yet registered, events are emitted to no listeners.
**How to avoid:** Follow the strict Layer 0-5 initialization sequence. Each layer must fully complete before the next starts. Use `await` on all async init calls.
**Warning signs:** First tap after boot is dropped. First few seconds of audio frames are lost (recording starts with silence).

### Pitfall 4: Startup Page Container Overwritten by Renderer
**What goes wrong:** The bridge's `init()` creates a 1-container startup layout. The renderer's `init()` calls `rebuildPageContainer` to create a 3-container chat layout. If there is a flicker or race between these two calls, the user sees a momentary blank display.
**Why it happens:** Both operations write to the glasses display. The bridge startup layout is immediately replaced by the renderer's chat layout.
**How to avoid:** This is expected behavior -- the transition should be near-instant (bridge init in Layer 1, renderer init in Layer 4). The boot indicator (icon animation or "connecting..." text) should be shown in the startup layout and replaced by the chat layout when the renderer initializes.
**Warning signs:** Brief black flash on glasses display during boot. Usually imperceptible but can be jarring on slow Bluetooth connections.

### Pitfall 5: Settings Not Available for Gateway Health Check
**What goes wrong:** The boot sequence tries to ping the gateway health endpoint, but `settings.gatewayUrl` is empty because the user hasn't configured it yet.
**Why it happens:** Fresh install with no localStorage data. Or user cleared browser/WebView storage.
**How to avoid:** Check `settings.gatewayUrl` before attempting health check. If empty, show the "Open companion app to configure" blocking message (per user decision). Do NOT attempt health check or allow voice turns.
**Warning signs:** Fetch error to `undefined/health` or empty string URL. Gateway health shows "connecting" forever.

### Pitfall 6: eventType from Different Event Sources
**What goes wrong:** On real hardware, tap events may arrive as `textEvent` (if text container has `isEventCapture: 1`) or `listEvent` (if list container has capture), not just `sysEvent`. Code that only checks one event source misses taps.
**Why it happens:** The event source depends on which container has `isEventCapture: 1`. The current even-bridge.ts correctly checks all three sources (`event.listEvent?.eventType ?? event.textEvent?.eventType ?? event.sysEvent?.eventType`).
**How to avoid:** Keep the existing triple-source eventType extraction. Do not simplify to checking only one event type.
**Warning signs:** Taps work in simulator but not on real glasses, or only work in certain display states.

## Code Examples

### CLICK_EVENT Quirk Fix
```typescript
// In src/bridge/even-bridge.ts, inside the onEvenHubEvent handler:
// BEFORE (broken on real hardware):
switch (eventType) {
  case OsEventTypeList.CLICK_EVENT:
    bus.emit('gesture:tap', { timestamp: now });
    break;
  // ...
}

// AFTER (works on real hardware):
// Handle CLICK_EVENT quirk: SDK fromJson normalizes 0 to undefined
if (eventType === OsEventTypeList.CLICK_EVENT || eventType === undefined) {
  bus.emit('gesture:tap', { timestamp: now });
} else {
  switch (eventType) {
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      bus.emit('gesture:double-tap', { timestamp: now });
      break;
    case OsEventTypeList.SCROLL_TOP_EVENT:
      bus.emit('gesture:scroll-up', { timestamp: now });
      break;
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      bus.emit('gesture:scroll-down', { timestamp: now });
      break;
  }
}
```
**Source:** nickustinov/even-g2-notes G2.md, SDK `OsEventTypeList.fromJson` behavior, verified in SDK dist/index.d.ts enum definition (`CLICK_EVENT = 0`).

### Orphaned Event Type Removal
```typescript
// In src/types.ts, REMOVE these 4 entries from AppEventMap:
// 'display:state-change': { state: IconState };
// 'display:viewport-update': { text: string };
// 'display:hide': Record<string, never>;
// 'display:wake': Record<string, never>;

// KEEP all remaining entries -- they are actively used.
```
**Source:** Codebase search confirms no module emits or subscribes to these events. They were planned during v1.0 but superseded by direct renderer method calls.

### Dev Mode Keyboard Shortcut for Tap
```typescript
// In src/bridge/bridge-mock.ts, update KEY_MAP:
const KEY_MAP: Record<string, keyof AppEventMap> = {
  ' ': 'gesture:tap',          // Spacebar = tap (toggle recording)
  d: 'gesture:double-tap',     // D = double-tap
  ArrowUp: 'gesture:scroll-up',
  ArrowDown: 'gesture:scroll-down',
};
```
**Source:** User decision: "spacebar is a natural choice". Toggle mode mirrors actual glasses tap-tap gesture. The existing KEY_MAP uses `t` for tap -- spacebar is more ergonomic and natural for a recording toggle.

### Welcome Message on Boot
```typescript
// After displayController.init() completes:
renderer.addUserMessage(''); // No user message yet
// Show welcome in chat area:
// Option A: Use a dedicated method on renderer
// Option B: Show as initial hint text (but user said no hints!)
// Option C: Use a simple text container upgrade for the "Tap to ask" message
bridge.textContainerUpgrade(2, 'Tap to ask');
// This renders in the chat container. After first voice turn, normal
// chat bubbles replace it.
```

### Turn Buffer Limit
```typescript
// In glasses-renderer.ts or viewport.ts, trim old turns:
const MAX_TURNS = 8; // ~8 turn pairs (16 messages) keeps memory reasonable
// on G2's 576x288 display with 1800-char viewport limit

// Before rendering, trim from the front:
while (viewport.messages.length > MAX_TURNS * 2) {
  viewport.messages.shift();
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Monolithic main.ts with all UI + state + wiring | Split into hub-main.ts (companion) and glasses-main.ts (runtime) | Phase 6 | Enables independent code paths for WebView and browser |
| Mock bridge keyboard: `t` key for tap | Spacebar for tap (toggle recording) | Phase 6 | More ergonomic, mirrors natural recording gesture |
| No VoiceLoopController (gateway wiring inline) | Dedicated VoiceLoopController module | Phase 6 | Testable, follows factory+interface convention, isolates gateway bridging |
| 4 orphaned event types in AppEventMap | Removed | Phase 6 | Cleaner type surface, no dead code |

**Deprecated/outdated:**
- `display:state-change`, `display:viewport-update`, `display:hide`, `display:wake` event types: Superseded by direct renderer method calls in display-controller.ts. Remove in this phase.
- `t` key for tap in bridge mock: Replace with spacebar for ergonomic dev mode. Keep `d` for double-tap.

## Open Questions

1. **waitForEvenAppBridge() rejection behavior**
   - What we know: The SDK checks `window.flutter_inappwebview` and listens for `evenAppBridgeReady`. The d.ts comments mention a 100ms retry. Sibling demo apps use try-catch.
   - What's unclear: Whether the Promise rejects, resolves with null, or hangs indefinitely in a regular browser without a WebView.
   - Recommendation: Use explicit `flutter_inappwebview` detection before calling any SDK methods. This makes the behavior deterministic regardless of SDK timeout behavior.

2. **Glasses display startup layout vs chat layout transition**
   - What we know: Bridge `init()` creates a 1-container startup layout (576x288 single text container). Renderer `init()` calls `rebuildPageContainer` with 3-container chat layout. Both are async.
   - What's unclear: Whether there is a visible flicker between the two layouts on real hardware.
   - Recommendation: Show boot indicator text ("Connecting..." or icon animation) in the startup 1-container layout. The renderer's `rebuildPageContainer` call will seamlessly replace it. If flicker is observed on real hardware, investigate adding a brief delay.

3. **Settle period interaction with FSM debounce**
   - What we know: The gesture handler already has a 275ms tap debounce. The user wants a 500ms settle after response_end.
   - What's unclear: Whether the settle period should be in the gesture handler (modifying its debounce window temporarily), in a bus subscription wrapper, or in the VoiceLoopController.
   - Recommendation: Implement as a separate timestamp guard in the glasses-main.ts boot wiring (subscribe to `gesture:tap` at a higher priority than gesture handler, suppress if within settle window). This avoids modifying the tested gesture-handler.ts module. Alternatively, the VoiceLoopController can set a flag that the gesture handler checks.

## Sources

### Primary (HIGH confidence)
- Even Hub SDK dist/index.d.ts -- `OsEventTypeList` enum definition (`CLICK_EVENT = 0`), `waitForEvenAppBridge` signature, BridgeService interface
- Even Hub SDK dist/index.js -- `window.flutter_inappwebview` detection in SDK source code
- Even Hub SDK README.md -- `createStartUpPageContainer` must be called first, `audioControl` prerequisite, event listening patterns, text container 2000-char limit
- v1.0 codebase source files -- All module APIs, dependency signatures, factory patterns, bus subscription patterns
- `.planning/research/ARCHITECTURE.md` -- Validated initialization sequence (Layers 0-5), dependency constraints, dev mode detection, VoiceLoopController pattern
- `.planning/research/FEATURES.md` -- CLICK_EVENT quirk documentation, feature dependency graph, initialization order

### Secondary (MEDIUM confidence)
- nickustinov/even-g2-notes G2.md (via GitHub raw) -- CLICK_EVENT normalization quirk (`0` -> `undefined`), event source routing (list vs text vs sys), scroll throttling guidance, simulator vs real hardware divergence
- Sibling app patterns (even-g2-apps/apps/demo/src/main.ts) -- `waitForEvenAppBridge()` with try-catch pattern for environment detection, `initializeBridge` async function structure

### Tertiary (LOW confidence)
- `waitForEvenAppBridge()` timeout behavior -- Only deduced from d.ts comments and SDK source (obfuscated). Not verified with actual hardware or official documentation. Mitigated by using explicit detection.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies, all modules exist and are tested
- Architecture: HIGH - Initialization sequence validated against module source code and existing research
- Pitfalls: HIGH for CLICK_EVENT (documented in community notes, verified in SDK source), MEDIUM for waitForEvenAppBridge timeout (deduced, not officially documented)

**Research date:** 2026-02-28
**Valid until:** 2026-03-30 (stable -- all dependencies are pinned, SDK is at 0.0.7, patterns are established)
