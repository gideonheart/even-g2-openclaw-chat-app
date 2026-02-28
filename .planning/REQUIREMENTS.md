# Requirements: Even G2 OpenClaw Chat App

**Defined:** 2026-02-28
**Core Value:** Users can have natural voice conversations with an AI assistant through their Even G2 glasses, seeing streaming responses as compact bubble chat on the glasses display.

## v1.2 Requirements

Requirements for v1.2 Conversation Intelligence & Hub Interaction. Each maps to roadmap phases.

### Persistence

- [x] **PERS-01**: Conversations persist in IndexedDB across page reloads and app restarts
- [x] **PERS-02**: Messages auto-save as they arrive (user transcripts and assistant responses)
- [x] **PERS-03**: Active conversation loads automatically on app boot with previous context
- [x] **PERS-04**: Conversation metadata auto-generated (name from first message, timestamps)

### Sessions

- [x] **SESS-01**: User can create new sessions
- [x] **SESS-02**: User can rename sessions
- [x] **SESS-03**: User can delete sessions (cascade-deletes associated conversations)
- [x] **SESS-04**: User can switch between sessions (active session receives new voice turns)

### Command Menu

- [x] **MENU-01**: Double-tap opens command menu overlay on glasses display
- [x] **MENU-02**: Scroll up/down navigates menu items
- [x] **MENU-03**: Tap executes selected command (/new, /reset, /switch, /rename, /delete)
- [x] **MENU-04**: Destructive actions show confirmation before executing
- [x] **MENU-05**: Menu auto-closes after 5 seconds of inactivity

### Cross-Context Sync

- [x] **SYNC-01**: Event bus bridge enables real-time hub-glasses communication
- [x] **SYNC-02**: Fallback mechanism if BroadcastChannel is unavailable in WebView

### Hub Interaction

- [x] **HUB-01**: Hub displays live glasses conversation in real-time
- [x] **HUB-02**: Hub shows streaming indicator while assistant is responding
- [x] **HUB-03**: User can type messages from hub into active conversation
- [x] **HUB-04**: Hub text messages appear on glasses display with responses streaming to both
- [ ] **HUB-05**: User can browse past conversations grouped by session in hub
- [ ] **HUB-06**: User can view full conversation transcript in hub
- [ ] **HUB-07**: User can delete individual conversations from hub
- [ ] **HUB-08**: User can search across all conversation history with results showing matched snippets

## Future Requirements

Deferred to future release. Tracked but not in current roadmap.

### Server Sync

- **SYNC-03**: Conversations sync with OpenClaw gateway session history
- **SYNC-04**: Gateway exposes conversation retrieval API endpoint

### Export

- **EXPORT-01**: User can export conversation transcripts
- **EXPORT-02**: User can share conversation links

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Cloud sync / backup | Gateway-side concern, not frontend. Privacy: conversation data stays local. |
| Fuzzy / semantic search | FlexSearch/Lunr add 4.5-18KB to bundle for marginal benefit. Substring match sufficient. |
| Voice commands for menu | Requires always-on STT, too complex for v1.2. Keep menu gesture-based. |
| Multi-conversation view | 576x288 glasses display can barely show one conversation. No clear use case. |
| Conversation export/share | Privacy concern. Should be a gateway feature with proper access controls. |
| Offline message queueing | Real-time voice loop is core value. Contradicts real-time design. |
| Markdown/code rendering | Glasses display renders plain text only. Would create UX inconsistency. |
| Conversation threading/branching | Significant data model complexity. Not standard chat UX expectation. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PERS-01 | Phase 13 (verify) | Complete |
| PERS-02 | Phase 13 (verify) | Complete |
| PERS-03 | Phase 13 (verify) | Complete |
| PERS-04 | Phase 13 (verify + fix) | Complete |
| SESS-01 | Phase 10 | Complete |
| SESS-02 | Phase 10 | Complete |
| SESS-03 | Phase 10 | Complete |
| SESS-04 | Phase 10 | Complete |
| MENU-01 | Phase 11 | Complete |
| MENU-02 | Phase 11 | Complete |
| MENU-03 | Phase 11 | Complete |
| MENU-04 | Phase 11 | Complete |
| MENU-05 | Phase 11 | Complete |
| SYNC-01 | Phase 10 | Complete |
| SYNC-02 | Phase 10 | Complete |
| HUB-01 | Phase 12 | Complete |
| HUB-02 | Phase 12 | Complete |
| HUB-03 | Phase 12 | Complete |
| HUB-04 | Phase 12 | Complete |
| HUB-05 | Phase 12 | Pending |
| HUB-06 | Phase 12 | Pending |
| HUB-07 | Phase 12 | Pending |
| HUB-08 | Phase 12 | Pending |

**Coverage:**
- v1.2 requirements: 23 total
- Mapped to phases: 23
- Unmapped: 0

---
*Requirements defined: 2026-02-28*
*Last updated: 2026-02-28 after gap closure phase creation*
