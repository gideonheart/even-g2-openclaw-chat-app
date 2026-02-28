# Phase 15: Write Verification & Auto-Save Hardening - Research

**Researched:** 2026-02-28
**Domain:** IndexedDB write verification, auto-save error escalation, partial response preservation, SSE mid-stream failure handling
**Confidence:** HIGH

## Summary

Phase 15 hardens the primary write path (auto-save) to prevent silent data loss. The scope is precisely three behaviors: (1) verify the first message write in each session to confirm storage is functional, (2) escalate auto-save errors from `persistence:warning` to `persistence:error` when all retries are exhausted, and (3) save partial assistant responses on mid-stream SSE failure instead of discarding them. All three requirements modify existing modules -- no new files are needed.

The existing `auto-save.ts` already has solid fundamentals: fire-and-forget saves with 3 retries and 500ms exponential backoff, `pendingAssistantText` accumulation, and per-chunk event handling. Phase 15 adds verification, escalation, and partial save behaviors to this proven flow. Phase 14 already delivered the `persistence:error` event type in `AppEventMap` with the exact payload shape needed (`type: 'write-failed' | 'verify-failed'`, `recoverable`, `conversationId`).

**Primary recommendation:** Modify `auto-save.ts` to add `verifyMessage()` call after first save, escalate to `persistence:error` on retry exhaustion, and save `pendingAssistantText` with `"[response interrupted]"` suffix on error chunks. Add `verifyMessage()` and `getMessage()` to `ConversationStore` interface. Replicate error escalation pattern in `hub-main.ts` for hub text turns. No new modules, no new dependencies.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| RES-06 | Write verification for first message only -- after first successful addMessage() in a session, read back via separate readonly transaction to confirm storage is working. Skip verification for subsequent messages in same session. Re-verify after any persistence:warning event. | `verifyMessage()` method design on ConversationStore. Separate readonly transaction avoids Pitfall P1 (false confidence from same-transaction read-back). Session-scoped flag (`verified`) tracks verification state. Re-verify on persistence:warning resets the flag. |
| RES-07 | Error escalation in auto-save -- after all retries exhausted, emit persistence:error (not just persistence:warning). Include error type, conversationId, recoverable flag. | Enhanced `saveWithRetry()` emits `persistence:error` with `{ type: 'write-failed', recoverable: false, conversationId }` after final retry failure. The `persistence:error` event type already exists in AppEventMap (Phase 14, RES-20). Hub text turn save paths need the same escalation. |
| RES-08 | Partial response preservation -- on mid-stream SSE failure, save partial assistant text with "[response interrupted]" suffix rather than discarding. Clear pendingAssistantText after save. | Modified `error` case in `gateway:chunk` handler. Instead of `pendingAssistantText = ''`, save the accumulated text with suffix. Uses existing `saveWithRetry()` flow. Hub-side `handleHubChunk` error case needs same treatment. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native IndexedDB API | Browser built-in | Write verification via separate readonly transaction | Already used throughout persistence layer. Zero bundle cost. |
| Existing auto-save.ts | Project module | Fire-and-forget save with retry logic | Proven pattern with 12 passing tests. Enhanced, not replaced. |
| Existing AppEventMap | Project types | persistence:error event type already defined | Phase 14 delivered the exact event shape needed for error escalation. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| fake-indexeddb | ^6.2.5 (already installed) | IDB test simulation for verification tests | All new write verification tests. |
| Vitest | Already installed | Unit test framework | Testing new auto-save behaviors. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Separate readonly verify tx | Same-transaction read-back after write | Same-tx read-back gives false confidence under relaxed durability (Pitfall P1). Separate tx confirms data survives transaction boundary. |
| Session-scoped verify flag | Verify every write | Per-write verification adds ~2ms latency per message with diminishing returns. First-write verification confirms storage works; subsequent writes use the proven retry path. |
| "[response interrupted]" suffix | Timestamp-based marker | Suffix is human-readable in chat transcript. Timestamp marker would need parsing/formatting elsewhere. |

**Installation:**
```bash
# No new packages needed. All APIs are browser built-ins.
# Existing devDependencies cover all test requirements.
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  persistence/
    auto-save.ts             # MODIFIED: verify first write, error escalation, partial save
    conversation-store.ts    # MODIFIED: add verifyMessage(), getMessage()
    types.ts                 # MODIFIED: add verifyMessage(), getMessage() to interface
    db.ts                    # UNCHANGED
    integrity-checker.ts     # UNCHANGED
    storage-health.ts        # UNCHANGED
    boot-restore.ts          # UNCHANGED
  types.ts                   # UNCHANGED (persistence:error already has write-failed/verify-failed)
  glasses-main.ts            # UNCHANGED (persistence:warning listener already exists)
  hub-main.ts                # MODIFIED: add error escalation to hub save paths + partial save
```

### Pattern 1: Verification via Separate Read-Only Transaction
**What:** After `addMessage()` resolves, open a new readonly transaction and read the message back by ID. If the read returns the record, storage is confirmed working. If not, storage is suspect.
**When to use:** First message in a session only. Re-verify after persistence:warning resets the flag.
**Why separate transaction:** Under relaxed durability (Chrome 121+, Firefox, Safari), data within the same transaction is in-memory. A separate transaction proves the data survived the transaction boundary and is at least in the OS buffer. This is NOT a disk durability guarantee (nothing short of `{ durability: 'strict' }` provides that), but it catches the failure class where `addMessage` resolved but IDB is actually non-functional (broken database, evicted store, corrupted state).
**Example:**
```typescript
// Added to ConversationStore interface and implementation
function verifyMessage(messageId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const tx = db.transaction('messages', 'readonly');
    const req = tx.objectStore('messages').get(messageId);
    req.onsuccess = () => resolve(req.result !== undefined);
    req.onerror = () => resolve(false);
    // Never reject -- verification failure is not an exception,
    // it's a data point for the caller
  });
}
```

### Pattern 2: Error Escalation from Warning to Error
**What:** When `saveWithRetry()` exhausts all retries, emit `persistence:error` with `{ type: 'write-failed', recoverable: false }` instead of just `persistence:warning`.
**When to use:** After the 4th failed attempt (attempt 0 + 3 retries = 4 total tries).
**Why escalate:** `persistence:warning` is a soft signal that the glasses-main.ts warning handler shows once and then silences (via `warningShown` guard). `persistence:error` is the Phase 14 event type that Phase 18 (Error UX) will subscribe to for user-visible error display. Without escalation, repeated save failures are completely silent after the first warning.
**Example:**
```typescript
// Enhanced saveWithRetry in auto-save.ts
async function saveWithRetry(
  operation: () => Promise<unknown>,
  context?: { conversationId: string },
): Promise<boolean> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await operation();
      return true;
    } catch {
      if (attempt < MAX_RETRIES) {
        await new Promise((r) =>
          setTimeout(r, RETRY_DELAY_MS * (attempt + 1)),
        );
      }
    }
  }
  // Escalate: emit persistence:error after all retries exhausted
  bus.emit('persistence:error', {
    type: 'write-failed',
    recoverable: false,
    message: 'Failed to save message after retries',
    conversationId: context?.conversationId,
  });
  return false;
}
```

### Pattern 3: Partial Response Preservation on SSE Error
**What:** On `gateway:chunk` type `error`, if `pendingAssistantText` has content, save it with `"[response interrupted]"` suffix instead of discarding.
**When to use:** Whenever a mid-stream error occurs and there is accumulated assistant text.
**Why save partial:** The current behavior discards `pendingAssistantText` on error (line 154-155 in auto-save.ts). This means any partial assistant response is lost. For long responses that fail near the end, this is significant data loss. The partial response may still be useful to the user. The `"[response interrupted]"` suffix clearly marks the response as incomplete.
**Example:**
```typescript
case 'error': {
  if (pendingAssistantText) {
    // RES-08: Save partial response instead of discarding
    const convId = getConversationId();
    const text = pendingAssistantText + ' [response interrupted]';
    pendingAssistantText = '';

    saveWithRetry(
      () => store.addMessage(convId, {
        role: 'assistant',
        text,
        timestamp: Date.now(),
      }),
      { conversationId: convId },
    ).then((ok) => {
      if (ok && syncBridge) {
        syncBridge.postMessage({
          type: 'message:added',
          origin: 'glasses',
          conversationId: convId,
          role: 'assistant',
          text,
        });
      }
    });
  } else {
    pendingAssistantText = '';
  }
  if (syncBridge) {
    syncBridge.postMessage({
      type: 'streaming:end',
      origin: 'glasses',
      conversationId: getConversationId(),
    });
  }
  break;
}
```

### Anti-Patterns to Avoid

- **Per-write verification (Pitfall P1):** Do NOT verify every `addMessage()` call. Verification adds ~2ms latency and under relaxed durability, a same-transaction read-back proves nothing. Verify only the FIRST write in a session to confirm storage is functional.
- **Inline verification in addMessage() (over-coupling):** Do NOT put verification logic inside `addMessage()`. Keep `addMessage()` as a pure write. Verification is a concern of the auto-save layer, not the store layer.
- **Blocking on verification (latency):** Do NOT make the auto-save flow synchronous on verification. Verify asynchronously after the first save resolves. If verification fails, emit the error event and skip further verification -- do not block subsequent saves.
- **Silent hub save failures (Error Surface #7):** The hub's `handleHubChunk` (line 823: `.catch(() => {})`) and `handleTextSubmit` silently swallow save errors. Phase 15 MUST add error escalation to hub save paths, not just glasses auto-save.
- **Re-sending partial response via sync without marker:** If partial text is saved and synced, the hub should display it with the interruption marker visible. Do NOT strip the marker before syncing.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Write verification transaction | Custom IDB health probe that writes and reads test data | `store.verifyMessage(id)` -- read back the actual saved message | Simpler, uses real data, no test-data cleanup needed |
| Retry with escalation | Separate retry-and-escalate wrapper module | Enhanced `saveWithRetry()` with context parameter | Existing function already has the retry loop; add escalation at the end |
| Partial save trigger | Custom SSE error detector that monitors stream health | Existing `gateway:chunk` type `error` handler | The error event is already emitted by gateway client and routed through event bus |
| Error event types | New event definitions | Existing `persistence:error` with `write-failed` and `verify-failed` types | Phase 14 already added these to AppEventMap (RES-20) |

**Key insight:** Phase 15 modifies three existing code paths (auto-save retry, auto-save error handler, ConversationStore interface). No new modules are needed. The infrastructure (event types, error payloads, retry logic) is already in place from Phase 14.

## Common Pitfalls

### Pitfall 1: Verification Creates False Confidence Under Relaxed Durability
**What goes wrong:** Developer adds read-back verification after every write, believing this confirms disk persistence. Under Chrome 121+ relaxed durability, `oncomplete` fires when data reaches OS buffer, not disk. The read-back sees data in memory and "passes" verification, but on power loss or force-kill the data is gone.
**Why it happens:** `fake-indexeddb` (used in tests) has no durability concept. All tests pass regardless. The developer cannot distinguish "in memory" from "on disk" in either test or dev environments.
**How to avoid:** Frame verification as a storage-functionality check, not a durability guarantee. Verify only the FIRST message to confirm IDB is working at all (not corrupted, not evicted, not closed). Document that verification confirms "IDB accepts writes" not "data is safe on disk."
**Warning signs:** Code adds `.get()` after every `.put()`. Write latency increases 50-100% with no actual durability improvement.

### Pitfall 2: Error Escalation Breaks Existing Warning Handler
**What goes wrong:** The new `persistence:error` emission conflicts with or duplicates the existing `persistence:warning` emission. Both fire on the same failure, causing the glasses to show two error messages.
**Why it happens:** `saveWithRetry()` currently emits `persistence:warning` on failure (lines 81-83, 144-146). If we ADD `persistence:error` emission inside `saveWithRetry()` but KEEP the `persistence:warning` in the caller's `.then(!ok)` block, both fire.
**How to avoid:** Move the escalation INTO `saveWithRetry()`. When all retries exhaust: emit `persistence:error` (the strong signal). The caller's `.then(!ok)` block should still emit `persistence:warning` (backward compatible for glasses-main.ts warning listener). This is intentional dual-emit: warning for the existing soft handler, error for Phase 18's error presenter. They serve different audiences.
**Warning signs:** Two error messages appear on glasses for a single save failure. persistence:warning handler fires after persistence:error already showed a stronger message.

### Pitfall 3: Partial Save Creates Orphan if Conversation Was Deleted Mid-Stream
**What goes wrong:** User starts a voice turn, glasses begin streaming assistant response. Mid-stream, the hub deletes the conversation via session manager. The stream fails (or ends), and the partial save tries to write to a now-deleted conversation. The message becomes an orphan because `addMessage()` writes to the messages store even if the conversation doesn't exist (it updates `updatedAt` only if conversation exists -- line 199-205 in conversation-store.ts).
**Why it happens:** `addMessage()` does a `get` on the conversation and updates `updatedAt` if found, but the message `put()` is unconditional. The message is always written regardless of whether the conversation exists.
**How to avoid:** This is actually safe in the current architecture. The orphan will be detected by the integrity checker on next boot and cleaned up after the grace period (Phase 14, RES-05). No special handling needed in Phase 15. Document this as a known benign race.
**Warning signs:** None required -- existing integrity checker handles this.

### Pitfall 4: Hub Text Turn Partial Save Syncs Incomplete Text to Glasses
**What goes wrong:** Hub sends a text turn, assistant streams partial response, SSE fails mid-stream. Hub saves partial text with "[response interrupted]" and syncs it to glasses. Glasses display shows the interrupted message. Then the user retries from glasses, and a new full response comes in. The conversation now has both the partial and the full response.
**Why it happens:** The partial response is saved as a normal message. The retry creates a new, independent response. Both are valid messages in IDB.
**How to avoid:** This is acceptable behavior. The "[response interrupted]" suffix clearly marks the partial response. The user can see both the interrupted and complete versions. Attempting to "replace" the partial message would require message-level updates and deduplication logic that is out of scope and over-engineered for this use case.
**Warning signs:** None -- this is expected behavior, not a bug.

### Pitfall 5: Verification Failure Should Not Block Subsequent Saves
**What goes wrong:** First-write verification fails (storage issue). Developer emits `persistence:error` and then refuses to save subsequent messages, thinking "storage is broken."
**Why it happens:** Overreaction to verification failure. Verification failure means "we couldn't read back one record in a separate transaction." It does NOT mean all future writes will fail.
**How to avoid:** On verification failure: emit `persistence:error` with `{ type: 'verify-failed', recoverable: false }`, set `verified = false` to prevent re-verification, but continue saving subsequent messages normally. Let the retry logic in `saveWithRetry()` handle any actual write failures independently.
**Warning signs:** Messages stop being saved after a single verification failure. User loses entire conversation because one verify check failed.

## Code Examples

### verifyMessage() on ConversationStore
```typescript
// Source: project pattern (conversation-store.ts factory)
// Added to ConversationStore interface and createConversationStore factory

// In persistence/types.ts -- add to ConversationStore interface:
verifyMessage(messageId: string): Promise<boolean>;
getMessage(messageId: string): Promise<MessageRecord | undefined>;

// In persistence/conversation-store.ts -- add to factory return:
function verifyMessage(messageId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const tx = db.transaction('messages', 'readonly');
    const req = tx.objectStore('messages').get(messageId);
    req.onsuccess = () => resolve(req.result !== undefined);
    req.onerror = () => resolve(false);
    // Never reject -- verification returns false on any error
  });
}

function getMessage(messageId: string): Promise<MessageRecord | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('messages', 'readonly');
    const req = tx.objectStore('messages').get(messageId);
    req.onsuccess = () => resolve(req.result ?? undefined);
    req.onerror = () => reject(req.error);
  });
}
```

### Enhanced Auto-Save with All Three RES Requirements
```typescript
// Source: existing auto-save.ts pattern + Phase 15 enhancements
// Key changes: (1) verify after first save, (2) escalate on retry exhaustion,
// (3) save partial on error

export function createAutoSave(opts: AutoSaveOptions): AutoSave {
  const { bus, store, getConversationId, onConversationNamed, syncBridge } = opts;
  const unsubs: Array<() => void> = [];

  let pendingAssistantText = '';
  let hasUserMessage = false;
  let storageVerified = false;  // RES-06: track verification state

  async function saveWithRetry(
    operation: () => Promise<unknown>,
    context?: { conversationId: string },
  ): Promise<boolean> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await operation();
        return true;
      } catch {
        if (attempt < MAX_RETRIES) {
          await new Promise((r) =>
            setTimeout(r, RETRY_DELAY_MS * (attempt + 1)),
          );
        }
      }
    }
    // RES-07: Escalate to persistence:error after all retries exhausted
    bus.emit('persistence:error', {
      type: 'write-failed',
      recoverable: false,
      message: 'Failed to save message after retries',
      conversationId: context?.conversationId,
    });
    return false;
  }

  // RES-06: Verify first write via separate readonly transaction
  async function verifyFirstWrite(messageId: string): Promise<void> {
    if (storageVerified) return;

    const exists = await store.verifyMessage(messageId);
    if (exists) {
      storageVerified = true;
    } else {
      bus.emit('persistence:error', {
        type: 'verify-failed',
        recoverable: false,
        message: 'Storage verification failed -- first message not readable',
        conversationId: getConversationId(),
      });
      // Do NOT set storageVerified -- allow re-verification on next session
    }
  }

  unsubs.push(
    bus.on('gateway:chunk', (chunk) => {
      switch (chunk.type) {
        case 'transcript': {
          const convId = getConversationId();
          const text = chunk.text!;
          const isFirst = !hasUserMessage;
          hasUserMessage = true;

          saveWithRetry(
            () => store.addMessage(convId, {
              role: 'user', text, timestamp: Date.now(),
            }),
            { conversationId: convId },
          ).then((ok) => {
            if (ok) {
              // RES-06: Verify first write
              if (isFirst) {
                // addMessage returns messageId -- need to capture it
                // (see implementation note below)
              }
              if (syncBridge) {
                syncBridge.postMessage({
                  type: 'message:added', origin: 'glasses',
                  conversationId: convId, role: 'user', text,
                });
              }
            }
            if (!ok) {
              bus.emit('persistence:warning', {
                message: 'Messages may not be saved',
              });
            }
          });
          // ... auto-naming unchanged
          break;
        }

        case 'error': {
          // RES-08: Save partial response instead of discarding
          if (pendingAssistantText) {
            const convId = getConversationId();
            const text = pendingAssistantText + ' [response interrupted]';
            pendingAssistantText = '';

            saveWithRetry(
              () => store.addMessage(convId, {
                role: 'assistant', text, timestamp: Date.now(),
              }),
              { conversationId: convId },
            ).then((ok) => {
              if (ok && syncBridge) {
                syncBridge.postMessage({
                  type: 'message:added', origin: 'glasses',
                  conversationId: convId, role: 'assistant', text,
                });
              }
            });
          } else {
            pendingAssistantText = '';
          }
          if (syncBridge) {
            syncBridge.postMessage({
              type: 'streaming:end', origin: 'glasses',
              conversationId: getConversationId(),
            });
          }
          break;
        }
        // ... other cases unchanged
      }
    }),
  );

  // RES-06: Re-verify after persistence:warning
  unsubs.push(
    bus.on('persistence:warning', () => {
      storageVerified = false;
    }),
  );

  // ... destroy unchanged
}
```

### Hub Error Escalation for Text Turns
```typescript
// Source: existing hub-main.ts handleHubChunk + handleTextSubmit patterns
// Phase 15 must add error escalation to these hub-side save paths

// In handleHubChunk, response_end case (currently line 823: .catch(() => {})):
hubConversationStore.addMessage(convId, {
  role: 'assistant', text, timestamp: Date.now(),
}).then(() => {
  // ... sync bridge posting (unchanged)
}).catch(() => {
  // RES-07: Escalate hub save failure (was silent .catch)
  console.error('[hub] Failed to save assistant response');
  showToast('Message may not be saved');
});

// In handleHubChunk, error case (currently discards pendingHubAssistantText):
case 'error': {
  hideStreamingIndicator();
  streamingMsgEl = null;
  if (sendBtn) sendBtn.disabled = false;

  // RES-08: Save partial hub response instead of discarding
  if (pendingHubAssistantText && hubConversationStore && sessionManager) {
    const convId = sessionManager.getActiveSessionId();
    const text = pendingHubAssistantText + ' [response interrupted]';
    pendingHubAssistantText = '';
    if (convId) {
      hubConversationStore.addMessage(convId, {
        role: 'assistant', text, timestamp: Date.now(),
      }).catch(() => {
        console.error('[hub] Failed to save partial response');
      });
    }
  } else {
    pendingHubAssistantText = '';
  }

  showToast(chunk.error ?? 'Gateway error');
  // ... sync bridge streaming:end (unchanged)
  break;
}
```

### Implementation Note: Capturing Message ID from addMessage()
```typescript
// addMessage() already returns Promise<string> (the message ID)
// The current auto-save code ignores this return value because saveWithRetry
// wraps the operation. To capture the ID for verification:

// Option A: Capture via closure variable (simple, matches existing pattern)
let lastSavedId = '';
saveWithRetry(
  async () => {
    lastSavedId = await store.addMessage(convId, { role: 'user', text, timestamp: Date.now() });
  },
  { conversationId: convId },
).then((ok) => {
  if (ok && isFirst && lastSavedId) {
    verifyFirstWrite(lastSavedId);
  }
  // ... rest unchanged
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Verify every write with read-back | Verify first write only, then trust retry logic | Chrome 121+ relaxed durability (Jan 2024) | Per-write verification is pointless under relaxed durability. First-write verification confirms storage is functional. |
| Silent error swallowing on save failure | Escalate to typed error event after retry exhaustion | Phase 14 added persistence:error event type | Downstream Error UX phase can subscribe to structured error events. |
| Discard partial responses on SSE failure | Save partial with "[response interrupted]" marker | Best practice for chat apps | Preserves user context; partial responses may contain useful information. |

**Deprecated/outdated:**
- `persistence:warning` as sole error signal: Still emitted for backward compatibility, but `persistence:error` is the primary signal for Phase 18 Error UX.
- Silent `.catch(() => {})` on hub save paths: Must be replaced with explicit error handling (toast + console.error at minimum).

## Open Questions

1. **Should `verifyMessage()` use `{ durability: 'strict' }` for its read transaction?**
   - What we know: Read transactions don't have a durability option (it's a write-transaction concept). The readonly transaction reads from whatever state IDB has -- if the prior write was relaxed-durability, the verify may see in-memory data.
   - What's unclear: Whether a separate readonly transaction opened AFTER the write transaction completes sees data that has "committed" to the OS buffer (likely yes, based on IDB spec -- oncomplete means "operations successfully recorded").
   - Recommendation: Use standard readonly transaction. The purpose of verification is to confirm IDB is functional (accepts and returns data), not to guarantee disk durability. Document this limitation.

2. **Should hub text turns use the full `saveWithRetry()` pattern?**
   - What we know: Hub currently does direct `hubConversationStore.addMessage()` without retries (lines 804, 864 in hub-main.ts). The glasses auto-save uses `saveWithRetry()` with 3 retries.
   - What's unclear: Whether the hub needs retry logic. The hub has a more interactive UX (toasts, banners) and can show errors immediately.
   - Recommendation: Do NOT add retry logic to hub saves in Phase 15. Instead, add error escalation (toast + console) on `.catch()`. Hub retry logic could be a Phase 18 (Error UX) deliverable with a proper "Retry" action button. Keep Phase 15 scope narrow.

3. **Should the `"[response interrupted]"` text be i18n-friendly?**
   - What we know: The entire app is English-only (per Out of Scope: "Multi-language UI -- EvenHub is early-access, English-first audience").
   - What's unclear: N/A -- this is out of scope.
   - Recommendation: Hardcode English string. Simple, matches existing patterns (e.g., "New conversation", "Messages may not be saved").

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/persistence/auto-save.ts` (177 lines) -- complete read, all save paths mapped
- Codebase analysis: `src/persistence/conversation-store.ts` (303 lines) -- addMessage() flow, return type (Promise<string>)
- Codebase analysis: `src/persistence/types.ts` (53 lines) -- ConversationStore interface, MessageRecord type
- Codebase analysis: `src/types.ts` (135 lines) -- AppEventMap with persistence:error already defined (Phase 14)
- Codebase analysis: `src/hub-main.ts` (1062 lines) -- handleHubChunk, handleTextSubmit, silent .catch paths
- Codebase analysis: `src/glasses-main.ts` (380 lines) -- persistence:warning listener, auto-save wiring
- Codebase analysis: `src/api/gateway-client.ts` (401 lines) -- streamSSEResponse, handleTurnError, error chunk emission
- Codebase analysis: `src/__tests__/auto-save.test.ts` (371 lines) -- existing test patterns, mock store patterns
- Phase 14 Research: `.planning/phases/14-data-integrity-foundation/14-RESEARCH.md` -- persistence:error event design, Pitfall P1
- Phase 14 Verification: `.planning/phases/14-data-integrity-foundation/14-VERIFICATION.md` -- confirmed persistence:error exists
- v1.3 PITFALLS.md: Pitfall 1 (write verification false confidence), Pitfall 7 (mid-stream retry)
- v1.3 ARCHITECTURE.md: AutoSave resilience enhancement design, ConversationStore extensions

### Secondary (MEDIUM confidence)
- MDN: IndexedDB transaction durability -- relaxed vs strict behavior
- Chrome 121 release notes: default durability changed to relaxed (Jan 2024)

### Tertiary (LOW confidence)
- None. All findings verified against codebase source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, all modifications to existing well-understood modules
- Architecture: HIGH -- three targeted code modifications (auto-save.ts, conversation-store.ts, hub-main.ts) following existing patterns exactly
- Pitfalls: HIGH -- Pitfall P1 (false confidence) is well-documented in v1.3 research; all other pitfalls identified from codebase analysis

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (stable APIs, modifications to existing code only)
