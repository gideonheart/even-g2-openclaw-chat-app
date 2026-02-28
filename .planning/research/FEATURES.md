# Feature Landscape: v1.3 Resilience & Error UX

**Domain:** Data integrity hardening, cross-context sync resilience, error recovery UX, and failure-mode testing for an AR glasses chat application
**Researched:** 2026-02-28
**Confidence:** HIGH (patterns verified against MDN, web.dev, IndexedDB spec; codebase thoroughly analyzed)

---

## Table Stakes

Features users expect from any application that persists data to IndexedDB, syncs across contexts, and streams from a remote gateway. Missing any of these means silent data loss, stale UI, or unrecoverable stuck states -- all of which feel like bugs, not missing features.

| Feature | Why Expected | Complexity | Depends On | Notes |
|---------|--------------|------------|------------|-------|
| **IDB write verification (read-after-write)** | Current `auto-save.ts` fires and forgets with retry but never confirms the write landed. IndexedDB `tx.oncomplete` on Firefox 40+ fires before data is flushed to disk. Safari can silently stall promise chains. Users expect "if it showed in chat, it was saved." | Med | `ConversationStore.addMessage`, `auto-save.ts` | Verify in a subsequent readonly tx after oncomplete. Do NOT rely on `readwriteflush` (non-standard Firefox-only). |
| **QuotaExceededError handling** | IndexedDB and Cache API both throw `QuotaExceededError` as a `DOMException` when the origin exceeds its storage quota. Current code catches generic errors but does not specifically detect or handle quota exhaustion. On mobile WebViews the quota can be as low as ~15% of disk on iOS 17+. | Low | `ConversationStore`, `SessionStore`, `auto-save.ts` | Wrap all IDB writes in try/catch, detect `error.name === 'QuotaExceededError'`, emit specific bus event. |
| **Orphan detection on boot** | After crashes, force-kills, or Safari's 7-day ITP eviction, messages can exist without parent conversations (orphans) or conversations can reference deleted sessions. Current `boot-restore.ts` handles "no data" and "corrupted data" but does not scan for orphans. | Med | `ConversationStore`, `boot-restore.ts`, `db.ts` | Cursor scan messages index, collect `conversationId` set, compare against conversations store. Delete orphans in single readwrite tx. |
| **Referential integrity check on boot** | The `by-conversation` index on messages can point to deleted conversation IDs after partial cascade failures. Current `deleteSession` uses a single IDB transaction for cascade, but crashes mid-transaction leave partial state. | Med | `SessionStore.deleteSession`, `boot-restore.ts` | Run at boot before `restoreOrCreateConversation`. Scan conversations, then messages; delete any messages whose `conversationId` has no matching conversation. |
| **FSM stuck-state watchdog** | `gesture-fsm.ts` transitions are pure but the FSM can get stuck in `sent` or `thinking` if the gateway never emits `response_end` (network drop, gateway crash, SSE stream dies mid-chunk). Current 30s timeout covers the fetch, but NOT stuck-in-thinking after a partial stream. | Med | `gesture-fsm.ts`, `display-controller.ts`, `voice-loop-controller.ts` | Timer-based watchdog: if FSM remains in `sent` or `thinking` for >45s with no chunk activity, force reset to `idle` and show error. |
| **Mid-stream gateway failure recovery** | `streamSSEResponse` reads until `done` but doesn't handle the reader throwing after partial chunks. If the gateway dies mid-stream, `pendingAssistantText` in `auto-save.ts` has partial data that is neither saved nor discarded cleanly. | Med | `gateway-client.ts` `streamSSEResponse`, `auto-save.ts` | Catch reader errors inside the while loop, emit `error` chunk, clear `pendingAssistantText`, reset FSM. Save partial response if >50 chars as a recoverable message. |
| **Sync message echo suppression** | Current sync bridge ignores messages from the same origin (`if (msg.origin === 'glasses') return`), but there is no deduplication for rapid-fire messages. Both contexts can fire `message:added` for the same user turn if both process the same gateway chunk. | Low | `sync-bridge.ts`, `glasses-main.ts` sync handler, `hub-main.ts` sync handler | Add `messageId` (the IDB record ID) to `message:added` sync messages. Receiver checks if message already exists before inserting. |
| **Graceful IDB unavailability on boot** | Current code has `if (!store)` guards, but the UX falls through silently -- no persistent indicator that data will not be saved. Users must know their session is ephemeral. | Low | `glasses-main.ts` boot, `hub-main.ts` `initPersistence` | Show persistent status indicator (glasses: status bar text; hub: warning banner). |
| **Error messages on 576x288 glasses display** | Current `showError` renders `[Error] message` as an assistant chat bubble. This works but there is no distinction between "transient error, will retry" vs "fatal error, needs user action." | Low | `glasses-renderer.ts` `showError` | Two-tier error display: transient errors auto-clear after 3s; fatal errors persist with hint text ("Double-tap for menu"). |

## Differentiators

Features that go beyond basic reliability. Not expected by users, but their presence makes the app feel polished and trustworthy. These distinguish a production-quality AR app from a prototype.

| Feature | Value Proposition | Complexity | Depends On | Notes |
|---------|-------------------|------------|------------|-------|
| **Storage health indicator (glasses)** | Show a subtle icon/text in status bar when storage is degraded -- quota >80%, persistence not granted, IDB unavailable. Users never wonder "is my data safe?" No AR glasses app does this today. | Med | `StorageManager.estimate()`, `navigator.storage.persisted()`, `glasses-renderer.ts` status container | Poll `navigator.storage.estimate()` on boot and every 60s. Show usage % only when >80%. Request `navigator.storage.persist()` on first user message save. |
| **Storage health indicator (hub)** | Hub health page already shows gateway/STT/session status dots. Add storage health dot with quota %, eviction risk, and persistence status. | Low | `hub-main.ts` `refreshHealthDisplay`, `StorageManager` API | Extend `buildHealthViewModel` with storage health. Green = persisted + <80% quota. Yellow = >80% or not persisted. Red = IDB unavailable. |
| **Cross-context sync heartbeat** | BroadcastChannel is fire-and-forget with no delivery guarantee. A periodic "ping/pong" between glasses and hub contexts detects when the other context is gone. Currently, if one context crashes, the other never knows. | Med | `sync-bridge.ts`, new `SyncMessage` types: `sync:ping`, `sync:pong` | Every 10s, each context sends `sync:ping`. If no pong received within 5s, mark peer as disconnected. Show "Hub disconnected" or "Glasses disconnected" in status. |
| **Sync drift reconciliation** | When BroadcastChannel messages are missed (tab backgrounded, WebView suspended), the two contexts drift. On reconnection (ping/pong restored), reconcile by comparing message counts per conversation. | High | Sync heartbeat (above), `ConversationStore.getMessages`, `sync-bridge.ts` | On reconnect: both contexts exchange `{conversationId, messageCount, lastTimestamp}`. Side with fewer messages requests missing ones from the other via IDB read + sync message. |
| **Persistent storage request** | `navigator.storage.persist()` prevents browser-initiated eviction of IndexedDB data. Critical on Safari which evicts after 7 days of inactivity. Current code does not request persistent storage. | Low | `navigator.storage.persist()`, `boot-restore.ts` or `auto-save.ts` | Call on first successful message save. Check with `navigator.storage.persisted()` at boot. If denied, show warning in hub health. No user-visible prompt on Chrome/Edge (auto-grant). |
| **IDB write failure counter and circuit breaker** | Current `auto-save.ts` retries 3 times then emits `persistence:warning`. But it does this per-message with no memory -- 10 consecutive failures still look like 10 independent retries. A circuit breaker stops retrying and shows a persistent error after N consecutive failures. | Med | `auto-save.ts`, `events.ts` (`persistence:warning` event) | Track consecutive failure count. After 5 consecutive failures, enter "circuit open" state: stop trying to save, show persistent "Storage offline" error, retry every 30s with a single probe write. |
| **Conversation export on storage failure** | When IDB is failing, offer to export the current in-memory conversation as text so the user does not lose the conversation entirely. | Low | `glasses-renderer.ts` viewport messages, `hub-main.ts` live conversation view | On hub: "Download conversation" button appears when storage health is red. On glasses: not feasible (no file system access). |
| **Gateway reconnect with conversation context** | Current gateway client reconnects with exponential backoff but starts a fresh SSE stream. If the gateway supports `Last-Event-ID`, sending it on reconnect allows resuming from where the stream broke. | Low | `gateway-client.ts`, SSE `id` field in `parseSSELines` | Already parsing `evt.id` in `parseSSELines`. Store last received ID per turn. Send as `Last-Event-ID` header on retry. Graceful degradation if gateway ignores it. |

## Anti-Features

Features to explicitly NOT build for v1.3. Building these would increase complexity without proportional value, or would conflict with the app's constraints.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Full offline mode** | Core value is live voice conversation with remote AI. Offline chat contradicts the product's purpose. IndexedDB persistence is for boot recovery, not offline operation. | Show "No connection" error clearly. Do not queue messages for later send. |
| **Automatic data repair/migration** | Auto-fixing corrupted IDB data risks further corruption. Deleting orphans is safe; rewriting corrupted records is not. | Detect corruption, report to user, offer "Reset storage" option. Never silently rewrite records. |
| **Cross-device sync** | BroadcastChannel and IDB are same-origin, same-device only. Cross-device sync requires a server component. Out of scope for a frontend-only app. | Sync is between glasses WebView and hub tab on the same device only. |
| **Real-time retry queue / outbox pattern** | Offline-first patterns (outbox, retry queue, background sync) add significant complexity for an app that fundamentally requires a live gateway connection. | Retry at the gateway client level (exponential backoff on turn submission). Do not build a persistent retry queue. |
| **Custom error sounds/haptics** | Even G2 SDK does not expose haptic or audio output APIs. Adding sound would require browser audio which may conflict with the glasses audio pipeline. | Visual-only error indicators via the SDK text containers. |
| **Detailed storage analytics dashboard** | Over-engineering the hub health page with per-store byte counts, transaction timing, etc. Few users care. | Single storage health dot with tooltip showing usage/quota. |
| **User-configurable retention policies** | "Delete conversations older than X days" adds settings UI complexity. Users can manually delete conversations via existing session management. | Keep manual delete. Add "Clear all data" as a single action if needed. |
| **IDB schema migration framework** | The current schema is v1 with 2 object stores. Building a migration framework for a schema that has not changed is premature. | Use the existing `onupgradeneeded` with version checks. Add migrations when (if) the schema actually changes. |
| **WebSocket replacement for SSE** | SSE with fetch is simpler, unidirectional (which is all the app needs), and already working. WebSocket adds connection management complexity for no benefit. | Keep SSE. The gateway defines the protocol, not the client. |

## Feature Dependencies

```
QuotaExceededError handling -----> Storage health indicator (glasses)
                                   Storage health indicator (hub)

Orphan detection on boot -------> Referential integrity check on boot
                                  (both run during same boot scan)

Sync heartbeat -----------------> Sync drift reconciliation
                                  (reconciliation requires knowing peer is back)

IDB write verification ---------> IDB write failure counter / circuit breaker
                                  (circuit breaker counts verification failures)

Mid-stream failure recovery ----> FSM stuck-state watchdog
                                  (watchdog is the safety net if recovery misses)

Persistent storage request -----> Storage health indicator
                                  (indicator shows persist status)

Storage health indicator -------> Conversation export on storage failure
                                  (export appears when health is red)
```

## MVP Recommendation

Prioritize in this order:

### Phase 1: Data Integrity Foundation (Table Stakes)
1. **IDB write verification** -- Core trust guarantee. Without it, "saved" is a lie.
2. **QuotaExceededError handling** -- Prevents silent write failures on constrained devices.
3. **Orphan detection + referential integrity on boot** -- Clean up after crashes. Run together as a single boot-time scan.
4. **Graceful IDB unavailability UX** -- Users must know when data is ephemeral.

### Phase 2: Error Resilience (Table Stakes)
5. **FSM stuck-state watchdog** -- Prevents permanent stuck UI.
6. **Mid-stream gateway failure recovery** -- Handles the most common real-world failure (network drops).
7. **Two-tier error display on glasses** -- Distinguish transient vs fatal errors.
8. **Sync message echo suppression** -- Prevents duplicate messages in cross-context sync.

### Phase 3: Sync Hardening (Differentiators)
9. **Persistent storage request** -- Low effort, high value on Safari.
10. **Cross-context sync heartbeat** -- Know when the other context is alive.
11. **Storage health indicators** (glasses + hub) -- Visible trust signals.
12. **IDB write failure circuit breaker** -- Graceful degradation under sustained failure.

### Phase 4: Advanced Resilience + Testing (Differentiators)
13. **Sync drift reconciliation** -- Complex but closes the biggest sync gap.
14. **Gateway reconnect with Last-Event-ID** -- Graceful degradation.
15. **Conversation export on storage failure** -- Last resort data recovery.

**Defer:** Sync drift reconciliation is the highest-risk feature (HIGH complexity). Consider making it a stretch goal or deferring to v1.4 if the simpler heartbeat suffices.

## Detailed Feature Specifications

### F1: IDB Write Verification

**What:** After every `tx.oncomplete` in `ConversationStore.addMessage`, perform a read-back in a new readonly transaction to confirm the record exists.

**Why:** On Firefox 40+, `tx.oncomplete` fires before data is flushed to disk. On Safari, promise chains can stall silently. The current `saveWithRetry` in `auto-save.ts` retries on thrown errors but never detects the case where `oncomplete` fires but data is not actually readable.

**Implementation sketch:**
```typescript
async function addMessageVerified(
  conversationId: string,
  msg: { role: 'user' | 'assistant'; text: string; timestamp: number },
): Promise<string> {
  const id = await store.addMessage(conversationId, msg);
  // Verify in a new transaction
  const verifyTx = db.transaction('messages', 'readonly');
  const record = await new Promise<MessageRecord | undefined>((resolve, reject) => {
    const req = verifyTx.objectStore('messages').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (!record) {
    throw new Error(`Write verification failed for message ${id}`);
  }
  return id;
}
```

**Module touched:** `conversation-store.ts` (new `addMessageVerified` method or wrap existing `addMessage`), `auto-save.ts` (switch to verified writes)
**Confidence:** HIGH (pattern validated against MDN IndexedDB docs and web.dev best practices)

### F2: QuotaExceededError Handling

**What:** Detect `QuotaExceededError` specifically in all IDB write paths. Emit a dedicated bus event `persistence:quota-exceeded` with current usage stats.

**Why:** `QuotaExceededError` is a `DOMException` thrown on the transaction's `onerror` handler. Current code catches generic errors. On mobile WebViews, quota can be as low as ~50MB. A chat app with long conversation history can hit this.

**Implementation sketch:**
```typescript
tx.onerror = () => {
  if (tx.error?.name === 'QuotaExceededError') {
    bus.emit('persistence:quota-exceeded', {
      message: 'Storage full -- oldest conversations may need to be deleted',
    });
    // Optionally: auto-delete oldest conversation
  }
  reject(tx.error);
};
```

**New event type in AppEventMap:** `'persistence:quota-exceeded': { message: string }`
**Module touched:** `conversation-store.ts` (all write paths), `auto-save.ts` (specific catch), `hub-main.ts` and `glasses-main.ts` (listener for UX)
**Confidence:** HIGH (MDN documents the exact error name and behavior)

### F3: Orphan Detection + Referential Integrity Check

**What:** On boot, before `restoreOrCreateConversation`, scan both IDB object stores. Find messages whose `conversationId` does not match any conversation record. Delete them in a single readwrite transaction.

**Why:** Orphans accumulate from: (1) crashes during cascade delete, (2) Safari ITP evicting conversations but not messages (unlikely but possible with partial eviction), (3) bugs in future code. The `by-conversation` index makes this scan efficient.

**Implementation sketch:**
```typescript
async function cleanOrphans(db: IDBDatabase): Promise<number> {
  const tx = db.transaction(['conversations', 'messages'], 'readwrite');
  const convIds = new Set<string>();
  let orphanCount = 0;

  // Collect all valid conversation IDs
  const convCursor = tx.objectStore('conversations').openCursor();
  // ... iterate, add to convIds set

  // Scan messages, delete orphans
  const msgCursor = tx.objectStore('messages').openCursor();
  // ... iterate, if !convIds.has(record.conversationId), cursor.delete(), orphanCount++

  return orphanCount; // for logging
}
```

**Module touched:** New `persistence/integrity.ts` module. Called from `boot-restore.ts` before restore. Log orphan count via bus.
**Confidence:** HIGH (standard cursor-based scan, same pattern as existing `deleteSession` cascade)

### F4: FSM Stuck-State Watchdog

**What:** A timer that monitors the gesture FSM state. If the FSM has been in `sent` or `thinking` for longer than a configurable timeout (default 45s) without any `gateway:chunk` event, force-reset to `idle` and show an error.

**Why:** The 30s fetch timeout in `gateway-client.ts` covers the initial request, but NOT the streaming phase. If the gateway sends `response_start` then dies, the FSM enters `thinking` and stays there forever. The reader's `while(true)` loop blocks on `reader.read()` which may never resolve.

**Implementation sketch:**
```typescript
// In display-controller or a new watchdog module
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

bus.on('gateway:chunk', (chunk) => {
  // Reset watchdog on any chunk
  clearWatchdog();
  if (chunk.type === 'response_start' || chunk.type === 'response_delta') {
    startWatchdog(45_000);
  }
});

function startWatchdog(timeoutMs: number) {
  watchdogTimer = setTimeout(() => {
    bus.emit('gateway:chunk', { type: 'error', error: 'Response timed out. Tap to retry.' });
    // This triggers display-controller's error handler which resets FSM
  }, timeoutMs);
}
```

**Module touched:** New `watchdog.ts` or extend `display-controller.ts`. Subscribes to `gateway:chunk`, emits synthetic `error` chunk on timeout.
**Confidence:** HIGH (watchdog timer is a well-established pattern from embedded systems, adapted for JS event bus)

### F5: Mid-Stream Gateway Failure Recovery

**What:** Wrap the `reader.read()` call inside `streamSSEResponse` in a try/catch. On reader error: (1) emit an `error` chunk, (2) clear the timeout, (3) save partial assistant text if >50 chars (better than losing it).

**Why:** Current code catches errors in the outer try/catch of `sendVoiceTurn`/`sendTextTurn`, but the `while(true)` loop in `streamSSEResponse` can throw from `reader.read()` if the network drops. This throws into the outer catch which handles it as a connection error and may retry -- but the partial response text in `auto-save.ts` is lost.

**Implementation sketch:**
```typescript
while (true) {
  let readResult: ReadableStreamReadResult<Uint8Array>;
  try {
    readResult = await reader.read();
  } catch (readErr) {
    // Network died mid-stream
    emitChunk({ type: 'error', error: 'Connection lost during response' });
    clearTimeout(timeoutId);
    return;
  }
  if (readResult.done) break;
  // ... existing processing
}
```

**Module touched:** `gateway-client.ts` `streamSSEResponse`. `auto-save.ts` needs a new code path to save partial text on `error` chunk if `pendingAssistantText.length > 50`.
**Confidence:** HIGH (ReadableStream reader throws on network error -- standard Web Streams behavior)

### F6: Cross-Context Sync Heartbeat

**What:** Add `sync:ping` and `sync:pong` message types to `SyncMessage`. Each context sends a ping every 10s. If no pong within 5s, mark peer as disconnected. Show status in glasses status bar and hub health page.

**Why:** BroadcastChannel has no delivery guarantee and no connection state. If the hub tab is closed, the glasses context has no idea. If the glasses WebView is suspended by the OS, the hub has no idea. Currently, both contexts assume the peer is always there.

**New sync message types:**
```typescript
| { type: 'sync:ping'; origin: SyncOrigin; timestamp: number }
| { type: 'sync:pong'; origin: SyncOrigin; timestamp: number }
```

**Module touched:** `sync-types.ts` (new message types), `sync-bridge.ts` (auto-respond to ping with pong), new `sync-health.ts` module for tracking peer status. Wire into `glasses-main.ts` and `hub-main.ts`.
**Confidence:** MEDIUM (pattern is sound, but BroadcastChannel in flutter_inappwebview WebView may not reach the hub tab if they are separate browser contexts -- needs hardware testing)

### F7: Storage Health Indicators

**What:**
- **Glasses (576x288):** In status bar (container 1, 576x30px), show a brief text suffix: `[!S]` when storage is degraded, `[!S FULL]` when quota >90%.
- **Hub:** Add a 4th status dot on the health page: "Storage" with green/yellow/red states.

**API usage:**
```typescript
const estimate = await navigator.storage.estimate();
const usagePercent = (estimate.usage! / estimate.quota!) * 100;
const persisted = await navigator.storage.persisted();
```

**Module touched:**
- New `persistence/storage-health.ts` for shared health check logic
- `glasses-renderer.ts`: modify status text to include storage indicator
- `hub-main.ts` / `app-wiring.ts`: extend `buildHealthViewModel` with storage health
- `glasses-main.ts`: poll storage health on boot and periodically

**Confidence:** HIGH (`StorageManager.estimate()` is well-supported: Chrome 61+, Firefox 57+, Safari 17+. `navigator.storage.persist()` is supported on Chrome 55+, Firefox 57+, Safari 17+.)

### F8: Persistent Storage Request

**What:** Call `navigator.storage.persist()` after the first successful message save. This prevents browser-initiated eviction of the app's IndexedDB data.

**Why:** Safari evicts script-created storage after 7 days of inactivity unless persistent storage is granted. Chrome auto-grants based on engagement heuristics. This is the single lowest-effort highest-value resilience feature.

**Implementation sketch:**
```typescript
// In auto-save.ts, after first successful save:
if (!persistRequested && navigator.storage?.persist) {
  persistRequested = true;
  navigator.storage.persist().then((granted) => {
    if (!granted) {
      bus.emit('persistence:warning', {
        message: 'Browser may clear saved conversations after inactivity',
      });
    }
  });
}
```

**Module touched:** `auto-save.ts` (one-time call after first save), optionally `boot-restore.ts` (check persisted status at boot)
**Confidence:** HIGH (well-documented, no side effects, graceful degradation)

### F9: Two-Tier Error Display on Glasses

**What:** Differentiate between transient errors (auto-clear after 3s, no user action needed) and fatal errors (persist until user acts, show hint text).

**Current state:** `showError` in `glasses-renderer.ts` adds `[Error] message` as a permanent assistant chat bubble. All errors look the same.

**Proposed behavior:**
- **Transient:** "Connection lost -- retrying..." (auto-clears, replaced by next message or "Reconnected")
- **Fatal:** "Storage full" or "Gateway unreachable after 5 retries" (persists, hint bar shows "Double-tap for menu")

**Module touched:** `glasses-renderer.ts` (new `showTransientError` method with auto-clear timer), `display-controller.ts` (determine error severity from chunk content or a new `severity` field on `VoiceTurnChunk`)
**Confidence:** HIGH (simple timer-based auto-clear, leverages existing display infrastructure)

### F10: IDB Write Failure Circuit Breaker

**What:** Track consecutive write failure count in `auto-save.ts`. After 5 consecutive failures, enter "circuit open" state: stop trying to save, show persistent error, probe every 30s with a single test write.

**Why:** Current behavior: each message save retries 3 times independently. If IDB is persistently failing (quota exceeded, disk error, Safari stall), every message triggers 3 retry attempts with delays -- wasting resources and generating misleading "may not be saved" warnings.

**Module touched:** `auto-save.ts` (new circuit breaker state machine: closed -> open -> half-open), bus event `persistence:circuit-open` for UX.
**Confidence:** HIGH (circuit breaker is a well-known resilience pattern)

## Glasses Display Constraints for Error UX

The 576x288 pixel, 4-bit greyscale, 4-gesture input display severely constrains error UX. Research findings specific to this form factor:

### What Works
- **Status bar text suffixes:** The 576x30px status container can show brief coded indicators like `[!]` or `[!S]` without disrupting icon animation
- **Error as chat bubble:** Current approach of `[Error] message` as an assistant bubble works because it uses existing layout
- **Hint bar directives:** "Tap to retry" or "Double-tap for menu" in the hint area (if added) gives clear action paths with the 4 available gestures

### What Does NOT Work
- **Modal dialogs:** No dismiss gesture available (all 4 gestures are mapped). A modal would trap the user.
- **Color-coded severity:** 4-bit greyscale only. Cannot use red/yellow/green. Must use text differentiation.
- **Toast notifications:** No auto-dismiss timing that works on a HUD -- too fast is missed, too slow blocks the display. Use the chat bubble approach instead.
- **Multi-step error recovery wizards:** Only 4 gestures. Cannot navigate complex recovery flows. Maximum: one confirmation step (existing double-tap confirm pattern).
- **Persistent banner overlay:** Would reduce the 256px chat area further, making chat unreadable with only 1-2 bubble visible.

### Recommended Error UX Pattern for Glasses
1. **Transient errors:** Show as assistant bubble `[!] message`, auto-replace with next real message
2. **Fatal errors:** Show as assistant bubble `[!!] message`, persist until next user action
3. **Storage status:** Append to icon animator text in status bar, e.g., `[idle] [!S]`
4. **Recovery action:** Always map to existing gestures -- "Tap to retry" (recording state FSM handles this naturally)

## Real-Hardware Gap Analysis

### BroadcastChannel in flutter_inappwebview

**Status:** Android WebView supports BroadcastChannel (Chrome engine). iOS WKWebView supports BroadcastChannel since Safari 15.4. However, the critical question for Even G2 is whether the glasses WebView and hub tab share the same browsing context/origin.

**Risk:** If Even G2 runs the glasses app and hub in separate WebView instances (not tabs in the same browser), BroadcastChannel messages may not cross between them. The localStorage fallback would also fail since `storage` events only fire across same-origin tabs/windows, not across separate WebView instances.

**Mitigation (already partially in place):** The existing `localStorage` fallback in `sync-bridge.ts` covers the case where BroadcastChannel is unavailable. But if both transports fail, sync needs a third path -- either through the gateway (server-mediated sync) or through the native Flutter bridge.

**Confidence:** LOW -- requires testing on actual Even G2 hardware. This is the single biggest unknown for v1.3.

### IndexedDB Eviction on Even G2

**Status:** Even G2 runs Android under the hood. Android WebView's IndexedDB follows Chrome's eviction policy: 60% of disk in best-effort mode. With `navigator.storage.persist()`, eviction is prevented.

**Risk:** If the Even G2 has limited internal storage (common for AR glasses hardware), the 60% quota may be small in absolute terms. A chat app with long history could hit the limit.

**Mitigation:** `navigator.storage.persist()` + `StorageManager.estimate()` monitoring + `QuotaExceededError` handling.

**Confidence:** MEDIUM -- quota depends on hardware specs not publicly documented for Even G2.

## Sources

- [MDN: Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- [MDN: Using IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)
- [MDN: StorageManager.estimate()](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate)
- [MDN: BroadcastChannel API](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API)
- [MDN: Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
- [web.dev: Best Practices for IndexedDB app state](https://web.dev/articles/indexeddb-best-practices-app-state)
- [web.dev: Persistent storage](https://web.dev/articles/persistent-storage)
- [Can I WebView: BroadcastChannel](https://caniwebview.com/features/web-feature-broadcast-channel/)
- [IndexedDB pain points and oddities (pesterhazy)](https://gist.github.com/pesterhazy/4de96193af89a6dd5ce682ce2adff49a)
- [Chrome blog: Estimating available storage space](https://developer.chrome.com/blog/estimating-available-storage-space)
- [SitePen: Cross-tab synchronization with Web Locks API](https://www.sitepen.com/blog/cross-tab-synchronization-with-the-web-locks-api)
- [W3C: Web Locks explainer](https://github.com/w3c/web-locks/blob/main/EXPLAINER.md)
- [MDN: Server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
- [RxDB: IndexedDB max storage limit](https://rxdb.info/articles/indexeddb-max-storage-limit.html)
- [WebKit: Updates to storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/)
- [fake-indexeddb: error scenario testing limitations](https://github.com/dumbmatter/fakeIndexedDB/issues/59)
