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

