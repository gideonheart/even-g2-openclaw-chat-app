# Milestones

## v1.0 MVP (Shipped: 2026-02-28)

**Phases completed:** 5 phases (1-5), 12 plans, 240 tests
**Lines of code:** 5,484 TypeScript (38 files)
**Timeline:** ~4 hours (2026-02-27 → 2026-02-28)
**Git range:** `cafa23e` → `d6e14c9` (55 commits)

**Delivered:** Core libraries and companion hub for Even G2 voice-chat app — gesture FSM, bridge SDK wrapper, glasses display pipeline, gateway API client, and full companion UI with native Even design.

**Key accomplishments:**
1. TypeScript strict mode infrastructure with Vite + Vitest test framework
2. Pure-function gesture FSM with 5-state transition table covering all 4 Even G2 gestures
3. EvenBridge SDK wrapper with dev-mode mock bridge and dual-mode audio capture (PCM + MediaRecorder)
4. Glasses display pipeline: viewport windowing, icon animation, streaming renderer, and event controller
5. Gateway API client with SSE streaming via eventsource-parser, heartbeat monitoring, and auto-reconnect
6. Complete companion hub UI: home, health, logs, sessions, simulator, mobile polish with native Even design

**Deferred to next milestone:**
- Phase 6: Voice Loop Integration & Submission (PLAT-03, PLAT-04)
- Runtime wiring of all modules via main.ts entry point
- EvenHub submission packaging

**Tech debt carried forward:**
- bridge:audio-frame → audioCapture.onFrame() bus subscription missing (glasses-mode PCM)
- 4 orphaned event types in AppEventMap (display:state-change/viewport-update/hide/wake)
- All E2E user flows require Phase 6 main.ts initialization

**Archive:** `.planning/milestones/v1.0-ROADMAP.md`, `.planning/milestones/v1.0-REQUIREMENTS.md`, `.planning/milestones/v1.0-MILESTONE-AUDIT.md`

---


## v1.1 Integration (Shipped: 2026-02-28)

**Phases completed:** 3 phases (6-8), 5 plans, 10 tasks, 265 tests
**Lines of code:** 6,336 TypeScript (43 files)
**Timeline:** ~6 hours (2026-02-28)
**Git range:** `add7773` → `a649124` (56 files changed, +8506/-1812)

**Delivered:** End-to-end voice loop wiring, error recovery, graceful shutdown, and EvenHub submission package — all v1.0 library modules assembled into a working app with a 42KB .ehpk artifact.

**Key accomplishments:**
1. Wired all v1.0 modules into end-to-end voice loop: tap → record → gateway → stream → glasses display
2. Split monolithic main.ts into environment router + glasses-main.ts with Layer 0-5 boot sequence
3. Added error recovery: FSM reset on gateway failures, 30-second timeout with visible error bubbles
4. Implemented graceful shutdown with reverse-order module teardown and double-call guard
5. Packaged app for EvenHub: app.json metadata, conditional Vite build, 42KB .ehpk artifact

**v1.0 tech debt resolved:**
- ✅ bridge:audio-frame → audioCapture.onFrame() bus subscription (LOOP-05)
- ✅ 4 orphaned event types removed from AppEventMap (ERR-04)
- ✅ Runtime main.ts initialization wiring all modules (LOOP-01..03)

**Archive:** `.planning/milestones/v1.1-ROADMAP.md`, `.planning/milestones/v1.1-REQUIREMENTS.md`, `.planning/milestones/v1.1-MILESTONE-AUDIT.md`

---


## v1.2 Conversation Intelligence & Hub Interaction (Shipped: 2026-02-28)

**Phases completed:** 5 phases (9-13), 11 plans, 372 tests
**Lines of code:** ~10,300 TypeScript (60 files)
**Timeline:** 2 days (2026-02-27 → 2026-02-28)
**Git range:** `899e58e` → `5c8739c` (73 files changed, +11,067/-320)

**Delivered:** Persistent conversations, multi-session management, glasses command menu, and full hub conversation interface — making the chat app stateful with real-time two-way sync between glasses and companion hub.

**Key accomplishments:**
1. IndexedDB persistence layer with auto-save on every message and boot recovery of active conversation
2. Dynamic session management: create, rename, delete (cascade), switch — from both glasses and hub
3. Cross-context sync via BroadcastChannel + localStorage fallback for real-time hub ↔ glasses relay
4. Glasses command menu: double-tap overlay with /new, /switch, /rename, /reset, /delete and confirmation dialogs
5. Hub live conversation view with streaming indicator, text input with gateway sendTextTurn
6. Conversation history browsing with transcript viewer, delete, and full-text search with highlighted snippets

**v1.1 tech debt resolved:**
- ✅ Phase 9 formally verified (PERS-01–04) via Phase 13 gap closure
- ✅ conversation:named and message:added SyncMessages wired (no longer dead code)
- ✅ onConversationNamed callback posts sync message instead of no-op stub

**Archive:** `.planning/milestones/v1.2-ROADMAP.md`, `.planning/milestones/v1.2-REQUIREMENTS.md`, `.planning/milestones/v1.2-MILESTONE-AUDIT.md`

---


## v1.3 Resilience & Error UX (Shipped: 2026-03-01)

**Phases completed:** 8 phases (14-19 incl. 16.5, 18.5), 18 plans, 498 tests
**Lines of code:** 14,436 TypeScript (78 files)
**Timeline:** ~8 hours (2026-02-28 → 2026-03-01)
**Git range:** `ab710e8` → `6f5d890` (91 files changed, +16,129/-76)

**Delivered:** Comprehensive resilience layer and error UX — boot-time integrity checking, write verification with partial response preservation, sync heartbeat with drift reconciliation, FSM watchdog, gateway error classification, and user-facing error presenters on both glasses and hub.

**Key accomplishments:**
1. Boot-time integrity checking (orphan detection, sentinel verification, dangling pointer fix) and storage health monitoring with persistent storage request
2. Write verification on first save, auto-save error escalation to persistence:error after retries, partial response preservation with "[response interrupted]" suffix
3. Sync hardening with SyncMonitor (seq numbering, 10s heartbeat, 30s liveness) and DriftReconciler (2-consecutive-mismatch rule, IDB-as-truth reconciliation)
4. Integration hardening: reopenDB propagates fresh IDB handle to all 5 modules in both contexts, eviction subscribers wired, cleanup teardown ordered
5. FSM 45-second watchdog timer with auto-reset and gateway error classification (connection vs mid-stream, no auto-retry of mid-stream failures)
6. Error UX: glasses 3-tier auto-clear error presenter, hub toast/banner error presenter, 5 health status dots (Gateway, STT, Session, Storage, Sync)
7. Reusable failure injection test helpers and 14 integration tests for IDB integrity flows, sync resilience, and error escalation

**Known tech debt:**
- Hub `quota-exceeded` persistence:error type defined/mapped but never emitted at runtime (low)
- Hub `fsm:watchdog-reset` subscription unreachable (glasses-only event, no bridge relay) (low)
- Hub boot-time eviction persistence:error fires before hubErrorPresenter registration (low)
- Seq gap detection is heartbeat-only — non-heartbeat messages bypass gap tracking (low)

**Archive:** `.planning/milestones/v1.3-ROADMAP.md`, `.planning/milestones/v1.3-MILESTONE-AUDIT.md`

---

