# Phase 9: IndexedDB Persistence - Research

**Researched:** 2026-02-28
**Domain:** Browser IndexedDB storage for conversation persistence
**Confidence:** HIGH

## Summary

Phase 9 adds IndexedDB-based persistence so conversations survive app restarts. The existing codebase uses a factory/closure pattern with typed event bus -- messages flow through `gateway:chunk` events to `GlassesRenderer` which maintains an in-memory `ViewportState.messages` array of `ChatMessage` objects. The persistence layer must intercept these same events, store messages to IndexedDB, and restore them on boot.

The browser's native IndexedDB API is sufficient for this use case. No wrapper library is needed because: (a) the data model is simple (conversations + messages), (b) the project has zero external runtime dependencies beyond the Even SDK, and (c) the native API is well-supported in all target environments (modern WebView, desktop browsers). The `idb` library (by Jake Archibald) would add convenience but also adds a dependency to a project that has deliberately stayed dependency-free at runtime.

**Primary recommendation:** Use the native IndexedDB API with a thin typed wrapper module (`src/persistence/db.ts`). Auto-save messages via event bus subscription. Restore the last active conversation on boot using a localStorage pointer for the active conversation ID.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Saving is completely invisible to the user -- no spinners, toasts, or checkmarks
- Each message (user transcript or assistant response) saves immediately upon completion
- Streaming assistant responses save when the full response completes, not during streaming
- On save failure: retry silently, then show a subtle non-blocking warning ("Messages may not be saved") if retries exhaust -- never interrupt the conversation
- Auto-generate name from the first ~50 characters of the user's first message, truncated at a word boundary
- Name appears immediately after the first user message is sent (don't wait for assistant response)
- Timestamps display as relative time: "2 minutes ago", "Yesterday", "Feb 15"
- Include basic inline rename -- user can click/tap the conversation name to edit it
- On boot, automatically restore the last active conversation -- feels like the user never left
- Show a brief loading skeleton (message-shaped placeholders) while IndexedDB loads, then swap in real content
- Always scroll to the bottom of the conversation (most recent messages visible)
- First-time user / no saved data: drop straight into a fresh empty conversation, no onboarding screen
- If IndexedDB is unavailable (private browsing): show a one-time banner on boot ("Storage unavailable -- conversations won't be saved"), then let the user continue normally with in-memory only
- If stored data is corrupted: show a brief message ("Previous conversation couldn't be restored"), then start a fresh conversation
- No storage limits for now -- keep all conversations. IndexedDB has generous limits. Cleanup is a future phase
- No "clear all" or deletion UI in this phase -- that's conversation management scope

### Claude's Discretion
- IndexedDB schema design and versioning strategy
- Exact warning/banner styling and placement
- Loading skeleton design details
- Error retry count and backoff strategy
- How "last active conversation" is tracked (localStorage flag, IndexedDB metadata, etc.)

### Deferred Ideas (OUT OF SCOPE)
- Conversation deletion / clear-all -- future conversation management phase
- Storage limits and auto-cleanup -- future phase
- Conversation search / filtering -- future phase
- Scroll position restoration (exact position rather than bottom) -- potential future enhancement
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PERS-01 | Conversations persist in IndexedDB across page reloads and app restarts | IndexedDB schema with `conversations` and `messages` object stores; restore on boot |
| PERS-02 | Messages auto-save as they arrive (user transcripts and assistant responses) | Event bus subscription on `gateway:chunk` events; save on `transcript` and `response_end` |
| PERS-03 | Active conversation loads automatically on app boot with previous context | localStorage pointer for active conversation ID; restore messages into ViewportState on boot |
| PERS-04 | Conversation metadata auto-generated (name from first message, timestamps) | Auto-name from first user message (~50 chars at word boundary); store `createdAt`/`updatedAt` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native IndexedDB API | Browser built-in | Key-value object store | Zero dependencies, available in all target environments, sufficient for simple conversation storage |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| localStorage | Browser built-in | Store active conversation ID pointer | Fast synchronous read on boot to know which conversation to restore |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native IndexedDB | `idb` (Jake Archibald) | Cleaner promise API, but adds a runtime dependency to a zero-dependency project. Not worth it for 2 object stores. |
| Native IndexedDB | Dexie.js | Full ORM-like API, but 16KB+ gzipped. Massive overkill for this use case. |
| localStorage for all data | IndexedDB | localStorage is synchronous and has a 5-10MB limit. IndexedDB is async with generous limits (50MB+ default). Conversations can grow large. |

**Installation:**
```bash
# No installation needed -- using browser built-in APIs
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── persistence/
│   ├── db.ts              # IndexedDB wrapper (open, schema, migrations)
│   ├── conversation-store.ts  # CRUD for conversations + messages
│   └── auto-save.ts       # Event bus subscription for auto-save
├── display/
│   └── viewport.ts        # Existing -- ChatMessage type reused
└── types.ts               # Extended with persistence types
```

### Pattern 1: Typed IndexedDB Wrapper
**What:** A thin module that opens the database, defines the schema, and provides typed get/put/getAll helpers.
**When to use:** When you need IndexedDB but want type safety without a library.
**Example:**
```typescript
// Source: MDN IndexedDB API docs
const DB_NAME = 'openclaw-chat';
const DB_VERSION = 1;

interface ConversationRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

interface MessageRecord {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('conversations')) {
        db.createObjectStore('conversations', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('messages')) {
        const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
        msgStore.createIndex('by-conversation', 'conversationId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
```

### Pattern 2: Event Bus Auto-Save
**What:** Subscribe to `gateway:chunk` events on the bus. On `transcript` chunk, save user message. On `response_end`, save assistant message. This decouples persistence from the display pipeline.
**When to use:** When persistence should be invisible and not block the display.
**Example:**
```typescript
function createAutoSave(opts: {
  bus: EventBus<AppEventMap>;
  store: ConversationStore;
  getConversationId: () => string;
}) {
  const { bus, store, getConversationId } = opts;
  let pendingAssistantText = '';

  bus.on('gateway:chunk', async (chunk) => {
    switch (chunk.type) {
      case 'transcript':
        await store.addMessage(getConversationId(), {
          role: 'user',
          text: chunk.text!,
          timestamp: Date.now(),
        });
        break;
      case 'response_delta':
        pendingAssistantText += chunk.text ?? '';
        break;
      case 'response_end':
        if (pendingAssistantText) {
          await store.addMessage(getConversationId(), {
            role: 'assistant',
            text: pendingAssistantText,
            timestamp: Date.now(),
          });
          pendingAssistantText = '';
        }
        break;
    }
  });
}
```

### Pattern 3: Graceful Degradation
**What:** Try to open IndexedDB on boot. If it fails (private browsing, quota exceeded), fall back to in-memory only mode with a one-time warning.
**When to use:** Always -- never let storage failure break the core voice loop.
**Example:**
```typescript
async function initPersistence(): Promise<ConversationStore | null> {
  try {
    const db = await openDB();
    return createConversationStore(db);
  } catch {
    // IndexedDB unavailable -- return null, caller uses in-memory fallback
    return null;
  }
}
```

### Pattern 4: Conversation Auto-Naming
**What:** Generate conversation name from first user message, truncated at ~50 chars at a word boundary.
**When to use:** On the first user message in a new conversation.
**Example:**
```typescript
function generateConversationName(firstMessage: string): string {
  const MAX_LEN = 50;
  if (firstMessage.length <= MAX_LEN) return firstMessage;
  const truncated = firstMessage.slice(0, MAX_LEN);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + '...';
}
```

### Anti-Patterns to Avoid
- **Blocking the voice loop on IndexedDB writes:** All persistence operations must be fire-and-forget with silent error handling. Never `await` a save in the display pipeline.
- **Storing Blob/binary data in IndexedDB for this phase:** Only store text messages. Audio is not persisted.
- **Using localStorage for message storage:** localStorage is synchronous and has a 5-10MB limit. One long conversation could exceed it.
- **Tight coupling between persistence and display:** The persistence layer should subscribe to the event bus independently, not be called directly from GlassesRenderer.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| IndexedDB promise wrapper | Full featured async DB library | Thin typed wrapper (~60 lines) | Only need open/put/get/getAll/index-query. Native API is manageable. |
| UUID generation | Custom ID generator | `crypto.randomUUID()` | Available in all target environments (ES2022 target confirmed in tsconfig). |
| Relative time formatting | Custom date formatter | `Intl.RelativeTimeFormat` or simple helper | Only 3 buckets needed: "X minutes ago", "Yesterday", "Feb 15" -- a 20-line function suffices. |

**Key insight:** The project pattern is zero runtime dependencies with thin typed wrappers. IndexedDB's native API is verbose but not complex for 2 object stores. A 60-line wrapper is better than a 16KB library.

## Common Pitfalls

### Pitfall 1: IndexedDB Transaction Auto-Close
**What goes wrong:** Transactions auto-close when all outstanding requests complete. If you `await` a non-IDB async operation mid-transaction, the transaction closes and subsequent operations fail with `TransactionInactiveError`.
**Why it happens:** IndexedDB transactions are tied to the microtask queue. Any macrotask boundary (setTimeout, fetch) between operations invalidates the transaction.
**How to avoid:** Perform all IndexedDB operations in a single synchronous chain within one transaction. Never mix `fetch()` or `setTimeout()` calls inside a transaction callback.
**Warning signs:** `TransactionInactiveError` in console.

### Pitfall 2: Version Mismatch on Upgrade
**What goes wrong:** If two tabs are open with different DB versions, `onblocked` fires and the upgrade never completes until the old tab closes.
**Why it happens:** IndexedDB enforces single-writer for schema upgrades.
**How to avoid:** Handle `onblocked` gracefully -- log a warning but don't block the app. For this app, the glasses WebView and hub browser are separate origins, so this is unlikely but should be handled.
**Warning signs:** `onblocked` event fires, app hangs waiting for DB.

### Pitfall 3: Private Browsing / WebView Restrictions
**What goes wrong:** Some WebViews restrict or disable IndexedDB in private/incognito mode. `indexedDB.open()` may throw or return an unusable database.
**Why it happens:** Privacy settings in iOS WebView (WKWebView) or Android WebView.
**How to avoid:** Wrap `openDB()` in try/catch. If it fails, set a flag and operate in memory-only mode. Show the one-time banner per user decision.
**Warning signs:** `SecurityError` or `QuotaExceededError` on open.

### Pitfall 4: Corrupted Data on Schema Change
**What goes wrong:** Changing object store structure without incrementing DB_VERSION means `onupgradeneeded` never fires and old data is read with new assumptions.
**Why it happens:** Forgetting to bump the version number.
**How to avoid:** Always increment DB_VERSION when changing schema. Use a migration pattern in `onupgradeneeded` that checks `oldVersion` and applies incremental changes.
**Warning signs:** Unexpected `undefined` fields, type errors on read.

### Pitfall 5: Saving Incomplete Streaming Responses
**What goes wrong:** If auto-save triggers during streaming, a partial response is persisted. On restore, the user sees a truncated message.
**Why it happens:** Saving on every `response_delta` instead of waiting for `response_end`.
**How to avoid:** Per user decision: only save assistant responses when `response_end` fires. Accumulate deltas in memory, save the complete text.
**Warning signs:** Restored messages end mid-sentence.

## Code Examples

### Opening IndexedDB with Schema
```typescript
// Source: MDN IndexedDB API
const DB_NAME = 'openclaw-chat';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      const oldVersion = e.oldVersion;

      // v0 -> v1: initial schema
      if (oldVersion < 1) {
        const convStore = db.createObjectStore('conversations', { keyPath: 'id' });
        convStore.createIndex('by-updatedAt', 'updatedAt', { unique: false });

        const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
        msgStore.createIndex('by-conversation', 'conversationId', { unique: false });
      }
    };

    req.onblocked = () => {
      console.warn('[db] Database upgrade blocked by another tab');
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
```

### Saving a Message
```typescript
async function addMessage(
  db: IDBDatabase,
  conversationId: string,
  msg: { role: 'user' | 'assistant'; text: string; timestamp: number },
): Promise<string> {
  const id = crypto.randomUUID();
  const record: MessageRecord = { id, conversationId, ...msg };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['messages', 'conversations'], 'readwrite');
    tx.objectStore('messages').put(record);

    // Update conversation's updatedAt timestamp
    const convStore = tx.objectStore('conversations');
    const getReq = convStore.get(conversationId);
    getReq.onsuccess = () => {
      const conv = getReq.result;
      if (conv) {
        conv.updatedAt = msg.timestamp;
        convStore.put(conv);
      }
    };

    tx.oncomplete = () => resolve(id);
    tx.onerror = () => reject(tx.error);
  });
}
```

### Loading Messages for a Conversation
```typescript
async function getMessages(
  db: IDBDatabase,
  conversationId: string,
): Promise<MessageRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('messages', 'readonly');
    const index = tx.objectStore('messages').index('by-conversation');
    const req = index.getAll(conversationId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
```

### Relative Time Formatting
```typescript
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  if (diffDay === 1) return 'Yesterday';

  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Callbacks-only IndexedDB | Promise wrappers + async/await | ~2020 | Much cleaner code; native API still callback-based but easy to wrap |
| localStorage for app data | IndexedDB for structured data | ~2018 | Better for large datasets, async, no blocking main thread |
| WebSQL | IndexedDB | 2010 (WebSQL deprecated) | WebSQL never standardized; IndexedDB is the only standard |

**Deprecated/outdated:**
- WebSQL: Deprecated, removed from standards. Never use.
- `window.openDatabase()`: Same as WebSQL -- deprecated.

## Open Questions

1. **Even App WebView IndexedDB durability**
   - What we know: STATE.md notes "IndexedDB durability in Even App WKWebView (iOS) may evict data under storage pressure"
   - What's unclear: Whether this is a practical concern for typical conversation volumes
   - Recommendation: Implement persistence optimistically. If eviction becomes a real issue, Phase 10+ can add server-sync. For now, document the risk but don't over-engineer around it.

2. **Hub vs Glasses data sharing**
   - What we know: `main.ts` routes to either `glasses-main.ts` or `hub-main.ts` based on runtime detection. These are separate code paths but likely same origin.
   - What's unclear: Whether glasses WebView and hub browser share the same IndexedDB instance
   - Recommendation: Design the schema to be shared (same DB name and stores). If they're same-origin, they share data automatically. If not, each has its own store -- Phase 10 (cross-context sync) addresses this.

## Sources

### Primary (HIGH confidence)
- MDN IndexedDB API documentation - schema creation, transactions, indexes, error handling
- Project source code analysis - types.ts, viewport.ts, events.ts, display-controller.ts, glasses-main.ts, hub-main.ts, app-wiring.ts

### Secondary (MEDIUM confidence)
- Web.dev IndexedDB best practices - transaction lifecycle, error patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Native IndexedDB is the only sensible choice; matches project's zero-dependency philosophy
- Architecture: HIGH - Event bus subscription pattern is well-established in this codebase; persistence is a natural new subscriber
- Pitfalls: HIGH - IndexedDB pitfalls are well-documented and well-understood

**Research date:** 2026-02-28
**Valid until:** 2026-06-28 (stable browser APIs, no fast-moving ecosystem)
