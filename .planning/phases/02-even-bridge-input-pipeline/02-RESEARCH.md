# Phase 2: Even Bridge & Input Pipeline - Research

**Researched:** 2026-02-28
**Domain:** Even G2 SDK bridge integration, gesture FSM, audio capture via WebView bridge
**Confidence:** HIGH — SDK types verified from official npm package `@evenrealities/even_hub_sdk@0.0.7` (downloaded and inspected). Event names, audio format, and bridge lifecycle confirmed from authoritative source.

---

## Summary

Phase 2 builds the hardware abstraction layer between the Even G2 glasses and the rest of the application. The critical insight from the SDK source is that gesture events do NOT arrive as raw tap/double-tap primitives — they arrive as `OsEventTypeList` enum values (`CLICK_EVENT = 0`, `DOUBLE_CLICK_EVENT = 3`, `SCROLL_TOP_EVENT = 1`, `SCROLL_BOTTOM_EVENT = 2`) delivered through a single `onEvenHubEvent` callback. The bridge must translate these into the typed app-domain events (`gesture:tap`, `gesture:double-tap`, etc.) and place them on the existing `AppEventMap` event bus.

The audio pipeline is straightforward but has a critical prerequisite: `createStartUpPageContainer` must succeed before `audioControl(true)` will work. Audio arrives as `Uint8Array` PCM frames (16kHz, 40 bytes/frame, 10ms per frame, little-endian) via `event.audioEvent.audioPcm`. In dev mode (no glasses connected), the browser's `MediaRecorder` API provides a fallback path for microphone access. Audio is buffered client-side until the user taps to stop, then sent as a single `Blob` to the gateway.

The tap/double-tap disambiguation is the most novel problem in this phase. The SDK delivers `CLICK_EVENT` (0) and `DOUBLE_CLICK_EVENT` (3) as distinct events — the firmware handles the disambiguation timing internally and delivers the correct event type. This means a 250-300ms software debounce window is needed only to prevent the rapid-fire tap that starts recording from also being interpreted as double-tap by the app FSM. The FSM design must be pure-function (no side effects) to remain testable without the SDK.

**Primary recommendation:** Install `@evenrealities/even_hub_sdk@0.0.7`, build `src/bridge/even-bridge.ts` as a singleton service wrapping `waitForEvenAppBridge()`, map `OsEventTypeList` events to the existing `AppEventMap` event bus, and implement the gesture FSM as a pure state-transition table testable without hardware.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BRDG-01 | EvenBridge service wraps SDK initialization, lifecycle, and teardown | `waitForEvenAppBridge()` + `shutDownPageContainer()` + `createStartUpPageContainer()` must be sequenced correctly. Singleton pattern. |
| BRDG-02 | Bridge events dispatched via typed event bus (no direct bridge.* calls from UI) | Existing `createEventBus<AppEventMap>()` in `src/events.ts` is already typed and ready. Bridge maps SDK events to bus emissions. |
| BRDG-03 | Development fallback mode enables building/testing without physical glasses connected | `waitForEvenAppBridge()` throws/hangs outside EvenHub WebView. Need a mock bridge that simulates SDK events for browser dev mode. |
| GEST-01 | Tap gesture maps to start/stop voice recording | `OsEventTypeList.CLICK_EVENT = 0` in `listEvent` or `textEvent`. FSM maps tap→START_RECORDING or STOP_RECORDING based on current state. |
| GEST-02 | Double-tap gesture maps to menu/wake toggle | `OsEventTypeList.DOUBLE_CLICK_EVENT = 3`. Firmware distinguishes from single tap — delivers the correct enum value. |
| GEST-03 | Scroll-up gesture maps to conversation history scroll up | `OsEventTypeList.SCROLL_TOP_EVENT = 1` — fires when user reaches top boundary of the event-capture container. |
| GEST-04 | Scroll-down gesture maps to scroll down / jump to latest | `OsEventTypeList.SCROLL_BOTTOM_EVENT = 2` — fires when user reaches bottom boundary of event-capture container. |
| GEST-05 | Tap vs double-tap disambiguation uses 250-300ms debounce window in FSM | SDK provides distinct event types already. Debounce in FSM guards against rapid CLICK→DOUBLE_CLICK race during recording start. |
| GEST-06 | Gesture hint bar displayed on glasses when contextually relevant | Implemented via `textContainerUpgrade()` on a dedicated hint-bar text container (e.g., containerID=3, bottom row of glasses layout). |
| VOICE-01 | User can tap to start voice recording on glasses | FSM transitions IDLE→RECORDING on tap, calls `bridge.audioControl(true)`. |
| VOICE-02 | User can tap again to stop voice recording | FSM transitions RECORDING→SENT on tap, calls `bridge.audioControl(false)`. |
| VOICE-03 | Audio is captured from glasses microphone via Even SDK bridge events | `event.audioEvent.audioPcm` (Uint8Array, 16kHz, 40 bytes/frame). Buffered in `AudioCapture` service. |
| VOICE-04 | Captured audio is buffered and sent to backend gateway for STT processing | Buffer grows during recording, on stop → `new Blob([...frames], { type: 'audio/webm' })` sent via `GatewayClient.sendVoiceTurn()`. |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@evenrealities/even_hub_sdk` | `^0.0.7` | Official Even Hub SDK — bridge init, container lifecycle, gesture events, audio control | The only official SDK. Provides `waitForEvenAppBridge()`, `EvenAppBridge`, all typed models. |
| Vitest | `^3.0.0` (already installed) | Unit testing gesture FSM, audio buffer, bridge mock | Already in project. Pure FSM functions are fully testable. |
| TypeScript | `^5.7.0` (already installed) | Type safety across bridge types | Already in project with strict mode. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Browser `MediaRecorder` API | Native | Dev-mode audio capture from device microphone (browser fallback) | When glasses are not connected and `BRDG-03` dev mode is active. |
| Browser `Web Audio API` (`AudioContext`) | Native | PCM frame reassembly for playback testing in dev mode | Optional: useful for verifying audio buffer correctness without glasses. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@evenrealities/even_hub_sdk` | Raw `window._listenEvenAppMessage` parsing | SDK handles message format compatibility across versions and normalizes PB field naming. Never bypass it. |
| Pure FSM state table | XState | XState is 50KB+ overhead for a 4-input FSM. The existing project pattern (pure functions, factory pattern) favors hand-rolled FSM. Don't add XState. |
| Browser MediaRecorder (dev fallback) | getUserMedia + ScriptProcessor | MediaRecorder is the modern, high-level API. ScriptProcessor is deprecated. |

**Installation:**
```bash
npm install @evenrealities/even_hub_sdk
```

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── bridge/
│   ├── even-bridge.ts        # EvenBridge service (singleton, wraps SDK)
│   ├── bridge-mock.ts        # Dev-mode mock bridge (BRDG-03)
│   └── bridge-types.ts       # Shared bridge interface type
├── gestures/
│   ├── gesture-fsm.ts        # Pure FSM: OsEventTypeList → GestureAction
│   └── gesture-handler.ts    # Wires bridge events → FSM → event bus emissions
├── audio/
│   └── audio-capture.ts      # PCM frame buffer + glasses/browser fallback
├── events.ts                 # Already exists — AppEventMap event bus
└── types.ts                  # Already exists — extend AppEventMap if needed
```

### Pattern 1: EvenBridge Singleton Service

**What:** A single module that owns the SDK bridge instance, manages the full lifecycle, and translates SDK events into typed `AppEventMap` bus emissions. No other module ever calls `bridge.*` directly.

**When to use:** Always. The SDK bridge is a singleton by design (`EvenAppBridge.getInstance()`). Only one module should own it.

**Critical lifecycle constraint:** `createStartUpPageContainer()` MUST succeed before `audioControl()` will work. The bridge must sequence these in init.

**Example:**
```typescript
// src/bridge/even-bridge.ts
import { waitForEvenAppBridge, OsEventTypeList } from '@evenrealities/even_hub_sdk';
import type { EvenAppBridge, CreateStartUpPageContainer } from '@evenrealities/even_hub_sdk';
import type { EventBus } from '../events';
import type { AppEventMap } from '../types';

export interface EvenBridgeService {
  init(): Promise<void>;
  destroy(): Promise<void>;
  startAudio(): Promise<boolean>;
  stopAudio(): Promise<boolean>;
}

// Phase 2 minimal startup layout — one text container with event capture
const STARTUP_LAYOUT: CreateStartUpPageContainer = {
  containerTotalNum: 1,
  textObject: [{
    xPosition: 0, yPosition: 0,
    width: 576, height: 288,
    containerID: 1, containerName: 'main',
    isEventCapture: 1,
    content: '',
  }],
};

export function createEvenBridgeService(bus: EventBus<AppEventMap>): EvenBridgeService {
  let bridge: EvenAppBridge | null = null;
  let unsubEvent: (() => void) | null = null;
  let unsubStatus: (() => void) | null = null;

  async function init(): Promise<void> {
    bridge = await waitForEvenAppBridge();

    // Must create page before audio control works
    await bridge.createStartUpPageContainer(STARTUP_LAYOUT);

    unsubStatus = bridge.onDeviceStatusChanged((status) => {
      if (status.isConnected()) {
        bus.emit('bridge:connected', { deviceName: 'Even G2' });
      } else if (status.isDisconnected()) {
        bus.emit('bridge:disconnected', { reason: status.connectType });
      }
    });

    unsubEvent = bridge.onEvenHubEvent((event) => {
      const now = Date.now();
      if (event.audioEvent) {
        // Forwarded to AudioCapture via separate subscription
        bus.emit('bridge:audio-frame' as any, { pcm: event.audioEvent.audioPcm, timestamp: now });
      }
      const eventType = event.listEvent?.eventType ?? event.textEvent?.eventType ?? event.sysEvent?.eventType;
      if (eventType === undefined) return;
      switch (eventType) {
        case OsEventTypeList.CLICK_EVENT:
          bus.emit('gesture:tap', { timestamp: now }); break;
        case OsEventTypeList.DOUBLE_CLICK_EVENT:
          bus.emit('gesture:double-tap', { timestamp: now }); break;
        case OsEventTypeList.SCROLL_TOP_EVENT:
          bus.emit('gesture:scroll-up', { timestamp: now }); break;
        case OsEventTypeList.SCROLL_BOTTOM_EVENT:
          bus.emit('gesture:scroll-down', { timestamp: now }); break;
      }
    });
  }

  async function destroy(): Promise<void> {
    unsubEvent?.();
    unsubStatus?.();
    await bridge?.shutDownPageContainer(0);
    bridge = null;
  }

  async function startAudio(): Promise<boolean> {
    return bridge?.audioControl(true) ?? false;
  }

  async function stopAudio(): Promise<boolean> {
    return bridge?.audioControl(false) ?? false;
  }

  return { init, destroy, startAudio, stopAudio };
}
```

### Pattern 2: Pure Gesture FSM

**What:** A pure-function state transition table mapping `(currentState, inputEvent) → { nextState, action }`. No side effects inside the FSM — callers handle the actions.

**When to use:** Handling all 4 gesture types with tap/double-tap disambiguation.

**Key insight from SDK:** The SDK already disambiguates `CLICK_EVENT` vs `DOUBLE_CLICK_EVENT` at the firmware level. The FSM just needs to guard against a CLICK_EVENT arriving during the debounce window right after a state transition.

**Example:**
```typescript
// src/gestures/gesture-fsm.ts

export type GestureState = 'idle' | 'recording' | 'sent' | 'thinking' | 'menu';
export type GestureInput = 'tap' | 'double-tap' | 'scroll-up' | 'scroll-down';
export type GestureAction =
  | { type: 'START_RECORDING' }
  | { type: 'STOP_RECORDING' }
  | { type: 'TOGGLE_MENU' }
  | { type: 'SCROLL_UP' }
  | { type: 'SCROLL_DOWN' }
  | null;

export interface GestureTransition {
  nextState: GestureState;
  action: GestureAction;
}

const TRANSITIONS: Record<GestureState, Partial<Record<GestureInput, GestureTransition>>> = {
  idle: {
    'tap':        { nextState: 'recording', action: { type: 'START_RECORDING' } },
    'double-tap': { nextState: 'menu',      action: { type: 'TOGGLE_MENU' } },
    'scroll-up':  { nextState: 'idle',      action: { type: 'SCROLL_UP' } },
    'scroll-down':{ nextState: 'idle',      action: { type: 'SCROLL_DOWN' } },
  },
  recording: {
    'tap':        { nextState: 'sent',  action: { type: 'STOP_RECORDING' } },
    // double-tap, scroll ignored during recording
  },
  sent: {
    // Inputs ignored while audio is being processed (auto-transitions to thinking)
  },
  thinking: {
    'double-tap': { nextState: 'menu', action: { type: 'TOGGLE_MENU' } },
    // tap/scroll ignored during thinking
  },
  menu: {
    'double-tap': { nextState: 'idle', action: { type: 'TOGGLE_MENU' } },
    'tap':        { nextState: 'idle', action: null }, // dismiss
    'scroll-up':  { nextState: 'menu', action: { type: 'SCROLL_UP' } },
    'scroll-down':{ nextState: 'menu', action: { type: 'SCROLL_DOWN' } },
  },
};

export function gestureTransition(
  state: GestureState,
  input: GestureInput,
): GestureTransition {
  return TRANSITIONS[state]?.[input] ?? { nextState: state, action: null };
}
```

### Pattern 3: Tap/Double-Tap Debounce Guard

**What:** A 250ms debounce window implemented in the gesture handler (not the FSM) that suppresses a `tap` event if it arrives within 250ms of a state transition that began from a `tap`.

**Why needed:** The SDK delivers `CLICK_EVENT` and `DOUBLE_CLICK_EVENT` as separate events, but a double-tap physically produces a `CLICK_EVENT` first, then a short pause, then `DOUBLE_CLICK_EVENT`. Without the guard, the FSM could transition on the first `CLICK_EVENT`, then receive `DOUBLE_CLICK_EVENT` in the wrong state.

**Note:** The SDK fires `DOUBLE_CLICK_EVENT` (3) as a distinct event — it does NOT fire two sequential `CLICK_EVENT`s for a double-tap. The debounce prevents the initial single click from advancing FSM state before the double-click confirmation arrives.

**Example:**
```typescript
// src/gestures/gesture-handler.ts
const DEBOUNCE_MS = 275; // middle of 250-300ms range

export function createGestureHandler(bus: EventBus<AppEventMap>) {
  let state: GestureState = 'idle';
  let lastTapTs = 0;

  function handleInput(input: GestureInput, timestamp: number): void {
    // Debounce: ignore tap if double-tap could still arrive
    if (input === 'tap' && (timestamp - lastTapTs) < DEBOUNCE_MS) {
      return;
    }
    if (input === 'tap') lastTapTs = timestamp;

    const { nextState, action } = gestureTransition(state, input);
    state = nextState;
    if (action) dispatchAction(action);
  }

  // Wire to bus
  bus.on('gesture:tap',         (p) => handleInput('tap', p.timestamp));
  bus.on('gesture:double-tap',  (p) => handleInput('double-tap', p.timestamp));
  bus.on('gesture:scroll-up',   (p) => handleInput('scroll-up', p.timestamp));
  bus.on('gesture:scroll-down', (p) => handleInput('scroll-down', p.timestamp));
}
```

### Pattern 4: Audio Capture Service with Dev Fallback

**What:** A service that accepts raw PCM frames from the bridge (glasses mode) or captures audio via `MediaRecorder` (browser dev mode), buffers until stop, then emits a `Blob`.

**Dev mode detection:** Check if `window.EvenAppBridge` is defined — if not, fall back to `MediaRecorder`. This satisfies BRDG-03 without complicating the bridge module.

**Example:**
```typescript
// src/audio/audio-capture.ts

export interface AudioCapture {
  startRecording(sessionId: string): void;
  stopRecording(): Promise<Blob>;
  onFrame(pcm: Uint8Array): void; // Called by bridge in glasses mode
}

export function createAudioCapture(devMode: boolean): AudioCapture {
  const frames: Uint8Array[] = [];
  let mediaRecorder: MediaRecorder | null = null;
  let mediaChunks: Blob[] = [];

  function startRecording(sessionId: string): void {
    frames.length = 0;
    if (devMode) {
      // Browser microphone fallback
      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        mediaRecorder = new MediaRecorder(stream);
        mediaChunks = [];
        mediaRecorder.ondataavailable = (e) => mediaChunks.push(e.data);
        mediaRecorder.start(100); // 100ms chunks
      });
    }
  }

  function onFrame(pcm: Uint8Array): void {
    if (!devMode) frames.push(pcm);
  }

  async function stopRecording(): Promise<Blob> {
    if (devMode && mediaRecorder) {
      return new Promise((resolve) => {
        mediaRecorder!.onstop = () => {
          resolve(new Blob(mediaChunks, { type: 'audio/webm' }));
        };
        mediaRecorder!.stop();
        mediaRecorder!.stream.getTracks().forEach((t) => t.stop());
      });
    }
    // Glasses mode: concatenate PCM frames
    const totalLen = frames.reduce((sum, f) => sum + f.length, 0);
    const buffer = new Uint8Array(totalLen);
    let offset = 0;
    for (const frame of frames) {
      buffer.set(frame, offset);
      offset += frame.length;
    }
    return new Blob([buffer], { type: 'audio/pcm' });
  }

  return { startRecording, stopRecording, onFrame };
}
```

### Pattern 5: Bridge Mock for Dev Mode (BRDG-03)

**What:** A module that simulates the SDK bridge in browser dev environments, allowing the gesture handler and audio capture to be exercised without physical glasses.

**Example:**
```typescript
// src/bridge/bridge-mock.ts

export function createBridgeMock(bus: EventBus<AppEventMap>) {
  // Expose keyboard shortcuts for manual testing
  window.addEventListener('keydown', (e) => {
    const now = Date.now();
    if (e.key === 't') bus.emit('gesture:tap', { timestamp: now });
    if (e.key === 'd') bus.emit('gesture:double-tap', { timestamp: now });
    if (e.key === 'ArrowUp') bus.emit('gesture:scroll-up', { timestamp: now });
    if (e.key === 'ArrowDown') bus.emit('gesture:scroll-down', { timestamp: now });
  });
  console.info('[BridgeMock] Keyboard shortcuts active: T=tap, D=double-tap, ↑/↓=scroll');
}
```

### Anti-Patterns to Avoid

- **Direct bridge calls from UI components:** Any module calling `bridge.audioControl()` or `bridge.onEvenHubEvent()` outside of `even-bridge.ts` creates lifecycle race conditions and bypasses the typed event bus contract.
- **Calling `audioControl(true)` before `createStartUpPageContainer` succeeds:** The SDK requires the page container to exist first. The bridge service init must await the container creation before exposing `startAudio()`.
- **Calling `createStartUpPageContainer` more than once:** The SDK ignores subsequent calls. All layout changes after initial boot must use `rebuildPageContainer()`. The bridge must track whether it has been initialized.
- **Per-PCM-frame async operations:** The audio event fires at ~100Hz (40 bytes/frame at 16kHz). Do not await anything in the audio event handler — push frames to a synchronous buffer only.
- **Assuming `SCROLL_TOP_EVENT` = scroll-up gesture:** The SDK fires `SCROLL_TOP_EVENT` when the text content REACHES its top boundary (user has scrolled up to the top). Map this to the app's scroll-up action, but understand it is a boundary event, not a raw gesture event. It will not fire if the content is short enough to not require scrolling.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bridge message parsing | Custom WebView message parser | `@evenrealities/even_hub_sdk` | The SDK handles multiple host message formats (`{type,jsonData}`, `{type,data}`, `[type,jsonData]`) and normalizes PB field naming (camelCase vs proto_name). Hand-rolling this will break on SDK updates. |
| Tap/double-tap disambiguation | Timer-based disambiguation from scratch | SDK `OsEventTypeList.DOUBLE_CLICK_EVENT` + FSM debounce guard | The firmware already disambiguates. Only a debounce guard is needed, not a full timer-based detection system. |
| Audio format conversion | PCM-to-WebM encoder | Send raw PCM `Blob` to gateway | The gateway performs STT — send the audio in whatever format the gateway accepts. Raw PCM Blob from frames is fine; WebM from MediaRecorder is fine for dev mode. |

**Key insight:** The Even Hub SDK does the heavy lifting of protobuf/JSON normalization, bridge lifecycle management, and event routing. The application layer's job is only to react to typed events and dispatch typed commands.

---

## Common Pitfalls

### Pitfall 1: `waitForEvenAppBridge()` Hangs Outside WebView

**What goes wrong:** `waitForEvenAppBridge()` waits for the `evenAppBridgeReady` DOM event, which is only fired by the Even App iOS host. In a regular browser it hangs indefinitely.

**Why it happens:** The bridge checks `window._listenEvenAppMessage` which is injected by `flutter_inappwebview`. This global is absent in a regular browser.

**How to avoid:** Detect dev mode before calling `waitForEvenAppBridge()`. Use a timeout or an env variable check:
```typescript
const isEvenHub = typeof (window as any)._listenEvenAppMessage === 'function'
  || typeof (window as any).flutter_inappwebview !== 'undefined';

if (isEvenHub) {
  await evenBridge.init();
} else {
  createBridgeMock(bus);
}
```

**Warning signs:** App freezes on load with no error messages in a regular browser.

### Pitfall 2: Audio Control Fails Silently Without Page Container

**What goes wrong:** `bridge.audioControl(true)` returns `false` (failure) with no thrown error. Recording appears to start but no audio frames arrive.

**Why it happens:** The SDK's audio control requires a page container to be active. The prerequisite is documented but easy to miss.

**How to avoid:** The `EvenBridgeService.init()` must await `createStartUpPageContainer()` before returning. The `startAudio()` method should assert that the bridge is initialized.

**Warning signs:** `audioControl()` returns `false`, no `audioEvent` payloads ever arrive in `onEvenHubEvent`.

### Pitfall 3: `SCROLL_TOP_EVENT` / `SCROLL_BOTTOM_EVENT` Are Boundary Events, Not Continuous Gestures

**What goes wrong:** Developer maps scroll events to continuous history paging but the events only fire once when the boundary is reached, not repeatedly as the user scrolls.

**Why it happens:** The SDK fires these events when the text container's internal scroll reaches the top or bottom boundary. If the current content fits within the visible height, no scroll events fire at all.

**How to avoid:** Phase 2 establishes the event mapping (scroll-up → `gesture:scroll-up`). Phase 3 will handle the display-side implications. For Phase 2, just emit the typed event. Document the boundary-event semantics in the gesture handler code.

### Pitfall 4: Container Name Length Limit

**What goes wrong:** `textContainerUpgrade()` silently fails if `containerName` exceeds 16 characters.

**Why it happens:** The SDK enforces a 16-character limit on `containerName` (documented in TypeScript types but easy to miss).

**How to avoid:** Keep all container names to ≤16 characters: `'main'`, `'status'`, `'chat'`, `'hint'`.

### Pitfall 5: Double-unsubscribe From Bridge Events on Destroy

**What goes wrong:** Calling `destroy()` after the bridge has already been torn down throws because unsubscribe functions are called twice.

**Why it happens:** The SDK's `onEvenHubEvent` returns an unsubscribe function. If `destroy()` is called twice, the same function is called twice.

**How to avoid:** Use the idempotent-unsubscribe pattern already in the project's event bus — call `unsubEvent?.(); unsubEvent = null;` in destroy.

---

## Code Examples

### Installing and Importing the SDK

```typescript
// Source: @evenrealities/even_hub_sdk@0.0.7 dist/index.d.ts
import {
  waitForEvenAppBridge,
  OsEventTypeList,
  DeviceConnectType,
  StartUpPageCreateResult,
} from '@evenrealities/even_hub_sdk';
import type {
  EvenAppBridge,
  EvenHubEvent,
  DeviceStatus,
  CreateStartUpPageContainer,
  TextContainerProperty,
} from '@evenrealities/even_hub_sdk';
```

### Complete OsEventTypeList Enum (Authoritative)

```typescript
// Source: @evenrealities/even_hub_sdk@0.0.7 dist/index.d.ts
enum OsEventTypeList {
  CLICK_EVENT        = 0,  // Single tap
  SCROLL_TOP_EVENT   = 1,  // Content reached top boundary
  SCROLL_BOTTOM_EVENT = 2, // Content reached bottom boundary
  DOUBLE_CLICK_EVENT = 3,  // Double tap (firmware-disambiguated)
  FOREGROUND_ENTER_EVENT = 4,
  FOREGROUND_EXIT_EVENT  = 5,
  ABNORMAL_EXIT_EVENT    = 6,
}
```

### PCM Audio Frame Specification (Authoritative)

```typescript
// Source: @evenrealities/even_hub_sdk@0.0.7 README.md + dist/index.d.ts
// audioPcm: Uint8Array
// dtUs: 10000 µs (10ms frame duration)
// srHz: 16000 Hz (16kHz sample rate)
// Bytes per frame: 40
// Byte order: little-endian
// Encoding: raw PCM S16LE mono

bridge.onEvenHubEvent((event) => {
  if (event.audioEvent) {
    const frame: Uint8Array = event.audioEvent.audioPcm;
    // frame.length === 40 (20 samples × 2 bytes/sample)
    // 16000 samples/sec × 2 bytes/sample × 0.01 sec/frame = 320 bytes/sec
    // Approx 25 frames/second
  }
});
```

### Minimal Startup Page Container

```typescript
// Source: @evenrealities/even_hub_sdk@0.0.7 README.md
// Must be called ONCE on init before any other UI or audio operations.
const result = await bridge.createStartUpPageContainer({
  containerTotalNum: 1,
  textObject: [{
    xPosition: 0, yPosition: 0,
    width: 576, height: 288,
    containerID: 1,
    containerName: 'main', // max 16 chars
    isEventCapture: 1,     // exactly one container must have this
    content: '',
  }],
});
// result === StartUpPageCreateResult.success (0) on success
```

### AppEventMap Extension (if needed)

The existing `AppEventMap` in `src/types.ts` already covers all Phase 2 events:
```typescript
// Already defined in src/types.ts — no changes needed for Phase 2
export interface AppEventMap {
  'bridge:connected':       { deviceName: string };
  'bridge:disconnected':    { reason: string };
  'gesture:tap':            { timestamp: number };
  'gesture:double-tap':     { timestamp: number };
  'gesture:scroll-up':      { timestamp: number };
  'gesture:scroll-down':    { timestamp: number };
  'audio:recording-start':  { sessionId: string };
  'audio:recording-stop':   { sessionId: string; blob: Blob };
  'gateway:status':         { status: ConnectionStatus };
  'gateway:chunk':          VoiceTurnChunk;
  'log':                    { level: LogLevel; msg: string; cid?: string };
}
```

If the bridge needs to forward raw PCM frames internally (bridge → audio capture), add `'bridge:audio-frame'` to the map, OR pass the audio capture service as a direct dependency of the bridge (avoids event bus for high-frequency PCM frames — recommended).

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual `window._evenAppHandleMessage` message parsing | `@evenrealities/even_hub_sdk` handles all message format variants | SDK v0.0.6+ (late 2025) | No need to write custom message parsers or handle format differences. |
| Gesture names like `TOUCH_EVENT` (from BLE protocol) | `OsEventTypeList.CLICK_EVENT`, `DOUBLE_CLICK_EVENT` (from SDK) | SDK-abstracted since v0.0.1 | The SDK abstracts BLE event codes into typed TypeScript enums. Use SDK types, not raw BLE bytes. |
| `ensureEvenAppBridge()` (seen in EH-InNovel KMM code) | `waitForEvenAppBridge()` (current JS SDK API) | JS SDK v0.0.7 | The current npm package uses `waitForEvenAppBridge`. EH-InNovel uses Kotlin/JS which has a different bridge API. |

**Deprecated/outdated:**
- `getGlassesInfo` method: The SDK exports `EvenAppMethod.GetGlassesInfo` but `getDeviceInfo()` is the current typed method. Use `getDeviceInfo()`.
- BLE raw byte gesture codes (`0xF5 0x01` for tap, `0xF5 0x00` for double-tap): These are the BLE protocol level, not the EvenHub SDK level. Irrelevant for WebView apps using the SDK.

---

## Open Questions

1. **Does `SCROLL_TOP_EVENT` / `SCROLL_BOTTOM_EVENT` require the text container to be scrollable?**
   - What we know: These are boundary events from text overflow. If content fits within the container height, the events may never fire.
   - What's unclear: Minimum content length that makes the container scrollable on G2 hardware. The font metrics are not publicly documented.
   - Recommendation: Phase 2 maps the events. Phase 3 must test this on hardware — the gesture hint bar (GEST-06) may need to suppress scroll hints when the chat is short enough that scrolling is impossible.

2. **What is the audio format the gateway expects — raw PCM or encoded?**
   - What we know: Glasses deliver `PCM S16LE, 16kHz, mono, 40 bytes/frame`. The gateway client (`src/api/gateway-client.ts`) sends a `Blob` with `audio/webm` MIME type (from existing code).
   - What's unclear: Whether the gateway STT pipeline expects raw PCM or encoded audio. The existing `VoiceTurnRequest` type has `audio: Blob` with no format enforcement.
   - Recommendation: Send PCM as `audio/pcm` from glasses mode; `audio/webm` from browser MediaRecorder. Noted in STATE.md as a research item for validation during Phase 2 integration.

3. **Can the bridge emit events before `createStartUpPageContainer` completes?**
   - What we know: The `onEvenHubEvent` subscription can be registered before `createStartUpPageContainer` is called (the callback is registered on the bridge instance, not on a specific container).
   - What's unclear: Whether gesture events can arrive before the container is created (e.g., if the user taps immediately on app launch).
   - Recommendation: Register the event listener before `createStartUpPageContainer`, but the gesture handler should gate on a `bridgeReady` flag before processing inputs. Emit `bridge:connected` only after `createStartUpPageContainer` succeeds.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 3.0.0 |
| Config file | `vite.config.ts` → `test.include: ['src/**/*.test.ts']` |
| Quick run command | `npx vitest run` |
| Full suite command | `npx vitest run` |
| Estimated runtime | ~11 seconds (current 95 tests run in ~11s) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BRDG-01 | `EvenBridgeService.init()` sequences `waitForEvenAppBridge` → `createStartUpPageContainer` → subscribe | unit (mock SDK) | `npx vitest run src/__tests__/even-bridge.test.ts` | ❌ Wave 0 gap |
| BRDG-02 | Bridge emits `gesture:tap` etc. on bus when `CLICK_EVENT` arrives; no direct bridge calls from UI | unit (mock SDK) | `npx vitest run src/__tests__/even-bridge.test.ts` | ❌ Wave 0 gap |
| BRDG-03 | `createBridgeMock` registers keyboard listeners and emits correct bus events | unit | `npx vitest run src/__tests__/bridge-mock.test.ts` | ❌ Wave 0 gap |
| GEST-01 | `gestureTransition('idle', 'tap')` → `{ nextState: 'recording', action: START_RECORDING }` | unit | `npx vitest run src/__tests__/gesture-fsm.test.ts` | ❌ Wave 0 gap |
| GEST-02 | `gestureTransition('idle', 'double-tap')` → `{ nextState: 'menu', action: TOGGLE_MENU }` | unit | `npx vitest run src/__tests__/gesture-fsm.test.ts` | ❌ Wave 0 gap |
| GEST-03 | `gestureTransition('idle', 'scroll-up')` → `{ nextState: 'idle', action: SCROLL_UP }` | unit | `npx vitest run src/__tests__/gesture-fsm.test.ts` | ❌ Wave 0 gap |
| GEST-04 | `gestureTransition('idle', 'scroll-down')` → `{ nextState: 'idle', action: SCROLL_DOWN }` | unit | `npx vitest run src/__tests__/gesture-fsm.test.ts` | ❌ Wave 0 gap |
| GEST-05 | `handleInput('tap', T)` then `handleInput('tap', T+100)` — second tap suppressed within debounce window | unit | `npx vitest run src/__tests__/gesture-handler.test.ts` | ❌ Wave 0 gap |
| GEST-06 | Gesture hint bar content correctly formatted for glasses display | unit | `npx vitest run src/__tests__/gesture-handler.test.ts` | ❌ Wave 0 gap |
| VOICE-01/02 | FSM tap→recording, tap→sent with correct actions dispatched | unit | `npx vitest run src/__tests__/gesture-fsm.test.ts` | ❌ Wave 0 gap |
| VOICE-03 | `AudioCapture.onFrame()` accumulates PCM frames into internal buffer | unit | `npx vitest run src/__tests__/audio-capture.test.ts` | ❌ Wave 0 gap |
| VOICE-04 | `AudioCapture.stopRecording()` returns `Blob` containing all buffered frames | unit | `npx vitest run src/__tests__/audio-capture.test.ts` | ❌ Wave 0 gap |

### Nyquist Sampling Rate

- **Minimum sample interval:** After every committed task → run: `npx vitest run`
- **Full suite trigger:** Before merging final task of any plan wave
- **Phase-complete gate:** Full suite green before `/gsd:verify-work` runs
- **Estimated feedback latency per task:** ~11 seconds

### Wave 0 Gaps (must be created before implementation)

- [ ] `src/__tests__/gesture-fsm.test.ts` — covers GEST-01, GEST-02, GEST-03, GEST-04, VOICE-01, VOICE-02
- [ ] `src/__tests__/gesture-handler.test.ts` — covers GEST-05, GEST-06 (debounce + hint bar)
- [ ] `src/__tests__/audio-capture.test.ts` — covers VOICE-03, VOICE-04
- [ ] `src/__tests__/even-bridge.test.ts` — covers BRDG-01, BRDG-02 (requires SDK mock via `vi.mock`)
- [ ] `src/__tests__/bridge-mock.test.ts` — covers BRDG-03

The gesture FSM tests (`gesture-fsm.test.ts`) are pure unit tests with no dependencies — they can be written immediately and will run in the existing test environment. The bridge tests require mocking `@evenrealities/even_hub_sdk` with `vi.mock()`.

---

## Sources

### Primary (HIGH confidence)

- `@evenrealities/even_hub_sdk@0.0.7` npm package (dist/index.d.ts + README.md) — downloaded and inspected locally. All SDK API shapes, enum values, audio format specs, and lifecycle constraints taken from this source.
- `src/events.ts`, `src/types.ts` — project codebase. The existing `AppEventMap` and `createEventBus` are the integration surface for Phase 2.
- `vite.config.ts` — confirms Vitest configuration and test discovery pattern.

### Secondary (MEDIUM confidence)

- Prior research file (`.planning/research/` concatenated content from 2026-02-27) — architecture patterns, SDK container model rules, BLE protocol reference. Partially verified against SDK types.
- [EvenDemoApp (official)](https://github.com/even-realities/EvenDemoApp) — official reference implementation. Kotlin/Android-based, so direct code patterns don't apply, but architectural decisions align.
- [EH-InNovel (official)](https://github.com/even-realities/EH-InNovel) — confirmed `ensureEvenAppBridge()` is Kotlin/JS variant; JS SDK uses `waitForEvenAppBridge()`.

### Tertiary (LOW confidence)

- [even-g2-notes by nickustinov](https://github.com/nickustinov/even-g2-notes) — community BLE reverse-engineering. BLE codes (`0xF5 0x01` for tap) are NOT relevant to SDK-layer development. Mentioned for context only.

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — SDK npm package version confirmed, downloaded, TypeScript types inspected directly.
- Architecture: HIGH — Patterns derived from authoritative SDK types and existing project codebase patterns.
- Pitfalls: HIGH — Most pitfalls come directly from SDK documentation constraints (16-char name limit, audio prerequisite, container-once rule).
- Audio format: HIGH — Confirmed in both README.md and `EvenHubEvent` type definition: `dtUs 10000 µs, srHz 16kHz, 40 bytes/frame, little-endian`.
- Gesture event names: HIGH — `OsEventTypeList` enum values confirmed from `dist/index.d.ts`.
- Gateway audio format compatibility: LOW — Whether gateway expects PCM or encoded audio is unresolved. Noted as Open Question.

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (SDK is actively developed — v0.0.7 published 2 weeks before research date; check for updates before planning if >2 weeks pass)
