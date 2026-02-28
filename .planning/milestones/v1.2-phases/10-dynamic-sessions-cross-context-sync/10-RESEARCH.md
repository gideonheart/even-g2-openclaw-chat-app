# Phase 10: Dynamic Sessions & Cross-Context Sync - Research

**Researched:** 2026-02-28
**Domain:** Session CRUD management, BroadcastChannel cross-context sync, event bus bridging
**Confidence:** HIGH

## Summary

Phase 10 builds two related capabilities on top of Phase 9's IndexedDB persistence: (1) dynamic session management with full CRUD, and (2) real-time cross-context synchronization so actions on the glasses appear in the hub and vice versa.

The current codebase has a critical terminology split. The `Session` type in `types.ts` is a hardcoded demo concept (`{ id, name, desc }`) used only in the hub UI. Meanwhile, `ConversationRecord` in the persistence layer is the real IndexedDB-backed entity with CRUD operations. Phase 10 must reconcile these by evolving the `ConversationRecord` into the primary "session" concept -- a session IS a conversation (or more precisely, a session is the container that the user creates/renames/deletes, and each session maps to one conversation stream). The hardcoded `SESSIONS` array and `Session` type must be replaced with dynamic IndexedDB-backed session records.

For cross-context sync, the BroadcastChannel API is the right primary transport. It enables same-origin message passing between the glasses WebView and hub browser tab with zero network overhead and sub-millisecond latency. Since BroadcastChannel support in `flutter_inappwebview` (Even App's WebView) is unverified (flagged as a blocker in STATE.md), a localStorage `storage` event fallback is required per SYNC-02. This fallback uses `localStorage.setItem()` to broadcast and the `storage` event to receive -- the `storage` event fires in all same-origin windows EXCEPT the one that triggered it, which is exactly the BroadcastChannel semantic.

**Primary recommendation:** Create a `SessionStore` (extending ConversationStore with delete + cascade-delete), a `SyncBridge` module (BroadcastChannel primary + localStorage fallback), and wire them into both glasses-main.ts and hub-main.ts boot sequences. Replace the hardcoded `SESSIONS` array with dynamic IndexedDB queries.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SESS-01 | User can create new sessions | `SessionStore.createSession()` -> IndexedDB `conversations` store; extends existing `createConversation()` |
| SESS-02 | User can rename sessions | `SessionStore.renameSession()` -> existing `updateConversation()` with name field |
| SESS-03 | User can delete sessions (cascade-deletes associated conversations) | New `SessionStore.deleteSession()` -> delete conversation record + all messages by conversationId in single IDB transaction |
| SESS-04 | User can switch between sessions (active session receives new voice turns) | Update `activeConversationId` in glasses-main.ts, update localStorage pointer, emit sync event; renderer clears and loads new session's messages |
| SYNC-01 | Event bus bridge enables real-time hub-glasses communication | `SyncBridge` module: BroadcastChannel posts typed events, receiving end emits to local event bus |
| SYNC-02 | Fallback mechanism if BroadcastChannel is unavailable in WebView | localStorage `storage` event fallback with same API surface; feature-detect at init time |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native BroadcastChannel API | Browser built-in | Cross-context message passing (same-origin) | Zero dependencies, sub-ms latency, structured clone for data, supported in all modern browsers since March 2022 |
| Native IndexedDB API | Browser built-in (DB_VERSION 1) | Session/conversation CRUD with cascade delete | Already in use from Phase 9; just need to add delete operations |
| localStorage `storage` event | Browser built-in | Fallback cross-context sync when BroadcastChannel unavailable | Universal support including older WebViews; `storage` event fires cross-tab automatically |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| localStorage | Browser built-in | Active session pointer (already used by boot-restore) | Fast synchronous read on boot; also used as sync fallback transport |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native BroadcastChannel + localStorage fallback | `broadcast-channel` npm package | Full-featured with auto-fallback and leader election, but adds 8KB+ runtime dependency to a zero-dependency project. Not worth it for simple event relay. |
| localStorage `storage` event fallback | SharedWorker | More powerful but significantly more complex; not supported in all WebViews; overkill for simple event relay |
| localStorage `storage` event fallback | ServiceWorker postMessage | Requires SW registration; heavier weight; more failure modes |

**Installation:**
```bash
# No installation needed -- using browser built-in APIs only
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── persistence/
│   ├── db.ts                  # Existing - IndexedDB wrapper
│   ├── types.ts               # Extended with SessionStore interface + delete methods
│   ├── conversation-store.ts  # Extended with deleteConversation + deleteMessages
│   ├── session-store.ts       # NEW - session CRUD facade (wraps conversation-store)
│   ├── auto-save.ts           # Existing - event bus auto-save
│   └── boot-restore.ts        # Modified - restore active session
├── sync/
│   ├── sync-bridge.ts         # NEW - BroadcastChannel + fallback
│   └── sync-types.ts          # NEW - typed sync message envelope
├── sessions.ts                # REWRITTEN - dynamic sessions from IndexedDB (replaces hardcoded)
├── events.ts                  # Existing - event bus
├── types.ts                   # Extended with session sync events
├── glasses-main.ts            # Modified - wire sync bridge + session switching
└── hub-main.ts                # Modified - wire sync bridge + dynamic session list
```

### Pattern 1: Session Store Facade
**What:** A thin module that wraps `ConversationStore` and adds session-specific operations (cascade delete, session listing). The "session" concept IS the conversation record -- no new object store needed.
**When to use:** When the existing data model already captures the entity, but you need higher-level operations.
**Example:**
```typescript
// Source: Project architecture pattern (factory/closure)
export interface SessionStore {
  createSession(name?: string): Promise<ConversationRecord>;
  renameSession(id: string, name: string): Promise<ConversationRecord>;
  deleteSession(id: string): Promise<void>;  // cascade-deletes messages
  listSessions(): Promise<ConversationRecord[]>;
  getSession(id: string): Promise<ConversationRecord | undefined>;
  getActiveSessionId(): string | null;
  setActiveSessionId(id: string): void;
}

export function createSessionStore(
  db: IDBDatabase,
  conversationStore: ConversationStore,
): SessionStore {
  // deleteSession: single transaction deletes conversation + all messages
  async function deleteSession(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['conversations', 'messages'], 'readwrite');
      tx.objectStore('conversations').delete(id);
      // Delete all messages for this conversation via index cursor
      const msgIndex = tx.objectStore('messages').index('by-conversation');
      const cursorReq = msgIndex.openCursor(IDBKeyRange.only(id));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ... delegate create/rename/list to conversationStore
}
```

### Pattern 2: Sync Bridge with Feature Detection
**What:** A module that abstracts cross-context messaging. Tries BroadcastChannel first; falls back to localStorage `storage` event. Exposes a unified API: `postMessage(msg)` and `onMessage(handler)`.
**When to use:** When two same-origin browsing contexts need real-time communication with uncertain API support.
**Example:**
```typescript
// Source: MDN BroadcastChannel API + MDN storage event docs
const CHANNEL_NAME = 'openclaw-sync';
const LS_SYNC_KEY = 'openclaw-sync-msg';

export interface SyncBridge {
  postMessage(msg: SyncMessage): void;
  onMessage(handler: (msg: SyncMessage) => void): () => void;
  destroy(): void;
}

export function createSyncBridge(): SyncBridge {
  const hasBroadcastChannel = typeof BroadcastChannel !== 'undefined';

  if (hasBroadcastChannel) {
    return createBroadcastChannelBridge();
  }
  return createLocalStorageBridge();
}

function createBroadcastChannelBridge(): SyncBridge {
  const channel = new BroadcastChannel(CHANNEL_NAME);
  const handlers = new Set<(msg: SyncMessage) => void>();

  channel.onmessage = (event: MessageEvent) => {
    const msg = event.data as SyncMessage;
    for (const handler of handlers) {
      handler(msg);
    }
  };

  return {
    postMessage: (msg) => channel.postMessage(msg),
    onMessage: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    destroy: () => { channel.close(); handlers.clear(); },
  };
}

function createLocalStorageBridge(): SyncBridge {
  const handlers = new Set<(msg: SyncMessage) => void>();

  function onStorage(event: StorageEvent): void {
    if (event.key !== LS_SYNC_KEY || !event.newValue) return;
    try {
      const msg = JSON.parse(event.newValue) as SyncMessage;
      for (const handler of handlers) {
        handler(msg);
      }
    } catch { /* ignore malformed */ }
  }

  window.addEventListener('storage', onStorage);

  return {
    postMessage: (msg) => {
      localStorage.setItem(LS_SYNC_KEY, JSON.stringify(msg));
      // Immediately remove to allow repeated sends of same data
      localStorage.removeItem(LS_SYNC_KEY);
    },
    onMessage: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    destroy: () => {
      window.removeEventListener('storage', onStorage);
      handlers.clear();
    },
  };
}
```

### Pattern 3: Typed Sync Message Envelope
**What:** A discriminated union type for all cross-context messages. Each message carries an `origin` field (glasses/hub) and a `type` discriminator.
**When to use:** When multiple event types flow through a single sync channel.
**Example:**
```typescript
export type SyncOrigin = 'glasses' | 'hub';

export type SyncMessage =
  | { type: 'session:created'; origin: SyncOrigin; session: { id: string; name: string } }
  | { type: 'session:renamed'; origin: SyncOrigin; sessionId: string; name: string }
  | { type: 'session:deleted'; origin: SyncOrigin; sessionId: string }
  | { type: 'session:switched'; origin: SyncOrigin; sessionId: string }
  | { type: 'message:added'; origin: SyncOrigin; conversationId: string; role: string; text: string }
  | { type: 'conversation:named'; origin: SyncOrigin; conversationId: string; name: string };
```

### Pattern 4: Session Switching in Glasses Context
**What:** When the user switches sessions on glasses, the renderer must clear the current display, load the new session's messages from IndexedDB, and update the active session pointer. The auto-save module's `getConversationId` getter automatically uses the new ID.
**When to use:** On SESS-04 -- active session switch.
**Example:**
```typescript
async function switchToSession(
  sessionId: string,
  store: ConversationStore,
  renderer: GlassesRenderer,
  setActiveId: (id: string) => void,
  syncBridge: SyncBridge,
): Promise<void> {
  // 1. Update active session pointer
  setActiveId(sessionId);
  localStorage.setItem('openclaw-active-conversation', sessionId);

  // 2. Clear display and load new session's messages
  renderer.destroy();
  await renderer.init();
  const messages = await store.getMessages(sessionId);
  for (const msg of messages) {
    if (msg.role === 'user') {
      renderer.addUserMessage(msg.text);
    } else {
      renderer.startStreaming();
      renderer.appendStreamChunk(msg.text);
      renderer.endStreaming();
    }
  }

  // 3. Notify other context
  syncBridge.postMessage({
    type: 'session:switched',
    origin: 'glasses',
    sessionId,
  });
}
```

### Anti-Patterns to Avoid
- **Adding a new IndexedDB object store for sessions:** Sessions ARE conversations in this app. One conversation per session. Adding a separate `sessions` store creates a join problem with no benefit. Use the existing `conversations` store.
- **Polling IndexedDB for changes instead of using BroadcastChannel:** Polling wastes CPU and battery. BroadcastChannel is push-based with zero overhead when idle.
- **Sending full message payloads through BroadcastChannel:** Only send typed event notifications. The receiving context reads from the shared IndexedDB to get full data. This avoids structured clone overhead for large text and keeps the sync messages tiny.
- **Blocking the voice loop on sync operations:** All sync bridge operations must be fire-and-forget, same pattern as auto-save.
- **Removing the hardcoded SESSIONS array without updating hub-main.ts:** The hub UI renders sessions from this array. It must be rewritten to query IndexedDB dynamically.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| BroadcastChannel polyfill | Full polyfill with all edge cases | Feature detection + localStorage fallback | Only need simple message passing. Two strategies with identical API surface is simpler than a universal polyfill. |
| Session list caching | In-memory session cache with invalidation | Direct IndexedDB queries (< 1ms for small datasets) | App will have < 100 sessions. IndexedDB reads are fast enough. Adding a cache layer adds invalidation complexity. |
| Cross-context event serialization | Custom binary protocol | JSON via structured clone (BroadcastChannel) or JSON.stringify (localStorage) | Sync messages are tiny objects (< 200 bytes). Serialization overhead is negligible. |

**Key insight:** The project's zero-dependency pattern means we build a thin SyncBridge abstraction (~80 lines) over two native APIs rather than pulling in a library. The fallback is needed per SYNC-02, but both implementations are trivial.

## Common Pitfalls

### Pitfall 1: Echo Loop in Sync Bridge
**What goes wrong:** Context A sends a sync message, Context B receives it and performs an action that triggers another sync message, which Context A receives and acts on, creating an infinite loop.
**Why it happens:** Not filtering out messages that originated from the current context.
**How to avoid:** Include an `origin` field in every sync message. Each context ignores messages from its own origin. BroadcastChannel already does not deliver messages to the sender, but the localStorage fallback does not have this guarantee -- so always check origin.
**Warning signs:** Rapid repeated events, UI flicker, browser tab freezing.

### Pitfall 2: Stale IndexedDB Reads After Sync Notification
**What goes wrong:** Context B receives a `session:created` sync message and immediately reads IndexedDB, but the IDB write from Context A hasn't committed yet.
**Why it happens:** BroadcastChannel postMessage can arrive before the IDB transaction commits in the sending context, especially with fire-and-forget writes.
**How to avoid:** Post sync messages AFTER the IDB transaction completes (in the `tx.oncomplete` callback or after the store method resolves). This ensures the data is readable when the notification arrives.
**Warning signs:** Session list shows stale data; newly created session not found.

### Pitfall 3: Cascade Delete Race with Auto-Save
**What goes wrong:** User deletes a session while auto-save is writing a message to that session's conversation. The delete removes the conversation, but auto-save's in-flight write creates orphaned messages.
**Why it happens:** Two concurrent IDB transactions targeting the same conversation.
**How to avoid:** Check if the conversation still exists before saving. Or, accept minor orphan risk and add a cleanup sweep. Simplest: auto-save's retry logic will fail (conversation not found) and it will silently discard -- which is the correct behavior since the session was deleted.
**Warning signs:** Messages in `messages` store with no matching `conversations` record.

### Pitfall 4: localStorage Fallback Dropping Rapid Messages
**What goes wrong:** Two sync messages sent in rapid succession via localStorage -- the second `setItem` overwrites the first before the `storage` event fires in the other context.
**Why it happens:** localStorage is synchronous and the `storage` event is asynchronous. The event fires with the latest value, not a queue.
**How to avoid:** Include a unique timestamp or sequence number in each message. Use `removeItem` immediately after `setItem` to reset the key. This way even identical messages trigger a storage event (because the value changes from the message to null to the next message).
**Warning signs:** Missed sync events during rapid operations.

### Pitfall 5: Session Switch During Active Streaming
**What goes wrong:** User switches session while an assistant response is streaming. The new session receives the tail end of the old session's response.
**Why it happens:** The display controller and auto-save are still subscribed to `gateway:chunk` events which now write to the wrong conversation.
**How to avoid:** On session switch: (1) discard pending auto-save assistant text (`pendingAssistantText = ''`), (2) if a stream is active, call `renderer.endStreaming()` to flush, (3) only then switch the active conversation ID. Alternatively, track a `turnConversationId` per voice turn and ignore chunks that don't match the active session.
**Warning signs:** Messages appearing in wrong session; partial responses.

### Pitfall 6: Hub Session List Not Refreshing After Sync Event
**What goes wrong:** Glasses creates a new session but the hub still shows the old list.
**Why it happens:** Hub renders sessions once from the hardcoded array; there's no reactive re-render.
**How to avoid:** When the sync bridge receives a session-mutation event (`session:created`, `session:renamed`, `session:deleted`), the hub must re-query IndexedDB and re-render the session list.
**Warning signs:** Hub shows stale session names or missing sessions until page reload.

## Code Examples

### Feature Detection for BroadcastChannel
```typescript
// Source: MDN BroadcastChannel API
function hasBroadcastChannel(): boolean {
  try {
    // Some environments throw on constructor even if typeof check passes
    const test = new BroadcastChannel('__test__');
    test.close();
    return true;
  } catch {
    return false;
  }
}
```

### Cascade Delete (Conversation + Messages) in Single Transaction
```typescript
// Source: MDN IndexedDB cursor delete
function deleteConversationWithMessages(
  db: IDBDatabase,
  conversationId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['conversations', 'messages'], 'readwrite');

    // Delete the conversation record
    tx.objectStore('conversations').delete(conversationId);

    // Delete all messages via index cursor
    const msgIndex = tx.objectStore('messages').index('by-conversation');
    const cursorReq = msgIndex.openCursor(IDBKeyRange.only(conversationId));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
```

### localStorage Storage Event Fallback
```typescript
// Source: MDN Window: storage event
// The storage event fires on OTHER same-origin windows when localStorage changes.
// This is the exact cross-tab semantic we need.

window.addEventListener('storage', (event: StorageEvent) => {
  if (event.key === 'openclaw-sync-msg' && event.newValue) {
    const msg = JSON.parse(event.newValue);
    // Process sync message...
  }
});

// Send: set + remove allows repeated sends
localStorage.setItem('openclaw-sync-msg', JSON.stringify(msg));
localStorage.removeItem('openclaw-sync-msg');
```

### Wiring Sync Bridge into Glasses Boot Sequence
```typescript
// Source: Project pattern (glasses-main.ts boot sequence)
// Insert after persistence init, before Layer 1 (hardware)

import { createSyncBridge } from './sync/sync-bridge';

// In boot():
const syncBridge = createSyncBridge();

// Subscribe to sync messages from hub
syncBridge.onMessage((msg) => {
  if (msg.origin === 'glasses') return; // ignore own echoes
  switch (msg.type) {
    case 'session:switched':
      // Load new session into display
      break;
    case 'session:deleted':
      // If active session was deleted, switch to most recent
      break;
    // ...
  }
});

// In cleanup():
syncBridge.destroy();
```

### Extending AppEventMap for Session Events
```typescript
// New events to add to AppEventMap in types.ts
export interface AppEventMap {
  // ... existing events ...

  // Session management events (local)
  'session:created': { id: string; name: string };
  'session:renamed': { id: string; name: string };
  'session:deleted': { id: string };
  'session:switched': { id: string; previousId: string };

  // Sync bridge events (from other context)
  'sync:message': SyncMessage;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| postMessage to parent window | BroadcastChannel API | Baseline March 2022 | No need for window references; any same-origin context can participate |
| SharedWorker for cross-tab state | BroadcastChannel for events + shared IndexedDB for state | ~2022 | Simpler; no worker lifecycle to manage |
| Custom IndexedDB polling for cross-tab sync | BroadcastChannel notification + IndexedDB read | ~2022 | Push-based instead of poll; no wasted CPU cycles |

**Deprecated/outdated:**
- `window.postMessage()` for cross-tab: Requires window references, complex origin checks. Use BroadcastChannel instead.
- WebSQL for shared state: Deprecated, removed from standards.

## Open Questions

1. **Same-origin guarantee between glasses WebView and hub browser**
   - What we know: `main.ts` routes to `glasses-main.ts` (WebView) or `hub-main.ts` (browser) based on runtime detection. Phase 9 research noted "likely same origin" and hub-main.ts already opens the same IndexedDB. The comment in hub-main.ts says "same-origin shares data with glasses."
   - What's unclear: Whether the Even App's `flutter_inappwebview` uses the same origin as the companion hub browser tab. If they're different origins, BroadcastChannel and shared IndexedDB won't work.
   - Recommendation: Implement assuming same-origin (strongest evidence supports this). The fallback localStorage mechanism provides a safety net. If origins differ, Phase 10+ would need a different sync strategy (e.g., the sync gateway from SYNC-03/04). Document this assumption clearly.

2. **Session concept: 1:1 or 1:many with conversations?**
   - What we know: The requirements say SESS-03 "cascade-deletes associated conversations" (plural). The current data model has only `ConversationRecord`.
   - What's unclear: Whether a "session" should contain multiple conversations.
   - Recommendation: Start with 1:1 mapping (session = conversation). The current voice loop creates one conversation per session. If users need multiple conversations per session, that's a future enhancement. The roadmap says "conversation threading/branching" is explicitly out of scope.

3. **Handling session switch during active voice turn**
   - What we know: The gesture FSM can be in `recording`, `sent`, or `thinking` states when a switch happens.
   - What's unclear: Whether to abort the current voice turn or let it complete before switching.
   - Recommendation: Prevent session switch while in `recording`/`sent`/`thinking` states. Only allow switch from `idle` state. This avoids the complex race condition entirely. The Phase 11 command menu can enforce this by graying out the /switch command when not idle.

## Sources

### Primary (HIGH confidence)
- [MDN BroadcastChannel API](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel) - constructor, methods, events, same-origin restriction, structured clone
- [MDN Broadcast Channel API overview](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API) - cross-context communication pattern
- [MDN Window: storage event](https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event) - localStorage cross-tab event semantics
- Project source code analysis (Phase 9): persistence/types.ts, conversation-store.ts, db.ts, auto-save.ts, boot-restore.ts, events.ts, types.ts, glasses-main.ts, hub-main.ts, sessions.ts, app-wiring.ts, gesture-handler.ts, voice-loop-controller.ts

### Secondary (MEDIUM confidence)
- [Can I WebView: BroadcastChannel](https://caniwebview.com/features/web-feature-broadcast-channel/) - WebView support status (unknown for iOS WKWebView and Android WebView -- necessitates fallback per SYNC-02)
- [Can I Use: BroadcastChannel](https://caniuse.com/broadcastchannel) - browser baseline widely available since March 2022
- [Chrome Developers: BroadcastChannel](https://developer.chrome.com/blog/broadcastchannel) - usage patterns and examples

### Tertiary (LOW confidence)
- [pubkey/broadcast-channel](https://github.com/pubkey/broadcast-channel) - reviewed as potential dependency; decided against due to zero-dependency project philosophy. Confirms localStorage fallback viability.
- [BroadcastChannel polyfill (GitHub Gist)](https://gist.github.com/sechel/e6aff22d9e56df02c5bd09c4afc516e6) - validates localStorage storage event as viable fallback technique

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Native BroadcastChannel + localStorage fallback are well-understood browser APIs with no dependencies. IndexedDB operations extend existing Phase 9 patterns.
- Architecture: HIGH - Factory/closure patterns, event bus subscription, and graceful degradation are all established in the codebase. Sync bridge follows the same patterns.
- Pitfalls: HIGH - Cross-tab communication pitfalls (echo loops, race conditions, stale reads) are well-documented in the web platform literature and verified against project-specific patterns.

**Research date:** 2026-02-28
**Valid until:** 2026-06-28 (stable browser APIs, no fast-moving ecosystem)
