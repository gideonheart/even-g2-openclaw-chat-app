# Phase 12: Hub Conversation Features - Research

**Researched:** 2026-02-28
**Domain:** Hub UI features -- live conversation view, text input, history browsing, search
**Confidence:** HIGH

## Summary

Phase 12 transforms the companion hub from a management dashboard into a full conversation interface. The hub already has persistence infrastructure (IndexedDB via `ConversationStore`), cross-context sync (`SyncBridge` with BroadcastChannel/localStorage fallback), and session management (`SessionManager`). All Phase 12 features build on these existing foundations with no new external dependencies.

The phase decomposes into three natural groups: (1) live conversation view with streaming indicator (HUB-01, HUB-02), (2) text input from hub with gateway integration (HUB-03, HUB-04), and (3) history browsing, deletion, and search (HUB-05, HUB-06, HUB-07, HUB-08). The gateway client needs a new `sendTextTurn` method since it currently only supports `sendVoiceTurn` (audio upload). The hub UI is pure DOM manipulation with inline styles following Even design tokens -- no framework.

**Primary recommendation:** Build in three plans: (1) live conversation view + streaming indicator (pure display, sync listener), (2) text input + gateway text turn API extension, (3) history browsing + deletion + search. All work is hub-main.ts and index.html modifications with supporting pure functions for search.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| HUB-01 | Hub displays live glasses conversation in real-time | SyncBridge `message:added` handler in hub-main.ts already has the stub (`// Phase 12 will use this`). Need to render incoming messages into a live conversation view panel. |
| HUB-02 | Hub shows streaming indicator while assistant is responding | `message:added` sync messages include `role` field. Can show a "typing..." indicator between user message arrival and assistant message arrival. Alternatively, add a new sync message type for streaming state. |
| HUB-03 | User can type messages from hub into active conversation | Need a text input form in the hub UI, a new `sendTextTurn` gateway method (POST text instead of audio), and auto-save wiring. |
| HUB-04 | Hub text messages appear on glasses display with responses streaming to both | Gateway response SSE stream needs to reach both contexts. Two approaches: (a) hub sends via gateway and syncs chunks to glasses via SyncBridge, or (b) hub sends via gateway and glasses receives via sync only. Approach (a) is simpler -- hub drives the gateway call and broadcasts chunks. |
| HUB-05 | User can browse past conversations grouped by session | Since sessions ARE conversations in the data model (SessionStore wraps ConversationStore), "grouped by session" means listing sessions with their message counts/previews. Use existing `sessionStore.listSessions()` + `conversationStore.getMessages()`. |
| HUB-06 | User can view full conversation transcript in hub | Load all messages for a selected conversation via `conversationStore.getMessages(id)` and render as a scrollable transcript. |
| HUB-07 | User can delete individual conversations from hub | Already have `sessionStore.deleteSession(id)` with cascade delete. Need a delete button in the history list and confirmation modal (reuse existing `confirmModal`). |
| HUB-08 | User can search across all conversation history with results showing matched snippets | Need to iterate all messages in IndexedDB, perform case-insensitive substring match, and render results with highlighted snippets. Per REQUIREMENTS.md Out of Scope: "Fuzzy/semantic search" is explicitly excluded -- substring match is sufficient. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native IndexedDB | Browser API | Message storage and retrieval | Already in use (Phase 9). No additional library needed. |
| BroadcastChannel / localStorage | Browser API | Cross-context sync | Already in use (Phase 10 SyncBridge). |
| Native DOM API | Browser API | Hub UI rendering | Project uses vanilla DOM manipulation, no framework. Consistent with all existing hub code. |
| Vite | ^6.1.0 | Build/dev server | Already configured. No changes needed. |
| Vitest | ^3.0.0 | Test framework | Already configured with fake-indexeddb for IDB tests. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| fake-indexeddb | ^6.2.5 | IndexedDB mock for tests | Already in devDependencies. Used for all persistence tests. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Substring search | FlexSearch/Lunr | Explicitly out of scope per REQUIREMENTS.md. Substring match is sufficient. |
| React/Preact for hub UI | Vanilla DOM | Project is vanilla DOM throughout. Adding a framework would be inconsistent and increase bundle size. |
| WebSocket for real-time sync | BroadcastChannel | BroadcastChannel already works. WebSocket would require server-side changes. |

**Installation:**
```bash
# No new dependencies needed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── hub-main.ts              # Extended with live view, text input, history, search
├── api/
│   └── gateway-client.ts    # Extended with sendTextTurn method
├── persistence/
│   ├── conversation-store.ts # Extended with searchMessages method
│   └── types.ts             # Extended with search types
├── sync/
│   └── sync-types.ts        # Possibly extended with streaming state messages
└── __tests__/
    ├── gateway-client.test.ts # Extended with text turn tests
    └── conversation-store.test.ts # Extended with search tests
```

### Pattern 1: SyncBridge Message Handler for Live View (HUB-01, HUB-02)
**What:** The hub already subscribes to SyncBridge messages in `initPersistence()`. The `message:added` case is a stub (`// Phase 12 will use this`). Phase 12 fills in this stub to render incoming messages into a live conversation panel.
**When to use:** Real-time display of glasses conversation in hub.
**Example:**
```typescript
// In hub-main.ts initPersistence() syncBridge.onMessage handler:
case 'message:added': {
  // Render the message into the live conversation view
  appendLiveMessage(msg.role, msg.text);
  // If role is 'user', show streaming indicator
  // If role is 'assistant', hide streaming indicator
  break;
}
```

### Pattern 2: Gateway Text Turn (HUB-03, HUB-04)
**What:** Add a `sendTextTurn` method to the gateway client that POSTs text (not audio) to a `/text/turn` endpoint (or similar), receiving the same SSE streaming response. The hub drives the gateway call and broadcasts response chunks via SyncBridge so the glasses can also display them.
**When to use:** When user types a message in the hub input field.
**Design consideration:** The gateway backend may not have a text turn endpoint yet (blocker noted in STATE.md). Two approaches:
1. **Optimistic:** Build the client-side `sendTextTurn` assuming a REST endpoint pattern matching `/voice/turn` but for text. Stub the endpoint path as configurable.
2. **Sync-first:** Hub sends text message via SyncBridge to glasses context, which processes it through the existing voice loop (would require glasses to handle text input). This is more complex and less direct.

Recommendation: Build `sendTextTurn` in gateway-client.ts, matching the existing `sendVoiceTurn` pattern but with a JSON body instead of FormData. The endpoint path can be confirmed with the backend team.
**Example:**
```typescript
// New method in gateway-client.ts
async function sendTextTurn(
  settings: AppSettings,
  request: { sessionId: string; text: string },
): Promise<void> {
  // Same SSE streaming pattern as sendVoiceTurn
  // but with JSON body: { sessionId, text }
  // POST to ${settings.gatewayUrl}/text/turn
}
```

### Pattern 3: Hub Text Input with Auto-Save and Sync (HUB-03, HUB-04)
**What:** When user submits text from the hub, the hub needs to: (1) save the user message to IndexedDB, (2) post `message:added` sync message so glasses can display it, (3) call `sendTextTurn` on the gateway, (4) stream response chunks to both hub display and glasses via SyncBridge, (5) save assistant response to IndexedDB.
**When to use:** Hub text input submit handler.
**Example:**
```typescript
async function handleTextSubmit(text: string): Promise<void> {
  const convId = sessionManager.getActiveSessionId();
  // 1. Save user message
  await conversationStore.addMessage(convId, { role: 'user', text, timestamp: Date.now() });
  // 2. Sync to glasses
  syncBridge.postMessage({ type: 'message:added', origin: 'hub', conversationId: convId, role: 'user', text });
  // 3. Render in hub live view
  appendLiveMessage('user', text);
  // 4. Send to gateway (streaming response handled by onChunk)
  await gateway.sendTextTurn(settings, { sessionId: convId, text });
}
```

### Pattern 4: History Browsing with Session Grouping (HUB-05, HUB-06)
**What:** Since the data model treats sessions as conversations (SessionStore wraps ConversationStore), history browsing lists all sessions via `sessionStore.listSessions()` ordered by `updatedAt` descending. Each entry shows conversation name, date, and message count preview. Selecting a session loads its full message transcript via `conversationStore.getMessages(id)`.
**When to use:** Hub history page/panel.
**Key insight:** The existing `showSessions()` function in hub-main.ts already lists sessions with names and dates. The history view extends this pattern to include message previews and a transcript view.

### Pattern 5: IndexedDB Full-Text Search (HUB-08)
**What:** Search across all messages in IndexedDB using cursor iteration with case-insensitive substring matching. IndexedDB does not support full-text search natively, so we must iterate through all messages. For a typical user's conversation history (hundreds to low thousands of messages), this is fast enough.
**When to use:** Hub search feature.
**Design:**
```typescript
// New method on ConversationStore
async function searchMessages(query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();
  // Open cursor on messages store
  // For each message, check if text.toLowerCase().includes(lowerQuery)
  // If match, collect: { messageId, conversationId, role, text, timestamp, snippet }
  return results;
}

interface SearchResult {
  messageId: string;
  conversationId: string;
  conversationName: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  snippetBefore: string;
  snippetMatch: string;
  snippetAfter: string;
}
```
**Snippet extraction:** Find the match position, take ~30 chars before and ~30 chars after, with the matched substring isolated for highlighting.

### Pattern 6: Hub UI Page/Panel Architecture
**What:** The hub currently has 4 pages: home, features, health, settings. Phase 12 needs to add conversation-related UI. Two options:
1. **New page(s):** Add a "Conversations" page to the bottom nav.
2. **Panels on existing pages:** Add live view to the home page, history to a new page.

Recommendation: Add the live conversation view directly to the home page (most natural -- user opens hub and sees the live conversation). Add a "History" section below the live view on home, or as a new bottom nav item. Search can be a search bar within the history view.

The bottom nav currently has 4 items (Home, Health, Apps, Settings). Adding a 5th "Chat" tab is feasible and keeps concerns separated. Alternatively, repurpose the "Features/Apps" tab (which is currently just informational) into a "Conversations" tab.

### Anti-Patterns to Avoid
- **Polling IndexedDB for live updates:** Do NOT poll IDB to check for new messages. Use SyncBridge messages as the real-time trigger.
- **Direct DOM innerHTML for user-provided text:** Always use `escHtml()` (already in utils.ts) to prevent XSS when rendering message content.
- **Unbounded message loading:** When browsing history, load messages lazily or paginate for conversations with many messages. Don't load all messages for all conversations at once.
- **Coupling hub gateway calls to glasses context:** Hub should drive its own gateway calls independently. Don't route hub text input through the glasses context.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Full-text search | Custom search index | IDB cursor + String.includes() | Per REQUIREMENTS.md: "Substring match sufficient". FlexSearch/Lunr explicitly out of scope. Message volume is low enough for cursor iteration. |
| Cross-context messaging | Custom postMessage wrapper | Existing SyncBridge | Already built in Phase 10 with BroadcastChannel + localStorage fallback. |
| Confirmation dialogs | Custom modal system | Existing `confirmModal` in index.html | Already wired in hub-main.ts with `appState.pendingConfirm` pattern. |
| Session listing | Custom session query | Existing `sessionStore.listSessions()` | Already returns ConversationRecord[] sorted by updatedAt. |
| Message storage | Custom storage layer | Existing `conversationStore.addMessage()` / `getMessages()` | Already handles IDB transactions, conversation updatedAt bumping. |

**Key insight:** Phase 12 is primarily a hub UI feature phase. The data layer and sync infrastructure are already built. The work is mostly wiring existing capabilities into new UI components.

## Common Pitfalls

### Pitfall 1: Streaming Indicator Without Explicit Stream State
**What goes wrong:** The SyncBridge `message:added` events only fire after a complete message is saved (transcript for user, response_end for assistant). There is no "assistant is typing" sync message, so the hub cannot show a streaming indicator (HUB-02) based on message:added alone.
**Why it happens:** Auto-save fires message:added only after successful IDB persist. For assistant messages, this happens at `response_end`, not during streaming.
**How to avoid:** Two approaches:
1. **Add streaming sync messages:** Add `streaming:start` and `streaming:end` (or `response:delta`) to SyncMessage types. Auto-save already handles `response_start` and `response_delta` chunks. Wire these to also post sync messages.
2. **Infer from timing:** After receiving a user `message:added`, assume streaming starts. Show indicator until assistant `message:added` arrives. This is simpler but less accurate (no real-time streaming text in hub).

Recommendation: Add a `streaming:start` / `streaming:end` sync message pair. This is minimal protocol addition and gives accurate indicator behavior. Adding `response:delta` sync messages would allow real-time streaming text in the hub too, but at higher sync traffic cost.
**Warning signs:** Hub shows no indication that assistant is responding after user message appears.

### Pitfall 2: Race Condition on Hub Text Input
**What goes wrong:** User submits text from hub while glasses is mid-voice-turn. Both contexts simultaneously send turns to the gateway, creating interleaved responses.
**Why it happens:** No mutex/lock between hub and glasses gateway calls.
**How to avoid:** Accept the race as unlikely in practice (user won't type while also speaking). Alternatively, disable hub text input while a `streaming:start` sync message is active. The simpler approach is sufficient for v1.2.
**Warning signs:** Garbled responses mixing two simultaneous turns.

### Pitfall 3: Hub Conversation View Shows Stale Data
**What goes wrong:** User opens hub after glasses has been used for a while. The hub's live view is empty because it only shows messages received via SyncBridge (real-time), not historical messages.
**Why it happens:** Hub only listens for new sync messages, doesn't load existing conversation from IDB on boot.
**How to avoid:** On hub initialization (or when the live view becomes visible), load the current active conversation's messages from IndexedDB and render them. Then overlay real-time updates from SyncBridge on top.
**Warning signs:** Empty conversation view despite glasses having an active conversation with messages.

### Pitfall 4: Search Performance on Large History
**What goes wrong:** Searching all messages via IDB cursor blocks the main thread for noticeable time when there are thousands of messages.
**Why it happens:** IDB cursor iteration is synchronous within the transaction callback.
**How to avoid:** IDB cursor iteration is actually async (each cursor.continue() yields). For typical usage (hundreds of messages), performance is fine. Add a debounce on search input (300ms) to avoid running queries on every keystroke. Set a reasonable result limit (e.g., 50 results max).
**Warning signs:** UI jank when typing in search field.

### Pitfall 5: XSS via User Messages in Hub
**What goes wrong:** User messages contain HTML-like content that gets rendered as HTML in the hub.
**Why it happens:** Using innerHTML without escaping.
**How to avoid:** Always use `escHtml()` from utils.ts when rendering message content. The existing hub code already follows this pattern (e.g., session names are escaped with `escHtml`).
**Warning signs:** Broken rendering when messages contain `<`, `>`, `&` characters.

### Pitfall 6: Data Model Confusion -- Sessions vs Conversations
**What goes wrong:** Implementer treats sessions and conversations as separate entities, tries to create a new data model or lookup table.
**Why it happens:** The naming suggests two separate concepts, but in this codebase, sessions ARE conversations. `SessionStore.createSession()` calls `ConversationStore.createConversation()`. They share the `ConversationRecord` type.
**How to avoid:** Understand the data model: one ConversationRecord is one session. Messages belong to a conversation/session via `conversationId`. "Browse past conversations grouped by session" (HUB-05) means listing sessions (which are conversations) and their messages. No new data structure needed.
**Warning signs:** Creating new IDB object stores or types for "sessions" separate from "conversations".

## Code Examples

### Loading Active Conversation into Hub Live View
```typescript
// Load current conversation messages from IDB (handles Pitfall 3)
async function loadLiveConversation(): Promise<void> {
  const activeId = sessionManager?.getActiveSessionId();
  if (!activeId || !conversationStore) return;

  const messages = await conversationStore.getMessages(activeId);
  const container = $('liveConversation');
  container.innerHTML = '';

  for (const msg of messages) {
    appendLiveMessage(msg.role, msg.text);
  }
}
```

### Appending a Message to the Live View
```typescript
function appendLiveMessage(role: string, text: string): void {
  const container = $('liveConversation');
  const div = document.createElement('div');
  div.className = `chat-msg chat-msg--${role}`;
  div.textContent = text; // textContent is XSS-safe
  container.appendChild(div);
  container.scrollTop = container.scrollHeight; // auto-scroll to bottom
}
```

### Streaming Indicator
```typescript
function showStreamingIndicator(): void {
  const indicator = $('streamingIndicator');
  indicator.classList.remove('hidden');
}

function hideStreamingIndicator(): void {
  const indicator = $('streamingIndicator');
  indicator.classList.add('hidden');
}
```

### Search Messages with Snippet Extraction
```typescript
interface SearchResult {
  messageId: string;
  conversationId: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  snippet: { before: string; match: string; after: string };
}

function extractSnippet(
  text: string,
  query: string,
  contextChars: number = 40,
): { before: string; match: string; after: string } {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return { before: '', match: '', after: '' };

  const start = Math.max(0, idx - contextChars);
  const end = Math.min(text.length, idx + query.length + contextChars);

  return {
    before: (start > 0 ? '...' : '') + text.slice(start, idx),
    match: text.slice(idx, idx + query.length),
    after: text.slice(idx + query.length, end) + (end < text.length ? '...' : ''),
  };
}

// In ConversationStore (or as a standalone search module):
async function searchMessages(
  db: IDBDatabase,
  query: string,
  limit: number = 50,
): Promise<SearchResult[]> {
  const lowerQuery = query.toLowerCase();
  const results: SearchResult[] = [];

  return new Promise((resolve, reject) => {
    const tx = db.transaction('messages', 'readonly');
    const store = tx.objectStore('messages');
    const cursorReq = store.openCursor();

    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor || results.length >= limit) {
        return; // tx.oncomplete will resolve
      }

      const msg = cursor.value as MessageRecord;
      if (msg.text.toLowerCase().includes(lowerQuery)) {
        results.push({
          messageId: msg.id,
          conversationId: msg.conversationId,
          role: msg.role,
          text: msg.text,
          timestamp: msg.timestamp,
          snippet: extractSnippet(msg.text, query),
        });
      }

      cursor.continue();
    };

    tx.oncomplete = () => resolve(results);
    tx.onerror = () => reject(tx.error);
  });
}
```

### Gateway Text Turn Method
```typescript
// New method in gateway-client.ts, following sendVoiceTurn pattern
async function sendTextTurn(
  settings: AppSettings,
  request: { sessionId: string; text: string },
): Promise<void> {
  if (!settings.gatewayUrl) {
    emitChunk({ type: 'error', error: 'Gateway URL not configured' });
    return;
  }

  abort(); // Cancel any in-progress request
  abortController = new AbortController();

  const timeoutId = setTimeout(() => {
    abortController!.abort(new DOMException('signal timed out', 'TimeoutError'));
  }, TURN_TIMEOUT_MS);

  setStatus('connecting');

  try {
    const resp = await fetch(`${settings.gatewayUrl}/text/turn`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.sessionKey ? { 'X-Session-Key': settings.sessionKey } : {}),
      },
      body: JSON.stringify({
        sessionId: request.sessionId,
        text: request.text,
      }),
      signal: abortController.signal,
    });

    // Same SSE streaming response handling as sendVoiceTurn
    // ... (reuse the ReadableStream parsing logic)
  } catch (err) {
    // Same error handling as sendVoiceTurn
  }
}
```

### Hub-Side Auto-Save for Text Turns
```typescript
// Hub needs its own auto-save-like behavior for text turns.
// When hub sends a text turn and receives streaming response,
// it must save the assistant response to IDB and sync to glasses.

function wireHubGatewayResponse(
  gateway: GatewayClient,
  conversationStore: ConversationStore,
  syncBridge: SyncBridge,
  getConversationId: () => string,
): () => void {
  let pendingAssistantText = '';

  return gateway.onChunk((chunk) => {
    switch (chunk.type) {
      case 'response_delta':
        pendingAssistantText += chunk.text ?? '';
        // Optionally sync delta to glasses for real-time display
        break;
      case 'response_end': {
        if (pendingAssistantText) {
          const convId = getConversationId();
          const text = pendingAssistantText;
          pendingAssistantText = '';

          conversationStore.addMessage(convId, {
            role: 'assistant',
            text,
            timestamp: Date.now(),
          }).then(() => {
            syncBridge.postMessage({
              type: 'message:added',
              origin: 'hub',
              conversationId: convId,
              role: 'assistant',
              text,
            });
          });
        }
        break;
      }
    }
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No hub conversation view | Hub is settings/management only | v1.0-v1.1 | Phase 12 adds conversation capability to hub |
| Voice-only input | Voice + text input | Phase 12 | Gateway needs text turn endpoint |
| No search | Substring search across IDB | Phase 12 | Simple cursor iteration, no external library |

**Deprecated/outdated:**
- None -- all existing infrastructure is current and stable.

## Open Questions

1. **Gateway text turn endpoint path and contract**
   - What we know: The gateway currently only has `/voice/turn` (POST with FormData audio). STATE.md notes: "Gateway text turn API for hub text input (HUB-03/04) not confirmed with backend."
   - What's unclear: The exact endpoint path (`/text/turn`? `/chat/turn`?), request format, and whether it returns the same SSE stream as voice turns.
   - Recommendation: Build `sendTextTurn` assuming `/text/turn` with JSON body `{ sessionId, text }` and the same SSE VoiceTurnChunk response format. If the backend uses a different path, it's a one-line change. If the endpoint doesn't exist yet, the feature will show an error until the backend is ready. This is acceptable -- the hub will gracefully handle gateway errors.

2. **Should hub show real-time streaming text or just completed messages?**
   - What we know: HUB-01 says "live conversation updating in real-time" and HUB-02 says "streaming indicator while assistant responds." This suggests at minimum a streaming indicator, but real-time token streaming in the hub would be ideal.
   - What's unclear: Whether to add `response:delta` sync messages (enables real-time streaming in hub from glasses voice turns) or just `streaming:start`/`streaming:end` (indicator only).
   - Recommendation: For glasses voice turns relayed to hub, start with `streaming:start`/`streaming:end` sync messages for the indicator. When the hub itself sends a text turn, it has direct access to response deltas from the gateway, so it can render real-time streaming locally. This minimizes sync traffic while still meeting HUB-01/HUB-02. A future enhancement could add delta sync for full real-time streaming from glasses.

3. **Where to place conversation UI in the hub navigation?**
   - What we know: Bottom nav has 4 items: Home, Health, Apps, Settings. The "Features/Apps" page is informational only (lists capabilities, links to simulator).
   - What's unclear: Whether to add a 5th nav item or repurpose an existing one.
   - Recommendation: Add the live conversation view to the Home page (users see it first). Add history/search as a new "Chat" bottom nav item, or repurpose the "Features/Apps" tab since it's informational and less frequently used. A 5th tab risks crowding on small screens.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies. All features use existing browser APIs and project infrastructure.
- Architecture: HIGH - All patterns follow established codebase conventions (factory/closure, SyncBridge, DOM manipulation, IDB cursor iteration).
- Pitfalls: HIGH - Based on thorough codebase analysis. Data model quirk (sessions = conversations) is well-understood from reading the actual code.

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (stable -- all browser APIs, no fast-moving dependencies)
