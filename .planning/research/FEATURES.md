# Feature Landscape: v1.2 Conversation Intelligence & Hub Interaction

**Domain:** Smart glasses voice-chat companion app (Even G2 + OpenClaw AI agent) -- conversation persistence and hub interaction
**Researched:** 2026-02-28
**Scope:** NEW features only -- IndexedDB persistence, event bus bridging, dynamic sessions, command menu, hub text input, hub live view, history browsing, full-text search
**Confidence:** HIGH for IndexedDB/search patterns, MEDIUM for BroadcastChannel in flutter_inappwebview

---

## Context: What Already Exists

v1.1 shipped the complete end-to-end voice loop (6,336 LOC, 265 tests). All conversation data is currently in-memory only -- messages are lost on page reload. Sessions are hardcoded (3 demo entries). The hub is a settings/diagnostics companion with no conversation awareness. Hub and glasses run in separate contexts with no cross-context communication.

| Module | Status | Relevance to v1.2 |
|--------|--------|-------------------|
| Typed event bus (`events.ts`) | Complete | Extend AppEventMap with conversation/session/menu events |
| Sessions store (`sessions.ts`) | Hardcoded array | Replace with dynamic IndexedDB-backed sessions |
| Settings store (`settings.ts`) | localStorage | Keep as-is -- settings stay in localStorage |
| Display controller (`display-controller.ts`) | Complete | Extend for command menu overlay |
| Glasses renderer (`glasses-renderer.ts`) | Complete | Extend for menu rendering on 576x288 display |
| Gesture handler (`gesture-handler.ts`) | Complete | Extend double-tap to toggle command menu |
| Gateway client (`api/gateway-client.ts`) | Complete | Messages from gateway are now persisted |
| Voice loop controller | Complete | Triggers conversation writes on message events |
| Hub UI (`hub-main.ts`) | Settings/diagnostics only | Major extension: conversation view, text input, history, search |

---

## Table Stakes

Features users expect from a "conversation-aware" chat app. Missing any of these makes the v1.2 milestone feel incomplete.

### 1. IndexedDB Conversation Persistence

| Feature | Why Expected | Complexity | Dependencies |
|---------|-------------|------------|--------------|
| Store conversation messages in IndexedDB | Conversations should survive page reloads and app restarts. In-memory loss is the #1 UX complaint for any chat interface. | MEDIUM | `idb` library, new `conversation-store.ts` module |
| Load conversation history on boot | When the app starts, restore the active conversation so the user sees their previous context. | LOW | conversation-store, bus event |
| Auto-save on each message | Every user utterance and assistant response is persisted as it arrives, not on explicit save. | LOW | bus subscription to `gateway:chunk` response_end |
| Conversation metadata (name, timestamps) | Each conversation needs an auto-generated name (from first user message), creation time, and last-updated time for listing and sorting. | LOW | conversation-store |

### 2. Dynamic Session Management

| Feature | Why Expected | Complexity | Dependencies |
|---------|-------------|------------|--------------|
| Create new sessions | Users need to create sessions for different use cases (coding, research, general). Hardcoded sessions are a dead end. | LOW | session-store backed by IndexedDB |
| Rename sessions | Users personalize session names. Default "Session 1" is not useful. | LOW | session-store, bus event |
| Delete sessions | Remove unused sessions. Cascade-delete associated conversations. | MEDIUM | session-store, conversation-store (cascade) |
| Switch active session | Change which session receives new voice turns. Already partially implemented in v1.1 with hardcoded sessions. | LOW | session-store, bus event, existing UI |

### 3. Hub Live View of Glasses Conversation

| Feature | Why Expected | Complexity | Dependencies |
|---------|-------------|------------|--------------|
| Real-time message display in hub | While using glasses, the companion hub shows the conversation as it happens. Users glance at their phone to see full text (glasses display is small). | MEDIUM | BroadcastChannel bridge, hub DOM rendering |
| Streaming indicator in hub | Hub shows "Assistant is typing..." while glasses display streams a response. | LOW | BroadcastChannel forwarding `gateway:chunk` type events |

### 4. Conversation History Browsing

| Feature | Why Expected | Complexity | Dependencies |
|---------|-------------|------------|--------------|
| List past conversations in hub | Users browse previous conversations grouped by session, sorted by date. | MEDIUM | conversation-store, hub UI page |
| View full conversation transcript | Tap a conversation to see the complete message history. | LOW | conversation-store read, hub DOM rendering |
| Delete individual conversations | Remove conversations that are no longer needed. | LOW | conversation-store, confirm modal |

### 5. Hub Text Input

| Feature | Why Expected | Complexity | Dependencies |
|---------|-------------|------------|--------------|
| Type messages from hub into active conversation | Users can type on their phone when voice input is not appropriate (meetings, quiet environments). | MEDIUM | Hub text input form, gateway client call, BroadcastChannel to glasses |
| Messages appear on glasses display | Text input from hub shows as user message on glasses, response streams to both hub and glasses. | MEDIUM | BroadcastChannel bridge, glasses display update |

---

## Differentiators

Features that set this app apart from a basic chat interface. Not expected by every user, but add significant value.

### 6. Glasses Command Menu (Double-Tap)

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| Double-tap opens command menu on glasses | Quick actions without reaching for phone. /new, /reset, /switch, /rename, /delete are the core commands. This is the primary "conversation intelligence" interaction on glasses. | HIGH | Gesture handler extension, menu renderer, display controller overlay, session-store |
| Scroll up/down navigates menu items | Reuses existing scroll gestures for menu navigation. Consistent with glasses input model. | MEDIUM | Gesture handler menu state, menu renderer |
| Tap selects menu item | Reuses existing tap gesture for selection. After selection, menu closes and action executes. | MEDIUM | Gesture handler, command dispatch |
| Command execution with confirmation | Destructive actions (/delete, /reset) show a brief confirmation on glasses before executing. | MEDIUM | Confirmation flow in display, timeout-based auto-cancel |

### 7. Full-Text Search

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| Search across all conversation history | Find previous answers, code snippets, or topics across all sessions. Hub-only feature (glasses display too small for search UX). | MEDIUM | conversation-store, search logic, hub UI |
| Results show conversation name + matched snippet | Search results are actionable -- user sees context and can tap to open the full conversation. | LOW | DOM rendering |

---

## Anti-Features

Features to explicitly NOT build in v1.2.

| Anti-Feature | Why It Seems Relevant | Why Avoid | What to Do Instead |
|--------------|----------------------|-----------|-------------------|
| Cloud sync / backup | "If we have IndexedDB, shouldn't we sync to a server?" | Adds server-side infrastructure, auth, conflict resolution. Gateway-side concern, not frontend. Also a privacy issue -- conversation data stays local. | Keep conversations local-only. Users can export via gateway if needed. |
| Fuzzy / semantic search | "Full-text search should be smart" | FlexSearch/Lunr add 4.5-18KB to bundle for marginal benefit. Users search chat history with exact terms, not semantic queries. | Substring match with `.includes()` is fast and expected behavior for chat search. |
| Voice commands for menu | "Say 'new conversation' instead of using gestures" | Requires always-on STT, significantly more complex than gesture-based menu. Battery and privacy implications. | Keep menu gesture-based (double-tap). Voice is for conversation content. |
| Multi-conversation view | "Show two conversations side by side" | 576x288 glasses display cannot show one conversation well, let alone two. Hub could theoretically do this but adds complexity for no clear use case. | One active conversation at a time. Switch with /switch command. |
| Conversation export/share | "Export this conversation as text/JSON" | Privacy concern -- should be a gateway feature with proper access controls. Frontend should not facilitate bulk data extraction. | Defer to gateway. Add if explicitly requested. |
| Offline message queueing | "Queue typed messages when gateway is down" | Real-time voice loop is core value. Offline support contradicts the real-time design. Adds IndexedDB queue management, retry logic, conflict resolution. | Show "Gateway disconnected" status. Retry when connection is restored. |
| Markdown/code rendering in messages | "Assistant responses often contain code" | 576x288 glasses display renders plain text only (1 fixed font, no styling). Hub could render markdown but creates UX inconsistency between contexts. | Plain text everywhere. Users view code-heavy responses on hub. |
| Conversation threading/branching | "Let users branch a conversation from a previous point" | Significant complexity in data model and UI. Not a standard chat UX expectation. | Linear conversation only. /reset starts fresh, /new creates separate conversation. |

---

## Feature Dependencies

```
[IndexedDB Schema + idb wrapper]
    |
    +-- [session-store.ts]
    |       |
    |       +-- create / rename / delete / list / get sessions
    |       +-- IndexedDB 'sessions' object store
    |
    +-- [conversation-store.ts]
    |       |
    |       +-- create / addMessage / rename / delete / list / get / search conversations
    |       +-- IndexedDB 'conversations' object store with sessionId index
    |
    +-- [BroadcastChannel bridge]
            |
            +-- Relays selected bus events between hub and glasses contexts
            +-- Falls back to IndexedDB polling if unavailable

[session-store] + [conversation-store] -> [Dynamic sessions in hub UI]
[session-store] + [conversation-store] -> [Glasses command menu]
[conversation-store] + [BroadcastChannel] -> [Hub live view]
[conversation-store] -> [Conversation history page]
[conversation-store] -> [Full-text search]
[BroadcastChannel] + [gateway client] -> [Hub text input]
```

### Critical Ordering

1. **IndexedDB schema + stores first** -- every other feature depends on persistence
2. **BroadcastChannel bridge second** -- hub live view and text input depend on cross-context sync
3. **Dynamic sessions third** -- command menu and hub session management depend on CRUD operations
4. **Command menu fourth** -- depends on dynamic sessions and display controller extension
5. **Hub features last** -- hub live view, history, search, text input all depend on stores + bridge

---

## Glasses Command Menu Design (576x288 Constraint)

The glasses display is 576 pixels wide, 288 pixels tall, with a single fixed-width font and no styling. The command menu must work within these constraints.

**Menu layout (text-based):**
```
-- Commands --
> /new    New conversation
  /reset  Clear current
  /switch Change session
  /rename Rename session
  /delete Delete session
```

**Interaction model:**
- Double-tap: Toggle menu open/closed
- Scroll up/down: Move selection cursor (> marker)
- Tap: Execute selected command
- Auto-close: Menu closes after 5 seconds of inactivity
- Commands that need input (/rename): show a brief "Renamed to: [first 3 words of next utterance]" confirmation, or use the most recent user message text

**Implementation approach:**
- Menu content renders into the existing chat text container via `textContainerUpgrade()`
- Display controller tracks `menuOpen` state and swaps between chat content and menu content
- Gesture handler's double-tap already emits `gesture:double-tap` -- extend the FSM to handle menu state
- Menu state is ephemeral (in-memory only, not persisted)

---

## MVP Recommendation

### Must Ship (Table Stakes)

1. **IndexedDB conversation persistence** -- conversations survive reload
2. **Dynamic session CRUD** -- create, rename, delete sessions
3. **Hub live view** -- see glasses conversation on phone in real-time
4. **Conversation history browsing** -- list and view past conversations in hub
5. **Glasses command menu** -- double-tap opens /new /reset /switch /rename /delete

### Should Ship (Differentiators)

6. **Hub text input** -- type messages from phone into active conversation
7. **Full-text search** -- search across all conversation history in hub

### Defer

- **Cloud sync** -- gateway concern, not frontend
- **Fuzzy/semantic search** -- overkill for local chat history
- **Voice commands** -- too complex for v1.2
- **Conversation export** -- privacy concern, gateway feature

---

## Sources

- [BroadcastChannel API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API) -- cross-context messaging patterns (HIGH confidence)
- [IndexedDB API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) -- schema design, multiEntry indexes (HIGH confidence)
- [Even G2 architecture notes](https://github.com/nickustinov/even-g2-notes/blob/main/G2.md) -- display constraints, gesture model, WebView capabilities (MEDIUM confidence)
- [flutter_inappwebview storage](https://inappwebview.dev/docs/web-storage-manager/) -- IndexedDB availability confirmation (MEDIUM confidence)
- Existing codebase analysis -- gesture FSM, display controller, session store patterns (HIGH confidence)

---
*Feature research for: Even G2 OpenClaw Chat App v1.2 -- Conversation Intelligence & Hub Interaction*
*Researched: 2026-02-28*
