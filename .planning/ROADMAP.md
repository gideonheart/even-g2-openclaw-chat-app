# Roadmap: Even G2 OpenClaw Chat App

## Milestones

- ✅ **v1.0 MVP** — Phases 1-5 (shipped 2026-02-28)
- ✅ **v1.1 Integration** — Phases 6-8 (shipped 2026-02-28)
- 🚧 **v1.2 Conversation Intelligence & Hub Interaction** — Phases 9-13 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-5) — SHIPPED 2026-02-28</summary>

- [x] Phase 1: Foundation & Settings (2/2 plans) — completed 2026-02-28
- [x] Phase 2: Even Bridge & Input Pipeline (3/3 plans) — completed 2026-02-28
- [x] Phase 3: Glasses Display & Streaming (3/3 plans) — completed 2026-02-28
- [x] Phase 4: Gateway API Client (1/1 plan) — completed 2026-02-28
- [x] Phase 5: Companion Hub UI (3/3 plans) — completed 2026-02-28

</details>

<details>
<summary>✅ v1.1 Integration (Phases 6-8) — SHIPPED 2026-02-28</summary>

- [x] Phase 6: Runtime Wiring (2/2 plans) — completed 2026-02-28
- [x] Phase 7: Error Handling & Lifecycle (2/2 plans) — completed 2026-02-28
- [x] Phase 8: EvenHub Submission (1/1 plan) — completed 2026-02-28

</details>

### 🚧 v1.2 Conversation Intelligence & Hub Interaction (In Progress)

**Milestone Goal:** Make conversations persistent, browsable, and accessible from both glasses and hub -- with dynamic sessions, a glasses command menu, and real-time two-way sync.

- [ ] **Phase 9: IndexedDB Persistence** - Conversation and message storage with auto-save and boot recovery
- [x] **Phase 10: Dynamic Sessions & Cross-Context Sync** - Session CRUD, event bus bridge, and real-time hub-glasses relay (completed 2026-02-28)
- [ ] **Phase 11: Glasses Command Menu** - Double-tap overlay with session commands, scroll navigation, and auto-close
- [ ] **Phase 12: Hub Conversation Features** - Live view, text input, history browsing, and full-text search
- [x] **Phase 13: Phase 9 Verification & Sync Wiring** - Verify persistence, fix sync message stubs, wire auto-save relay *(gap closure)* (completed 2026-02-28)

## Phase Details

### Phase 9: IndexedDB Persistence
**Goal**: Conversations survive app restarts -- messages auto-save as they arrive and the active conversation restores on boot
**Depends on**: Phase 8 (v1.1 complete app with runtime wiring)
**Requirements**: PERS-01, PERS-02, PERS-03, PERS-04
**Success Criteria** (what must be TRUE):
  1. User can close the app, reopen it, and see the same conversation they left off on
  2. User speaks a message and sees it persist immediately -- no manual save action required
  3. New conversations auto-generate a name from the first user message and show creation timestamps
  4. All existing tests continue to pass (persistence layer does not break stateless modules)
**Plans**: 2 plans

Plans:
- [ ] 09-01-PLAN.md — IndexedDB wrapper + conversation store (TDD)
- [ ] 09-02-PLAN.md — Auto-save wiring + boot restore

### Phase 10: Dynamic Sessions & Cross-Context Sync
**Goal**: Users can manage multiple conversation sessions, and actions in one context (glasses or hub) are visible in the other in real time
**Depends on**: Phase 9
**Requirements**: SESS-01, SESS-02, SESS-03, SESS-04, SYNC-01, SYNC-02
**Success Criteria** (what must be TRUE):
  1. User can create a new session and immediately start a fresh conversation in it
  2. User can rename a session and see the updated name reflected everywhere
  3. User can delete a session and all its conversations are removed (no orphaned data)
  4. User can switch between sessions and the active session receives new voice turns
  5. An action performed on glasses (e.g., new message) appears in the hub within one second, and vice versa
**Plans**: 3 plans

Plans:
- [ ] 10-01-PLAN.md — Session store + sync bridge (TDD)
- [ ] 10-02-PLAN.md — Glasses session switching + sync wiring
- [ ] 10-03-PLAN.md — Hub dynamic sessions + sync relay

### Phase 11: Glasses Command Menu
**Goal**: Users can access session management commands directly from the glasses via a double-tap overlay menu
**Depends on**: Phase 10
**Requirements**: MENU-01, MENU-02, MENU-03, MENU-04, MENU-05
**Success Criteria** (what must be TRUE):
  1. User double-taps and sees a command menu overlay on the glasses display with available commands
  2. User scrolls up/down to highlight different menu items and taps to execute the selected command
  3. Destructive commands (delete, reset) show a confirmation step before executing
  4. Menu disappears automatically after 5 seconds of no interaction
  5. After executing a menu command, the glasses display returns to the conversation view with the correct state
**Plans**: 2 plans

Plans:
- [ ] 11-01-PLAN.md — Pure command menu state module + FSM MENU_SELECT extension (TDD)
- [ ] 11-02-PLAN.md — Menu controller, renderer overlay, gesture dispatch, and boot wiring

### Phase 12: Hub Conversation Features
**Goal**: The companion hub becomes a full conversation interface -- users can watch live conversations, type messages, browse history, and search across all past conversations
**Depends on**: Phase 10 (sync layer); Phase 11 not required
**Requirements**: HUB-01, HUB-02, HUB-03, HUB-04, HUB-05, HUB-06, HUB-07, HUB-08
**Success Criteria** (what must be TRUE):
  1. User opens the hub and sees the active glasses conversation updating in real time, with a streaming indicator while the assistant responds
  2. User types a message in the hub and it appears on the glasses display, with the assistant response streaming to both hub and glasses
  3. User can browse past conversations in the hub, grouped by session, and open any conversation to read the full transcript
  4. User can delete individual conversations from the hub history view
  5. User can search across all conversations and see matching snippets with the search term highlighted
**Plans**: TBD

Plans:
- [ ] 12-01: TBD
- [ ] 12-02: TBD
- [ ] 12-03: TBD

### Phase 13: Phase 9 Verification & Sync Wiring
**Goal**: Close Phase 9 verification gap and wire the sync message types that are currently dead code, enabling Phase 12's real-time hub features
**Depends on**: Phase 10 (sync bridge infrastructure)
**Requirements**: PERS-01, PERS-02, PERS-03, PERS-04 (verify), SYNC-01 (complete wiring)
**Gap Closure**: Closes gaps from v1.2 milestone audit
**Success Criteria** (what must be TRUE):
  1. Phase 9 VERIFICATION.md exists and confirms PERS-01–04 pass
  2. `onConversationNamed` callback in glasses-main.ts posts `conversation:named` SyncMessage (not a no-op stub)
  3. Auto-save handler posts `message:added` SyncMessage to syncBridge after persisting
  4. Both sync message types are no longer dead code — they are posted by glasses context and can be consumed by hub
**Plans**: 1 plan

Plans:
- [ ] 13-01-PLAN.md — Phase 9 verification + sync message wiring (conversation:named, message:added)

## Progress

**Execution Order:**
Phases execute: 9 → 10 → **13** → 11 → 12 (Phase 13 must complete before Phase 12)

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation & Settings | v1.0 | 2/2 | Complete | 2026-02-28 |
| 2. Even Bridge & Input Pipeline | v1.0 | 3/3 | Complete | 2026-02-28 |
| 3. Glasses Display & Streaming | v1.0 | 3/3 | Complete | 2026-02-28 |
| 4. Gateway API Client | v1.0 | 1/1 | Complete | 2026-02-28 |
| 5. Companion Hub UI | v1.0 | 3/3 | Complete | 2026-02-28 |
| 6. Runtime Wiring | v1.1 | 2/2 | Complete | 2026-02-28 |
| 7. Error Handling & Lifecycle | v1.1 | 2/2 | Complete | 2026-02-28 |
| 8. EvenHub Submission | v1.1 | 1/1 | Complete | 2026-02-28 |
| 9. IndexedDB Persistence | v1.2 | 2/2 | Unverified | - |
| 10. Dynamic Sessions & Cross-Context Sync | v1.2 | 3/3 | Complete | 2026-02-28 |
| 11. Glasses Command Menu | v1.2 | 0/? | Not started | - |
| 12. Hub Conversation Features | v1.2 | 0/? | Not started | - |
| 13. Phase 9 Verification & Sync Wiring | 1/1 | Complete    | 2026-02-28 | - |
