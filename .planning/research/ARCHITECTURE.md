# Architecture Research: v1.2 Conversation Intelligence & Hub Interaction

**Domain:** Integration architecture for persistence, cross-context sync, dynamic sessions, and command menu into existing Even G2 OpenClaw Chat App
**Researched:** 2026-02-28
**Confidence:** HIGH (based on full codebase analysis of all 43 source files + verified platform constraints)

## Critical Architectural Insight: Same-Context Model

The existing codebase has an environment router in `main.ts` that branches to either `glasses-main.ts` (Even App WebView) or `hub-main.ts` (browser). Research confirms the Even App loads a single WebView instance -- the web app renders both the glasses display (via SDK bridge over BLE) and the companion phone UI (standard DOM) in the **same JavaScript context**.

**What this means for v1.2:**

| Scenario | Context Model | Sync Mechanism |
|----------|--------------|----------------|
| Production (Even App) | Single WebView, single JS context | Shared in-memory event bus -- no cross-context bridging needed |
| Dev mode: hub in browser | Separate tab from glasses simulator | BroadcastChannel for real-time sync between index.html and preview-glasses.html |
| Dev mode: hub only | Single tab, no glasses | Direct function calls, no sync needed |

The "hub <-> glasses real-time communication" requirement is already solved in production by the shared event bus. Cross-context bridging (BroadcastChannel) is needed only for the **dev mode simulator** scenario where the glasses preview opens in a separate tab.

This simplifies the architecture dramatically. The main.ts router currently runs EITHER glasses OR hub code. In production, it needs to run BOTH in the same context, sharing a single bus instance.

## System Overview: v1.2 Integration Map

```
+---------------------------------------------------------------------+
|                    EXISTING: Layer 0-5 Boot (glasses-main.ts)       |
|  L0: EventBus + Settings                                           |
|  L1: Bridge (SDK/Mock)                                              |
|  L2: AudioCapture + PCM wiring                                      |
|  L3: GestureHandler + FSM                                           |
|  L4: DisplayController + GlassesRenderer                            |
|  L5: GatewayClient + VoiceLoopController                            |
+---------------------------------------------------------------------+
|                    NEW: Layer 2.5 -- Persistence                    |
|  +--------------+  +------------------+  +---------------+          |
|  | ConvoStore   |  | SessionManager   |  | SearchIndex   |          |
|  | (IndexedDB)  |  | (CRUD + active)  |  | (in-memory)   |          |
|  +------+-------+  +--------+---------+  +------+--------+          |
|         |                   |                    |                   |
+---------+-------------------+--------------------+-------------------+
|                    NEW: Layer 3.5 -- Command Menu                   |
|  +--------------------+  +-----------------------------+            |
|  | CommandMenuFSM      |  | CommandMenuRenderer         |            |
|  | (pure function)     |  | (glasses text containers)   |            |
|  +--------------------+  +-----------------------------+            |
+---------------------------------------------------------------------+
|                    NEW: Layer 5.5 -- Hub Integration                |
|  +------------------+  +------------------+  +--------------+       |
|  | HubLiveView      |  | HubTextInput     |  | HistoryBrowse|       |
|  | (DOM rendering)  |  | (input -> bus)   |  | (IDB queries)|       |
|  +------------------+  +------------------+  +--------------+       |
+---------------------------------------------------------------------+
|                    NEW: DevSync (dev mode only)                     |
|  +--------------------------------------------------------------+   |
|  | BroadcastChannelBridge -- mirrors bus events across tabs      |   |
|  | Only instantiated when devMode=true AND hub/simulator split   |   |
|  +--------------------------------------------------------------+   |
+---------------------------------------------------------------------+
```

## New Component Responsibilities

| Component | Responsibility | Module Type | New File |
|-----------|---------------|-------------|----------|
| ConvoStore | IndexedDB CRUD for conversations and messages | Side-effect (I/O) | `src/persistence/convo-store.ts` |
| SessionManager | Dynamic session lifecycle (create/rename/delete/switch/list), replaces static SESSIONS array | Pure logic + ConvoStore delegate | `src/sessions/session-manager.ts` |
| SearchIndex | In-memory token index built on load, queried for full-text search | Pure function | `src/persistence/search-index.ts` |
| CommandMenuFSM | Pure state machine for menu item navigation (selected index, items list) | Pure function (zero imports) | `src/gestures/command-menu-fsm.ts` |
| CommandMenuRenderer | Renders command menu items to glasses text container when menu state is active | Side-effect (bridge calls) | `src/display/command-menu-renderer.ts` |
| CommandMenu | Orchestrator connecting FSM + renderer + session actions | Glue module | `src/gestures/command-menu.ts` |
| PersistenceTap | Bus listener that persists messages to IndexedDB as they flow | Side-effect (bus subscriber) | `src/persistence/persistence-tap.ts` |
| HubLiveView | Renders current glasses conversation in hub DOM, subscribes to bus events | DOM + bus subscriber | `src/hub/hub-live-view.ts` |
| HubTextInput | Text input field in hub that sends typed messages into the conversation | DOM + bus emitter | `src/hub/hub-text-input.ts` |
| HistoryBrowser | Hub UI for browsing past conversations with search | DOM + ConvoStore queries | `src/hub/history-browser.ts` |
| BroadcastChannelBridge | Dev-only: mirrors selected bus events across BroadcastChannel for simulator sync | Side-effect (BroadcastChannel) | `src/bridge/broadcast-bridge.ts` |

## Recommended Project Structure (v1.2 additions)

```
src/
  persistence/                # NEW: IndexedDB layer
    convo-store.ts            # IndexedDB wrapper for conversations + messages
    search-index.ts           # In-memory full-text search index
    persistence-tap.ts        # Bus subscriber that writes to IndexedDB
    db-schema.ts              # Database schema version constants + types
  sessions/                   # REFACTORED: replaces flat sessions.ts
    session-manager.ts        # Dynamic session CRUD (was: static SESSIONS array)
    session-types.ts          # Session-related types
  gestures/                   # EXISTING + additions
    gesture-fsm.ts            # UNCHANGED
    gesture-handler.ts        # MODIFIED: delegate to command-menu on menu state
    command-menu-fsm.ts       # NEW: pure FSM for menu item selection
    command-menu.ts           # NEW: orchestrator connecting FSM + renderer + actions
  display/                    # EXISTING + additions
    glasses-renderer.ts       # MODIFIED: add loadConversation() + getLastAssistantMessage()
    command-menu-renderer.ts  # NEW: renders menu overlay on glasses
    display-controller.ts     # MODIFIED: wire command menu events
    viewport.ts               # UNCHANGED
    icon-animator.ts          # UNCHANGED
  hub/                        # NEW: hub-specific UI modules
    hub-live-view.ts          # Real-time mirror of glasses conversation
    hub-text-input.ts         # Text input -> conversation
    history-browser.ts        # Conversation history UI + search
  bridge/                     # EXISTING + additions
    even-bridge.ts            # UNCHANGED
    bridge-mock.ts            # UNCHANGED
    bridge-types.ts           # UNCHANGED
    broadcast-bridge.ts       # NEW: dev-mode cross-tab event mirroring
  events.ts                   # UNCHANGED (bus factory)
  types.ts                    # MODIFIED: add new event types to AppEventMap
  main.ts                     # MODIFIED: production boots both glasses + hub
  glasses-main.ts             # MODIFIED: integrate persistence + command menu layers
  hub-main.ts                 # MODIFIED: integrate live view, text input, history
  settings.ts                 # UNCHANGED
  voice-loop-controller.ts    # MODIFIED: add text turn support for hub input
```

### Structure Rationale

- **persistence/:** Isolates all IndexedDB I/O into one folder. Matches the existing pattern of side-effect isolation (bridge/ for SDK, api/ for gateway). The convo-store module is the ONLY module that touches IndexedDB, same as even-bridge.ts is the ONLY module that touches the SDK.
- **sessions/:** Promotes sessions from a flat constant file to a proper module with CRUD. The static `SESSIONS` array in `sessions.ts` becomes the seed data for first-run, then IndexedDB owns session storage.
- **hub/:** Groups all hub-specific DOM rendering modules. Keeps the hub-main.ts file thin (wiring only) by extracting component logic into dedicated modules.
- **gestures/command-menu-fsm.ts:** Follows the exact pattern of gesture-fsm.ts -- pure function, zero imports, record-based transition table. This is the proven pattern in the codebase.

## Architectural Patterns

### Pattern 1: Persistence Tap (Bus Listener Pattern)

**What:** ConvoStore subscribes to existing bus events (`gateway:chunk`, `audio:recording-stop`) and persists messages as they flow through the system. No existing modules need to know about persistence.
**When to use:** Adding persistence to an existing event-driven system without modifying producers.
**Trade-offs:** PRO: zero coupling to existing modules. CON: persistence becomes a "silent subscriber" that could fail without visible feedback.

```typescript
// persistence-tap.ts -- subscribes to bus, writes to IndexedDB
export function createPersistenceTap(opts: {
  bus: EventBus<AppEventMap>;
  convoStore: ConvoStore;
  sessionManager: SessionManager;
  renderer: GlassesRenderer;
}): { destroy(): void } {
  const { bus, convoStore, sessionManager, renderer } = opts;
  const unsubs: Array<() => void> = [];

  // Persist user messages when transcript arrives
  unsubs.push(bus.on('gateway:chunk', async (chunk) => {
    if (chunk.type === 'transcript' && chunk.text) {
      await convoStore.addMessage(sessionManager.activeSessionId(), {
        role: 'user',
        text: chunk.text,
        timestamp: Date.now(),
      });
    }
    if (chunk.type === 'response_end') {
      const lastMsg = renderer.getLastAssistantMessage();
      if (lastMsg) {
        await convoStore.addMessage(sessionManager.activeSessionId(), {
          role: 'assistant',
          text: lastMsg.text,
          timestamp: lastMsg.timestamp,
        });
      }
    }
  }));

  return {
    destroy() {
      for (const unsub of unsubs) unsub();
      unsubs.length = 0;
    },
  };
}
```

**Why this pattern:** The existing architecture already uses the bus as the central nervous system. Persistence is just another subscriber. This avoids the anti-pattern of threading a `saveMessage()` call through every module that touches messages.

### Pattern 2: Pure FSM for Command Menu (Matches Existing gesture-fsm.ts)

**What:** The command menu is a separate pure FSM that the gesture handler delegates to when `state === 'menu'`. Menu items are a static array; scroll-up/scroll-down move selection; tap executes the selected command.
**When to use:** Any new UI state machine in this codebase should follow the pure-function FSM pattern.
**Trade-offs:** PRO: fully testable, zero dependencies, self-documenting. CON: requires an orchestrator module to wire FSM output to side effects.

```typescript
// command-menu-fsm.ts -- zero imports, pure function
export type MenuCommand = '/new' | '/reset' | '/switch' | '/rename' | '/delete';

export interface MenuState {
  items: MenuCommand[];
  selectedIndex: number;
}

export type MenuInput = 'scroll-up' | 'scroll-down' | 'tap' | 'close';

export interface MenuTransition {
  nextState: MenuState;
  action: { type: 'EXECUTE'; command: MenuCommand } | { type: 'CLOSE' } | null;
}

export function menuTransition(state: MenuState, input: MenuInput): MenuTransition {
  switch (input) {
    case 'scroll-up':
      return {
        nextState: {
          ...state,
          selectedIndex: Math.max(0, state.selectedIndex - 1),
        },
        action: null,
      };
    case 'scroll-down':
      return {
        nextState: {
          ...state,
          selectedIndex: Math.min(state.items.length - 1, state.selectedIndex + 1),
        },
        action: null,
      };
    case 'tap':
      return {
        nextState: state,
        action: { type: 'EXECUTE', command: state.items[state.selectedIndex] },
      };
    case 'close':
      return {
        nextState: { ...state, selectedIndex: 0 },
        action: { type: 'CLOSE' },
      };
  }
}
```

### Pattern 3: Thin IndexedDB Wrapper (No Library)

**What:** A hand-rolled IndexedDB wrapper using raw `IDBDatabase` with promise helpers. No Dexie, no idb-keyval.
**When to use:** When the app has simple schema needs (2 object stores, 3 indexes) and bundle size is critical (42KB .ehpk target).
**Trade-offs:** PRO: zero dependency added, full control, minimal bundle impact. CON: more boilerplate than Dexie, must handle upgrade events manually.

**Rationale for raw IndexedDB over Dexie:**
- Dexie adds 22-26KB gzipped to the bundle. The entire app is currently 42KB packaged. This would be a 50%+ size increase.
- The schema is trivial: 2 object stores (`sessions`, `messages`), 3 indexes (`sessionId`, `timestamp`, compound `[sessionId, timestamp]`). Dexie's query builder and schema migration system are overkill.
- The existing codebase uses zero external runtime dependencies beyond the Even SDK. Adding Dexie would break this pattern.

```typescript
// convo-store.ts -- raw IndexedDB with promise wrapper
const DB_NAME = 'even-openclaw';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('sessions')) {
        const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('messages')) {
        const messages = db.createObjectStore('messages', {
          keyPath: 'id',
          autoIncrement: true,
        });
        messages.createIndex('sessionId', 'sessionId');
        messages.createIndex('timestamp', 'timestamp');
        messages.createIndex('sessionId_timestamp', ['sessionId', 'timestamp']);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
```

### Pattern 4: BroadcastChannel as Dev-Only Event Mirror

**What:** In dev mode, a thin bridge subscribes to selected bus events and forwards them over BroadcastChannel. The receiving tab (glasses simulator) subscribes to the channel and re-emits into its local bus.
**When to use:** Only in dev mode when hub and glasses simulator run in separate browser tabs.
**Trade-offs:** PRO: enables dev testing of the full hub-glasses flow. CON: adds a code path that only runs in development.

**BroadcastChannel compatibility:** Supported in Android WebView since v54, iOS WKWebView since v15.4. Since the Even App uses flutter_inappwebview which delegates to native WebView, BroadcastChannel is available. However, this bridge is only needed in dev mode (browser tabs), NOT in production (single WebView context).

```typescript
// broadcast-bridge.ts -- dev-mode only, conditional instantiation
const CHANNEL_NAME = 'even-openclaw-sync';

// Events worth mirroring (skip high-frequency audio frames)
const MIRROR_EVENTS: (keyof AppEventMap)[] = [
  'gateway:chunk',
  'gateway:status',
  'audio:recording-start',
  'audio:recording-stop',
  'gesture:menu-toggle',
  'session:switched',
  'hub:text-message',
];

export function createBroadcastBridge(
  bus: EventBus<AppEventMap>,
): { destroy(): void } {
  const channel = new BroadcastChannel(CHANNEL_NAME);
  const unsubs: Array<() => void> = [];

  // Outbound: bus -> channel (skip re-emits to prevent loops)
  let suppressReEmit = false;
  for (const eventName of MIRROR_EVENTS) {
    unsubs.push(bus.on(eventName, (payload: unknown) => {
      if (!suppressReEmit) {
        channel.postMessage({ event: eventName, payload });
      }
    }));
  }

  // Inbound: channel -> bus
  channel.onmessage = (msg) => {
    const { event, payload } = msg.data;
    if (MIRROR_EVENTS.includes(event)) {
      suppressReEmit = true;
      bus.emit(event, payload);
      suppressReEmit = false;
    }
  };

  return {
    destroy() {
      for (const unsub of unsubs) unsub();
      unsubs.length = 0;
      channel.close();
    },
  };
}
```

## Data Flow

### Conversation Persistence Flow

```
[Voice Turn Completes]
    |
    v
bus.emit('gateway:chunk', { type: 'transcript', text })
    |
    +---> GlassesRenderer.addUserMessage(text)          [existing: display]
    +---> PersistenceTap -> ConvoStore.addMessage(...)   [NEW: persist]
    +---> HubLiveView.renderMessage(msg)                 [NEW: hub mirror]
    |
bus.emit('gateway:chunk', { type: 'response_end' })
    |
    +---> GlassesRenderer.endStreaming()                 [existing: display]
    +---> PersistenceTap -> ConvoStore.addMessage(...)   [NEW: persist]
    +---> SearchIndex.index(sessionId, assistantMsg)      [NEW: search]
```

### Command Menu Flow

```
[Double-tap while idle/thinking]
    |
    v
GestureHandler: gestureTransition(state, 'double-tap')
  -> state = 'menu', action = TOGGLE_MENU
    |
    v
bus.emit('gesture:menu-toggle', { active: true })
    |
    +---> DisplayController: renderer.hide()              [existing]
    +---> CommandMenu: activate, render items to glasses   [NEW]
    |
[Scroll-up / Scroll-down while state === 'menu']
    |
    v
GestureHandler delegates to CommandMenuFSM:
  menuTransition(menuState, 'scroll-down')
    |
    v
CommandMenuRenderer: bridge.textContainerUpgrade(2, formattedMenu)
  e.g. "  /new\n> /reset\n  /switch\n  /rename\n  /delete"
    |
[Tap while state === 'menu']
    |
    v
CommandMenuFSM -> action: { type: 'EXECUTE', command: '/new' }
    |
    v
CommandMenu orchestrator -> SessionManager.createSession()
    |
    v
GestureHandler: gestureTransition('menu', 'tap') -> state = 'idle'
bus.emit('gesture:menu-toggle', { active: false })  -> wake display
```

### Hub Text Input Flow

```
[User types in hub text input, presses Enter]
    |
    v
HubTextInput: validate non-empty
    |
    v
bus.emit('hub:text-message', { text, sessionId })      [NEW event type]
    |
    +---> GlassesRenderer.addUserMessage(text)           [glasses display]
    +---> PersistenceTap -> ConvoStore.addMessage(...)    [persist]
    +---> VoiceLoopController -> gateway.sendTextTurn()   [NEW: text API]
```

### Session Switch Flow

```
[Command menu: /switch OR Hub session picker]
    |
    v
SessionManager.switchSession(newSessionId)
    |
    +---> ConvoStore.getMessages(newSessionId)            [load history]
    +---> GlassesRenderer.loadConversation(messages)      [render on glasses]
    +---> bus.emit('session:switched', { sessionId })     [notify all]
    |
    v
HubLiveView hears 'session:switched'
    +---> Load and render new session's messages
```

## Modified Boot Sequence: Layer 0-5 + New Layers

The existing Layer 0-5 boot in `glasses-main.ts` needs surgical insertions, not restructuring. New layers slot between existing ones:

```typescript
export async function boot(): Promise<EventBus<AppEventMap>> {
  // Layer 0: Foundation (UNCHANGED)
  const bus = createEventBus<AppEventMap>();
  const settings = loadSettings();
  const devMode = typeof (window as any).flutter_inappwebview === 'undefined';

  // Layer 1: Hardware boundary (UNCHANGED)
  const bridge = devMode ? createBridgeMock(bus) : createEvenBridgeService(bus);
  await bridge.init();
  bridge.textContainerUpgrade(1, 'Connecting...');

  // Layer 2: Audio capture (UNCHANGED)
  const mockAudio = devMode || new URLSearchParams(location.search).has('mock-audio');
  const audioCapture = createAudioCapture(mockAudio);
  bus.on('bridge:audio-frame', ({ pcm }) => audioCapture.onFrame(pcm));

  // === NEW: Layer 2.5 -- Persistence + Session Management ===
  const convoStore = await createConvoStore();  // opens IndexedDB
  const sessionManager = createSessionManager({ convoStore, bus });
  await sessionManager.init();  // loads sessions from IDB, seeds defaults if empty

  // Layer 3: Gesture handling (MODIFIED: dynamic session ID)
  const gestureHandler = createGestureHandler({
    bus,
    bridge,
    audioCapture,
    activeSessionId: () => sessionManager.activeSessionId(),  // was: () => 'gideon'
  });

  // === NEW: Layer 3.5 -- Command Menu ===
  const commandMenu = createCommandMenu({
    bus, bridge, sessionManager, gestureHandler,
  });

  // Layer 4: Display pipeline (MODIFIED: load persisted conversation)
  const renderer = createGlassesRenderer({ bridge, bus });
  const displayController = createDisplayController({ bus, renderer });
  await displayController.init();

  const lastMessages = await convoStore.getMessages(sessionManager.activeSessionId());
  if (lastMessages.length > 0) {
    renderer.loadConversation(lastMessages);  // NEW method on renderer
  } else {
    renderer.showWelcome();
  }

  // Layer 5: Gateway + voice loop (UNCHANGED creation)
  const gateway = createGatewayClient();
  const voiceLoopController = createVoiceLoopController({
    bus, gateway, settings: () => settings,
  });

  // === NEW: Layer 5.5 -- Persistence Tap ===
  const persistenceTap = createPersistenceTap({
    bus, convoStore, sessionManager, renderer,
  });

  // === NEW: Dev-mode cross-tab sync ===
  let broadcastBridge: { destroy(): void } | null = null;
  if (devMode) {
    broadcastBridge = createBroadcastBridge(bus);
  }

  // Gateway health check (UNCHANGED)
  if (settings.gatewayUrl) {
    const healthy = await gateway.checkHealth(settings.gatewayUrl);
    if (healthy) {
      gateway.startHeartbeat(settings.gatewayUrl);
      bus.emit('gateway:status', { status: 'connected' });
    }
  } else {
    renderer.showConfigRequired();
  }

  // Cleanup (MODIFIED: add new modules in reverse order)
  let cleaned = false;
  function cleanup(): void {
    if (cleaned) return;
    cleaned = true;
    broadcastBridge?.destroy();
    persistenceTap.destroy();
    voiceLoopController.destroy();
    gateway.destroy();
    displayController.destroy();
    commandMenu.destroy();
    gestureHandler.destroy();
    audioCapture.stopRecording().catch(() => {});
    bridge.destroy();
    bus.clear();
  }

  if (!devMode) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') cleanup();
    });
    window.addEventListener('pagehide', cleanup);
  }

  // NEW: return bus so hub code can share it in production
  return bus;
}
```

## Production main.ts: Shared Context Architecture

The critical change for v1.2 is that the production path must run BOTH glasses and hub code in the same context, sharing the event bus:

```typescript
// main.ts -- v1.2
async function main() {
  const isEvenApp =
    typeof (window as any).flutter_inappwebview !== 'undefined' ||
    new URLSearchParams(location.search).has('even');

  if (isEvenApp) {
    // Production: boot glasses AND hub in same context, sharing bus
    const { boot } = await import('./glasses-main');
    const bus = await boot();  // boot() now returns the shared bus
    const { initHub } = await import('./hub-main');
    initHub(bus);  // hub receives the same bus instance
  } else {
    // Dev mode: hub only (glasses simulator in separate tab)
    const { initHub } = await import('./hub-main');
    initHub();  // no shared bus; BroadcastChannel bridge if simulator open
  }
}

main().catch((err) => {
  console.error('[main] Fatal boot error:', err);
});
```

**Why boot() must return the bus:** In production, the hub DOM and glasses bridge coexist in the same WebView. The hub's live view, text input, and session management must emit/subscribe to the same bus instance that the glasses pipeline uses. Passing the bus from boot() to initHub() makes this explicit.

## Hub-Main Integration

The hub-main.ts currently does pure DOM manipulation with no bus. For v1.2, it accepts an optional shared bus:

```typescript
// hub-main.ts -- v1.2 signature change
export async function initHub(sharedBus?: EventBus<AppEventMap>): Promise<void> {
  // Existing DOM setup (unchanged)...
  init();

  // NEW: Persistence access (IndexedDB is same-origin, works in both contexts)
  const convoStore = await createConvoStore();  // reuses same IDB database
  const sessionManager = createSessionManager({ convoStore });
  await sessionManager.init();

  // NEW: Create local bus with optional BroadcastChannel bridge for dev mode
  let bus: EventBus<AppEventMap>;
  if (sharedBus) {
    bus = sharedBus;  // Production: shared with glasses
  } else {
    bus = createEventBus<AppEventMap>();
    // Dev mode: bridge to simulator tab if open
    createBroadcastBridge(bus);
  }

  // NEW: Hub-specific features
  createHubLiveView({ bus, convoStore, sessionManager, /* DOM container */ });
  createHubTextInput({ bus, sessionManager, /* DOM container */ });
  createHistoryBrowser({ convoStore, sessionManager, /* DOM container */ });
}
```

## AppEventMap Additions

New event types needed for v1.2 features:

```typescript
export interface AppEventMap {
  // EXISTING (unchanged)
  'bridge:connected': { deviceName: string };
  'bridge:disconnected': { reason: string };
  'bridge:audio-frame': { pcm: Uint8Array; timestamp: number };
  'gesture:tap': { timestamp: number };
  'gesture:double-tap': { timestamp: number };
  'gesture:scroll-up': { timestamp: number };
  'gesture:scroll-down': { timestamp: number };
  'audio:recording-start': { sessionId: string };
  'audio:recording-stop': { sessionId: string; blob: Blob };
  'gesture:menu-toggle': { active: boolean };
  'gateway:status': { status: ConnectionStatus };
  'gateway:chunk': VoiceTurnChunk;
  'log': { level: LogLevel; msg: string; cid?: string };

  // NEW: Session lifecycle
  'session:switched': { sessionId: string; sessionName: string };
  'session:created': { sessionId: string; sessionName: string };
  'session:renamed': { sessionId: string; newName: string };
  'session:deleted': { sessionId: string };

  // NEW: Command menu
  'command:execute': { command: MenuCommand };
  'menu:selection-changed': { selectedIndex: number; command: MenuCommand };

  // NEW: Hub text input
  'hub:text-message': { text: string; sessionId: string };

  // NEW: Persistence acknowledgment
  'message:persisted': { sessionId: string; messageId: number };
}
```

## IndexedDB Schema

```typescript
// db-schema.ts
export const DB_NAME = 'even-openclaw';
export const DB_VERSION = 1;

export interface StoredSession {
  id: string;           // UUID or slug, keyPath
  name: string;
  desc: string;
  createdAt: number;    // Date.now()
  updatedAt: number;
  messageCount: number; // denormalized for fast list rendering
}

export interface StoredMessage {
  id?: number;          // auto-increment keyPath
  sessionId: string;    // foreign key -> sessions.id
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  turnId?: string;      // groups user+assistant pair
}

// Object stores and indexes:
// sessions: keyPath 'id', index on 'createdAt'
// messages: autoIncrement 'id', indexes on:
//   'sessionId'            -- get all messages for a session
//   'timestamp'            -- global time ordering
//   ['sessionId', 'timestamp']  -- messages for a session in time order (primary query)
```

## Full-Text Search Strategy

IndexedDB has no native full-text search. For v1.2, use an **in-memory token index** built at startup:

1. On app boot, load all message text from IndexedDB (`getAll` on messages store)
2. Build a reverse index: `Map<string, Set<number>>` mapping lowercased tokens to message IDs
3. On search query, tokenize the query, intersect the ID sets, fetch matching messages from IDB
4. On new message persist, add its tokens to the in-memory index

**Why not a persistent search index in IndexedDB:** The token-to-ID map would be complex to maintain across schema versions. The message corpus for a single user on glasses is small (hundreds to low thousands of messages). Loading all message text into memory at boot is fast (~1ms per 1000 messages) and the in-memory index provides sub-millisecond search.

**Scaling concern:** If message count exceeds ~10K, switch to cursor-based loading and paginated search. This is unlikely for v1.2 given the voice-first interaction model (each turn takes 10-30 seconds).

```typescript
// search-index.ts -- pure function, zero side effects
export interface SearchIndex {
  add(messageId: number, text: string): void;
  search(query: string): number[];  // returns matching message IDs
}

export function createSearchIndex(): SearchIndex {
  const index = new Map<string, Set<number>>();

  function tokenize(text: string): string[] {
    return text.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  }

  function add(messageId: number, text: string): void {
    for (const token of tokenize(text)) {
      let set = index.get(token);
      if (!set) { set = new Set(); index.set(token, set); }
      set.add(messageId);
    }
  }

  function search(query: string): number[] {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];

    const sets = tokens
      .map((t) => index.get(t))
      .filter((s): s is Set<number> => s !== undefined);

    if (sets.length === 0) return [];
    if (sets.length === 1) return [...sets[0]];

    // Intersect all token sets
    const smallest = sets.reduce((a, b) => (a.size < b.size ? a : b));
    return [...smallest].filter((id) =>
      sets.every((s) => s.has(id)),
    );
  }

  return { add, search };
}
```

## Modules That Need Modification

| Module | Change | Scope |
|--------|--------|-------|
| `types.ts` | Add new event types to AppEventMap, import MenuCommand type | Small: ~20 lines added |
| `main.ts` | Production path boots both glasses and hub; passes shared bus | Small: ~8 lines changed |
| `glasses-main.ts` | Insert Layer 2.5 (persistence), 3.5 (command menu), 5.5 (persistence tap); boot() returns bus; modify cleanup | Medium: ~35 lines added |
| `hub-main.ts` | Accept optional shared bus; initialize hub modules (live view, text input, history) | Medium: ~40 lines added |
| `gesture-handler.ts` | Delegate to command-menu orchestrator when `state === 'menu'`; add commandMenu dependency | Small: ~15 lines in dispatchAction() |
| `glasses-renderer.ts` | Add `loadConversation(messages)` and `getLastAssistantMessage()` methods | Small: ~20 lines |
| `voice-loop-controller.ts` | Add text turn support for hub:text-message events | Small: ~10 lines |
| `sessions.ts` | Deprecate -- replaced by sessions/session-manager.ts backed by IndexedDB | Full replacement |
| `index.html` | Add hub live view container, text input, history page, conversations nav | Medium: new HTML sections |

## Modules That Stay Unchanged

| Module | Why Unchanged |
|--------|--------------|
| `events.ts` | Event bus factory is generic; new events just need type entries |
| `gesture-fsm.ts` | Already handles menu state transitions correctly via TOGGLE_MENU |
| `display-controller.ts` | Already handles menu-toggle and all gateway:chunk events |
| `even-bridge.ts` | SDK wrapper unchanged; command menu uses existing textContainerUpgrade |
| `bridge-mock.ts` | Mock interface unchanged |
| `bridge-types.ts` | BridgeService interface unchanged |
| `viewport.ts` | Pure viewport windowing unchanged |
| `icon-animator.ts` | Animation system unchanged |
| `audio-capture.ts` | Audio pipeline unchanged |
| `gateway-client.ts` | May need sendTextTurn() method but existing voice turn unchanged |
| `settings.ts` | Settings schema unchanged for v1.2 |
| `app-wiring.ts` | Pure hub logic functions unchanged |
| `logs.ts` | Log store unchanged |

## Anti-Patterns

### Anti-Pattern 1: Splitting Bus Across Contexts Unnecessarily

**What people do:** Create a separate event bus for hub and glasses, then build complex sync infrastructure between them.
**Why it's wrong:** In production, glasses and hub share the same WebView and JavaScript context. Building cross-context sync for production adds latency, complexity, and failure modes to something that is already a shared memory space.
**Do this instead:** Use the SAME bus instance for both glasses and hub code in production. Reserve BroadcastChannel bridging for dev-mode simulator only.

### Anti-Pattern 2: Persisting Inside Display Modules

**What people do:** Add `convoStore.addMessage()` calls inside `GlassesRenderer.addUserMessage()` or `endStreaming()`.
**Why it's wrong:** Couples display rendering to storage I/O. The renderer becomes untestable without IndexedDB mocks. Violates the existing architecture where pure-function modules have zero side-effect imports.
**Do this instead:** Persistence subscribes to bus events as a separate listener (PersistenceTap). The renderer never knows IndexedDB exists.

### Anti-Pattern 3: Making Command Menu a DOM Overlay

**What people do:** Render the command menu as HTML elements overlaid on the glasses display.
**Why it's wrong:** The glasses display is NOT DOM. It is a set of text containers pushed to the G2 hardware via SDK bridge calls. HTML overlays are invisible on the physical glasses. The "display" is `bridge.textContainerUpgrade()` calls, not CSS.
**Do this instead:** Render the command menu by calling `bridge.textContainerUpgrade()` with formatted text showing the menu items and a selection indicator (e.g., `"  /new\n> /reset\n  /switch"`).

### Anti-Pattern 4: Eager-Loading Full Conversation History

**What people do:** Load all messages for all sessions into memory at boot.
**Why it's wrong:** Adds boot latency proportional to total message count. The glasses boot sequence already shows a "Connecting..." indicator; adding I/O here extends the time before the user can interact.
**Do this instead:** Load only the active session's messages at boot. Lazy-load other sessions when the user switches or browses history in the hub.

### Anti-Pattern 5: Using SharedWorker for Cross-Context Sync

**What people do:** Reach for SharedWorker as the cross-context communication mechanism.
**Why it's wrong:** SharedWorker support in Android WebView is inconsistent. BroadcastChannel is simpler, lighter, and has confirmed support in Android WebView since v54. SharedWorker adds unnecessary complexity for what amounts to event forwarding.
**Do this instead:** BroadcastChannel for dev-mode tab sync. In production, no sync mechanism needed at all.

## Build Order (Dependency Chain)

The dependency chain dictates this build order:

```
Phase 1: Foundation (no dependencies on other new modules)
   1. db-schema.ts           -- types only, no logic
   2. convo-store.ts         -- depends on db-schema, IndexedDB
   3. search-index.ts        -- pure function, no dependencies

Phase 2: Session Management (depends on Phase 1)
   4. session-types.ts       -- types for session-manager
   5. session-manager.ts     -- depends on convo-store
   6. types.ts updates       -- add new event types to AppEventMap

Phase 3: Glasses Features (depends on Phase 2)
   7. command-menu-fsm.ts    -- pure function, no dependencies
   8. command-menu-renderer.ts -- depends on bridge-types
   9. command-menu.ts         -- depends on 7, 8, session-manager, bus
  10. gesture-handler.ts mod  -- wire command menu delegation
  11. glasses-renderer.ts mod -- add loadConversation, getLastAssistantMessage
  12. persistence-tap.ts      -- depends on convo-store, bus, renderer
  13. glasses-main.ts mod     -- integrate all new layers

Phase 4: Hub Features (depends on Phase 1, 2)
  14. hub-live-view.ts       -- depends on bus, convo-store
  15. hub-text-input.ts      -- depends on bus, session-manager
  16. history-browser.ts     -- depends on convo-store, search-index
  17. hub-main.ts mod        -- integrate hub modules, accept shared bus
  18. main.ts mod            -- shared bus in production path

Phase 5: Dev Sync (depends on Phase 3, 4)
  19. broadcast-bridge.ts    -- depends on bus, BroadcastChannel API
  20. Wire into glasses-main + hub-main for dev mode
```

**Phase ordering rationale:**
- Phase 1 has zero dependencies on other new modules; everything else depends on it
- Phase 2 (SessionManager) depends on ConvoStore from Phase 1
- Phase 3 (glasses features) can be built and tested independently of hub features
- Phase 4 (hub features) can be built and tested independently of glasses features
- Phase 5 (dev sync) is the lowest priority -- production works without it

## Integration Points

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| ConvoStore <-> SessionManager | Direct method calls | SessionManager delegates all IDB operations to ConvoStore |
| PersistenceTap <-> ConvoStore | Direct method calls | PersistenceTap is the only writer outside SessionManager |
| CommandMenu <-> GestureHandler | Bus events + direct delegation | GestureHandler calls commandMenu methods when state='menu' |
| HubLiveView <-> GlassesRenderer | Bus events (indirect) | Both subscribe to gateway:chunk; no direct coupling |
| HubTextInput <-> VoiceLoopController | Bus events (hub:text-message) | Hub emits, voice loop subscribes and sends to gateway |
| SearchIndex <-> ConvoStore | ConvoStore feeds data, SearchIndex is independent | SearchIndex has no dependency on ConvoStore |

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| IndexedDB | ConvoStore wraps all access | Only convo-store.ts touches IDB |
| BroadcastChannel | BroadcastBridge wraps all access | Only broadcast-bridge.ts touches BroadcastChannel; dev mode only |
| Even Hub SDK | even-bridge.ts wraps all access | Unchanged from v1.1 |
| Gateway API | gateway-client.ts wraps all access | May need new sendTextTurn() endpoint |

## Sources

- [MDN: BroadcastChannel API](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API) -- HIGH confidence, official documentation
- [MDN: Using IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB) -- HIGH confidence, official documentation
- [Can I WebView: BroadcastChannel](https://caniwebview.com/features/mdn-broadcastchannel/) -- Android WebView support since v54, iOS WKWebView since v15.4 -- HIGH confidence
- [Even G2 Developer Notes](https://github.com/nickustinov/even-g2-notes/blob/main/G2.md) -- Single WebView architecture for glasses + hub -- MEDIUM confidence (community notes, verified against codebase patterns)
- [Dexie.js Bundle Size Issue #1585](https://github.com/dexie/Dexie.js/issues/1585) -- 22-26KB gzipped -- HIGH confidence
- [Speeding up IndexedDB reads and writes](https://nolanlawson.com/2021/08/22/speeding-up-indexeddb-reads-and-writes/) -- batched cursor patterns -- MEDIUM confidence
- [Cross-Tab Communication patterns](https://dev.to/naismith/cross-tab-communication-with-javascript-1hc9) -- localStorage fallback for BroadcastChannel -- MEDIUM confidence
- [LogRocket: Offline-first frontend apps in 2025](https://blog.logrocket.com/offline-first-frontend-apps-2025-indexeddb-sqlite/) -- IndexedDB best practices -- MEDIUM confidence
- [npm-compare: idb vs dexie vs localforage](https://npm-compare.com/dexie,idb,localforage) -- Library comparison -- MEDIUM confidence
- Direct codebase analysis of all 43 source files across 6,336 LOC -- HIGH confidence

---
*Architecture research for: Even G2 OpenClaw Chat App v1.2 -- Conversation Intelligence & Hub Interaction*
*Researched: 2026-02-28*
