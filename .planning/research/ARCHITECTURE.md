# Architecture Patterns

**Domain:** Smart glasses voice/chat frontend (Even G2 + OpenClaw AI agent)
**Researched:** 2026-02-27
**Confidence:** MEDIUM-HIGH (Even Hub SDK docs verified via community notes + official demo apps; audio/streaming patterns verified via MDN + multiple sources)

## Recommended Architecture

The app is a **dual-surface web application** running inside Even's iPhone WebView. One logical app serves two rendering targets: the **companion hub** (mobile/desktop browser viewport at arbitrary resolution) and the **glasses HUD** (576x288 green monochrome 4-bit greyscale, rendered via Even Hub SDK container model over BLE). All sensitive operations proxy through `openclaw-even-g2-voice-gateway`.

### System Topology

```
[G2 Glasses]                    [iPhone WebView]              [Backend Gateway]
  4x Mics ----BLE 5.x----> Even App (Flutter)            openclaw-even-g2-voice-gateway
  Display  <---BLE 5.x---- EvenAppBridge (injected JS)         |
  Touch/Ring gestures           |                              |-- STT (WhisperX/OpenAI)
                                v                              |-- OpenClaw Agent
                         [Your Web App]  ----HTTP/SSE---->     |-- Session mgmt
                         (hub + glasses)                       |-- TTS (optional)
```

**Key insight from research:** The Even Hub SDK does NOT give you a DOM on the glasses. It provides a **container-based display model** with max 4 containers per page, absolute pixel positioning, no CSS. Your web app calls `bridge.createStartUpPageContainer()` / `bridge.textContainerUpgrade()` to push text/images to the glasses. The companion hub IS a normal web page in the WebView. These are two completely separate rendering paths within one app.

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| **AudioCapture** (`src/audio/`) | Receive PCM frames from glasses mic via bridge `audioEvent`, buffer and encode for backend | EvenBridge, GatewayClient |
| **EvenBridge** (`src/bridge/`) | Initialize `EvenAppBridge`, manage page lifecycle, route events (audio, input, system) to handlers | AudioCapture, GestureEngine, GlassesRenderer |
| **GlassesRenderer** (`src/glasses/`) | Manage up to 4 containers on glasses display, push text/image updates via SDK, handle viewport virtualization | EvenBridge, ChatStore |
| **GestureEngine** (`src/gestures/`) | Finite state machine mapping raw SDK events (TOUCH, CLICK, SCROLL_UP/DOWN, LONG_PRESS) to app actions | EvenBridge, AppState |
| **ChatStore** (`src/chat/`) | Maintain ordered chat history (messages + metadata), track streaming state, provide viewport window | GlassesRenderer, HubUI, GatewayClient |
| **GatewayClient** (`src/api/`) | HTTP client for backend gateway -- send audio chunks, receive SSE streaming responses, session CRUD | ChatStore, AudioCapture, SessionManager |
| **SessionManager** (`src/sessions/`) | Track active session, list sessions, switch sessions, persist session state | GatewayClient, SettingsStore |
| **SettingsStore** (`src/settings/`) | Read/write settings to localStorage with type safety, mask secrets for display, export/import JSON | SessionManager, GatewayClient, HubUI |
| **HubUI** (`src/ui/`) | Companion mobile/desktop screens (home, health, features, settings, logs) using Even design tokens | ChatStore, SettingsStore, SessionManager, AppState |
| **AppState** (`src/app/`) | Global app state coordinator -- connection status, current mode (idle/recording/thinking), error state | All components |
| **IconRegistry** (`src/icons/`) | Animation frame definitions for HUD state icons (recording blink, sent, thinking throb) | GlassesRenderer |

### Data Flow

**Voice Conversation Flow (primary path):**

```
1. User taps temple/ring on G2 glasses
2. EvenBridge receives TOUCH_EVENT/CLICK_EVENT via onEvenHubEvent
3. GestureEngine FSM transitions: IDLE -> RECORDING
4. AppState updates mode to "recording"
5. GlassesRenderer shows REC icon + timer in status container
6. EvenBridge calls bridge.audioControl(true) to start glasses mic
7. AudioCapture receives audioEvent.audioPcm (16kHz, PCM S16LE, 10ms frames)
8. AudioCapture buffers frames, sends chunks to GatewayClient
9. User taps again -> GestureEngine: RECORDING -> SENT
10. bridge.audioControl(false) stops mic
11. GatewayClient POSTs buffered audio to gateway
12. AppState updates mode to "thinking"
13. GlassesRenderer shows THINKING throbber
14. Gateway responds with SSE stream of agent tokens
15. GatewayClient feeds tokens into ChatStore incrementally
16. ChatStore appends to current assistant message
17. GlassesRenderer calls bridge.textContainerUpgrade() every 150-300ms
    with latest text (up to 2000 chars per update)
18. When stream completes, AppState -> IDLE
19. GlassesRenderer shows final response, user can scroll history
```

**Settings Flow:**
```
1. User navigates to Settings in HubUI (companion screen)
2. HubUI reads current values from SettingsStore
3. User edits gateway URL, session key, STT provider, gesture mapping
4. SettingsStore validates and persists to localStorage
5. GatewayClient reads gateway URL from SettingsStore on next request
6. Secret fields (API keys) displayed with masking (*****)
7. Export: SettingsStore.export() emits JSON without secret fields
8. Import: SettingsStore.import(json) merges, user re-enters secrets
```

**Glasses History Scroll Flow:**
```
1. User scrolls ring up/down on glasses
2. EvenBridge receives SCROLL_UP_EVENT or SCROLL_DOWN_EVENT
   (NOTE: these are BOUNDARY events from text overflow, not raw gestures)
3. If text container has isEventCapture:1, firmware handles internal scroll
4. At boundaries, SCROLL_TOP_EVENT/SCROLL_BOTTOM_EVENT fire
5. GlassesRenderer can then page to previous/next message blocks
6. ChatStore provides message window based on current scroll offset
```

## Patterns to Follow

### Pattern 1: Bridge-First Event Bus
**What:** All glasses communication flows through a single EvenBridge module that initializes the SDK bridge and dispatches typed events to subscribers. No other module calls `bridge.*` directly.
**When:** Always -- the bridge is the single gateway to hardware.
**Why:** The `EvenAppBridge` must be awaited (`waitForEvenAppBridge()`), has strict lifecycle requirements (page container must exist before audio control), and coalesces events. Centralizing prevents race conditions and lifecycle bugs.
**Example:**
```typescript
// src/bridge/even-bridge.ts
import { waitForEvenAppBridge, EvenAppBridge } from '@evenrealities/even_hub_sdk';

type BridgeEvent =
  | { type: 'audio'; pcm: Uint8Array }
  | { type: 'input'; event: OsEventTypeList }
  | { type: 'system'; event: SysEvent }
  | { type: 'text-scroll'; boundary: 'top' | 'bottom' };

type BridgeListener = (event: BridgeEvent) => void;

class EvenBridgeService {
  private bridge: EvenAppBridge | null = null;
  private listeners: Set<BridgeListener> = new Set();

  async init(): Promise<void> {
    this.bridge = await waitForEvenAppBridge();
    this.bridge.onEvenHubEvent((evt) => {
      if (evt.audioEvent?.audioPcm) {
        this.emit({ type: 'audio', pcm: evt.audioEvent.audioPcm });
      }
      if (evt.listEvent || evt.textEvent) {
        // Map SDK events to typed BridgeEvents
        this.mapInputEvent(evt);
      }
      if (evt.sysEvent) {
        this.emit({ type: 'system', event: evt.sysEvent });
      }
    });
  }

  subscribe(listener: BridgeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: BridgeEvent): void {
    this.listeners.forEach(fn => fn(event));
  }

  // Expose controlled SDK actions
  async startAudio(): Promise<void> { this.bridge?.audioControl(true); }
  async stopAudio(): Promise<void> { this.bridge?.audioControl(false); }
  async createPage(containers: ContainerProperty[]): Promise<number> { /* ... */ }
  async updateText(id: number, name: string, content: string, offset: number, length: number): Promise<boolean> { /* ... */ }
}
```

### Pattern 2: Gesture Finite State Machine
**What:** A pure-function state machine that maps raw input events to app actions. No side effects in the FSM itself -- it returns the next state and an optional action.
**When:** All gesture handling on the glasses HUD.
**Why:** Only 4-6 input types exist (TOUCH, CLICK, SCROLL_UP, SCROLL_DOWN, LONG_PRESS, plus scroll boundary events). A clean FSM prevents gesture conflicts (e.g., tap during recording vs. tap during idle mean different things). Testable without SDK.
**Example:**
```typescript
// src/gestures/gesture-fsm.ts
type GestureState = 'idle' | 'recording' | 'sent' | 'thinking' | 'menu' | 'scrolling';
type InputEvent = 'tap' | 'double_tap' | 'scroll_up' | 'scroll_down' | 'long_press';
type Action =
  | { type: 'START_RECORDING' }
  | { type: 'STOP_RECORDING' }
  | { type: 'SCROLL_HISTORY'; direction: 'up' | 'down' }
  | { type: 'TOGGLE_MENU' }
  | { type: 'DISMISS' }
  | null;

interface Transition {
  nextState: GestureState;
  action: Action;
}

const transitions: Record<GestureState, Partial<Record<InputEvent, Transition>>> = {
  idle: {
    tap: { nextState: 'recording', action: { type: 'START_RECORDING' } },
    double_tap: { nextState: 'menu', action: { type: 'TOGGLE_MENU' } },
    scroll_up: { nextState: 'scrolling', action: { type: 'SCROLL_HISTORY', direction: 'up' } },
    scroll_down: { nextState: 'scrolling', action: { type: 'SCROLL_HISTORY', direction: 'down' } },
  },
  recording: {
    tap: { nextState: 'sent', action: { type: 'STOP_RECORDING' } },
    // Other inputs ignored during recording
  },
  thinking: {
    // Most inputs ignored while waiting for response
    double_tap: { nextState: 'menu', action: { type: 'TOGGLE_MENU' } },
  },
  // ... etc
};

export function transition(state: GestureState, input: InputEvent): Transition {
  return transitions[state]?.[input] ?? { nextState: state, action: null };
}
```

### Pattern 3: Throttled Streaming Text Push
**What:** Buffer incoming SSE tokens client-side, then push accumulated text to the glasses display on a fixed cadence (150-300ms) using `textContainerUpgrade()` rather than per-token.
**When:** Every streaming AI response.
**Why:** The glasses display update over BLE is slow. Per-token updates (which can arrive every 20-50ms from an LLM) would overwhelm the BLE pipe and cause dropped frames. The SDK's `textContainerUpgrade` supports partial updates with offset/length, but BLE latency means batching is essential. The Pong game example confirms: frame push must complete before next push.
**Example:**
```typescript
// src/chat/stream-throttle.ts
class StreamThrottle {
  private buffer = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastPushedLength = 0;

  constructor(
    private pushFn: (text: string, offset: number, length: number) => Promise<boolean>,
    private intervalMs = 200,
  ) {}

  start(): void {
    this.timer = setInterval(() => this.flush(), this.intervalMs);
  }

  append(token: string): void {
    this.buffer += token;
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === this.lastPushedLength) return;
    const newContent = this.buffer;
    // Replace entire content (offset 0, length = previous length)
    await this.pushFn(newContent, 0, this.lastPushedLength);
    this.lastPushedLength = newContent.length;
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush(); // Final push
  }
}
```

### Pattern 4: Container Layout Manager
**What:** A declarative abstraction over the 4-container limit that manages layout presets (chat mode, menu mode, status-only mode) and handles page rebuilds.
**When:** Switching between HUD views (chat, menu, status).
**Why:** The Even Hub SDK limits to 4 containers per page. Switching layouts requires `rebuildPageContainer()` which tears down and recreates everything. A layout manager encapsulates this complexity and prevents container ID conflicts.
**Example:**
```typescript
// src/glasses/layouts.ts
interface Layout {
  name: string;
  containers: ContainerConfig[];
  eventCaptureId: number;
}

const CHAT_LAYOUT: Layout = {
  name: 'chat',
  containers: [
    { id: 1, name: 'status', x: 0, y: 0, w: 576, h: 32, type: 'text' },
    { id: 2, name: 'chat',   x: 0, y: 32, w: 576, h: 224, type: 'text', isEventCapture: true },
    { id: 3, name: 'hint',   x: 0, y: 256, w: 576, h: 32, type: 'text' },
    // 4th container reserved for state icon (image)
  ],
  eventCaptureId: 2,
};

const MENU_LAYOUT: Layout = {
  name: 'menu',
  containers: [
    { id: 1, name: 'title', x: 0, y: 0, w: 576, h: 40, type: 'text' },
    { id: 2, name: 'options', x: 0, y: 40, w: 576, h: 248, type: 'text', isEventCapture: true },
  ],
  eventCaptureId: 2,
};
```

### Pattern 5: Type-Safe Settings Store with Secret Separation
**What:** Split settings into `public` (exportable) and `secret` (never exported) partitions. Use a typed wrapper around localStorage with JSON serialization, validation on read, and masking on display.
**When:** All settings persistence.
**Why:** The app handles gateway URLs, session keys, and potentially API keys. Frontend localStorage is not secure, but we can prevent accidental leakage by never including secrets in export JSON and masking them in the UI. The gateway handles real secret management.
**Example:**
```typescript
// src/settings/settings-store.ts
interface PublicSettings {
  gatewayUrl: string;
  sttProvider: 'whisperx' | 'openai' | 'custom';
  sessionName: string;
  gestureMapping: Record<string, string>;
}

interface SecretSettings {
  sessionKey: string;
}

type AllSettings = PublicSettings & SecretSettings;

const DEFAULTS: AllSettings = {
  gatewayUrl: 'http://localhost:3000',
  sttProvider: 'whisperx',
  sessionName: 'default',
  gestureMapping: {},
  sessionKey: '',
};

class SettingsStore {
  private cache: AllSettings | null = null;

  get(): AllSettings {
    if (!this.cache) {
      const raw = localStorage.getItem('openclaw-settings');
      this.cache = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
    }
    return this.cache;
  }

  set<K extends keyof AllSettings>(key: K, value: AllSettings[K]): void {
    const settings = this.get();
    settings[key] = value;
    localStorage.setItem('openclaw-settings', JSON.stringify(settings));
    this.cache = settings;
  }

  exportPublic(): PublicSettings {
    const { sessionKey, ...pub } = this.get();
    return pub;
  }

  importPublic(json: PublicSettings): void {
    const current = this.get();
    Object.assign(current, json);
    // Preserve existing secrets
    localStorage.setItem('openclaw-settings', JSON.stringify(current));
    this.cache = current;
  }
}
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Direct Bridge Calls from UI Components
**What:** Calling `bridge.textContainerUpgrade()` or `bridge.audioControl()` directly from UI event handlers or rendering code.
**Why bad:** The bridge has strict lifecycle requirements (page must exist before audio), concurrency constraints (await frame push before next), and event coalescing. Scattered direct calls cause race conditions, dropped frames, and hard-to-debug state desync between glasses display and app state.
**Instead:** Route ALL bridge calls through `EvenBridgeService`. Components dispatch intentions; the bridge service manages ordering and lifecycle.

### Anti-Pattern 2: Per-Token Glasses Display Updates
**What:** Pushing every streamed token to the glasses display immediately as it arrives from SSE.
**Why bad:** LLM tokens arrive at 20-50ms intervals. The glasses BLE pipe has significant latency. The SDK's `textContainerUpgrade` must complete before the next call. Per-token updates will queue up, causing massive lag (seconds behind the actual response) and potential BLE buffer overflow.
**Instead:** Buffer tokens client-side, push to display on a 150-300ms throttle cadence using `StreamThrottle`.

### Anti-Pattern 3: Using More Than 4 Containers or Dynamic Container Creation
**What:** Trying to create containers dynamically per chat message, or exceeding the 4-container limit.
**Why bad:** The Even Hub SDK hard-limits to 4 containers per page. Exceeding this returns error code 2. Each container switch requires `rebuildPageContainer()` which tears down everything and causes a visible flicker on the glasses.
**Instead:** Use fixed layout presets (chat layout, menu layout, status layout). Text containers hold multi-message content as plain text. Use the container layout manager pattern.

### Anti-Pattern 4: Storing Secrets in localStorage Without Awareness
**What:** Treating localStorage as a secure store for API keys or session secrets.
**Why bad:** localStorage is accessible to any script on the origin. The app may be loaded in a WebView context where other scripts could access it. XSS would expose everything.
**Instead:** Store only non-critical preferences in localStorage. Session keys are semi-sensitive (use masking, exclude from export). Real secrets (OpenClaw API keys, STT credentials) must stay in the gateway backend, never in the frontend.

### Anti-Pattern 5: Full Chat History in a Single Text Container
**What:** Concatenating all messages into one string and pushing to the glasses display.
**Why bad:** Text containers have content limits (2000 chars for `textContainerUpgrade`, 1000 chars for `createStartUpPageContainer`). A full conversation easily exceeds this. The glasses font is non-monospaced with ~400-500 chars filling a full-screen container.
**Instead:** Maintain full chat history in `ChatStore` in memory. Compute a "viewport window" of recent messages that fits within the character limit. Use manual pagination for older messages, triggered by scroll boundary events.

## Even Hub SDK Container Model (Critical Reference)

This section documents the verified SDK architecture that all glasses-side rendering must conform to.

### Display Hardware
- 576x288 pixels per eye, dual micro-LED (green)
- 4-bit greyscale (16 shades of green)
- Single baked-in LVGL font, non-monospaced, no size control
- ~400-500 chars fills a full-screen text container

### Container Rules
- Maximum 4 containers per page
- Exactly 1 must have `isEventCapture: 1`
- Absolute pixel positioning only (no CSS, no flexbox)
- Container types: Text, List, Image
- Image containers: 20-200px wide, 20-100px tall
- Text containers: left-aligned, top-aligned, no formatting
- Borders: 0-5 width, 0-16 color, 0-10 radius, 0-32 padding

### Content Limits
| Operation | Max Chars |
|-----------|-----------|
| `createStartUpPageContainer` | 1,000 |
| `textContainerUpgrade` | 2,000 |
| `rebuildPageContainer` | 1,000 |

### Input Events
| Event | Source | Notes |
|-------|--------|-------|
| `TOUCH_EVENT` | Temple touch | Single tap |
| `CLICK_EVENT` | Ring click | Ring press |
| `SCROLL_UP_EVENT` | Ring scroll | Scroll gesture |
| `SCROLL_DOWN_EVENT` | Ring scroll | Scroll gesture |
| `LONG_PRESS_EVENT` | Long hold | Extended press |
| `SCROLL_TOP_EVENT` | Text overflow | Boundary reached at top |
| `SCROLL_BOTTOM_EVENT` | Text overflow | Boundary reached at bottom |

### Audio
- `bridge.audioControl(true/false)` starts/stops glasses mic
- PCM arrives via `onEvenHubEvent` as `audioEvent.audioPcm` (Uint8Array)
- Format: 16kHz, PCM S16LE, mono, 10ms frames (40 bytes/frame)
- Page container must exist before calling `audioControl`

### Page Lifecycle
1. `createStartUpPageContainer(containers)` -- initial page
2. `textContainerUpgrade(upgrade)` -- partial text update (offset/length)
3. `rebuildPageContainer(containers)` -- replace all containers
4. `updateImageRawData(data)` -- update image container
5. `shutDownPageContainer()` -- tear down display

## Scalability Considerations

| Concern | Single User (target) | 10+ Sessions | Notes |
|---------|---------------------|--------------|-------|
| Chat history size | In-memory array, trim at 500 msgs | Same -- frontend only | Backend stores canonical history |
| Audio buffer | ~160 bytes/sec PCM, buffer 30s max | N/A -- single glasses | Gateway handles concurrent sessions |
| Display updates | 150-300ms throttle, single BLE pipe | N/A | Hardware constraint, not scalable |
| Settings storage | localStorage, ~10KB | Same | One set of settings per device |
| Session switching | Swap active session ID, reload history from gateway | List grows linearly | Gateway paginates session list |

## Suggested Build Order (Dependency Chain)

Build order follows strict dependency chains. Each layer requires the one below it.

```
Layer 0 (Foundation):  Types + SettingsStore + AppState
                       No external dependencies. Pure data structures.

Layer 1 (Bridge):      EvenBridge
                       Requires: Types
                       Blocks: Everything glasses-related

Layer 2 (Input/Output): GestureEngine + AudioCapture + GlassesRenderer + IconRegistry
                        Requires: EvenBridge, AppState
                        Can be built in parallel within this layer

Layer 3 (Data):         ChatStore + GatewayClient
                        Requires: SettingsStore (for gateway URL)
                        GatewayClient needs ChatStore for streaming writes

Layer 4 (Orchestration): SessionManager + StreamThrottle
                         Requires: GatewayClient, ChatStore, GlassesRenderer
                         Wires streaming responses to display

Layer 5 (UI):           HubUI (companion screens)
                        Requires: All stores + AppState for display
                        Can develop companion UI independently from glasses

Layer 6 (Integration):  Full voice conversation loop wiring
                        Connects: GestureEngine -> AudioCapture -> GatewayClient
                                  -> ChatStore -> StreamThrottle -> GlassesRenderer
```

**Rationale:** The EvenBridge is the critical bottleneck. Nothing glasses-related works without it. However, the companion HubUI and SettingsStore can be built independently. The GestureEngine FSM is pure functions and fully testable without the SDK. The StreamThrottle is the most novel component and should be prototyped early with the simulator.

## Sources

- [Even G2 SDK technical notes (nickustinov)](https://github.com/nickustinov/even-g2-notes/blob/main/G2.md) -- MEDIUM-HIGH confidence, community-maintained but detailed and consistent with official demo apps
- [Even Hub Developer Portal](https://evenhub.evenrealities.com/) -- HIGH confidence, official
- [EvenDemoApp (official)](https://github.com/even-realities/EvenDemoApp) -- HIGH confidence, official reference
- [EH-InNovel (official)](https://github.com/even-realities/EH-InNovel) -- HIGH confidence, official Even Hub web app demo
- [Pong for Even G2](https://github.com/nickustinov/pong-even-g2) -- MEDIUM confidence, community app demonstrating real rendering patterns
- [Even G2 BLE Protocol (reverse-engineered)](https://github.com/i-soxi/even-g2-protocol) -- MEDIUM confidence, community reverse engineering
- [MDN MediaRecorder API](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) -- HIGH confidence, standard web API reference
- [MDN Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) -- HIGH confidence, standard web API reference
- [VoiceStreamAI (audio streaming architecture)](https://github.com/alesaccoia/VoiceStreamAI) -- MEDIUM confidence, well-documented pattern reference
- [Even G2 smart glasses product page](https://www.evenrealities.com/smart-glasses) -- HIGH confidence, official hardware specs
