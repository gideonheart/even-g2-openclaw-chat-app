# ARCHITECTURE — Even G2 Frontend

## System Pair

This project is the **frontend half** of a two-repo system:

- Frontend (this repo): `even-g2-openclaw-chat-app`
- Backend: `openclaw-even-g2-voice-gateway`

## Responsibilities

### Frontend (this repo)

Runs in Even App WebView and owns:

- Hub UI (text/settings/sessions/history) — phone screen companion
- Glasses runtime UX (gestures, mic capture, display updates) — AR overlay
- Sending text/audio turns to gateway
- Rendering streamed responses and maintaining local conversation/session state

### Gateway (backend repo)

Owns:

- STT provider integration (WhisperX, OpenAI Whisper)
- OpenClaw agent orchestration
- HTTP POST + JSON response (not SSE — gateway returns complete replies)
- Server-side integrations and secret handling

## End-to-End Flow

1. User interacts via Hub UI (text input) and/or glasses gestures (tap-to-record).
2. Frontend submits turn (text or audio) to gateway via HTTP POST.
3. Gateway runs STT (if audio) and OpenClaw agent orchestration.
4. Gateway returns JSON reply with `{ transcript?, assistant?: { fullText } }`.
5. Frontend renders on glasses display and updates Hub conversation/session state.

## Trust + Security Boundary

- **No secrets in frontend.**
- Frontend is public-safe and should not contain privileged keys.
- Credentials, provider keys, and privileged integrations remain in gateway.

## Canonical Paths (local)

- Frontend: `/home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app`
- Gateway: `/home/forge/openclaw-even-g2-voice-gateway`

## API/Contract Notes

- Frontend should treat gateway as the source of backend behavior.
- Contract changes must be versioned and coordinated across both repos.
- Prefer additive changes; document breaking changes explicitly.

---

## Dual-Boot Architecture

Hub and glasses run in a **single WebView** as two independent modules. This is
the most important architectural decision in the project and most bugs trace
back to misunderstanding it.

### Runtime Router (`src/main.ts`)

```
┌─────────────────────────────────────────────────┐
│                   main.ts                       │
│                                                 │
│  1. Always boot hub-main  (phone screen UI)     │
│  2. If flutter_inappwebview OR ?even flag:       │
│     also boot glasses-main (AR display)         │
│                                                 │
│  Detection:                                     │
│    Even App WebView → both modules              │
│    Plain browser    → hub-main only (dev)       │
└─────────────────────────────────────────────────┘
```

### Module Independence

Each module creates **its own instances** of shared services:

```
┌──────────────────────────┐    ┌──────────────────────────┐
│      hub-main.ts         │    │    glasses-main.ts       │
│                          │    │                          │
│  hubBus = EventBus()     │    │  bus = EventBus()        │
│  hubGateway = Gateway()  │    │  gateway = Gateway()     │
│  hubSyncBridge = Sync()  │    │  syncBridge = Sync()     │
│                          │    │                          │
│  Owns:                   │    │  Owns:                   │
│  - Phone DOM (nav, UI)   │    │  - SDK bridge (AR)       │
│  - Text input            │    │  - Gesture FSM           │
│  - Settings panel        │    │  - Audio capture         │
│  - Session management    │    │  - Display controller    │
│  - Live chat view        │    │  - Glasses renderer      │
│  - Health display        │    │  - Voice loop controller │
│                          │    │  - Auto-save             │
└──────────┬───────────────┘    └───────────┬──────────────┘
           │                                │
           └────────── SyncBridge ──────────┘
              (BroadcastChannel / localStorage)
```

### Why Separate Event Buses (not a shared bus)

A shared event bus would cause **harmful crosstalk**:

| If hub emitted `gateway:chunk` on a shared bus... | Effect |
|---|---|
| Auto-save would trigger | Double-write to IDB (hub already saved) |
| Gesture FSM would react | State corruption (text turn ≠ voice turn) |
| Voice queue would drain | Interfere with in-flight voice turns |
| Display controller would render | Correct — but at the cost of all the above |

Separate buses enforce the principle: **each module is sovereign over its own
domain.** Cross-module communication goes through the sync bridge, which is
explicit, typed, and filterable.

---

## Sync Bridge — The Integration Contract

The sync bridge (`BroadcastChannel`) is the **only** cross-module communication
channel. Both modules create their own `BroadcastChannel('openclaw-sync')`
instance. BroadcastChannel delivers to **other** instances on the same channel
(even within the same page), so hub → glasses and glasses → hub both work.

### Message Flow Diagram

```
  HUB MODULE                              GLASSES MODULE
  ──────────                              ──────────────

  handleTextSubmit(text)
    │
    ├─► Save to IDB
    ├─► appendLiveMessage('user', text)
    ├─► hubGateway.sendTextTurn(...)
    │
    ├─► syncBridge ─── message:added ──────► renderer.addUserMessage(text)
    │                  (role=user)
    │
    │   hubGateway.onChunk:
    │     response_start
    │       ├─► showStreamingIndicator()
    │       └─► syncBridge ─ streaming:start ► renderer.startStreaming()
    │                                          renderer.setIconState('thinking')
    │     response_delta
    │       └─► accumulate text locally
    │
    │     response_end
    │       ├─► save assistant text to IDB
    │       ├─► syncBridge ─ message:added ──► renderer.appendStreamChunk(text)
    │       │                (role=assistant)
    │       └─► syncBridge ─ streaming:end ──► renderer.endStreaming()
    │
    │
  VOICE TURN (glasses-native):
  ──────────────────────────
    gesture tap → audioCapture → voice-loop-controller
    │
    ├─► gateway.sendVoiceTurn(...)
    │     gateway.onChunk → bus.emit('gateway:chunk', chunk)
    │                          │
    │                          ├─► display-controller → renderer
    │                          ├─► auto-save → IDB
    │                          ├─► gesture-handler → FSM reset
    │                          └─► voice queue → drain next turn
    │
    └─► syncBridge ─── message:added ──────► hub live view update
                       streaming:*
```

### Sync Bridge Message Types

| Message | Direction | Purpose |
|---|---|---|
| `message:added` | both | User or assistant message for display + persistence |
| `streaming:start` / `streaming:end` | hub → glasses | Streaming lifecycle for text turns |
| `session:switched` | both | Active session changed |
| `session:created` / `session:deleted` / `session:renamed` | both | Session lifecycle |
| `conversation:named` | glasses → hub | Auto-generated conversation name |
| `sync:heartbeat` | both | Liveness + drift detection |
| `gateway:error` / `gateway:status-changed` | glasses → hub | Health status forwarding |
| `bridge:connected` / `bridge:disconnected` | glasses → hub | Glasses hardware status |

### Best Practice: Sync Bridge Completeness

When adding a new cross-module feature, **always check if the sync bridge
contract covers the new data flow.** The most common bug pattern is:

1. Add feature to hub (e.g., text input)
2. Hub-side works perfectly (sends to gateway, renders locally)
3. Forget to add sync bridge handlers on glasses side
4. Glasses never renders the feature's output

**Rule: If hub sends it, glasses must handle it. If glasses sends it, hub must
handle it.** Unhandled sync message types should log a warning, not silently
drop.

---

## Boot Sequence & Layer Dependencies

### Glasses Module (`glasses-main.ts`)

Boots in strict dependency order. Later layers depend on earlier ones.

```
Layer 0: Foundation
  └─► EventBus, Settings, DevMode detection

Layer 1: Persistence
  └─► IndexedDB → ConversationStore, SessionStore
  └─► IntegrityChecker (read-only, <10ms)
  └─► SyncBridge, SyncMonitor, DriftReconciler

Layer 2: Audio
  └─► AudioCapture (mock in dev mode)
  └─► Bridge audio frame wiring (must exist before first tap)

Layer 3: Gestures (subscribes to bus FIRST)
  └─► GestureHandler (FSM: idle → recording → sent → thinking)

Layer 4: Display (subscribes to bus AFTER gestures — order matters)
  └─► GlassesRenderer → DisplayController
  └─► Message restore from IDB
  └─► ErrorPresenter, MenuController

Layer 5: Gateway + Voice Loop
  └─► GatewayClient, VoiceLoopController
  └─► AutoSave (listens to gateway:chunk events)
  └─► Health check + heartbeat
```

### Hub Module (`hub-main.ts`)

Boots independently from glasses. No layer numbering — all DOM wiring
happens in `initHub()`.

```
Foundation:
  └─► AppState, LogStore, hubBus = EventBus()

Persistence (async):
  └─► SessionManager, SyncBridge, SyncMonitor
  └─► DriftReconciler, ConversationStore

UI Wiring (sync):
  └─► Bottom nav, settings panel, health display
  └─► Error presenter, persistence health

Gateway:
  └─► hubGateway = GatewayClient()
  └─► Text input form → handleTextSubmit → sendTextTurn
  └─► Health check + heartbeat
```

---

## Voice Turn vs Text Turn — Data Flow Comparison

Understanding why these work differently prevents the most common bugs.

### Voice Turn (glasses-native)

```
Tap → Audio → VoiceLoopController → gateway.sendVoiceTurn()
                                          │
                              gateway.onChunk callback
                                          │
                                  bus.emit('gateway:chunk')
                                          │
                          ┌───────────────┼───────────────┐
                          ▼               ▼               ▼
                   DisplayController   AutoSave    GestureHandler
                   (renders on        (saves to    (resets FSM on
                    glasses)           IDB)         response_end)
```

- Gateway client is **glasses-side** → chunks flow through glasses bus
- All consumers (display, auto-save, FSM) receive events naturally
- Hub receives updates via sync bridge

### Text Turn (hub-initiated)

```
Type → handleTextSubmit() → hubGateway.sendTextTurn()
  │                                │
  ├─► Save to IDB (hub)           │ hubGateway.onChunk callback
  ├─► appendLiveMessage (hub DOM)  │         │
  │                                │  handleHubChunk() ← hub UI only
  │                                │
  └─► syncBridge.postMessage(message:added, streaming:*)
                    │
                    ▼
            glasses syncBridge.onMessage
                    │
                    ▼
            renderer.addUserMessage / startStreaming / etc.
            (direct calls — NOT bus events — avoids double-save)
```

- Gateway client is **hub-side** → chunks stay on hub bus
- Glasses receives via sync bridge → calls renderer directly
- **Must not** emit `gateway:chunk` on glasses bus (would trigger auto-save = double-write)

---

## Error Classification — Gateway Client

The gateway client classifies errors into three categories with different
status effects:

```
         catch(err)
              │
     ┌────────┼────────────────┐
     ▼        ▼                ▼
  Timeout   GatewayAppError   Network Error
  (Abort)   (4xx/5xx)         (fetch failed)
     │        │                │
     ▼        ▼                ▼
  status:   status:           status:
  'error'   'connected'       'error'
     │        │                │
     ▼        ▼                ▼
  "Timed    Show error msg   "Unreachable"
   out"     but gateway IS    in health
            reachable         panel
```

**Key insight:** A 4xx/5xx response means the gateway IS reachable — it
responded. Only network errors (fetch throws TypeError) and timeouts mean
the gateway is genuinely unreachable. Conflating these causes the health
panel to show "Unreachable" when the gateway is working fine but rejected
a request (e.g., empty audio transcription).

The shared `handleTurnError(err)` function in `gateway-client.ts` enforces
this classification for both voice and text turns (DRY).

---

## Best Practices

### 1. Assert Both Dimensions of Error Handling

When testing error paths, assert **both** the user-facing effect AND the
internal state effect:

```typescript
// BAD: only checks what the user sees
expect(errorChunks[0].error).toContain('502');

// GOOD: checks what the user sees AND what the system remembers
expect(errorChunks[0].error).toContain('502');
expect(statuses[statuses.length - 1]).toBe('connected'); // gateway IS reachable
```

### 2. Extract Shared Policy Immediately

When multiple callers share identical error handling, extract it immediately.
Duplication of error classification logic signals **policy** (how errors are
classified), not one-off logic (how a request is built). Policy belongs in
one place.

### 3. Watch for Semantic Overloading of Status Values

A single status enum value (`'error'`) meaning both "unreachable" and
"request failed" is a code smell. If downstream behavior differs based on
how a status was reached, split it into distinct values or add a
discriminator.

### 4. Direct Renderer Calls for Cross-Module Display

When forwarding data from hub to glasses display, call renderer methods
directly — do not emit `gateway:chunk` on the glasses bus. The glasses bus
has multiple subscribers (auto-save, gesture FSM, voice queue) that should
not react to hub-initiated turns.

### 5. Sync Bridge Conversation ID Guard

Always check `msg.conversationId === activeConversationId` before rendering
sync bridge messages. Without this guard, messages from a previous session
could render on the current session's display.

### 6. Bus Subscription Order Matters

In glasses-main, gesture handler subscribes to bus events **before** display
controller. This ensures the FSM state transitions happen before display
updates. Reordering these subscriptions can cause subtle bugs where the
display renders before the FSM is ready.

### 7. No Dead Code Accumulation

Remove unused code immediately. Do not keep code "for potential future use."
Historical examples of dead code that persisted for months:

| Dead Code | Origin | Why It Survived | Lesson |
|---|---|---|---|
| `parseSSELines` + `SSEEvent` | Phase 4 | "Might need SSE later" | Gateway is HTTP POST — SSE was never implemented |
| `connectGlasses` / `disconnectGlasses` | Phase 2 | "Backward compat" | Superseded in Phase 10 — only its own tests used it |

### 8. Hub Init Failure Must Not Block Glasses

`main.ts` wraps `initHub()` in try/catch so glasses boot continues even if
hub fails. This is intentional — on real devices, the glasses AR display is
the primary UX, and the hub is a companion. Never add dependencies from
glasses-main to hub-main.
