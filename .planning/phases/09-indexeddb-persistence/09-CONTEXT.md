# Phase 9: IndexedDB Persistence - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Conversations survive app restarts — messages auto-save as they arrive and the active conversation restores on boot. This phase delivers the IndexedDB persistence layer, auto-save behavior, conversation metadata (auto-naming, timestamps), and boot restoration. Conversation management (deletion, search, organization) belongs in later phases.

</domain>

<decisions>
## Implementation Decisions

### Save feedback
- Saving is completely invisible to the user — no spinners, toasts, or checkmarks
- Each message (user transcript or assistant response) saves immediately upon completion
- Streaming assistant responses save when the full response completes, not during streaming
- On save failure: retry silently, then show a subtle non-blocking warning ("Messages may not be saved") if retries exhaust — never interrupt the conversation

### Conversation naming
- Auto-generate name from the first ~50 characters of the user's first message, truncated at a word boundary
- Name appears immediately after the first user message is sent (don't wait for assistant response)
- Timestamps display as relative time: "2 minutes ago", "Yesterday", "Feb 15"
- Include basic inline rename — user can click/tap the conversation name to edit it

### Restore experience
- On boot, automatically restore the last active conversation — feels like the user never left
- Show a brief loading skeleton (message-shaped placeholders) while IndexedDB loads, then swap in real content
- Always scroll to the bottom of the conversation (most recent messages visible)
- First-time user / no saved data: drop straight into a fresh empty conversation, no onboarding screen

### Failure handling
- If IndexedDB is unavailable (private browsing): show a one-time banner on boot ("Storage unavailable — conversations won't be saved"), then let the user continue normally with in-memory only
- If stored data is corrupted: show a brief message ("Previous conversation couldn't be restored"), then start a fresh conversation
- No storage limits for now — keep all conversations. IndexedDB has generous limits. Cleanup is a future phase
- No "clear all" or deletion UI in this phase — that's conversation management scope

### Claude's Discretion
- IndexedDB schema design and versioning strategy
- Exact warning/banner styling and placement
- Loading skeleton design details
- Error retry count and backoff strategy
- How "last active conversation" is tracked (localStorage flag, IndexedDB metadata, etc.)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

- Conversation deletion / clear-all — future conversation management phase
- Storage limits and auto-cleanup — future phase
- Conversation search / filtering — future phase
- Scroll position restoration (exact position rather than bottom) — potential future enhancement

</deferred>

---

*Phase: 09-indexeddb-persistence*
*Context gathered: 2026-02-28*
