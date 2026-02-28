# Pitfalls Research

**Domain:** Conversation persistence, cross-context sync, dynamic sessions, and command menu for Even G2 smart glasses app
**Researched:** 2026-02-28
**Confidence:** MEDIUM-HIGH (IndexedDB WebView pitfalls verified against multiple sources and codebase constraints; FSM state explosion verified against existing 5x4 transition table; cross-context sync pitfalls verified against architecture -- Even App WebView runs hub and glasses in separate contexts; bus timing verified against synchronous dispatch in events.ts)

## Critical Pitfalls

### Pitfall 1: IndexedDB Transaction Auto-Commit Kills Async Persistence Patterns

**What goes wrong:**
A developer writes a natural async pattern: open IndexedDB transaction, await gateway response or bus event, then write to the store. The transaction silently auto-commits before the async operation resolves. The put() call throws "Transaction is already committing or done" -- or worse, succeeds silently because a new implicit transaction is created, breaking atomicity. Messages appear saved but are actually lost after app restart.

**Why it happens:**
IndexedDB transactions auto-close as soon as the browser finishes processing the current microtask queue with no pending requests. Any `await` that yields to the event loop (even a single `await sleep(0)`) causes the transaction to commit. This is the single most common IndexedDB bug. The existing codebase has zero async storage -- settings use synchronous localStorage. Developers will naturally try the same patterns they use with localStorage but with `await db.put()` inside broader async flows.

The specific danger in this app: the voice loop controller listens for `gateway:chunk` events (synchronous bus dispatch), and a developer will try to persist each chunk inside the event handler. If they open a transaction in `response_start`, accumulate in `response_delta`, and finalize in `response_end`, the transaction dies between the first and second event because each event dispatch is a separate synchronous call stack.

**How to avoid:**
- Never hold an IndexedDB transaction open across event bus callbacks. Each bus event handler that writes to IndexedDB must open its own transaction, write, and let it auto-commit within that single synchronous call.
- Use a write-behind buffer pattern: accumulate chat messages in memory (the existing `viewport.messages` array), then persist the complete message to IndexedDB only at `response_end` or on a debounced timer (e.g., every 2 seconds during streaming). One transaction per complete message, not per chunk.
- Use the `idb` library (Jake Archibald's promise wrapper) which makes transaction scoping explicit and prevents accidental cross-await usage. Avoid raw IndexedDB API.
- Add a persistence service with a simple API: `saveMessage(msg: ChatMessage): Promise<void>` that internally opens a fresh transaction each call.

**Warning signs:**
- "InvalidStateError: The transaction has finished" in console during streaming
- Messages appear in the chat UI but disappear after app restart
- Persistence works for short responses but fails for long streaming responses
- Tests pass (fake-indexeddb handles auto-commit differently than real browsers)

**Phase to address:**
IndexedDB persistence layer phase (first phase of v1.2). Design the transaction strategy before writing any persistence code.

---

### Pitfall 2: IndexedDB Persistence May Not Survive Even App WebView Lifecycle

**What goes wrong:**
IndexedDB data persists across page loads in a normal browser, but the Even App runs web content in a `flutter_inappwebview` on the iPhone. WebKit (WKWebView, which backs flutter_inappwebview on iOS) has a history of clearing IndexedDB data under storage pressure, on iOS updates, or after the Even App is force-quit. There is a long-standing WebKit bug (Bug 144875) where WKWebView does not persist IndexedDB data after the parent app closes. Conversations the user thought were saved are silently gone.

**Why it happens:**
The Even App architecture is: server -> HTTPS -> iPhone Even App (Flutter) -> flutter_inappwebview -> your web app. On iOS, flutter_inappwebview uses WKWebView, which has historically had storage persistence issues. Safari also has a 7-day data expiry for sites "without user interaction" (Intelligent Tracking Prevention), though this typically affects third-party contexts. Additionally, if the Even App ever clears its WebView cache (some Flutter apps do this on update), all IndexedDB data is wiped.

The codebase currently uses `localStorage` for settings, which faces the same risks but settings are low-value (easily re-entered). Conversation history is high-value and irreplaceable.

**How to avoid:**
- Treat IndexedDB as a cache, not as the single source of truth. Design the persistence layer with an "export to gateway" capability from day one. The gateway backend is the permanent store; IndexedDB is the fast local buffer.
- Implement `navigator.storage.persist()` at app startup to request durable storage. Check the return value and log whether persistent storage was granted. If denied, show a warning in the hub diagnostics page.
- Add a `storage:quota-warning` event to the bus when IndexedDB usage exceeds 50% of the available quota (check via `navigator.storage.estimate()`).
- On every app boot, verify IndexedDB integrity by reading a known sentinel record. If the sentinel is missing, emit a `storage:data-lost` event and show a user-visible warning rather than silently operating with no history.
- Include conversation count and last-saved timestamp in the hub's health display so users can see if their data survived.

**Warning signs:**
- Conversation history is empty after iPhone reboot or Even App update
- `navigator.storage.persisted()` returns `false` on the Even App WebView
- IndexedDB open() succeeds but the database is empty (data was evicted)
- Works fine during development (browser has generous storage) but fails on device

**Phase to address:**
IndexedDB persistence layer phase. The storage durability check must be part of the initial implementation, not added later.

---

### Pitfall 3: Session Switch During Active Voice Loop Causes Data Corruption

**What goes wrong:**
The user double-taps to open the command menu and selects /switch while the gateway is streaming a response. The active session ID changes, but the in-flight SSE stream continues delivering chunks for the old session. The display controller writes these chunks to the new session's viewport, and the persistence layer saves them under the new session's ID. The old session loses its final response, and the new session starts with a ghost response from a different conversation.

**Why it happens:**
The existing gesture handler receives `activeSessionId` as a getter function: `activeSessionId: () => string`. The voice loop controller reads `settings()` at the time audio is sent. But the display controller and persistence layer read the "current session" at the time they receive bus events. There is no concept of a "turn ID" that binds a gateway response to the session that initiated it. The gateway does return a `turnId` in `VoiceTurnChunk`, but nothing in the current pipeline uses it for session correlation.

The FSM has a `menu` state that coexists with `thinking` (double-tap during thinking -> menu), but the transition table currently sends `thinking` + `double-tap` -> `menu` with `TOGGLE_MENU` action. There is no guard preventing session switch while a stream is active.

**How to avoid:**
- Tag every voice turn with both `sessionId` and `turnId` at the point of `audio:recording-stop`. Carry these IDs through the entire pipeline: gateway request, SSE chunks, display rendering, and persistence writes. Never use the "current session" for writes -- always use the turn's originating session.
- Add a `turn:active` flag to the voice loop controller. When a turn is in flight, the command menu's /switch and /delete commands are disabled (greyed out on the glasses display, show "Finish current turn first" hint).
- Alternatively, allow session switch during active turn but drain the in-flight response to the originating session. The display stops showing the old turn's chunks, but persistence completes to the correct session ID.
- Add a `voiceLoop:turnStart` and `voiceLoop:turnEnd` event pair to the bus so all consumers know when a turn is in flight.

**Warning signs:**
- Switching sessions mid-response causes the new session to show a response from the previous conversation
- The old session is missing its last response after switching back
- Persistence layer saves a message with mismatched sessionId and content
- Race conditions in tests that depend on session ID timing

**Phase to address:**
Dynamic sessions phase. Must be resolved before session switching is exposed via the command menu.

---

### Pitfall 4: FSM State Explosion When Adding Command Menu Sub-States

**What goes wrong:**
The existing FSM has 5 states (idle, recording, sent, thinking, menu) with 5 inputs (tap, double-tap, scroll-up, scroll-down, reset). Adding command menu items (/new, /reset, /switch, /rename, /delete) means the `menu` state needs to track which item is focused, handle selection (tap), handle scrolling between items, and handle confirmation for destructive actions (delete). A naive approach adds 5+ sub-states (menu-new-focused, menu-reset-focused, etc.) or a parallel "selected item" variable, blowing up the transition table from 25 entries to 50+ entries and making it untestable.

**Why it happens:**
The existing FSM is a flat transition table -- elegant for 5 states but not designed for hierarchical state. The `menu` state currently only has: double-tap -> idle (close), tap -> idle (dismiss), scroll-up/down -> menu (scroll), reset -> idle. Adding "which menu item is selected" and "is a confirmation dialog showing" requires either nested states or auxiliary data alongside the FSM state.

The 576x288 display constraint makes this worse: the menu must show items in a scrollable list, but the display can only show ~4-5 lines of text at the menu's y-position range (the status bar takes 30px, leaving 258px for content).

**How to avoid:**
- Do NOT expand the flat FSM with per-menu-item states. Instead, keep the FSM's `menu` state as-is and add a separate, independent `MenuController` that manages menu item selection, scrolling, and confirmation as its own internal state. The FSM stays at 5 states. The menu controller activates when FSM enters `menu` and deactivates when FSM leaves `menu`.
- The MenuController is a pure-function module (like gesture-fsm.ts) with its own state: `{ items: MenuItem[], selectedIndex: number, confirmingAction: string | null }`. It receives scroll-up/scroll-down/tap inputs from the gesture handler when FSM is in `menu` state.
- Use a hierarchical state pattern: the FSM's `menu` state delegates to the MenuController. The gesture handler checks `if (fsmState === 'menu') menuController.handleInput(input)` before the normal FSM transition.
- Keep the confirmation flow simple: /delete shows "Delete [name]? Tap to confirm" on the display, double-tap to cancel. One level of nesting maximum, no nested menus.

**Warning signs:**
- FSM transition table grows beyond 30-35 entries and becomes hard to verify by inspection
- Test file for gesture-fsm.ts doubles in size
- Menu selection bugs where scrolling past the last item wraps or gets stuck
- Gesture inputs are handled differently in menu vs non-menu states with duplicated logic

**Phase to address:**
Command menu phase. Design the MenuController as a separate pure-function module before integrating with the FSM.

---

### Pitfall 5: BroadcastChannel Unavailable or Unreliable in Even App WebView

**What goes wrong:**
The hub (running in the phone browser or in a hub WebView) and the glasses app (running in the Even App WebView) need real-time sync. A developer uses BroadcastChannel for cross-context communication, but BroadcastChannel support in Android WebView and iOS WKWebView is listed as "unknown" on caniwebview.com. Even if it works in development (Chrome browser), it fails silently on the actual device because the hub and glasses contexts may not share the same browsing context origin, or BroadcastChannel simply is not available in the flutter_inappwebview runtime.

**Why it happens:**
The Even App architecture loads the web app URL in flutter_inappwebview. The hub might be opened as a separate browser tab on the phone, or as a different WebView context within the Even App. BroadcastChannel only works between browsing contexts of the same origin AND within the same storage partition. Two separate WebView instances (even loading the same URL) may have different storage partitions, making BroadcastChannel invisible across them.

The existing codebase has no cross-context communication -- the hub (`hub-main.ts`) and glasses (`glasses-main.ts`) are completely independent. They share the same source but run as separate entry points with separate state.

**How to avoid:**
- Do NOT rely on BroadcastChannel as the primary sync mechanism. Use it as an optimization only, with a fallback.
- Primary sync mechanism: IndexedDB as the shared state store + polling. The hub polls IndexedDB every 500ms-1s for new messages. The glasses app writes to IndexedDB after each message. This is slow but universally reliable.
- Enhancement: Use `localStorage` storage events as a lightweight change notification. Write a `lastUpdated` timestamp to localStorage after each IndexedDB write. The hub listens for the `storage` event and re-reads from IndexedDB when it fires. Storage events fire cross-tab on the same origin.
- Feature-detect BroadcastChannel (`'BroadcastChannel' in self`) and use it when available, fall back to localStorage events + polling when not.
- Design the sync layer as an abstract interface: `SyncChannel { send(msg): void; onMessage(cb): Unsubscribe }` with BroadcastChannel and localStorage+polling implementations.

**Warning signs:**
- Hub shows stale conversation data that never updates
- Sync works in Chrome dev mode but not on the actual iPhone with Even App
- `typeof BroadcastChannel` returns `'undefined'` in the Even App WebView console
- Storage events fire in some contexts but not others

**Phase to address:**
Event bus bridge / cross-context sync phase. Must be the first thing prototyped on real hardware before building features that depend on it.

---

### Pitfall 6: Hub Text Input Races with Glasses Voice Input on Same Session

**What goes wrong:**
The user types a message in the hub while simultaneously recording a voice message on the glasses. Both inputs target the same session. The gateway receives two overlapping requests. The display shows interleaved responses (hub text response chunks mixed with glasses voice response chunks). The persistence layer saves messages in the wrong order. The conversation becomes incoherent.

**Why it happens:**
The existing voice loop is single-threaded by gesture: tap starts recording, tap stops, gateway receives one request, streams one response. There is no mechanism to queue or block concurrent requests. Adding hub text input introduces a second input source that has no coordination with the glasses voice loop. The gateway client's `sendVoiceTurn()` already calls `abort()` on the previous request, but a hub text submission would be a separate code path that does not share the same abort controller.

The event bus is synchronous and single-threaded, which helps with ordering within a single context, but the hub and glasses run in separate contexts with separate event bus instances. There is no global request queue.

**How to avoid:**
- Add a turn-level lock: a `TurnManager` that tracks whether a turn is in flight. Both the glasses voice input and the hub text input must acquire this lock before sending to the gateway. If a turn is in flight, the second input is queued (not dropped).
- The TurnManager lives in the persistence layer (IndexedDB) since it must be visible to both contexts. Write a `currentTurn: { sessionId, turnId, status }` record. Before starting a new turn, check this record.
- For the hub specifically: show a "Glasses is recording..." indicator that disables the send button when a voice turn is in flight. The hub learns about the glasses state via the cross-context sync channel.
- For the glasses: if a hub text turn is in flight, the gesture handler shows "Hub message pending..." hint and blocks START_RECORDING until the turn completes.

**Warning signs:**
- Two responses stream simultaneously on the glasses display, interleaving chunks
- The conversation log shows a hub message sandwiched inside a voice response
- Gateway receives abort() followed immediately by a new request from a different source
- Persistence layer has two messages with nearly identical timestamps from different sources

**Phase to address:**
Hub text input phase. Must be designed after the TurnManager/turn-level lock is in place, which depends on the persistence layer.

---

### Pitfall 7: Command Menu Rendering Overflows 576x288 Display

**What goes wrong:**
The command menu (/new, /reset, /switch, /rename, /delete) needs to render a scrollable list on the 576x288 glasses display, but the display is text-only with absolute positioning and no CSS. A developer renders all 5 menu items at once, exceeding the available vertical space, and the bottom items are clipped or overlap with the hint bar. Or the menu text is too long ("Switch to: Gideon (Coding assistant)") and gets truncated mid-word, making items unreadable.

**Why it happens:**
The glasses display is not a DOM -- it is a text-only canvas with SDK-controlled positioning. The existing layout uses 3 containers: status (0-30px), chat (34-288px), and the chat area is 576x254px. The command menu must replace the chat container's content. With the single fixed font and no size control, each line takes approximately 24-28px height. The chat container can fit approximately 9-10 lines. But the menu also needs: a title line ("Commands"), visual focus indicator (e.g., "> " prefix on selected item), and a hint line at the bottom ("Tap to select | Scroll to navigate"). This leaves room for only about 5-7 visible menu items.

The current renderer uses `bridge.textContainerUpgrade(2, text)` to push text to the chat container with a 2000-character limit. Menu rendering must stay within this same constraint.

**How to avoid:**
- Design menu rendering as a viewport window over the items array, identical to the existing `viewport.ts` pattern. Track `selectedIndex` and render only items visible in the current scroll window.
- Use short, action-oriented labels: `/new`, `/reset`, `/switch`, `/rename`, `/delete`. Show description only for the focused item on a second line.
- Format menu items as: `> /new  Create session` (focused) vs `  /switch` (unfocused). The `> ` prefix is the selection indicator.
- Limit item descriptions to 40 characters. Use the existing `truncate()` utility from utils.ts.
- The menu title and hint text consume 2 lines, leaving 7 lines for items -- more than enough for 5 commands. But /switch needs a sub-menu for session selection, which could have many sessions. Apply the same scrolling viewport pattern for session lists.
- Test with maximum-length session names (the current Session type has `name: string` with no length limit).

**Warning signs:**
- Menu items are cut off at the bottom of the display
- Scrolling past the last item shows blank space or wraps to the top unexpectedly
- Selected item indicator is not visible after scrolling
- Menu text overlaps with the status bar or extends past the 576px width

**Phase to address:**
Command menu rendering phase. Create a `MenuRenderer` that reuses the viewport windowing pattern.

---

### Pitfall 8: Full-Text Search on IndexedDB Is Inherently Slow Without Explicit Index Design

**What goes wrong:**
A developer implements full-text search by iterating all conversation messages with a cursor and running `text.toLowerCase().includes(query)` on each. This works for 10 conversations but becomes noticeably slow (>500ms) at 100+ conversations with long messages, freezing the hub UI and blocking the main thread.

**Why it happens:**
IndexedDB has no built-in full-text search. Its indexes only support exact match, range queries, and key-prefix matching. Searching for a substring within a message body requires a full table scan. The IndexedDB cursor API is async and callback-based, adding overhead per record. On the Even App WebView (mobile device), CPU and memory are more constrained than desktop, making this worse.

The existing app has no search functionality. The `viewport.ts` module operates on in-memory arrays. Moving to IndexedDB-backed persistence introduces the first scenario where a query must scan unbounded data.

**How to avoid:**
- Pre-compute a search index on write, not on query. When saving a message, tokenize the text into lowercase words and store a `words: string[]` field on the message record. Create a multi-entry IndexedDB index on the `words` field. Full-text search becomes: `index.getAll(IDBKeyRange.only(queryWord))` for each query word, then intersect results in memory.
- For the v1.2 scope, a simpler approach: keep an in-memory search index (Map of word -> messageId[]) that is built on app startup by reading all messages once. Search queries hit the in-memory index. This avoids IndexedDB cursor overhead during search.
- Cap the number of stored conversations (e.g., 200) with an LRU eviction policy. This bounds scan time regardless of approach.
- Run search in a debounced handler (300ms after last keystroke) to avoid firing on every character.
- If search results take >200ms to compute, move the search to a Web Worker (if available in the WebView) to avoid blocking the hub UI thread.

**Warning signs:**
- Search results take >300ms to appear in the hub
- Hub UI freezes during search on mobile device
- Search works fine with 5 conversations but degrades linearly as history grows
- Tests pass with small fixture data but real-world performance is unacceptable

**Phase to address:**
Full-text search phase (likely one of the later v1.2 phases). Design the index strategy when building the persistence layer, even if search UI comes later.

---

### Pitfall 9: Synchronous Event Bus Cannot Bridge Two Separate JavaScript Contexts

**What goes wrong:**
A developer assumes the typed event bus (`createEventBus<AppEventMap>()`) can be used for hub-to-glasses communication because both contexts use the same TypeScript types. They add new events like `hub:text-submitted` or `sync:message-saved` to `AppEventMap` and expect the hub to emit and the glasses to receive. Nothing happens. The bus instances are completely separate -- one in the hub WebView, one in the glasses WebView.

**Why it happens:**
The `main.ts` router creates completely separate boot paths: `glasses-main.ts` creates its own `createEventBus<AppEventMap>()`, and `hub-main.ts` does not even use the event bus (it is vanilla DOM-event driven). These are two separate JavaScript execution contexts, potentially in two separate WebViews. The bus is an in-memory Map of handlers -- it has no serialization, no network transport, no persistence.

The codebase's clean architecture (typed bus, pure functions, factory pattern) makes it easy to forget that types are compile-time only. At runtime, the hub and glasses have zero shared state.

**How to avoid:**
- Create a clear conceptual separation: the AppEventMap bus is for intra-context communication ONLY (within glasses-main or within a hypothetical hub-bus). Cross-context communication uses a separate mechanism: the SyncChannel abstraction (see Pitfall 5).
- Define a separate `SyncEventMap` type for cross-context messages. These messages must be serializable (no Blob, no functions, no circular references). Keep `AppEventMap` for internal events.
- The bridge between internal bus and sync channel is explicit adapter code: `bus.on('message:saved', (msg) => syncChannel.send({ type: 'message:saved', payload: msg }))`. This makes the boundary visible and testable.
- Document the architecture boundary clearly: "AppEventMap = same context, SyncEventMap = cross context" in a types file.

**Warning signs:**
- New event types added to AppEventMap that are only emitted in one context and expected in another
- Tests mock the bus and pass, but real-device testing shows no cross-context communication
- Developer adds `bus.on('hub:text-submitted', ...)` in glasses-main.ts and it never fires

**Phase to address:**
Event bus bridge phase. This architectural decision must be made before any cross-context feature is implemented.

---

### Pitfall 10: IndexedDB Version Upgrade Blocks If Old Connection Is Open in Another Context

**What goes wrong:**
The glasses WebView has an open IndexedDB connection. The hub WebView tries to open the same database with a higher version number (because a schema migration was added). The upgrade is blocked because the glasses WebView did not close its connection. The hub hangs indefinitely on `indexedDB.open()`, and the `onblocked` event fires but nobody handles it. The hub shows a blank conversation history page.

**Why it happens:**
IndexedDB requires ALL existing connections to a database to close before a version upgrade can proceed. The spec says: when a higher version is requested, the browser sends a `versionchange` event to all open connections. Those connections must call `db.close()` in response. If they do not, the upgrade request fires a `blocked` event and waits indefinitely. In the Even App, the glasses WebView and hub WebView are separate contexts that may both hold open IndexedDB connections to the same database.

**How to avoid:**
- Always register a `versionchange` event handler on every `IDBDatabase` instance that immediately closes the connection: `db.onversionchange = () => db.close()`. This is mandatory for any multi-context IndexedDB usage.
- Handle the `blocked` event on the open request: `request.onblocked = () => { /* retry after delay, or show user message */ }`. Include a timeout (5 seconds) and fallback behavior.
- Minimize schema migrations. Design the initial IndexedDB schema to be extensible (use generic object stores with flexible value shapes rather than rigid, version-coupled schemas).
- Use a single, stable database version for v1.2. Only bump the version if absolutely necessary (new indexes, new object stores). Adding data to existing stores does not require a version bump.

**Warning signs:**
- Hub page loads but conversation list never appears
- Console shows "blocked" event on IndexedDB open request
- Works when only one context is open, fails when both are open simultaneously
- Schema migration works in tests (single context) but blocks on device (dual context)

**Phase to address:**
IndexedDB persistence layer phase. The `versionchange` handler must be part of the database initialization code from the first implementation.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Persist only on `response_end`, not per-chunk | Simpler persistence logic, fewer IDB transactions | Long responses lost entirely if app crashes mid-stream | v1.2 MVP only; add periodic flush (every 5s) before release |
| Skip `navigator.storage.persist()` check | Avoids platform-specific code paths | Data silently evicted under storage pressure on iOS | Never -- 3 lines of code, critical for user trust |
| Use polling instead of BroadcastChannel for sync | Works everywhere, no feature detection needed | 500ms-1s latency for hub<->glasses updates, battery drain | Acceptable for v1.2; optimize with BroadcastChannel in v1.3 |
| Full table scan for search | No index maintenance, simpler persistence schema | Search freezes UI at 100+ conversations | Acceptable if conversations capped at 50; not beyond |
| Single shared database for hub and glasses | Simpler code, single schema file | Version upgrade blocking between contexts (Pitfall 10) | Acceptable with proper `versionchange` handler |
| Store full message text without tokenization | Simpler write path, no preprocessing | Search requires full scan, grows linearly with data | Acceptable for v1.2 MVP with <50 conversations |
| Hardcode 5 menu items without extensibility | Faster to build command menu | Adding new commands requires touching FSM, renderer, and handler | Acceptable for v1.2; refactor if >7 commands |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| IndexedDB + synchronous event bus | Open transaction in one event handler, expect it alive in the next | Each event handler opens its own transaction. Write-behind buffer for streaming chunks. |
| Cross-context sync + AppEventMap | Add hub events to AppEventMap expecting cross-context delivery | Use separate SyncEventMap with serializable payloads. Explicit adapter between bus and sync channel. |
| Session switch + active voice turn | Change activeSessionId while gateway is streaming | Tag turns with sessionId at initiation time. Use turn-level lock to prevent concurrent requests. |
| MenuController + gesture handler | Duplicate input handling logic in menu and non-menu code paths | FSM stays at 5 states. MenuController is a separate module activated only when FSM is in `menu` state. |
| IndexedDB schema upgrade + dual WebView | Bump database version without versionchange handler | Always register `db.onversionchange = () => db.close()`. Handle `blocked` event with timeout. |
| Hub text input + glasses voice input | Two concurrent gateway requests without coordination | TurnManager with acquire/release pattern. Hub shows "Glasses recording" indicator. |
| Full-text search + IndexedDB cursors | Iterate all records with `.includes()` on every keystroke | Debounce 300ms, pre-built in-memory index, or tokenized multi-entry index on write. |
| Persistence + viewport.messages array | Persist from viewport (which trims to MAX_TURNS=8) | Persist from the source of truth (bus events), not from the display buffer. Viewport is a view, not the data model. |
| Menu rendering + 576x288 display | Render all items at once assuming CSS handles overflow | Use viewport windowing pattern (like viewport.ts). Calculate visible items from pixel budget. |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| IndexedDB write per streaming chunk | 5-20 IDB transactions per second during streaming, each blocking the main thread | Buffer chunks in memory, persist complete messages only | Immediately during any streaming response; compounds with long responses |
| Full table scan search on mobile WebView | Hub freezes for 500ms+ during search, unresponsive to touch | Pre-built search index (memory or multi-entry IDB index) | At ~50-100 conversations with average 10 messages each |
| Cross-context polling at <500ms interval | Battery drain, CPU usage from constant IndexedDB reads | Poll at 1s minimum; use storage events as change notification to avoid unnecessary reads | Visible as battery drain during 30+ minute sessions |
| Loading entire conversation history into memory on boot | App startup takes 2-5 seconds, memory spike | Load only session list on boot; lazy-load messages per session when accessed | At ~50+ conversations or conversations with 100+ messages |
| Menu re-render on every scroll event | Bridge receives textContainerUpgrade calls at gesture-repeat rate (~100ms) | Throttle menu renders to 150ms minimum (match streaming flush cadence) | During rapid scroll gesture sequences |
| Persisting unchanged messages after session load | Redundant IDB writes when switching to a session and re-reading its messages | Track dirty flag per message; only persist messages that changed | Every session switch (reads trigger persistence listener) |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Storing conversation content in IndexedDB without considering device access | Anyone with physical access to the iPhone can extract IndexedDB data from the Even App | Acceptable risk for v1.2 (conversations are user's own data); document in privacy notice |
| Sync channel transmits full message content | If BroadcastChannel or localStorage is used, message content is visible to any same-origin page | Not a risk in practice (Even App controls the origin); but avoid storing sensitive data in localStorage event payloads -- use message IDs only |
| Session IDs predictable (sequential or timestamp-based) | URL-based session access could be guessable | Use crypto.randomUUID() for session IDs; sessions are local-only so risk is minimal |
| Full conversation text in search index accessible without auth | Search index exposes all message content in a queryable format | Not an additional risk beyond IndexedDB itself; both are on the same device |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Menu opens during active streaming, hiding the response | User double-taps to "do something" while AI is responding, misses the response | Show truncated live response at top of menu: "AI: The answer is..." (first 40 chars). Or block menu during streaming. |
| Session switch with no visual confirmation on glasses | User accidentally switches sessions via scroll+tap on menu, loses context | Show "Switched to [name]" confirmation on glasses for 2 seconds before showing new session content |
| Delete session with no undo | User accidentally deletes a conversation, data is permanently lost | Soft-delete pattern: mark as deleted, actually purge after 24 hours. Show "Undo" option for 5 seconds. |
| Hub live view lags behind glasses | Hub shows conversation 1-2 seconds behind glasses due to polling sync | Show "Live" indicator with subtle pulse animation; users accept small lag if they know it is live |
| Search results show raw message text without context | User searches "weather" and sees 10 results with no indication of which conversation they belong to | Show session name + timestamp + highlighted match snippet for each result |
| Command menu /rename requires text input on glasses | Even G2 has no keyboard -- user cannot type a session name with 4 gestures | /rename on glasses shows "Rename in hub app" message. Rename is hub-only. |

## "Looks Done But Isn't" Checklist

- [ ] **IndexedDB persistence:** Often missing `versionchange` handler on db connection -- verify by opening hub and glasses simultaneously, then bumping schema version
- [ ] **IndexedDB persistence:** Often missing `navigator.storage.persist()` call -- verify by checking `navigator.storage.persisted()` returns true in Even App WebView
- [ ] **Cross-context sync:** Often assumes BroadcastChannel works -- verify by testing on actual Even App WebView, not Chrome browser
- [ ] **Session switching:** Often missing turn-in-flight guard -- verify by switching sessions during active streaming and checking persistence integrity
- [ ] **Command menu:** Often renders all items without viewport windowing -- verify by adding 10+ sessions to /switch sub-menu and scrolling
- [ ] **Full-text search:** Often missing debounce on search input -- verify by typing rapidly and checking for UI freezes on mobile device
- [ ] **Hub text input:** Often missing concurrent turn prevention -- verify by typing in hub while recording on glasses simultaneously
- [ ] **Persistence:** Often persists from viewport.messages (which trims to 8 turns) instead of from source events -- verify by checking IndexedDB contains all messages, not just the last 8
- [ ] **Menu rendering:** Often forgets the 2000-char SDK text limit -- verify by rendering menu with long session names and checking for truncation
- [ ] **Data integrity:** Often missing boot-time IndexedDB sentinel check -- verify by manually deleting IndexedDB and checking app handles empty state gracefully

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| IDB transaction auto-commit during streaming | MEDIUM | Refactor to write-behind buffer pattern; change persistence calls to per-message instead of per-chunk. ~4-6 hours including tests. |
| IDB data loss on WebView lifecycle | LOW | Add `navigator.storage.persist()` call + sentinel check. ~1-2 hours. The lost data cannot be recovered. |
| Session switch corrupts conversation data | HIGH | Requires adding turn tagging throughout the pipeline (gateway request, chunk handling, persistence). ~1-2 days if not designed in from the start. |
| FSM state explosion from menu sub-states | MEDIUM | Extract MenuController as separate module. ~4-6 hours refactoring if already embedded in FSM. |
| BroadcastChannel fails on device | LOW | Swap to localStorage events + polling fallback. ~2-3 hours if sync abstraction exists. HIGH if BroadcastChannel was hardcoded throughout. |
| Hub/glasses concurrent input race | MEDIUM | Add TurnManager with lock/queue. ~4-6 hours. Requires cross-context sync to be working first. |
| Menu overflows display | LOW | Apply viewport windowing pattern (already exists in codebase). ~2-3 hours. |
| Search too slow | MEDIUM | Add in-memory search index built on boot. ~4-6 hours. More if switching to tokenized IDB index. |
| Cross-context bus confusion | LOW if caught early | Define SyncEventMap, add adapter layer. ~2-3 hours. HIGH if features were built assuming shared bus. |
| IDB version upgrade blocked | LOW | Add `versionchange` handler and `blocked` timeout. ~1 hour. But the hang may have already frustrated users. |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| IDB transaction auto-commit (P1) | IndexedDB persistence layer | Write 50 streaming chunks; all appear in IDB after response_end |
| IDB WebView data loss (P2) | IndexedDB persistence layer | Force-quit Even App, reopen; conversations still present |
| Session switch corruption (P3) | Dynamic sessions | Switch session during active stream; old session has complete response, new session is clean |
| FSM state explosion (P4) | Command menu design | Menu has 5 commands + session sub-menu; FSM still has exactly 5 states |
| BroadcastChannel unavailable (P5) | Cross-context sync | Hub receives message updates on actual Even App hardware, not just Chrome |
| Hub/glasses input race (P6) | Hub text input | Type in hub while recording on glasses; no interleaved responses |
| Menu display overflow (P7) | Command menu rendering | Add 20 sessions; menu scrolls correctly, no clipping |
| Search performance (P8) | Full-text search | Search 100 conversations with 10 messages each; results appear in <300ms |
| Cross-context bus confusion (P9) | Event bus bridge | SyncEventMap is separate from AppEventMap; adapter code has tests |
| IDB version upgrade blocked (P10) | IndexedDB persistence layer | Bump schema version with both contexts open; upgrade completes within 5s |

## Sources

- [IndexedDB transaction auto-commit behavior](https://javascript.info/indexeddb) -- HIGH confidence, comprehensive documentation
- [The pain and anguish of using IndexedDB](https://gist.github.com/pesterhazy/4de96193af89a6dd5ce682ce2adff49a) -- HIGH confidence, real-world bug catalog
- [WebKit Bug 144875: WKWebView does not persist IndexedDB after app close](https://bugs.webkit.org/show_bug.cgi?id=144875) -- HIGH confidence, official WebKit bug tracker
- [Dexie.js PrematureCommitError documentation](https://dexie.org/docs/DexieErrors/Dexie.PrematureCommitError) -- HIGH confidence, library documentation of exact pitfall
- [BroadcastChannel WebView support status](https://caniwebview.com/features/web-feature-broadcast-channel/) -- MEDIUM confidence, support listed as "unknown" for Android WebView and iOS WKWebView
- [BroadcastChannel API MDN](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API) -- HIGH confidence, same-origin restriction documented
- [State machine state explosion](https://statecharts.dev/state-machine-state-explosion.html) -- HIGH confidence, canonical reference
- [Handling IndexedDB version upgrade conflicts](https://dev.to/ivandotv/handling-indexeddb-upgrade-version-conflict-368a) -- MEDIUM confidence, practical walkthrough
- [Even G2 architecture notes](https://github.com/nickustinov/even-g2-notes/blob/main/G2.md) -- HIGH confidence, verified: iPhone flutter_inappwebview proxies to glasses via BLE
- [flutter_inappwebview IndexedDB access issues](https://github.com/pichillilorenzo/flutter_inappwebview/issues/1604) -- MEDIUM confidence, community discussion
- [IndexedDB slow performance analysis](https://rxdb.info/slow-indexeddb.html) -- MEDIUM confidence, benchmarks from RxDB author
- [idb library (Jake Archibald)](https://github.com/jakearchibald/idb) -- HIGH confidence, recommended promise wrapper for IndexedDB
- Existing codebase analysis: `src/events.ts` (synchronous bus, in-memory Map), `src/gestures/gesture-fsm.ts` (5 states x 5 inputs flat table), `src/display/viewport.ts` (windowing pattern reusable for menus), `src/voice-loop-controller.ts` (no turn ID tracking), `src/glasses-main.ts` (Layer 0-5 init, separate bus instance), `src/hub-main.ts` (no event bus, pure DOM) -- HIGH confidence, primary source

---
*Pitfalls research for: Even G2 OpenClaw Chat App v1.2 -- Conversation Intelligence and Hub Interaction*
*Researched: 2026-02-28*
