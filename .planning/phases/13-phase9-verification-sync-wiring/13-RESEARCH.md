# Phase 13: Phase 9 Verification & Sync Wiring - Research

**Researched:** 2026-02-28
**Domain:** IndexedDB persistence verification, cross-context sync message wiring
**Confidence:** HIGH

## Summary

Phase 13 is a gap-closure phase with two distinct tasks: (1) formally verify that Phase 9's persistence requirements (PERS-01 through PERS-04) are satisfied, and (2) wire the two dead-code SyncMessage types (`message:added` and `conversation:named`) so that the glasses context posts them through the syncBridge after persisting data.

The v1.2 milestone audit (`v1.2-MILESTONE-AUDIT.md`) identified that Phase 9 was fully executed (2/2 plans complete, 300+ tests passing) but never formally verified -- no VERIFICATION.md was created. It also identified that `conversation:named` and `message:added` are defined in `sync-types.ts` but never posted or consumed, making them dead code. The `onConversationNamed` callback in `glasses-main.ts:187` is a no-op stub that receives the name but does nothing with it.

The code changes required are minimal and surgical. The auto-save module (`auto-save.ts`) needs access to the syncBridge to post `message:added` after each successful save. The `onConversationNamed` callback in `glasses-main.ts` needs to call `syncBridge.postMessage()` with a `conversation:named` message. The hub's sync message handler needs to handle these two new message types (at minimum with `refreshSessionList()` for `conversation:named`, and a no-op or future placeholder for `message:added` until Phase 12 builds the live conversation view).

**Primary recommendation:** Keep changes to 3 files maximum (`glasses-main.ts`, `auto-save.ts`, `hub-main.ts`). The verification document is documentation-only. The sync wiring is straightforward -- pass `syncBridge` reference into the auto-save options and wire the two callbacks.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PERS-01 | Conversations persist in IndexedDB across page reloads and app restarts | Verification only -- code exists in `conversation-store.ts`, tested by 17 tests in `conversation-store.test.ts`. Boot-restore loads from IndexedDB. |
| PERS-02 | Messages auto-save as they arrive (user transcripts and assistant responses) | Verification only -- `auto-save.ts` subscribes to `gateway:chunk`, saves user on `transcript`, assistant on `response_end`. Tested by 7 tests in `auto-save.test.ts`. |
| PERS-03 | Active conversation loads automatically on app boot with previous context | Verification only -- `boot-restore.ts` reads `localStorage` pointer then loads from IndexedDB. Tested by 5 tests in `boot-restore.test.ts`. |
| PERS-04 | Conversation metadata auto-generated (name from first message, timestamps) | Verification + fix -- `generateConversationName()` works, `store.updateConversation()` is called, but `onConversationNamed` callback is a no-op stub. Must wire it to post `conversation:named` SyncMessage. |
| SYNC-01 | Event bus bridge enables real-time hub-glasses communication | Complete wiring -- `message:added` and `conversation:named` SyncMessage types are defined but dead code. Must be posted from glasses context and handled (or acknowledged) by hub context. |
</phase_requirements>

## Standard Stack

### Core

No new libraries needed. This phase uses only existing project infrastructure.

| Library | Version | Purpose | Already in Project |
|---------|---------|---------|-------------------|
| fake-indexeddb | devDependency | Test-time IndexedDB polyfill | Yes |
| vitest | devDependency | Test runner | Yes |
| TypeScript | project version | Type safety | Yes |

### Supporting

None -- no new dependencies for this phase.

### Alternatives Considered

None -- this phase wires existing code, not adding new technology.

**Installation:**
```bash
# No installation needed -- all dependencies already present
```

## Architecture Patterns

### Recommended Project Structure

No new files needed. Changes affect existing files:

```
src/
├── persistence/
│   └── auto-save.ts           # Add syncBridge + postMessage calls
├── sync/
│   └── sync-types.ts          # Already has message:added and conversation:named (no change)
│   └── sync-bridge.ts         # No change
├── glasses-main.ts            # Wire onConversationNamed to post conversation:named
├── hub-main.ts                # Add message:added and conversation:named to sync handler
.planning/phases/
├── 09-indexeddb-persistence/
│   └── 09-VERIFICATION.md     # NEW: formal verification document
└── 13-phase9-verification-sync-wiring/
    └── (plans, summaries)
```

### Pattern 1: Passing syncBridge into AutoSave

**What:** The auto-save module currently has no reference to the syncBridge. To post `message:added` SyncMessages, it needs the bridge passed through its options.

**When to use:** When a cross-cutting persistence module needs to notify other contexts of data changes.

**Example:**
```typescript
// In auto-save.ts -- extend AutoSaveOptions
export interface AutoSaveOptions {
  bus: EventBus<AppEventMap>;
  store: ConversationStore;
  getConversationId: () => string;
  onConversationNamed?: (name: string) => void;
  // NEW: sync bridge for cross-context notifications
  syncBridge?: SyncBridge;
}

// After successful save in the transcript handler:
saveWithRetry(() =>
  store.addMessage(convId, { role: 'user', text, timestamp: Date.now() }),
).then((ok) => {
  if (ok && opts.syncBridge) {
    opts.syncBridge.postMessage({
      type: 'message:added',
      origin: 'glasses',
      conversationId: convId,
      role: 'user',
      text,
    });
  }
  if (!ok) {
    bus.emit('persistence:warning', { message: 'Messages may not be saved' });
  }
});
```

**Source:** Derived from existing patterns in `sessions.ts` (SessionManager posts sync messages after mutations).

### Pattern 2: Wiring onConversationNamed Callback

**What:** The `onConversationNamed` callback in `glasses-main.ts` is currently a no-op stub. It should post `conversation:named` through the syncBridge.

**When to use:** When an existing callback stub needs to be replaced with real implementation.

**Example:**
```typescript
// In glasses-main.ts, replace the no-op onConversationNamed:
onConversationNamed: (name) => {
  syncBridge.postMessage({
    type: 'conversation:named',
    origin: 'glasses',
    conversationId: activeConversationId,
    name,
  });
},
```

**Source:** Mirrors how `SessionManager.renameSession()` posts `session:renamed` in `sessions.ts:48-55`.

### Pattern 3: Hub Sync Handler Extension

**What:** The hub's `syncBridge.onMessage()` handler currently only handles `session:*` types. It needs cases for `message:added` and `conversation:named`.

**When to use:** When new sync message types are added to the protocol.

**Example:**
```typescript
// In hub-main.ts initPersistence() syncBridge.onMessage handler:
syncBridge.onMessage((msg) => {
  if (msg.origin === 'hub') return;
  switch (msg.type) {
    case 'session:created':
    case 'session:renamed':
    case 'session:deleted':
    case 'session:switched':
      refreshSessionList();
      break;
    case 'conversation:named':
      // Session list shows conversation names -- refresh to show new name
      refreshSessionList();
      break;
    case 'message:added':
      // Phase 12 will use this for live conversation view
      // For now, just acknowledge the message type is wired
      break;
  }
});
```

**Source:** Extension of existing switch statement in `hub-main.ts:569-575`.

### Anti-Patterns to Avoid

- **Adding syncBridge to the EventBus:** Do NOT post SyncMessages through the local AppEventMap bus. The syncBridge is a cross-context transport (BroadcastChannel/localStorage), not a local event bus. Keep these channels separate.
- **Posting sync messages before persistence completes:** Always post `message:added` AFTER the `saveWithRetry()` succeeds, not before. If the save fails, the hub should not show a message that was never persisted.
- **Breaking the optional chain:** The `syncBridge` parameter in AutoSaveOptions should remain optional (`syncBridge?: SyncBridge`) to avoid breaking existing tests that do not pass a syncBridge.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-context messaging | Custom postMessage wrapper | Existing `SyncBridge` interface | Already built, tested, with BroadcastChannel + localStorage fallback |
| Verification document | Ad-hoc format | Phase 10 VERIFICATION.md format | Consistent format across phases, consumed by milestone audit |

**Key insight:** This phase wires existing infrastructure together. There is nothing to hand-roll -- the SyncBridge, auto-save, and conversation store are all built and tested.

## Common Pitfalls

### Pitfall 1: Posting sync messages on failed saves

**What goes wrong:** If `message:added` is posted before verifying the save succeeded, the hub could display a message that was never persisted. On next page load, the message would be missing.
**Why it happens:** Fire-and-forget pattern makes it tempting to post the sync message alongside the save, not after.
**How to avoid:** Post `message:added` only inside the `.then((ok) => { if (ok) ... })` callback of `saveWithRetry()`.
**Warning signs:** Hub shows a message that disappears after reload.

### Pitfall 2: Breaking existing auto-save tests

**What goes wrong:** If the `syncBridge` parameter is made required in `AutoSaveOptions`, all 7 existing auto-save tests will fail because they don't pass a syncBridge.
**Why it happens:** TypeScript will flag the missing property.
**How to avoid:** Make `syncBridge` optional (`syncBridge?: SyncBridge`). Existing tests continue to work without it. New tests can pass a mock syncBridge.
**Warning signs:** Type errors in `auto-save.test.ts`.

### Pitfall 3: Double-posting in hub self-echo

**What goes wrong:** If the hub eventually posts `message:added` messages itself (Phase 12), the `if (msg.origin === 'hub') return` guard correctly filters self-echoes. But if the filter is removed or weakened, the hub could process its own messages.
**Why it happens:** Copy-paste errors when adding new message type handlers.
**How to avoid:** The origin filter at the top of the handler already covers all message types. Do not add per-case origin checks.
**Warning signs:** Duplicate operations when hub sends a message.

### Pitfall 4: Forgetting to handle conversation:named in hub

**What goes wrong:** If `conversation:named` is wired in glasses but the hub switch statement has no case for it, the message is silently dropped. The session list shows stale names.
**Why it happens:** The default case in a switch without `default` silently falls through.
**How to avoid:** Add explicit cases for both `conversation:named` and `message:added` in the hub's sync handler.
**Warning signs:** Hub session list shows "New conversation" instead of the auto-generated name.

### Pitfall 5: Verification scope creep

**What goes wrong:** The VERIFICATION.md for Phase 9 tries to re-verify Phase 10 concerns (sessions, sync bridge) instead of staying focused on PERS-01 through PERS-04.
**Why it happens:** Phase 9 and Phase 10 share the persistence layer.
**How to avoid:** The Phase 9 VERIFICATION.md should only verify the 4 PERS requirements. Phase 10 already has its own VERIFICATION.md.
**Warning signs:** Phase 9 VERIFICATION.md mentions SESS-* or SYNC-* requirements.

## Code Examples

### Current state: onConversationNamed no-op (glasses-main.ts:187-189)

```typescript
// Source: src/glasses-main.ts lines 187-189
onConversationNamed: (_name) => {
  // Future: update UI with conversation name (Phase 10+ concern)
},
```

### Current state: Dead code sync types (sync-types.ts:11-12)

```typescript
// Source: src/sync/sync-types.ts lines 11-12
| { type: 'message:added'; origin: SyncOrigin; conversationId: string; role: string; text: string }
| { type: 'conversation:named'; origin: SyncOrigin; conversationId: string; name: string };
```

### Current state: Hub sync handler only handles session types (hub-main.ts:566-575)

```typescript
// Source: src/hub-main.ts lines 566-575
syncBridge.onMessage((msg) => {
  if (msg.origin === 'hub') return; // ignore own echoes
  switch (msg.type) {
    case 'session:created':
    case 'session:renamed':
    case 'session:deleted':
    case 'session:switched':
      refreshSessionList();
      break;
  }
});
```

### Target state: auto-save posts message:added after successful save

```typescript
// Target: src/persistence/auto-save.ts -- transcript handler
saveWithRetry(() =>
  store.addMessage(convId, { role: 'user', text, timestamp: Date.now() }),
).then((ok) => {
  if (ok && syncBridge) {
    syncBridge.postMessage({
      type: 'message:added',
      origin: 'glasses',
      conversationId: convId,
      role: 'user',
      text,
    });
  }
  if (!ok) {
    bus.emit('persistence:warning', { message: 'Messages may not be saved' });
  }
});
```

### Target state: onConversationNamed posts conversation:named

```typescript
// Target: src/glasses-main.ts -- onConversationNamed callback
onConversationNamed: (name) => {
  syncBridge.postMessage({
    type: 'conversation:named',
    origin: 'glasses',
    conversationId: activeConversationId,
    name,
  });
},
```

### Target state: hub handles both new message types

```typescript
// Target: src/hub-main.ts -- extended sync handler
syncBridge.onMessage((msg) => {
  if (msg.origin === 'hub') return;
  switch (msg.type) {
    case 'session:created':
    case 'session:renamed':
    case 'session:deleted':
    case 'session:switched':
    case 'conversation:named':
      refreshSessionList();
      break;
    case 'message:added':
      // Phase 12 will use this for live conversation view (HUB-01)
      break;
  }
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No-op callback for onConversationNamed | Post conversation:named via syncBridge | Phase 13 (this phase) | Hub sees auto-generated conversation names in real-time |
| Auto-save saves locally only | Auto-save posts message:added via syncBridge | Phase 13 (this phase) | Hub can receive real-time message notifications (consumed in Phase 12) |

**Deprecated/outdated:**
- The `// Future: update UI with conversation name (Phase 10+ concern)` comment in glasses-main.ts:188 is stale and should be removed when the real implementation replaces it.

## Open Questions

1. **Should auto-save post message:added for both user and assistant messages?**
   - What we know: The `message:added` SyncMessage type has `role` and `text` fields, suggesting it supports both. Phase 12 (HUB-01) wants to display the live conversation, which includes both user transcripts and assistant responses.
   - What's unclear: Whether posting assistant `response_delta` chunks or only the final `response_end` message is preferred. Posting only on `response_end` is simpler and matches the current save behavior.
   - Recommendation: Post `message:added` for both user (on transcript save) and assistant (on response_end save). This matches the save cadence and avoids flooding the sync bridge with delta chunks. Phase 12 can add streaming indicators separately via HUB-02.

2. **Should the hub's message:added handler do anything in Phase 13?**
   - What we know: Phase 12 will build the live conversation view (HUB-01). Phase 13 only needs to ensure the message is "no longer dead code" per success criteria.
   - What's unclear: Whether a simple `break` (acknowledge but no action) satisfies "can be consumed by hub."
   - Recommendation: Add the case with a `break` statement and a comment indicating Phase 12 will consume it. The success criterion says "can be consumed" not "is consumed with visible effect." The wiring is what matters -- the hub receives and dispatches the message, even if the Phase 12 handler is not yet built.

## Sources

### Primary (HIGH confidence)

- **Codebase inspection** -- All findings based on direct reading of source files:
  - `src/glasses-main.ts` (252 lines) -- boot sequence, auto-save wiring, onConversationNamed stub
  - `src/persistence/auto-save.ts` (134 lines) -- event bus subscriber, save retry logic
  - `src/sync/sync-types.ts` (18 lines) -- SyncMessage type definition with all 6 variants
  - `src/sync/sync-bridge.ts` (93 lines) -- BroadcastChannel + localStorage transport
  - `src/hub-main.ts` (583 lines) -- hub initialization, sync message handler
  - `src/sessions.ts` (90 lines) -- SessionManager pattern (reference for sync posting)

- **v1.2 Milestone Audit** (`.planning/v1.2-MILESTONE-AUDIT.md`) -- Identified the specific gaps this phase closes

- **Phase 10 VERIFICATION.md** (`.planning/phases/10-dynamic-sessions-cross-context-sync/10-VERIFICATION.md`) -- Reference format for Phase 9 VERIFICATION.md

- **Test suite** -- 325/325 tests passing (verified by running `npx vitest run`)

### Secondary (MEDIUM confidence)

None needed -- all findings are from direct codebase inspection.

### Tertiary (LOW confidence)

None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new technology; all existing project infrastructure
- Architecture: HIGH - Patterns directly derived from existing code (SessionManager sync posting)
- Pitfalls: HIGH - Based on actual code inspection, not speculation

**Research date:** 2026-02-28
**Valid until:** Indefinite -- this research covers project-internal wiring, not external library APIs
