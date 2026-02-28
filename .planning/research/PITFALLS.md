# Pitfalls Research

**Domain:** Resilience hardening, error UX, data integrity, and sync robustness for Even G2 smart glasses chat app (IndexedDB + BroadcastChannel + SSE architecture)
**Researched:** 2026-02-28
**Confidence:** HIGH for IndexedDB/BC pitfalls (verified against WebKit blog, Chrome DevRel, MDN, codebase analysis); MEDIUM for real-hardware gaps (BC in flutter_inappwebview unverified on device); HIGH for over-engineering traps (bounded by codebase analysis of existing ~10,300 LOC with 372 tests)

## Critical Pitfalls

### Pitfall 1: Write Verification Read-Back Gives False Confidence Under Relaxed Durability

**What goes wrong:**
Adding "write verification" (reading back a record immediately after writing it to confirm persistence) appears to work perfectly in development but provides zero actual durability guarantees. Chrome 121+ changed IndexedDB default durability from `strict` to `relaxed`, matching Firefox and Safari. The `oncomplete` event fires when data reaches the OS buffer, not disk. A read-back within the same or next transaction sees the data in memory, but on power loss, app force-kill, or iOS storage pressure, that data is gone. The developer invested time and latency into verification that verified nothing.

**Why it happens:**
The existing codebase uses `tx.oncomplete = () => resolve(record)` throughout `conversation-store.ts`. This is correct for current usage but can mislead a developer into thinking `oncomplete` guarantees disk persistence. The `auto-save.ts` uses fire-and-forget with 3 retries and 500ms exponential backoff -- the correct pattern for message persistence. A developer tasked with "hardening" might replace this proven pattern with read-after-write verification, believing it to be more rigorous.

Additionally, `fake-indexeddb` (used in tests) has no durability concept at all. All 372 existing tests pass regardless of durability mode, making it impossible to catch this issue in CI.

**How to avoid:**
- Do NOT implement read-after-write verification for normal message persistence. The existing fire-and-forget + retry pattern in `auto-save.ts` is the correct approach.
- For genuinely critical writes (schema migrations, sentinel records), use explicit strict durability: `db.transaction(['store'], 'readwrite', { durability: 'strict' })`.
- Frame integrity checks as boot-time structural audits (orphan detection, referential consistency), not per-write confirmation.
- Call `navigator.storage.persist()` at startup to request persistent storage from the OS. This is a one-time call that provides OS-level eviction protection.
- Audit new code for `.get()` calls immediately following `.put()` calls in the same function -- this is the telltale sign.

**Warning signs:**
- New code adds `.get()` calls immediately after `.put()` calls "to verify the write worked"
- Write latency increases 50-100% without any corresponding improvement in data durability
- Tests pass in `fake-indexeddb` but data loss still occurs on iOS devices
- Developer cannot explain what read-after-write catches that `tx.oncomplete` does not

**Phase to address:**
Data integrity phase. Frame integrity as boot-time audits, not per-write verification. Budget: 0 lines for write verification, all effort toward boot-time checks.

---

### Pitfall 2: Orphan Detection Deletes Valid Data During Cross-Context Write Races

**What goes wrong:**
A boot-time integrity check scans for "orphaned" messages -- messages whose `conversationId` has no matching conversation record. It finds messages written by the glasses context milliseconds ago for a conversation the hub context has not yet observed (because the BroadcastChannel sync notification is still in flight, or was dropped). The integrity check deletes these "orphaned" messages, destroying valid user data. The glasses context then reads back an empty conversation.

**Why it happens:**
IndexedDB is shared between glasses and hub contexts but has no cross-context locking. Looking at `auto-save.ts` lines 64-85: the glasses write a user message to IDB then post a `message:added` sync message. If the hub boots (or runs integrity) between the IDB write and sync delivery -- or if the sync message was lost (BroadcastChannel has no delivery guarantees per MDN docs) -- the hub sees messages pointing to a conversation it has not synced.

The `addMessage` function in `conversation-store.ts` operates in a single transaction spanning both `messages` and `conversations` stores. It does `getReq.onsuccess` on the conversation, and if the conversation exists, updates `updatedAt`. But if the conversation was created by the OTHER context and the hub has not yet "seen" it through sync, the IDB read finds the conversation (they share the same IDB) -- so this specific path is actually safe. The REAL orphan scenario is when the glasses create a conversation but it has not yet been committed (the transaction is still in the OS buffer under relaxed durability), and then iOS evicts just the conversations store. This is extremely unlikely but not impossible.

The more realistic race condition: hub runs orphan detection, finds a conversation with zero messages. Decides it is "stale" and deletes it. Meanwhile, glasses are about to write the first message to that conversation. First message arrives but the conversation record is gone.

**How to avoid:**
- Never auto-delete orphaned records on first detection. Mark with a `suspectedOrphanAt` timestamp. Only delete after a grace period (30+ seconds). This allows cross-context sync to catch up.
- Run orphan detection as a read-only scan first. Log findings. Surface orphan counts in hub diagnostics. Require explicit user action ("Clean up X orphaned messages") to actually delete.
- Before deletion, re-verify orphan status in a new transaction. If the conversation appeared between detection and deletion, the record is no longer orphaned.
- Store `lastIntegrityCheck` timestamp in localStorage. Run at most once per boot, not on every hub page navigation.
- Protect conversations younger than 60 seconds from orphan cleanup regardless of their state. A conversation just created should never be treated as orphaned.

**Warning signs:**
- Messages disappear after the hub boots while glasses are in an active conversation
- Orphan detection logs show deletions immediately followed by the glasses recreating the same data
- Data loss correlates with opening the hub app -- glasses-only usage works fine
- Integrity check runs on every `show('chat')` navigation in `hub-main.ts` instead of once per session

**Phase to address:**
Data integrity / orphan detection phase. Cross-context concurrent access must be the primary design constraint.

---

### Pitfall 3: BroadcastChannel Silently Unavailable in flutter_inappwebview on Real Hardware

**What goes wrong:**
Sync hardening features (message loss detection, drift reconciliation, heartbeat) are built on top of BroadcastChannel as the primary transport. Everything works in Chrome dev mode. On real Even G2 hardware, the glasses run inside flutter_inappwebview (wrapping WKWebView on iOS). BroadcastChannel either (a) is unavailable because WKWebView's storage partitioning puts contexts in different partitions, (b) is available but messages are silently dropped because contexts are not same-origin from the WebView perspective, or (c) is available and works (best case, unverified). All sync hardening becomes dead code if (a) or (b). The localStorage fallback has different limitations (no guaranteed delivery, no ordering, limited payload).

**Why it happens:**
The current `createSyncBridge()` in `sync-bridge.ts` (line 87-92) feature-detects `typeof BroadcastChannel !== 'undefined'` and creates BC transport if available. But availability does not guarantee cross-context reachability. The BC might exist in both contexts but be in different WKWebView partitions, resulting in messages sent to the void with no error.

BroadcastChannel was added to Safari/WebKit in Safari 15.4 with origin partitioning. Whether two WKWebView instances within the same Flutter app share a BC partition depends on `WKWebViewConfiguration` settings in flutter_inappwebview, which are not documented for this use case. The flutter_inappwebview changelog does not mention BroadcastChannel support explicitly.

The localStorage fallback (`storage` event) has the same partition concern and also lacks delivery guarantees -- it only fires in other tabs/contexts on the same origin.

**How to avoid:**
- Build all sync hardening with IndexedDB as the shared source of truth, not BroadcastChannel messages. Treat BC/localStorage events as optional "hurry up" notifications that trigger immediate IDB re-reads.
- Implement a sync cursor protocol: each context writes a monotonically increasing `syncVersion` counter to a dedicated IDB store or localStorage key alongside its writes. The other context polls at low frequency (every 2-3 seconds) and compares its local cursor against the stored cursor. If they diverge, it reads new data from IDB. BC/localStorage events trigger an immediate poll.
- Add a sync health probe on boot: each context writes a probe to BC, listens for echo from the other context (2-second timeout). If no echo, downgrade to poll-only mode. Log a diagnostic to hub health page.
- Test BC on real hardware BEFORE building hardening features. The result determines architecture. If BC works: use it as optimization. If not: poll-based sync is primary.
- Design all hardening to work with the poll mechanism disabled (BC-only) AND with BC disabled (poll-only). Both paths must be independently functional.

**Warning signs:**
- Sync hardening tests pass in Vitest (with mock BC) but sync never works on real glasses
- Hub shows "connected" but conversation updates never appear from glasses
- `console.log` in BC `onmessage` handler never fires on device
- Developer assumes BC feature detection passing means cross-context delivery works
- Sync hardening code references `syncBridge.postMessage` without considering the no-delivery case

**Phase to address:**
Sync hardening phase. Must begin with real-hardware BC reachability test before designing any hardening protocol.

---

### Pitfall 4: iOS Storage Eviction Destroys All Data Without Detection or Warning

**What goes wrong:**
User has 50+ conversations in IndexedDB. iOS applies storage pressure (low disk, app unused for days, ITP policy), and WebKit silently deletes all IDB data for the Even App's origin. User opens app, sees "New conversation" -- indistinguishable from first-run experience. No error, no warning, no recovery. The `restoreOrCreateConversation` in `boot-restore.ts` handles empty IDB identically to fresh install.

**Why it happens:**
WebKit storage policy (webkit.org/blog/14403): WKWebView apps get up to 15% of disk per origin, 20% total. Eviction uses least-recently-used policy. The Even App WebView may not count as "user interaction" from ITP's perspective, accelerating eviction to as little as 7 days of inactivity (documented in Safari ITP policy and confirmed in the Dexie.js issue #739 thread).

The current `boot-restore.ts` (line 66-73): if no conversations exist, it creates a new one. There is no way to distinguish "never had data" from "data was evicted." `navigator.storage.persist()` exists in Safari 17+ but is heuristic-based -- WebKit grants persistence based on whether the site is a Home Screen Web App, which the Even App running inside flutter_inappwebview may or may not qualify as.

**How to avoid:**
- Call `navigator.storage.persist()` on every boot. Log whether granted. If denied, show persistent warning on hub health page: "Storage not guaranteed -- conversations may be lost."
- Write a sentinel record to IDB on first run: `{ id: '__sentinel__', createdAt: Date.now() }` in the conversations store. On every subsequent boot, check for sentinel. If IDB opens but sentinel is missing, data was evicted. Emit `storage:evicted` event.
- Use `navigator.storage.estimate()` on boot to check quota usage. If >70% of quota used, warn and suggest cleanup.
- Store `conversationCount` in localStorage (different eviction characteristics than IDB). Compare localStorage count against actual IDB count on boot. Mismatch indicates eviction.
- When eviction is detected, show clear message: "Your previous conversations were cleared by the system." NOT just "New conversation."

**Warning signs:**
- Users report "all my conversations disappeared" after not using the app for a week
- `navigator.storage.persisted()` returns `false` in Even App WebView
- `boot-restore.ts` shows `restored: false, storageAvailable: true` (IDB available but empty)
- Works perfectly in development (macOS Chrome, unlimited storage) but fails on real iPhone

**Phase to address:**
Data integrity / boot verification phase. Sentinel check and `persist()` call must be added early -- they are prerequisites for meaningful error UX.

---

### Pitfall 5: Error UX That Blocks the Glasses Display and Traps the User

**What goes wrong:**
A developer adds error states appropriate for phone/desktop: modal error dialogs, persistent banners, detailed error messages with retry buttons. On the 576x288 glasses display with 4-bit greyscale and only 4 gesture inputs, these errors consume the entire display, hide the conversation, and cannot be dismissed because tap is already mapped to "retry" and the other 3 gestures (double-tap, scroll-up, scroll-down) do not map to "dismiss." The user is trapped in an error state with no way to return to conversation.

**Why it happens:**
The glasses display uses `bridge.textContainerUpgrade()` to replace text content. No layering, no z-index, no partial overlays. Container 0 (top strip ~30px) is status. Container 1-2 is chat. An error shown in container 1-2 replaces the conversation entirely. The existing `renderer.showError(message)` uses container 0 (status bar) which is non-blocking. But comprehensive error UX naturally escalates to showing errors in the chat area.

4-bit greyscale: no color for severity distinction. Fixed font: no size emphasis. 4 gestures: no spare input for "dismiss" or "show details." The Google Glimmer design language for AR HUD glasses recommends: "headline + value + action" as the pattern, with transient messages preferred to reduce thermal/battery impact and avoid attention fatigue.

**How to avoid:**
- Define strict error display hierarchy for glasses before implementing:
  - **Transient** (network blip, save retry): Status bar only (container 0). Auto-clear 3 seconds. No gesture required.
  - **Recoverable** (gateway timeout, SSE mid-stream failure): Status bar + hint bar. "Tap to retry" using existing tap flow. Auto-clear 10 seconds.
  - **Fatal** (IDB unavailable, no gateway URL): Full-screen but with escape: "Double-tap for menu." Menu always works.
- Never occupy chat container (container 1) with error text for >5 seconds.
- Single-line error messages only: "Save failed" not "Failed to persist message to IndexedDB due to QuotaExceededError."
- Use Unicode symbols for severity: `!` (warning), `x` (error), checkmark (recovery). These render in the fixed font.
- Map ALL error recovery to existing gestures. Tap = retry. Double-tap = menu/dismiss. Never add new gesture semantics for errors.
- Error messages on glasses must be under 40 characters. Details go to hub diagnostics page.

**Warning signs:**
- Error messages >40 characters on glasses display
- Error state with no auto-clear timeout and no gesture to dismiss
- Error text in container 1 (chat area) blocking conversation view
- New gesture mappings added for error handling (breaks 4-gesture model)
- Error messages referencing technical concepts ("IndexedDB", "BroadcastChannel") on glasses
- Error display code calling `bridge.textContainerUpgrade(1, ...)` directly

**Phase to address:**
Error UX phase. Define error display hierarchy as design constraint BEFORE implementing any error states.

---

### Pitfall 6: Sync Drift Reconciliation Creates Duplicate Messages

**What goes wrong:**
Drift reconciliation detects the hub is "behind" the glasses (comparing message counts or timestamps), pulls all messages from IDB, and appends missing ones. But message identity is UUID-based (`crypto.randomUUID()` at write time in `addMessage`). If both contexts independently saved the same logical message (e.g., hub receives it via sync and also saves it as a resilience measure), two records with different UUIDs exist. Reconciliation sees both as unique and keeps both. The conversation shows duplicate messages that cannot be deduplicated by ID.

**Why it happens:**
The current architecture has one writer per message type (which is good):
1. Glasses: `auto-save.ts` saves voice-originated messages, posts `message:added` via sync
2. Hub: `hub-main.ts` receives sync message, calls `appendLiveMessage()` to display it but does NOT write to IDB (trusts glasses wrote it)

This single-writer pattern is fragile. A "resilience improvement" where the hub ALSO saves incoming sync messages to IDB creates the duplicate problem. The `MessageRecord.id` is `crypto.randomUUID()` at write time, so two independent writes of the same logical message produce two records.

For hub-originated text turns: `hub-main.ts` lines 863-868 save the user message, and lines 799-825 save the assistant response. If the glasses also listen for these sync messages and try to save them, duplicates appear.

**How to avoid:**
- Preserve and document the single-writer-per-origin pattern. Glasses write all voice-originated messages. Hub writes all text-originated messages. The other context reads from IDB but NEVER writes duplicates.
- If drift reconciliation is needed, compare by `(conversationId, role, timestamp)` tuple with a 1-second window, not by UUID. Two messages with same conversation, role, and timestamp within 1 second are the same logical message.
- If both contexts must write (for offline resilience), use deterministic IDs: `id = hash(conversationId + role + text.substring(0, 100) + Math.floor(timestamp / 1000))`. Same logical message produces same ID regardless of writer.
- Add a `sourceContext: 'glasses' | 'hub'` field to `MessageRecord` to track which context authored each message. During reconciliation, the non-author context never creates copies.

**Warning signs:**
- Same message appears twice in conversation after opening hub
- Message count in IDB is higher than expected visible messages
- Reconciliation runs on every boot and message count keeps growing
- Tests creating messages from both contexts show 2x expected count

**Phase to address:**
Sync hardening / drift reconciliation phase. Define and document authoritative write ownership BEFORE implementing reconciliation.

---

### Pitfall 7: Mid-Stream SSE Failure Retry Sends Duplicate Requests to Backend

**What goes wrong:**
Error resilience for mid-stream SSE failures: stream drops (reader throws mid-response), client auto-retries the entire voice/text turn. The backend already received and processed the original request, queried the OpenClaw agent, and started streaming a response. The retry creates a second agent invocation. User sees two responses for one question. If the backend is under load (which caused the original failure), 5 retry attempts compound the problem.

**Why it happens:**
The existing `gateway-client.ts` retry logic (`handleTurnError` at line 213-244, recursive retry in `sendVoiceTurn` at line 297-304) treats all errors identically. It returns `'retry'` if `reconnectAttempts < maxReconnectAttempts`. The retry recursively calls `sendVoiceTurn` with the same request. There is no distinction between "server never got the request" (connection error, safe to retry) and "server responded partially" (mid-stream error, unsafe to retry).

The `streamSSEResponse` function (line 161-209) reads from the response body reader in a while loop. If `reader.read()` throws after some data was received, the catch block in `sendVoiceTurn` fires and may retry. The `pendingAssistantText` in `auto-save.ts` accumulates text across the partial response, gets discarded on error (line 154-155), and then re-accumulated from the retry's response -- but the backend has created a new, different response.

**How to avoid:**
- Add a `receivedAnyData` flag in `streamSSEResponse`. If the reader throws after receiving at least one chunk, classify as mid-stream failure. Do NOT auto-retry mid-stream failures.
- Distinguish three error categories:
  - **Connection error** (fetch throws before response): safe to auto-retry with backoff
  - **HTTP error** (response.ok === false): show error to user, prompt "Tap to retry"
  - **Mid-stream error** (reader throws after partial data): save partial response to conversation, show "Response interrupted -- tap to ask again"
- For mid-stream failures, save the `pendingAssistantText` accumulated so far to IDB. It has value even if incomplete. Mark with "[interrupted]" suffix.
- Cap total retries per session: 3 within 60 seconds. After that, stop retrying and surface "Connection unstable" warning.

**Warning signs:**
- User sees duplicate responses after network hiccups
- Gateway logs show same request submitted 3-5 times within seconds
- `pendingAssistantText` in `auto-save.ts` accumulates text from multiple partial responses
- Battery drain from retry loops when gateway is down

**Phase to address:**
Error resilience / gateway failure handling phase. Must modify existing `gateway-client.ts` retry logic.

---

### Pitfall 8: Error Recovery Paths That Do Not Reset the FSM, Trapping Users in Thinking State

**What goes wrong:**
New error recovery code emits error events or manages error states that do not go through the standard voice loop pipeline. The FSM remains in `thinking` state. The display shows an error. The user taps expecting to start a new recording, but `thinking` + `tap` = no action in the FSM transition table. The user is stuck with no visual indication of why tapping does not work. Only double-tap (menu) works in `thinking` state.

**Why it happens:**
Looking at the FSM transition table in `gesture-fsm.ts`: `thinking` state responds only to `double-tap` (open menu) and `reset` (return to idle). Tap, scroll-up, scroll-down are all ignored. The `gesture-handler.ts` emits `reset` on `gateway:chunk` error events -- but ONLY if the error comes through the standard voice loop pipeline. If error UX code creates new error event types or error paths that bypass the voice loop, the FSM does not get the `reset` signal.

The existing error flow: gateway error -> `emitChunk({ type: 'error' })` -> `voice-loop-controller.ts` forwards to bus -> `gesture-handler.ts` receives `gateway:chunk` with error type -> emits FSM `reset`. New error recovery code might create errors that do not flow through `emitChunk`, breaking this chain.

**How to avoid:**
- Define a single canonical `returnToIdle()` function that ALL error recovery paths call. This function: (a) emits FSM `reset`, (b) updates display to idle indicator, (c) clears pending state.
- Add a watchdog timer: if FSM has been in `sent` or `thinking` for >45 seconds (1.5x the 30-second gateway timeout), auto-emit `reset`. Catches any error path that forgot to reset.
- Never add new FSM states for error conditions. Errors are transient -- they use `idle` state with a temporary status bar indicator. The FSM cycle is idle->recording->sent->thinking->idle. Errors are a fast path back to idle.
- Test every error scenario end-to-end: inject error, verify FSM returns to `idle`, verify tap starts new recording.
- All new event types that represent errors MUST be documented as requiring FSM reset.

**Warning signs:**
- User reports "glasses stopped responding to taps" after a network error
- FSM state logged as `thinking` for >30 seconds
- Tap gesture events fire in bus but produce no FSM transition
- Error UX shows error message but does not call FSM reset
- New `gateway:chunk` subtypes that `gesture-handler.ts` does not handle

**Phase to address:**
Error resilience phase. Add watchdog timer early. Audit all error paths for FSM reset.

---

### Pitfall 9: Over-Engineering Integrity Checks for a Two-Store Schema

**What goes wrong:**
A developer builds comprehensive referential integrity: foreign key validation on every write, cascading constraint checks, periodic full-database consistency audits, and a repair mechanism that reconstructs missing records. This adds 300+ lines to what is a two-store schema (`conversations` + `messages`) with one relationship (`message.conversationId -> conversation.id`). Integrity checks add 200-500ms to boot. Writes become 2x slower. The repair mechanism introduces new failure modes (what if repair itself fails mid-transaction?).

**Why it happens:**
Referential integrity is critical in relational databases with dozens of tables. IndexedDB has two stores. The only integrity violation possible is orphaned messages (pointing to deleted conversation). The existing `deleteSession` in `session-store.ts` already handles cascade delete in a single atomic transaction (line 22-44). Orphans can only appear through cross-context races (Pitfall 2) or IDB corruption (extremely rare).

The gold-plating anti-pattern: a developer continues working on integrity past the point of diminishing returns. For this schema, "comprehensive integrity" means checking one foreign key relationship. Everything beyond that is waste.

**How to avoid:**
- Scope integrity to exactly two checks: (a) orphaned messages (conversationId -> no conversation), (b) empty conversations (may indicate interrupted creation). Nothing more.
- Run once per boot in a single read-only transaction. Budget: <50ms for hundreds of records.
- Do NOT auto-repair. Log findings to hub diagnostics. User-confirmable action for cleanup.
- Do NOT add foreign key validation on writes. `addMessage` runs in a transaction spanning both stores. If conversation is missing, message is still written (the conversation update simply finds `undefined` and skips). The orphan will be caught on next boot check.
- Budget: total integrity code under 50 lines. If exceeding 100 lines, stop and reassess.
- Do NOT build a "repair" function. The only repair needed is deleting orphaned messages, which is a single cursor delete -- it does not need its own retry/recovery logic.

**Warning signs:**
- Integrity code is larger than the persistence layer it protects
- Boot time increases by >100ms from integrity checks
- Integrity checks run on every page navigation, not just boot
- Repair function has its own error handling and retry logic
- Foreign key validation on every `addMessage` call

**Phase to address:**
Data integrity phase. Define exact checks (two) and budget (50 lines) BEFORE writing code.

---

### Pitfall 10: Adding Resilience Layers That Regress Existing Working Flows

**What goes wrong:**
A developer adds verification, retry, or error handling wrappers around existing working functions. The wrapper introduces a new async boundary, a new error path, or a new timing dependency. The existing function's contract changes subtly: it now throws where it previously swallowed errors, or resolves at a different time, or emits events in a different order. Existing tests pass because they test the function directly, not through the wrapper. The integration breaks at runtime.

**Why it happens:**
The codebase has 60 files and 372 tests, but integration coverage is limited. Most tests are unit tests for individual modules (e.g., `conversation-store.test.ts` tests CRUD operations, `sync-bridge.test.ts` tests message delivery). The wiring between modules -- `auto-save.ts` subscribing to bus events, `glasses-main.ts` orchestrating init order, `hub-main.ts` handling sync messages -- is tested primarily in `glasses-main.test.ts` and `app-wiring.test.ts`. Adding a verification layer between `auto-save` and `conversation-store` might pass `auto-save.test.ts` but break the timing expectations in `glasses-main.ts`.

Specific regression risks in this codebase:
- `auto-save.ts` relies on fire-and-forget semantics. Adding `await` to verification changes the timing of `syncBridge.postMessage` relative to the save. The `message:added` sync event might fire before the verification completes, and the hub might try to read the message from IDB before it is verified.
- `boot-restore.ts` assumes `restoreOrCreateConversation` completes quickly. Adding integrity checks inside boot-restore extends boot time. The bridge init waits for restore, and the "Connecting..." text stays on screen longer.
- The `switchToSession` function in `glasses-main.ts` (line 117-141) calls `renderer.destroy()` then `renderer.init()`. If a new verification layer runs between these calls (e.g., checking session integrity before loading), the renderer is in a destroyed state during verification. Any event that fires during this window and tries to render will fail silently.

**How to avoid:**
- Add new resilience code as NEW functions alongside existing functions, not as wrappers around them. `verifyIntegrity()` as a separate function called from `boot()`, not as a wrapper around `createConversationStore()`.
- Never change the async contract of existing functions. If `addMessage` is fire-and-forget today, it stays fire-and-forget. New verification runs in a separate async chain.
- Run the full test suite after EVERY resilience change, not just the tests for the modified module.
- Add integration tests for the specific interaction points: auto-save -> IDB -> sync -> hub display. These tests catch timing regressions that unit tests miss.
- Use the existing event bus as the integration surface. New resilience features should subscribe to existing events, not modify the functions that emit them.
- Create a "smoke test" that boots the full glasses context, sends a voice turn, and verifies the message appears in IDB and is synced. Run this after every resilience change.

**Warning signs:**
- A resilience change modifies the function signature or return type of an existing public function
- `async` is added to a function that was previously synchronous
- Error handling is added to a function that previously swallowed errors (changing the error propagation contract)
- The Layer 0-5 init sequence in `glasses-main.ts` is modified to accommodate new steps between existing layers
- Tests for the modified module pass but `glasses-main.test.ts` or `app-wiring.test.ts` fail

**Phase to address:**
All phases. This is a cross-cutting concern. Every phase that adds resilience must run the full test suite and verify no regressions.

---

### Pitfall 11: Safari/WebKit Transaction Auto-Commit Timing Breaks New Integrity Code

**What goes wrong:**
New integrity check code opens a read-only transaction, scans for orphans, computes repair actions, and then opens a read-write transaction to apply repairs. The code works in Chrome and in `fake-indexeddb` tests. On Safari/WebKit (the actual runtime via WKWebView), the read-only transaction auto-commits between the scan phase and the repair phase. The repair transaction cannot reference results from the scan transaction. Worse, if the code uses Promises between IDB operations within a single transaction, Safari closes the transaction mid-operation, throwing "TransactionInactiveError."

**Why it happens:**
Safari closes IDB transactions more aggressively than Chrome/Firefox when nothing is being done to a transaction in a stack frame. The use of `Promise.resolve().then(() => ...)` can prematurely close the transaction in Safari and Firefox. The existing codebase avoids this by completing all IDB operations synchronously within transaction callbacks -- e.g., `conversation-store.ts` uses `tx.oncomplete` and `req.onsuccess` directly, never awaiting Promises between IDB operations within a transaction.

New integrity code written with modern async/await patterns WILL break on Safari because each `await` creates a microtask boundary where Safari may auto-commit the transaction. Firebase had to implement their own Promise for this reason.

**How to avoid:**
- Follow the existing codebase pattern: use `tx.oncomplete`, `req.onsuccess` callbacks directly. Do NOT use `async/await` within IDB transaction boundaries.
- If scan + repair requires two transactions, accept that the data may change between them. Re-verify orphan status in the repair transaction before deleting.
- Test on Safari (or a WebKit-based browser) during development, not just Chrome. Safari's stricter transaction semantics catch bugs that Chrome hides.
- If using `fake-indexeddb` in tests, be aware it does not replicate Safari's aggressive auto-commit. Consider marking integrity tests as requiring browser-level validation.
- The existing patterns in `conversation-store.ts` and `session-store.ts` are Safari-safe. Copy them exactly. Do not "improve" them with async/await.

**Warning signs:**
- "TransactionInactiveError" in console on Safari but not Chrome
- Integrity checks pass in Vitest (fake-indexeddb) but crash on device
- Code uses `await` between IDB operations within the same transaction
- New IDB code uses a different pattern than existing `conversation-store.ts`

**Phase to address:**
All phases that touch IndexedDB. This is a coding discipline constraint, not a feature.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip sentinel record for eviction detection | Saves 10 lines | Users cannot distinguish data eviction from first run | Never -- 10 lines for critical user trust |
| BC-only sync hardening without IDB fallback | Simpler protocol | Dead code if BC unavailable on device hardware | Never -- BC support unverified |
| Auto-delete orphans without grace period | Cleaner DB immediately | Deletes valid data during cross-context races | Never -- grace period adds 5 lines |
| Full error messages on glasses display | Developer can debug from glasses | Display unusable during errors, user trapped | Never -- hub diagnostics is for debugging |
| Read-after-write verification on every write | Feels rigorous | 50-100% latency increase with no durability gain | Never -- use strict durability for critical writes |
| Auto-retry mid-stream SSE failures | Automatic recovery | Duplicate responses, backend load amplification | Only for connection errors (no data received) |
| Run integrity checks on every navigation | Catches corruption faster | 200-500ms per page load, redundant after boot | Never -- boot-only sufficient for single-user app |
| Add FSM states for error conditions | Explicit error in transition table | FSM grows from 5 to 7+ states; recovery becomes state machine logic | Never -- errors are transient, use idle + visual |
| Poll IDB for sync at <500ms interval | Near-instant sync | Battery drain, CPU contention, IDB lock pressure | Never -- 2-second poll with event-triggered immediate is sufficient |
| async/await in IDB transaction callbacks | Cleaner code | Breaks on Safari/WebKit due to aggressive auto-commit | Never in transaction scope -- use callback pattern |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Orphan detection + cross-context writes | Delete orphans immediately | Mark with timestamp, grace period, re-verify before deleting |
| Strict durability + performance | Use strict for all writes "because safer" | Relaxed (default) for messages; strict only for schema migrations, sentinels |
| Sync hardening + BroadcastChannel | Assume BC delivery is reliable | Build on IDB-as-truth; BC is optional "hurry up" notification |
| Error UX + glasses display | Show detailed errors on glasses | Status bar only (container 0); auto-clear 3-5 seconds; details in hub |
| FSM error recovery + existing reset | Add new error states or gesture mappings | Use existing `reset` input; add watchdog timer; all errors return to idle |
| Gateway retry + mid-stream failures | Retry all errors identically | Distinguish connection (safe) from mid-stream (show partial, prompt user) |
| Drift reconciliation + message identity | Deduplicate by UUID | Deduplicate by (conversationId, role, timestamp) or deterministic IDs |
| New verification layers + existing functions | Wrap existing functions with verification | Add new functions alongside; never change async contract of existing code |
| Integrity code + Safari IDB | Use async/await in transactions | Use callback pattern (tx.oncomplete, req.onsuccess) matching existing code |
| Health indicators + glasses | Show all health on both displays | Glasses: actionable/temporary only. Hub: detailed/persistent |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Read-after-write verification on every save | Write latency doubles; 200ms+ per streaming message | Boot-time integrity instead of per-write | Immediately -- every save adds unnecessary read |
| Strict durability for all IDB transactions | Write throughput drops 3-10x (waits for disk flush) | Default relaxed for messages; strict only for migrations | Immediately -- noticeable latency on every save |
| Full integrity audit on every page navigation | Hub feels sluggish; 200-500ms per tab click | Boot-only; cache results; explicit user action for re-scan | At 50+ conversations with messages |
| Sync heartbeat at sub-second intervals | Battery drain, CPU contention, IDB lock pressure | 2-second poll minimum; BC/LS events as immediate trigger | Extended sessions (30+ minutes) |
| Reconciliation reading all messages from both contexts | Memory spike on boot; 500ms+ for large histories | Incremental: only messages newer than last sync cursor | At 100+ conversations |
| Error UX animations on glasses display | Flicker, 150-300ms update cadence violated | Static text only for errors on glasses | Immediately -- glasses display is not a DOM |
| Full-table scan orphan detection | Boot time proportional to total message count | Index-based scan using `by-conversation` index + conversation ID set | At 1000+ messages across many conversations |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Logging conversation content in error diagnostics | Private conversations visible in exported diagnostics JSON | Log message IDs and metadata only; never log text in error reports |
| Sync heartbeat messages containing conversation content | Full text transits through BC/localStorage | Heartbeat: cursor positions and counts only; content reads from IDB |
| Integrity results exposing orphaned message content in hub UI | User text shown in integrity report | Show counts only ("3 orphaned messages"), not content |
| Storing sync cursor state with conversation content | Sync debugging data includes message text | Separate sync metadata from content data in IDB |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Error modal on glasses with no dismiss path | User trapped, cannot return to conversation | Auto-clear 3-5 seconds; tap = retry; double-tap = menu (escape hatch) |
| Technical error terms on glasses ("IDB quota exceeded") | Confused by jargon on consumer device | "Storage full" not "QuotaExceededError"; "Connection lost" not "SSE stream terminated" |
| Persistent health bar consuming display space | Less conversation space; visual noise | Show only when something is wrong, and only temporarily |
| Error state preventing new recordings | Cannot recover by starting fresh; feels broken | FSM always returns to idle after error; tap always starts recording |
| "Data may be lost" without explanation on hub | User panics, no action available | "Some messages may not have been saved. Check connection and try again." |
| Sync indicator showing real-time status on glasses | Distracting; user does not care about sync mechanism | Sync invisible when working; "Not synced" only after 30+ seconds of failure |
| Silent data eviction appearing as first-run | User thinks app reset itself; loses trust | Sentinel detection + clear "System cleared your data" message |

## "Looks Done But Isn't" Checklist

- [ ] **Eviction detection:** Often missing sentinel record -- verify by clearing IDB and confirming app shows "Previous data was cleared" not first-run experience
- [ ] **Orphan cleanup:** Often deletes valid data during races -- verify by running detection while glasses are actively writing messages
- [ ] **BC reachability:** Often tested only in Chrome dev mode -- verify BC messages cross contexts on real Even App hardware
- [ ] **Error UX on glasses:** Often uses chat container for errors -- verify errors only in status bar (container 0), auto-clear within 5 seconds
- [ ] **FSM recovery:** Often missing watchdog -- verify FSM returns to idle within 45 seconds of any error
- [ ] **Mid-stream retry:** Often retries partial responses -- verify mid-stream failure shows partial text, prompts user
- [ ] **Integrity checks:** Often run on every page load -- verify boot-only, <50ms for hundreds of records
- [ ] **Drift reconciliation:** Often creates duplicates -- verify reconciling from both contexts produces exactly N messages
- [ ] **Health indicators on glasses:** Often show non-actionable status -- verify every glasses health message has auto-clear or user action
- [ ] **Safari IDB compatibility:** Often uses async/await in transactions -- verify new IDB code uses callback pattern matching existing code
- [ ] **Regression coverage:** Often only tests modified module -- verify full 372-test suite passes after every resilience change

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Read-after-write verification (P1) | LOW | Remove verification reads. No behavioral change. ~1 hour. |
| Orphan cleanup deletes valid data (P2) | HIGH | Data unrecoverable. Add grace period retroactively. ~2 hours for fix. |
| BC unavailable on hardware (P3) | MEDIUM | Refactor to IDB-as-truth. ~4-6 hours if BC-dependent, LOW if designed with fallback. |
| iOS storage eviction (P4) | LOW for code | Add sentinel + persist(). ~2 hours. Lost data unrecoverable. |
| Glasses display blocked by errors (P5) | LOW | Add auto-clear timeouts, move to status bar. ~2-3 hours. |
| Duplicate messages from reconciliation (P6) | MEDIUM | Add deduplication, clean existing duplicates. ~3-4 hours. |
| Mid-stream retry hammering backend (P7) | LOW | Add `receivedAnyData` flag, classify error types. ~2-3 hours. |
| Stuck FSM after error (P8) | LOW | Add watchdog timer, audit error paths. ~2-3 hours. |
| Over-engineered integrity (P9) | MEDIUM | Simplify to 2 checks, <50 lines. ~3-4 hours to strip over-engineering. |
| Regression from resilience changes (P10) | VARIES | Depends on what broke. Integration tests prevent this. ~1-8 hours. |
| Safari transaction timing (P11) | MEDIUM | Rewrite async code to callback pattern. ~2-4 hours per function. |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Write verification false confidence (P1) | Data integrity | No read-after-write in save path; strict durability only on migrations/sentinels |
| Orphan cleanup race condition (P2) | Data integrity / orphan detection | Run detection during active cross-context writes; no valid data deleted |
| BroadcastChannel unavailability (P3) | Sync hardening | Hardening works with BC disabled; test on real Even App hardware |
| iOS storage eviction (P4) | Data integrity / boot verification | Clear IDB manually; app shows eviction warning, not first-run |
| Glasses error UX blocking (P5) | Error UX | Inject every error type; all auto-clear within 5 seconds; tap always works |
| Drift reconciliation duplicates (P6) | Sync hardening / drift | Write same message from both contexts; IDB has exactly 1 copy |
| Gateway retry amplification (P7) | Error resilience / gateway | Mid-stream: partial shown, no retry. Connection: auto-retry with backoff |
| Stuck FSM states (P8) | Error resilience | Inject error in every state; all return to idle <45 seconds; tap works |
| Over-engineered integrity (P9) | Data integrity | Code under 50 lines; boot check <50ms |
| Regression from resilience (P10) | All phases | Full 372-test suite passes after every change; integration tests added |
| Safari transaction timing (P11) | All IDB phases | No async/await in transaction scope; callback pattern only |

## Over-Engineering Boundaries: What NOT to Build

These are explicit boundaries to prevent gold-plating in v1.3:

| DO NOT Build | Why | What to Do Instead |
|-------------|-----|-------------------|
| Per-write read-after-write verification | False confidence, latency cost, no actual durability gain | Boot-time integrity scan |
| Referential integrity enforcement on every write | Two-store schema, single FK, cascade delete already exists | Two-check boot audit |
| Automatic orphan repair without user confirmation | Risk of deleting valid data during races | Log + user-confirmable cleanup |
| Custom retry/recovery framework | Over-abstraction for 2 retry sites (auto-save, gateway) | Extend existing retry patterns |
| Sync protocol with acknowledgments and sequence numbers | BC has no delivery guarantee anyway; adds massive complexity | IDB-as-truth + cursor polling |
| Persistent health dashboard on glasses | Not actionable, consumes display, user does not care | Transient status bar only |
| More than 2 integrity checks | Only 2 things can break (orphan messages, empty conversations) | Stop at 2 |
| Error states in FSM transition table | Errors are transient, not states | Reset to idle + visual indicator |
| Sub-second sync polling | Battery drain, no user-perceivable benefit over 2-second | 2-second poll + event trigger |
| Conversation export/backup | Out of scope for v1.3; adds significant complexity | Eviction detection + warning only |

## Sources

- [Chrome IndexedDB durability mode change (Chrome 121)](https://developer.chrome.com/blog/indexeddb-durability-mode-now-defaults-to-relaxed) -- HIGH confidence, official Chrome DevRel
- [WebKit storage policy updates (Safari 17+)](https://webkit.org/blog/14403/updates-to-storage-policy/) -- HIGH confidence, official WebKit blog; WKWebView apps get 15% per origin, 20% total; navigator.storage.persist() available but heuristic-based
- [MDN: Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) -- HIGH confidence, authoritative web platform docs
- [WebKit Bug 144875: WKWebView does not persist IndexedDB after app close](https://bugs.webkit.org/show_bug.cgi?id=144875) -- HIGH confidence, official WebKit bug tracker
- [The pain and anguish of using IndexedDB (pesterhazy)](https://gist.github.com/pesterhazy/4de96193af89a6dd5ce682ce2adff49a) -- HIGH confidence, comprehensive real-world bug catalog; Safari transaction auto-commit, WAL file bloat, 7-day data deletion
- [MDN: BroadcastChannel API](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API) -- HIGH confidence; documents no delivery guarantee, no message history
- [MDN Blog: Exploring BroadcastChannel for cross-tab communication](https://developer.mozilla.org/en-US/blog/exploring-the-broadcast-channel-api-for-cross-tab-communication/) -- HIGH confidence; messages lost if no listeners, no ordering guarantee
- [SSE production pitfalls](https://dev.to/miketalbot/server-sent-events-are-still-not-production-ready-after-a-decade-a-lesson-for-me-a-warning-for-you-2gie) -- MEDIUM confidence, practitioner experience; buffering by proxies, connection pool exhaustion
- [Google Glimmer: UI design language for HUD AR glasses](https://www.uploadvr.com/google-details-glimmer-its-ui-design-language-for-hud-ar-glasses/) -- MEDIUM confidence; headline+value+action pattern, transient messages preferred
- [Dexie.js data loss on iOS 11.3/11.4](https://github.com/dfahlander/Dexie.js/issues/739) -- HIGH confidence, documented IDB data loss in WKWebView
- [Apple Developer Forums: losing data from IndexedDB](https://developer.apple.com/forums/thread/730023) -- MEDIUM confidence, community reports of IDB eviction
- [flutter_inappwebview changelog](https://pub.dev/packages/flutter_inappwebview/changelog) -- MEDIUM confidence; no specific BroadcastChannel documentation found
- [web.dev: Best practices for IndexedDB](https://web.dev/articles/indexeddb-best-practices) -- HIGH confidence, official Google web platform guidance
- [Longhorn orphaned data cleanup design](https://github.com/longhorn/longhorn/blob/master/enhancements/20220324-orphaned-data-cleanup.md) -- MEDIUM confidence; demonstrates grace period pattern for orphan cleanup
- [Gold plating anti-pattern](https://exceptionnotfound.net/gold-plating-the-daily-software-anti-pattern/) -- MEDIUM confidence; stop when product functions well
- Codebase analysis: `src/sync/sync-bridge.ts`, `src/persistence/conversation-store.ts`, `src/persistence/auto-save.ts`, `src/persistence/boot-restore.ts`, `src/api/gateway-client.ts`, `src/gestures/gesture-fsm.ts`, `src/glasses-main.ts`, `src/hub-main.ts`, `src/persistence/session-store.ts` -- HIGH confidence, primary source

---
*Pitfalls research for: Even G2 OpenClaw Chat App v1.3 -- Resilience & Error UX*
*Researched: 2026-02-28*
