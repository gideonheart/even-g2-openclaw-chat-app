# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-28)

**Core value:** Users can have natural voice conversations with an AI assistant through their Even G2 glasses, seeing streaming responses as compact bubble chat on the glasses display.
**Current focus:** Phase 11 - Glasses Command Menu

## Current Position

Phase: 11 of 13 (Glasses Command Menu)
Plan: 2 of 2 in current phase
Status: Plan 11-01 complete, executing 11-02
Last activity: 2026-02-28 - Completed 11-01: CommandMenu pure state module + FSM extension

Progress: [████████████████████] 24/25 plans (v1.0-v1.1 complete, Phase 10+13 complete, Phase 11 in progress)

## Performance Metrics

**Velocity:**
- Total plans completed: 24 (Phases 1-10 + Phase 13 gap closure + Phase 11-01 complete)
- Total tests: 352 (all passing)
- Total LOC: ~7,600 TypeScript (58 files)
- Total execution time: ~4.7 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 | 2 (infra + settings) | ~30m | 15m |
| 2 | 3 (gesture FSM, bridge+audio, handler wiring) | ~13m | 4m |
| 3 | 3 (viewport+icons, renderer, controller) | ~10m | 3m |
| 4 | 1 (API client) | ~20m | 20m |
| 5 | 3 (hub UI + logs + mobile polish) | ~40m | 13m |
| 6 | 2 (module fixes + runtime wiring) | ~10m | 5m |
| 7 | 2 (error recovery + lifecycle cleanup) | ~15m | 8m |
| 8 | 1 (evenhub submission) | ~3m | 3m |
| 9 | 2 (data layer TDD + wiring) | ~10m | 5m |
| 10 | 3/3 (session store + sync bridge + glasses wiring + hub sessions) | ~16m | 5m |
| 11 | 1/2 (command menu state + FSM extension) | ~4m | 4m |
| 13 | 1/1 (Phase 9 verification + sync wiring) | ~5m | 5m |

## Accumulated Context

### Decisions

All decisions logged in PROJECT.md Key Decisions table (20 entries with outcomes).

- Cascade delete uses raw IDB transaction with cursor for atomicity (10-01)
- SyncBridge feature-detects BroadcastChannel, falls back to localStorage (10-01)
- localStorage fallback uses set+remove pattern for repeated sends (10-01)
- switchToSession uses renderer.destroy()+init() cycle to clear display (10-02)
- SyncBridge initialized before Layer 1 hardware boundary for early sync readiness (10-02)
- Session events added to AppEventMap for local bus coordination (10-02)
- SessionManager wraps SessionStore + SyncBridge in single facade for all session ops (10-03)
- Removed hardcoded SESSIONS array; sessions loaded dynamically from IndexedDB (10-03)
- activeSession default '' (set from IndexedDB on boot), initHub() now async (10-03)
- syncBridge optional in AutoSaveOptions to preserve backward compatibility (13-01)
- message:added posted only after successful save to prevent hub showing unpersisted messages (13-01)
- Hub message:added is no-op break for now; Phase 12 will build live conversation view (13-01)
- conversation:named falls through to refreshSessionList() since hub shows conversation names (13-01)
- MENU_SELECT action added to FSM; tap in menu stays in menu state, controller decides when to close (11-01)
- Destructive menu items require confirmation sub-state before execution (11-01)
- Scroll locked during confirmation to prevent accidental navigation (11-01)

### Pending Todos

None.

### Blockers/Concerns

- BroadcastChannel support in flutter_inappwebview is unverified on real hardware (SYNC-02 fallback ready)
- IndexedDB durability in Even App WKWebView (iOS) may evict data under storage pressure
- Gateway text turn API for hub text input (HUB-03/04) not confirmed with backend

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 1 | Review last commits and document what was done well, what to refactor, and edge cases before Phase 2 | 2026-02-28 | e10ca22 | [1-review-last-commits-and-document-what-wa](./quick/1-review-last-commits-and-document-what-wa/) |
| 2 | Implement 3 P1 blockers: event bus, gateway reconnect retry, main.ts decomposition | 2026-02-28 | 1ffe894 | [2-implement-3-p1-blockers-gateway-reconnec](./quick/2-implement-3-p1-blockers-gateway-reconnec/) |
| 3 | Review Phase 6 commits, identify refactoring opportunities, apply low-risk fixes | 2026-02-28 | 85e3d44 | [3-review-phase-6-commits-identify-refactor](./quick/3-review-phase-6-commits-identify-refactor/) |
| 4 | Apply 5 priority pre-close fixes: dedup key, hub cleanup, unused param, dead code, async guards | 2026-02-28 | 409eebb | [4-apply-4-priority-pre-close-fixes-dedupli](./quick/4-apply-4-priority-pre-close-fixes-dedupli/) |

## Session Continuity

Last session: 2026-02-28
Stopped at: Completed 11-01-PLAN.md (CommandMenu pure state module + FSM extension)
Resume file: None
