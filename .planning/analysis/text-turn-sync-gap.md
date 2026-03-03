# Root Cause Analysis: Text Turn Messages Not Showing on Glasses

## Bug

Text turn messages typed in the hub do not appear on the G2 glasses display. Voice turns work correctly.

## Root Cause

The Even G2 app uses a dual-boot architecture where hub and glasses run in separate WebView contexts with separate event buses. The gateway client in each context emits chunks on its local bus -- so voice turns work on glasses because the glasses gateway client handles its own voice responses.

Text input, however, is hub-only. When a user types in the hub, the hub gateway client processes the response and emits chunks on the hub bus. The hub sync bridge correctly sends `message:added`, `streaming:start`, and `streaming:end` events to the glasses context. But the glasses `syncBridge.onMessage` handler only handled session management events (`session:switched`, `session:deleted`, `session:created`, `session:renamed`). The message and streaming events were silently ignored.

## Why It Was Not Caught

1. **Voice turns work perfectly** -- the glasses gateway client handles its own voice responses, masking the text turn gap.
2. **The sync bridge was originally designed for session management**, not message relay. Text input was added later (Phase 12) and the sync bridge handlers were not updated to match.
3. **No test coverage** for sync bridge message handling -- existing tests focused on lifecycle cleanup/resume.

## Fix

Added three case handlers to the glasses `syncBridge.onMessage` switch statement in `glasses-main.ts`:

- `message:added`: Calls `renderer.addUserMessage(text)` for `role=user`, `renderer.appendStreamChunk(text)` for `role=assistant`
- `streaming:start`: Calls `renderer.startStreaming()` + `renderer.setIconState('thinking')`
- `streaming:end`: Calls `renderer.endStreaming()`

All cases guard with `msg.conversationId === activeConversationId` to prevent cross-session rendering.

**Critical design choice:** Uses direct renderer calls, NOT `bus.emit('gateway:chunk', ...)`. Emitting gateway:chunk would cause auto-save to double-save messages that the hub already saved to IndexedDB. This matches the existing pattern used for message restore (lines 308-316) and drift reconciliation (lines 373-387).

## Hub Event Sequence for Text Turns

1. `message:added` (role=user) -- immediately after user types
2. `streaming:start` -- on response_start chunk
3. `message:added` (role=assistant) -- on response_end, with full text
4. `streaming:end` -- immediately after assistant message:added

## Architectural Lesson

In dual-boot single-page apps with separate event buses, the sync bridge must handle ALL cross-context data flows -- not just session management. When a new hub-side feature produces display content (like text input), a corresponding glasses-side sync handler must be added. The sync bridge is the only channel between contexts.

## Files Changed

- `src/glasses-main.ts` -- Added message:added, streaming:start, streaming:end case handlers
- `src/__tests__/glasses-main.test.ts` -- Added 6 tests for sync bridge text turn rendering
