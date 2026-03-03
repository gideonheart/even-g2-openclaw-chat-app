# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-01)

**Core value:** Users can have natural voice conversations with an AI assistant through their Even G2 glasses, seeing streaming responses as compact bubble chat on the glasses display.
**Current focus:** v1.4 Voice Loop Polish -- Decoupled Input + Voice Queue

## Current Position

Phase: 01-v1-4-voice-loop-polish-decoupled-input-voice-queue
Current Plan: 3 of 3
Status: Complete
Last activity: 2026-03-03 - Completed quick task 30: Fix hub text turn messages not showing on glasses display

## Performance Metrics

**Velocity:**
- Total plans completed: 49 (Phases 1-19 incl. 16.5, 18.5 + Phase 13 gap closure + Phase 01 plans 01-03)
- Total tests: 619 (all passing)
- Total LOC: ~14,400 TypeScript (78 files)
- Total execution time: ~13.2 hours across 4 milestones

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
| 11 | 2/2 (command menu state + FSM extension, controller + boot wiring) | ~8m | 4m |
| 12 | 3/3 (live conversation view + hub text input + history/search) | ~15m | 5m |
| 13 | 1/1 (Phase 9 verification + sync wiring) | ~5m | 5m |
| 14 | 5/5 (event types + onclose + sentinel filtering + integrity checker TDD + storage health + boot wiring + reopenDB wiring + orphan grace period) | ~17m | 3.4m |
| 15 | 2/2 (write verification + error escalation + partial save + hub error escalation + partial response preservation) | ~19m | 9.5m |
| 16 | 2/2 (sync monitor + drift reconciler + countMessages TDD + boot wiring) | ~8m | 4m |
| 16.5 | 2/2 (glasses + hub integration hardening: reopenDB propagation + eviction + health + cleanup) | ~12m | 6m |
| 17 | 2/2 (FSM watchdog timer + gateway error classification) | ~5m | 2.5m |
| 18 | 2/2 (glasses error presenter + hub error presenter + health indicator) | ~15m | 7.5m |
| 18.5 | 1/1 (hub integration wiring: error bus, IDB module recreation, storage health) | ~5m | 5m |
| 19 | 2/2 (failure injection helpers + IDB integrity flow + sync resilience + error escalation integration tests) | ~8m | 4m |
| Phase 01 P01 | 3min | 2 tasks | 2 files |
| Phase 01 P02 | 6min | 2 tasks | 2 files |
| Phase 01 P03 | 4min | 2 tasks | 4 files |

## Accumulated Context

### Decisions

All decisions logged in PROJECT.md Key Decisions table (37 entries with outcomes).
- [Phase quick-17]: Null origin CORS branch before strict mode; allowNullOrigin defaults false; reflect literal 'null' per RFC 6454
- [Phase quick-19]: response_end resets FSM to idle via handleInput('reset'); transcript chunk emitted before response_start for user bubble display
- [Phase 01-01]: State-aware reset guard checks state === 'sent' || state === 'thinking' before reset; recording/idle/menu immune to response_end/error
- [Phase 01-01]: State-aware reset guard: only reset FSM on response_end/error when state is sent or thinking; recording/idle/menu are immune
- [Phase 01-02]: Synchronous busy-flag queue (not Promise-based) because gateway signals completion via synchronous chunk events
- [Phase 01-02]: Drop-oldest overflow strategy when queue exceeds MAX_QUEUE (5); queue drains on both response_end and error
- [Phase 01-03]: Kept unreachable thinking state with NOTE comment rather than removing (cascading type impact); documented queue/FSM independence
- [Phase quick-23]: menu:close bus listener with state === 'menu' guard resets FSM to idle; uses handleInput('reset') not direct mutation
- [Phase quick-24]: session:switched bus listener with state !== 'idle' guard resets FSM to idle; covers glasses /switch and hub sync origins
- [Phase quick-25]: Conditional autoScroll reset in endStreaming: only reset when scrollOffset===0 (user at bottom); preserves manual scroll position across turn boundaries
- [Phase quick-26]: Readonly<ViewportState> return type on getViewportState() prevents test mutation of internal state; additive test assertions kept alongside existing mock-call assertions
- [Phase quick-27]: Comments-only: documented guard asymmetry (menu:close narrow vs session:switched broad) and watchdog timer clearance chain in gesture-handler.ts
- [Phase quick-28]: Empty-audio guard: WAV header-only blobs (<=44 bytes) dropped before gateway send; MIN_AUDIO_BYTES=1600 threshold for short-audio warning
- [Phase quick-29]: Shared handleTurnError extracted from duplicated catch blocks; parseSSELines/SSEEvent/connectGlasses/disconnectGlasses dead code removed
- [Phase quick-30]: Direct renderer calls (not bus.emit) for sync bridge text turn display to avoid auto-save double-write of hub-saved messages

### Roadmap Evolution

- Phase 1 added: v1.4 Voice Loop Polish — Decoupled Input + Voice Queue

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
| 5 | Synthesize 3 v1.3 research streams into 22 requirements and 6 ROADMAP phases (14-19) | 2026-02-28 | 959b128 | [5-synthesize-research-streams-into-hardeni](./quick/5-synthesize-research-streams-into-hardeni/) |
| 7 | Review Phase 16 commits for strengths, weaknesses, edge cases, required fixes | 2026-02-28 | 5d6a09b | [7-review-phase-16-commits-for-strengths-we](./quick/7-review-phase-16-commits-for-strengths-we/) |
| 8 | Implement 3 pre-audit fixes: heartbeat try/catch, .catch() on handleHeartbeat, send() removal | 2026-02-28 | ec87d9a | [8-implement-3-pre-audit-fixes-from-quick-t](./quick/8-implement-3-pre-audit-fixes-from-quick-t/) |
| 9 | Review 5 hotfix commits for risks/edge cases, resolve debug doc, add z-index reference | 2026-03-01 | 4fc26fc | [9-review-hotfix-commits-for-risks-edge-cas](./quick/9-review-hotfix-commits-for-risks-edge-cas/) |
| 11 | Self-review of commit e89ede3: dual-boot fix strengths, 6 real-device risk assumptions, test recommendation | 2026-03-01 | 97cf3a4 | [11-self-review-commit-e89ede3-what-did-you-](./quick/11-self-review-commit-e89ede3-what-did-you-/) |
| 12 | Self-review of tap-pipeline fix 6fe259e: isEventCapture safeguard assertions on hide/wake paths | 2026-03-01 | aaf5017 | [12-self-review-the-tap-pipeline-fix-commit-](./quick/12-self-review-the-tap-pipeline-fix-commit-/) |
| 13 | Switch health check /healthz to /readyz, enrich health view with readyz detail, rename Gateway URL label | 2026-03-01 | dcbf44a | [13-update-health-section-rename-gateway-to-](./quick/13-update-health-section-rename-gateway-to-/) |
| 14 | Restart voice gateway with .env CORS_ORIGINS and verify health (readyz + CORS strict) | 2026-03-01 | (ops, no commit) | [14-restart-voice-gateway-and-verify-health-](./quick/14-restart-voice-gateway-and-verify-health-/) |
| 15 | Self-review commit 4cad75a: localhost detection regex verified, 8 risk scenarios assessed, 0.0.0.0 follow-up recommended | 2026-03-01 | 2b41c8d | [15-self-review-commit-4cad75a-confirm-local](./quick/15-self-review-commit-4cad75a-confirm-local/) |
| 16 | Extend LOOPBACK_RE to include 0.0.0.0 as non-routable address, add 4 test cases | 2026-03-01 | 3a410ba | [16-extend-loopback-re-to-include-0-0-0-0-ad](./quick/16-extend-loopback-re-to-include-0-0-0-0-ad/) |
| 17 | Implement robust CORS support for Even WebView Origin: null with allowNullOrigin flag | 2026-03-01 | 7106723 | [17-implement-robust-cors-support-for-even-w](./quick/17-implement-robust-cors-support-for-even-w/) |
| 19 | FSM re-record after response_end + queue during thinking + transcript chunk emission | 2026-03-02 | 49bd755 | [19-fsm-re-record-after-response-end-queue-d](./quick/19-fsm-re-record-after-response-end-queue-d/) |
| 22 | Critical analysis of phase 1 plans: unreachable thinking state, path fix blocker, 5 plan edits | 2026-03-02 | 5b6e7c5 | [22-analyze-phase-plans-critically-and-propo](./quick/22-analyze-phase-plans-critically-and-propo/) |
| 23 | Fix tap-to-record inactive after /new: menu:close bus listener resets FSM to idle | 2026-03-03 | 1fac332 | [23-bug-fix-tap-to-record-inactive-after-new](./quick/23-bug-fix-tap-to-record-inactive-after-new/) |
| 24 | Fix switching sessions disables tap-to-record: session:switched FSM reset | 2026-03-03 | 8eed501 | [24-bug-2-switching-sessions-disables-tap-to](./quick/24-bug-2-switching-sessions-disables-tap-to/) |
| 25 | Fix glasses UI scroll jump: conditional autoScroll reset in endStreaming | 2026-03-03 | 4bea031 | [25-bug-3-fix-glasses-ui-scroll-jump-anchor-](./quick/25-bug-3-fix-glasses-ui-scroll-jump-anchor-/) |
| 26 | Scroll viewport hardening: getViewportState debug accessor, autoScroll audit, direct state assertions | 2026-03-03 | d5159c6 | [26-fix-scroll-viewport-expose-viewport-stat](./quick/26-fix-scroll-viewport-expose-viewport-stat/) |
| 27 | Guard asymmetry and watchdog dependency inline comments in gesture-handler.ts | 2026-03-03 | 5e0dac3 | [27-dry-srp-fixes-guard-asymmetry-comments-w](./quick/27-dry-srp-fixes-guard-asymmetry-comments-w/) |
| 28 | Audio pipeline diagnostics: empty-audio guard, frame counting, bridge logging | 2026-03-03 | 2414337 | [28-fix-audio-transcription-pipeline-recorde](./quick/28-fix-audio-transcription-pipeline-recorde/) |
| 29 | DRY/SRP cleanup: handleTurnError extraction, dead SSE/glasses code removal, root cause analysis | 2026-03-03 | 519b4dd | [29-analyze-recent-changes-for-dry-srp-remov](./quick/29-analyze-recent-changes-for-dry-srp-remov/) |
| 30 | Fix hub text turn messages not showing on glasses: sync bridge handlers + 6 tests | 2026-03-03 | d44b41f | [30-fix-sendtextturn-messages-not-showing-in](./quick/30-fix-sendtextturn-messages-not-showing-in/) |

## Session Continuity

Last session: 2026-03-03
Stopped at: Completed quick-30 (Fix hub text turn messages not showing on glasses display)
Resume file: None
