# Research Summary: v1.2 Conversation Intelligence & Hub Interaction

**Project:** Even G2 OpenClaw Chat App -- v1.2 Milestone
**Domain:** Conversation persistence, cross-context sync, dynamic sessions, command menu, hub interaction for smart glasses chat app
**Researched:** 2026-02-28
**Overall confidence:** HIGH (stack and architecture), MEDIUM (cross-context sync on real hardware)

## Executive Summary

The v1.2 milestone transforms the Even G2 OpenClaw Chat App from a stateless voice loop into a persistent, interactive conversation system. v1.1 shipped the complete end-to-end voice pipeline (6,336 LOC, 265 tests, 42KB .ehpk artifact) but conversations are lost on page reload, sessions are hardcoded, and the hub has no conversation awareness. v1.2 adds IndexedDB persistence, dynamic session management, a glasses command menu, hub text input, live conversation mirroring, history browsing, and full-text search.

The recommended stack addition is minimal: one new runtime dependency (`idb` at ~1.2KB brotli for IndexedDB promise wrapping) and three browser built-ins (IndexedDB, BroadcastChannel, crypto.randomUUID()). This keeps the .ehpk artifact under 50KB. The architecture extends the existing factory-pattern, typed event bus, and layered initialization sequence with new persistence, sync, and menu layers that follow the same patterns. No existing modules need architectural changes -- only interface extensions and new subscribers.

The critical architectural insight is the context model. In production, the Even App loads the web app in a single flutter_inappwebview -- both glasses display control (via SDK bridge) and hub DOM rendering happen in the same JavaScript context with a shared event bus. Cross-context bridging (BroadcastChannel) is needed only for the dev-mode scenario where the glasses simulator runs in a separate browser tab. This dramatically simplifies the sync architecture: production sync is free (shared bus), and dev-mode sync is a thin BroadcastChannel mirror.

The highest-risk areas are: (1) IndexedDB transaction auto-commit during async streaming responses -- requires a write-behind buffer pattern, not per-chunk persistence; (2) IndexedDB data durability in the Even App's WKWebView on iOS, which historically evicts IndexedDB data under storage pressure; (3) session switching during an active voice turn, which can corrupt conversation data if turns are not tagged with their originating session ID; and (4) FSM state explosion if the command menu sub-states are naively added to the flat 5-state transition table instead of delegated to a separate MenuController.

## Key Findings

**Stack:** One new runtime dependency (`idb@^8.0.3`, ~1.2KB brotli) plus browser built-ins (IndexedDB, BroadcastChannel, crypto.randomUUID()). Total artifact growth: +1-2KB.

**Architecture:** Persistence layer (ConvoStore + SessionManager backed by IndexedDB), command menu as a separate pure-function FSM with renderer, PersistenceTap as a bus subscriber pattern, BroadcastChannel bridge for dev-mode only, and hub UI extensions (live view, text input, history browser, search).

**Critical pitfall:** IndexedDB transactions auto-commit across async boundaries. Never hold a transaction open across event bus callbacks. Use write-behind buffer: accumulate streaming chunks in memory, persist complete messages only at response_end.

## Implications for Roadmap

Based on the dependency chain from research, v1.2 maps to five phases. Each phase builds on the previous and can be independently tested.

### Phase 1: IndexedDB Persistence Foundation

**Rationale:** Every other feature depends on having a working persistence layer. Sessions, conversations, search, and history all require IndexedDB to be operational. This must be first.
**Delivers:** Database schema, ConvoStore (CRUD for conversations and messages), SessionManager (dynamic sessions replacing hardcoded SESSIONS array), data migration from hardcoded sessions to IndexedDB on first run.
**Addresses:** IndexedDB schema design, `idb` library integration, `fake-indexeddb` test setup, session CRUD, conversation CRUD.
**Avoids:** Transaction auto-commit pitfall (P1) by designing write-behind buffer from day one; IDB version upgrade blocking (P10) by registering `versionchange` handler; data loss (P2) by calling `navigator.storage.persist()`.
**New files:** `src/persistence/db-schema.ts`, `src/persistence/convo-store.ts`, `src/sessions/session-manager.ts`, `src/persistence/persistence-tap.ts`.
**Installs:** `idb@^8.0.3` (runtime), `fake-indexeddb@^6.0.0` (dev).

### Phase 2: Dynamic Sessions & Cross-Context Sync

**Rationale:** Session CRUD must work before the command menu can dispatch session operations. Cross-context sync must be in place before hub features can reflect glasses state.
**Delivers:** Dynamic session create/rename/delete/switch, BroadcastChannel bridge (dev-mode), IndexedDB polling fallback, AppEventMap extended with session and sync events.
**Addresses:** Session lifecycle events, cross-context event relay, echo prevention in BroadcastChannel, turn-level session tagging.
**Avoids:** Session switch corruption (P3) by tagging turns with originating sessionId; BroadcastChannel unavailability (P5) by implementing polling fallback; cross-context bus confusion (P9) by using explicit adapter pattern.

### Phase 3: Glasses Command Menu

**Rationale:** The command menu is the primary glasses-side interaction for v1.2. It requires sessions to be dynamic (Phase 2) and conversations to be persistent (Phase 1).
**Delivers:** Double-tap opens command menu on 576x288 display, scroll navigates items, tap executes (/new, /reset, /switch, /rename, /delete), auto-close timeout, confirmation for destructive actions.
**Addresses:** CommandMenuFSM (pure function, separate from gesture FSM), CommandMenuRenderer (text container rendering), gesture handler delegation in menu state.
**Avoids:** FSM state explosion (P4) by keeping gesture FSM at 5 states and delegating to separate MenuController; display overflow (P7) by applying viewport windowing pattern from existing viewport.ts.

### Phase 4: Hub Interaction Features

**Rationale:** Hub features (live view, text input, history, search) depend on persistence (Phase 1), sync (Phase 2), and dynamic sessions (Phase 2). They are independent of the glasses command menu (Phase 3) but build on the same foundation.
**Delivers:** Hub live view of glasses conversation, hub text input into active conversation, conversation history browser with session grouping, full-text search across all conversations.
**Addresses:** Hub DOM rendering, text input -> gateway text turn, history list with lazy loading, in-memory search index.
**Avoids:** Hub/glasses input race (P6) by implementing turn-level lock; search performance (P8) by pre-building in-memory token index on boot.

### Phase 5: Integration & Polish

**Rationale:** Final phase wires together all new modules in glasses-main.ts and hub-main.ts, implements the production shared-bus architecture, and verifies the complete flow on hardware.
**Delivers:** Updated boot sequence (Layer 2.5 persistence, Layer 3.5 menu, Layer 5.5 persistence tap), production main.ts that boots both glasses and hub in same context with shared bus, updated hub navigation with new pages, build verification.
**Addresses:** Initialization ordering for new layers, cleanup/destroy for new modules, hub page navigation extension, .ehpk artifact size verification.

### Phase Ordering Rationale

- **Phase 1 first** because persistence is the foundation -- every other feature reads from or writes to IndexedDB.
- **Phase 2 before Phase 3** because the command menu dispatches session operations that require the SessionManager from Phase 2.
- **Phase 3 and Phase 4 are partially parallel** -- they share Phase 1-2 as dependencies but do not depend on each other. However, Phase 4 is after Phase 3 to allow the glasses-side experience to stabilize first.
- **Phase 5 last** because integration wiring depends on all components being individually tested.

### Research Flags for Phases

**Phases needing no further research (standard patterns):**
- Phase 1 (IndexedDB persistence) -- `idb` library is well-documented, schema design is straightforward, write-behind pattern is established.
- Phase 3 (Command menu) -- pure FSM pattern is already proven in the codebase (gesture-fsm.ts).
- Phase 4 (Hub features) -- vanilla DOM rendering, standard CRUD patterns.

**Phases needing targeted validation during execution:**
- Phase 2 (Cross-context sync) -- BroadcastChannel behavior in flutter_inappwebview has not been verified on real Even G2 hardware. Prototype the BroadcastChannel bridge early and test on device. If unavailable, the IndexedDB polling fallback is ready.
- Phase 5 (Integration) -- The shared-bus production architecture (glasses + hub in same WebView context) needs verification on the actual Even App. The architecture research suggests this is correct but has not been tested with the v1.2 module set.
- Phase 1 (IndexedDB durability) -- `navigator.storage.persist()` and IndexedDB data survival across Even App restarts needs on-device verification.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | `idb` v8.0.3 verified on npm, ~1.2KB brotli confirmed from README. Browser built-ins (IndexedDB, BroadcastChannel, crypto.randomUUID()) confirmed in target environments. |
| Features | HIGH | Feature set clearly defined by PROJECT.md v1.2 milestone. Dependency chain is deterministic. |
| Architecture | HIGH | Extends proven v1.1 patterns (factory, typed bus, layered init). New components follow same patterns. Single-context production model verified from Even G2 architecture docs. |
| Pitfalls | MEDIUM-HIGH | IndexedDB transaction pitfalls well-documented. FSM state explosion is a known pattern problem. BroadcastChannel WebView support is MEDIUM confidence -- not verified on hardware. |

## Gaps to Address

- **BroadcastChannel in flutter_inappwebview:** Support status listed as "unknown" on caniwebview.com for both Android WebView and iOS WKWebView. Must be tested on actual Even App before relying on it. Polling fallback is designed and ready.
- **IndexedDB durability in Even App WebView:** WKWebView (iOS) has WebKit Bug 144875 about IndexedDB data not surviving app close. Must verify with `navigator.storage.persist()` and real-device testing.
- **Gateway text turn API:** Hub text input requires a new `sendTextTurn()` method on the gateway client. The gateway backend must support this endpoint. If not, hub text input is blocked on backend changes.
- **Session name input on glasses:** The /rename command cannot accept text input on glasses (only 4 gestures available). Must delegate to hub or use auto-naming (first words of conversation).
- **Turn-level lock across contexts:** Preventing concurrent hub text input and glasses voice input requires shared state visible to both contexts. If using shared bus in production, this is straightforward. In dev mode (separate tabs), the lock must be in IndexedDB or BroadcastChannel.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis -- all 43 source files (6,336 LOC), event bus implementation, gesture FSM, display pipeline, glasses-main.ts boot sequence
- [idb GitHub](https://github.com/jakearchibald/idb) -- v8.0.3, ~1.19KB brotli, promise-based IndexedDB wrapper
- [BroadcastChannel API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API) -- same-origin cross-context messaging
- [Using IndexedDB - MDN](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB) -- transaction behavior, indexes, schema versioning
- [crypto.randomUUID() - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID) -- native UUID v4

### Secondary (MEDIUM confidence)
- [Even G2 architecture notes](https://github.com/nickustinov/even-g2-notes/blob/main/G2.md) -- single WebView, SDK bridge, display constraints
- [flutter_inappwebview storage](https://inappwebview.dev/docs/web-storage-manager/) -- IndexedDB availability in WebView
- [BroadcastChannel WebView support](https://www.testmuai.com/web-technologies/broadcastchannel/) -- 92% browser support, WebView status unclear
- [Dexie.js bundle size issue #1585](https://github.com/dexie/Dexie.js/issues/1585) -- ~29KB min+gzip (why Dexie was rejected)
- [FlexSearch GitHub](https://github.com/nextapps-de/flexsearch) -- 4.5KB light build (why FlexSearch was rejected)

### Tertiary (LOW confidence -- needs validation)
- BroadcastChannel behavior in flutter_inappwebview specifically -- not tested on Even G2 hardware
- IndexedDB data durability in Even App's WKWebView on iOS -- WebKit Bug 144875 may affect data survival
- Gateway text turn API endpoint -- not confirmed with backend team

---
*Research completed: 2026-02-28*
*Ready for roadmap: yes*
