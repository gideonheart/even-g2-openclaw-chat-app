# Stack Research: v1.2 Conversation Intelligence & Hub Interaction

**Domain:** Conversation persistence, cross-context event bus bridging, command menu, and full-text search for Even G2 smart glasses chat app
**Researched:** 2026-02-28
**Confidence:** HIGH

## Scope

This research covers ONLY the stack additions needed for v1.2:
1. IndexedDB conversation persistence (replacing in-memory chat)
2. Cross-context event bus bridge (hub <-> glasses real-time sync)
3. ID generation for conversations and sessions
4. Full-text search across stored conversations
5. Test infrastructure for IndexedDB

The existing stack (Vite 6.1, TypeScript 5.7, Vitest 3, @evenrealities/even_hub_sdk 0.0.7, eventsource-parser, typed event bus, factory pattern modules, localStorage settings, 42KB .ehpk artifact) is validated in v1.0/v1.1 and NOT re-researched.

## Critical Constraint: Bundle Size Budget

The current .ehpk artifact is **42KB** (23.5KB dist/index.html). Every new runtime dependency directly inflates this single-file output. The v1.2 features must be achievable with minimal bundle growth.

**Budget target:** Keep total artifact under **50KB** (allowing ~8KB growth for all v1.2 features including code).

## New Dependencies

### Runtime

| Technology | Version | Purpose | Bundle Impact | Why | Confidence |
|------------|---------|---------|---------------|-----|------------|
| `idb` | ^8.0.3 | Promise-based IndexedDB wrapper | ~1.2KB brotli | Wraps raw IndexedDB with promises, async iterators, transaction `.done`, and schema versioning. Eliminates 8+ lines of callback boilerplate per read. The only library that justifies its weight -- raw IndexedDB is too verbose for async/await codebase, but Dexie (29KB) is 24x heavier. By Jake Archibald (Chrome DevRel, IndexedDB spec contributor). ESM with `sideEffects: false` for tree-shaking. | HIGH |

### Development

| Technology | Version | Purpose | Confidence |
|------------|---------|---------|------------|
| `fake-indexeddb` | ^6.0.0 | IndexedDB implementation for Vitest/jsdom | HIGH |

### Browser Built-ins (Zero Bundle Cost)

| API | Purpose | Why No Library Needed |
|-----|---------|----------------------|
| `BroadcastChannel` | Hub <-> glasses event bus bridge | Same-origin cross-context messaging. Both contexts load the same URL. 92% browser support. Zero bytes. |
| `crypto.randomUUID()` | Conversation/session ID generation | Native UUID v4. Chrome 92+, Safari 15.1+. Zero bytes vs nanoid (130B) or uuid (6.5KB). |
| `IndexedDB` (via `idb` wrapper) | Conversation and session persistence | Browser-native structured storage with indexes. Available in flutter_inappwebview on both iOS (WebKit storage manager) and Android (Chromium). |
| `String.prototype.includes()` | Full-text search | Simple substring scan over cached conversation text. Sufficient for <1000 conversations per user. |

## Detailed Technology Rationale

### IndexedDB via `idb` (not Dexie, not raw IndexedDB, not idb-keyval)

**Why `idb` over raw IndexedDB:**
Raw IndexedDB uses IDBRequest/onsuccess/onerror callbacks -- verbose, error-prone, incompatible with async/await patterns used throughout the codebase. `idb` wraps every IDBRequest with a Promise, so `await db.get('conversations', id)` replaces 8+ lines of callback boilerplate. Adds transaction `.done` promise for durability confirmation. Supports async iterators for cursor-based reads (`for await (const cursor of store)`). Schema versioning via `upgrade` callback handles future migrations cleanly.

**Why `idb` over Dexie:**
Dexie is ~29KB min+gzip -- nearly 70% of the current total artifact size. Completely unacceptable for a 42KB .ehpk budget. Dexie's query builder, live queries, and reactive observation are overkill for a chat log store. `idb` at ~1.2KB brotli is 24x smaller.

**Why `idb` over `idb-keyval`:**
`idb-keyval` (~600B) only supports key-value get/set -- no indexes, no range queries, no cursor iteration. Conversations need compound indexes (e.g., `sessionId` + `createdAt` for chronological listing). Full-text search needs cursor iteration over a word-tokens index. `idb-keyval` cannot create custom object stores or indexes.

### BroadcastChannel for Hub <-> Glasses Sync (not postMessage, not SharedWorker, not polling)

**Architecture context:** The Even App (Flutter) opens the web app URL in a `flutter_inappwebview`. The `main.ts` environment router detects `window.flutter_inappwebview` and loads `glasses-main.ts` (glasses context) or the hub UI runs in a separate browser tab. These are two separate browsing contexts loading the same origin.

**Why BroadcastChannel:**
- Zero dependencies -- browser API, zero bytes added to bundle
- Same-origin requirement is automatically satisfied (both contexts load the same URL)
- Simple pub/sub: `channel.postMessage(event)` / `channel.onmessage = (e) => ...`
- Decoupled -- neither context needs a reference to the other
- Works even if one context is not yet open (messages simply not received, no errors)

**Why not postMessage / window.opener:**
`postMessage` requires a reference to the target window/iframe. The hub and glasses WebView have no parent-child relationship. The Even App WebView is not an iframe inside the hub -- it is a separate Flutter WebView process.

**Why not SharedWorker:**
SharedWorker support in iOS WebKit is inconsistent. Adds complexity (separate worker file, MessagePort management). BroadcastChannel is simpler and fully sufficient.

**Why not polling shared IndexedDB:**
Higher latency (~500ms per poll cycle), more code, more battery drain. Use BroadcastChannel as primary mechanism. Shared IndexedDB is the natural fallback if BroadcastChannel is unavailable in a particular WebView environment.

**Bridge pattern -- how it integrates with the existing typed event bus:**
```typescript
// In each context (hub-main.ts and glasses-main.ts):
const channel = new BroadcastChannel('openclaw-sync');

// Relay selected outbound events from local bus to BroadcastChannel
bus.on('conversation:message-added', (payload) => {
  channel.postMessage({ type: 'conversation:message-added', payload });
});

// Relay inbound BroadcastChannel messages to local bus
channel.onmessage = (e) => {
  const { type, payload } = e.data;
  bus.emit(type, payload);
};

// Cleanup
channel.close(); // on destroy
```

**Risk: MEDIUM** -- BroadcastChannel behavior in `flutter_inappwebview` specifically has not been verified with Even G2 hardware. The implementation should include a fallback: if BroadcastChannel is unavailable, fall back to polling a shared IndexedDB "sync-events" object store. This fallback costs no extra dependencies since IndexedDB is already in use.

### crypto.randomUUID() for ID Generation (no nanoid, no uuid)

**Why built-in:**
- `crypto.randomUUID()` returns a standard UUID v4 string -- perfect for conversation and session IDs
- Zero bytes added to bundle (vs nanoid 130B, uuid 6.5KB)
- Supported in all target environments (Chrome 92+, Safari 15.1+, modern WebViews)
- UUID v4 format is recognizable in IndexedDB DevTools inspection

**Fallback for edge cases:**
```typescript
function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback using crypto.getRandomValues (broader support)
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
```

### Full-Text Search: Manual Tokenization (no FlexSearch, no Lunr, no Fuse.js)

**Why no search library:**
- FlexSearch light is 4.5KB gzipped -- nearly 10% of current artifact size
- Chat conversations are relatively small (hundreds, not millions of messages per user)
- Single-user app -- conversation volume is bounded by one person's usage
- Search runs on the hub (phone/desktop browser) with ample CPU/memory
- No need for fuzzy matching, stemming, or relevance ranking -- exact substring match is the expected UX for chat search

**Implementation approach:**
1. **Simple scan (primary):** Load conversation summaries from IndexedDB, filter with `.toLowerCase().includes(query.toLowerCase())` in memory. For <1000 conversations, this is instant (<10ms).
2. **Token index (optional upgrade):** Add a `tokens` field (array of unique lowercased words) to each message, use IndexedDB `multiEntry` index for O(log n) term lookup. `idb` supports this natively via standard IndexedDB indexes.

### fake-indexeddb for Testing

**Why needed:**
- Vitest runs in jsdom environment (per existing `vite.config.ts`)
- jsdom does not implement IndexedDB
- `fake-indexeddb` provides a full IndexedDB 2.0 implementation backed by in-memory storage
- Used by Dexie's own test suite, well-maintained, v6.0.0 current

**Setup:**
```typescript
// vitest.setup.ts (or add to existing test config)
import 'fake-indexeddb/auto';
```

## Installation

```bash
# Runtime (one new dependency -- ~1.2KB brotli impact)
npm install idb@^8.0.3

# Dev dependencies (IndexedDB testing in jsdom)
npm install -D fake-indexeddb@^6.0.0
```

**Estimated artifact impact:** +1-2KB gzipped to the final .ehpk (from `idb` library). All other v1.2 features use browser built-ins. Well within the 50KB budget target.

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| `idb` (~1.2KB) | Dexie.js (~29KB) | 24x larger, overkill for chat log CRUD. Would consume 70% of current artifact budget. |
| `idb` (~1.2KB) | `idb-keyval` (~600B) | No indexes, no range queries, no cursor iteration. Cannot support conversation listing by session or full-text search. |
| `idb` (~1.2KB) | Raw IndexedDB | Callback-based API is verbose, error-prone. 8+ lines per read vs 1 line with `idb`. The 1.2KB cost is justified. |
| BroadcastChannel (0B) | SharedWorker | Inconsistent iOS WebKit support. More complex API (MessagePort). |
| BroadcastChannel (0B) | postMessage | Requires window reference. Hub and glasses WebView are not parent-child. |
| BroadcastChannel (0B) | Polling shared IndexedDB | Higher latency, more code, more battery. Use as fallback only. |
| `crypto.randomUUID()` (0B) | nanoid (130B) | Built-in is always cheaper than any library. |
| `crypto.randomUUID()` (0B) | uuid (6.5KB) | Massive for something the browser does natively. |
| Manual search (0B) | FlexSearch light (4.5KB) | 10% of artifact size for searching <1000 conversations. Overkill. |
| Manual search (0B) | Elasticlunr (8KB+) | Built for larger corpora. Same overkill concern. |
| Manual search (0B) | Fuse.js (18KB+) | Fuzzy search is not the UX expectation for chat history. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Dexie.js | 29KB gzipped -- nearly doubles artifact size. Live queries, sync, reactive observation all unused. | `idb` at 1.2KB |
| localForage | 7KB gzipped, wraps IndexedDB with localStorage/WebSQL fallbacks. We do not need fallbacks -- IndexedDB is our target. | `idb` directly |
| RxDB | 200KB+, reactive database. Massive overkill for single-user chat persistence. | `idb` + manual patterns |
| uuid npm package | 6.5KB for something the browser does natively. | `crypto.randomUUID()` |
| FlexSearch / Lunr / Fuse.js | 4.5-20KB for searching a small local dataset. | Manual `.includes()` + optional token index |
| Service Worker for sync | Not needed -- hub and glasses are always online (real-time voice loop is core value). Adds registration complexity. | BroadcastChannel |
| WebSocket/SSE for hub-glasses sync | Hub and glasses are same-origin same-device. Network-based sync is unnecessary. | BroadcastChannel |
| React / framework for hub UI | Project is vanilla TS with direct DOM manipulation. Adding a framework for conversation list would be overengineering for the scope. | Continue vanilla TS + template literals |

## Integration with Existing Codebase

### Event Bus Extension

The existing `AppEventMap` in `src/types.ts` needs new event types for v1.2 features:

```typescript
// New events to add to AppEventMap
interface AppEventMap {
  // ... existing v1.1 events ...

  // Conversation lifecycle
  'conversation:created': { conversationId: string; sessionId: string; name: string };
  'conversation:message-added': { conversationId: string; role: 'user' | 'assistant'; text: string };
  'conversation:renamed': { conversationId: string; newName: string };
  'conversation:deleted': { conversationId: string };

  // Session management (dynamic)
  'session:created': { sessionId: string; name: string };
  'session:switched': { sessionId: string; conversationId: string };
  'session:renamed': { sessionId: string; newName: string };
  'session:deleted': { sessionId: string };

  // Command menu (glasses)
  'menu:opened': { timestamp: number };
  'menu:closed': { timestamp: number };
  'menu:command': { command: '/new' | '/reset' | '/switch' | '/rename' | '/delete' };
  'menu:item-selected': { index: number };

  // Hub text input
  'hub:text-submitted': { text: string; conversationId: string };

  // Cross-context sync
  'sync:conversation-update': { conversationId: string; action: string };
}
```

### Settings Store: No Changes

The existing `loadSettings()` / `saveSettings()` in `src/settings.ts` uses `localStorage`. This remains unchanged -- settings are small, synchronous, and do not need IndexedDB. Conversations and sessions move to IndexedDB because they are structured, queryable, and potentially large.

### Sessions Store: Migration from Hardcoded to Dynamic

The existing `src/sessions.ts` has a hardcoded `SESSIONS` array with 3 demo sessions. v1.2 replaces this with dynamic sessions backed by IndexedDB. The `Session` type in `src/types.ts` gains new fields:

```typescript
// Current (v1.1)
interface Session {
  id: string;
  name: string;
  desc: string;
}

// New (v1.2)
interface Session {
  id: string;           // UUID via crypto.randomUUID()
  name: string;
  desc: string;
  createdAt: number;    // Date.now() timestamp
  updatedAt: number;    // Date.now() timestamp
}
```

### New Types for Conversations

```typescript
interface Conversation {
  id: string;           // UUID via crypto.randomUUID()
  sessionId: string;    // FK to Session
  name: string;         // Auto-generated or user-set
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}
```

### IndexedDB Schema Design

```typescript
import { openDB } from 'idb';

const db = await openDB('openclaw-chat', 1, {
  upgrade(db) {
    // Sessions store
    const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
    sessions.createIndex('updatedAt', 'updatedAt');

    // Conversations store
    const convos = db.createObjectStore('conversations', { keyPath: 'id' });
    convos.createIndex('sessionId', 'sessionId');
    convos.createIndex('updatedAt', 'updatedAt');
    convos.createIndex('sessionId_updatedAt', ['sessionId', 'updatedAt']);
  },
});
```

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `idb@^8.0.3` | TypeScript ^5.7, Vite ^6.1, Vitest ^3.0 | ESM-first, `sideEffects: false`. Works with existing Vite config. No special Rollup plugin needed. Ships TypeScript declarations. |
| `fake-indexeddb@^6.0.0` | Vitest ^3.0, jsdom ^25.0 | Auto-polyfill mode (`import 'fake-indexeddb/auto'`) patches globalThis. Compatible with existing test environment. |
| BroadcastChannel | Chrome 54+, Firefox 38+, Safari 15.4+, Edge 79+ | iOS 15.4+ requirement matches Even App minimum. Android WebView uses Chromium, fully supported. |
| `crypto.randomUUID()` | Chrome 92+, Safari 15.1+, Firefox 95+ | Secure contexts only (HTTPS or localhost). Even App WebView and dev server both qualify. |
| IndexedDB 2.0 | All modern browsers | `getAll()`, `openKeyCursor()`, multiEntry indexes all available. Supported in flutter_inappwebview via WebKit (iOS) and Chromium (Android) storage managers. |

## Stack Patterns by Context

**If running in Even App WebView (glasses context):**
- IndexedDB writes happen here (conversation messages arrive via gateway SSE)
- BroadcastChannel emits conversation updates for hub to receive
- Command menu renders via existing text container system (576x288 display)
- No DOM manipulation beyond existing `bridge.textContainerUpgrade()`

**If running in browser (hub context):**
- IndexedDB reads for history browsing and search
- IndexedDB writes for hub text input (new messages from hub)
- BroadcastChannel receives live conversation updates from glasses
- DOM manipulation for conversation list, search UI, text input form

**If BroadcastChannel unavailable (fallback):**
- Both contexts share the same IndexedDB (same origin)
- Hub polls IndexedDB for updates using a timestamp-based change detection
- No new dependencies needed -- IndexedDB is already present
- Higher latency (~500ms) but functionally correct

## Sources

- [idb GitHub repository](https://github.com/jakearchibald/idb) -- ~1.19KB brotli, v8.0.3, promise-based IndexedDB wrapper (HIGH confidence)
- [idb npm page](https://www.npmjs.com/package/idb) -- version 8.0.3, last published ~April 2025 (HIGH confidence)
- [Dexie.js bundle size issue #1585](https://github.com/dexie/Dexie.js/issues/1585) -- ~29KB min+gzip confirmed (HIGH confidence)
- [idb-keyval GitHub](https://github.com/jakearchibald/idb-keyval) -- ~600B, key-value only (HIGH confidence)
- [BroadcastChannel API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API) -- same-origin cross-context messaging (HIGH confidence)
- [BroadcastChannel browser compatibility](https://www.testmuai.com/web-technologies/broadcastchannel/) -- 92% support score (HIGH confidence)
- [crypto.randomUUID() - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID) -- browser-native UUID v4 (HIGH confidence)
- [nanoid GitHub](https://github.com/ai/nanoid) -- 130 bytes, but built-in randomUUID is 0 bytes (HIGH confidence)
- [Even G2 architecture notes](https://github.com/nickustinov/even-g2-notes/blob/main/G2.md) -- WebView architecture, same-origin, bridge pattern (MEDIUM confidence)
- [flutter_inappwebview storage manager](https://inappwebview.dev/docs/web-storage-manager/) -- IndexedDB available on iOS via WebKit storage manager (MEDIUM confidence)
- [flutter_inappwebview GitHub issue #1604](https://github.com/pichillilorenzo/flutter_inappwebview/issues/1604) -- IndexedDB access in WebView (MEDIUM confidence)
- [FlexSearch GitHub](https://github.com/nextapps-de/flexsearch) -- light build 4.5KB gzip (HIGH confidence)
- [IndexedDB full-text search PoC](https://gist.github.com/inexorabletash/a279f03ab5610817c0540c83857e4295) -- manual tokenization approach (MEDIUM confidence)
- [Using IndexedDB - MDN](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB) -- multiEntry indexes for token-based search (HIGH confidence)
- Existing codebase analysis: `src/events.ts`, `src/types.ts`, `src/sessions.ts`, `src/settings.ts`, `src/main.ts` -- direct source inspection (HIGH confidence)

---
*Stack research for: Even G2 OpenClaw Chat App v1.2 -- Conversation Intelligence & Hub Interaction*
*Researched: 2026-02-28*
