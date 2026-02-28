# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-28)

**Core value:** Users can have natural voice conversations with an AI assistant through their Even G2 glasses, seeing streaming responses as compact bubble chat on the glasses display.
**Current focus:** v1.3 Resilience & Error UX

## Current Position

Phase: 16.5-integration-hardening
Current Plan: 1 of 2
Status: Plan 01 complete
Last activity: 2026-02-28 - Completed 16.5-01: Glasses integration hardening (reopenDB handle propagation, eviction subscriber, cleanup teardown)

## Performance Metrics

**Velocity:**
- Total plans completed: 38 (Phases 1-16.5 + Phase 13 gap closure)
- Total tests: 436 (all passing)
- Total LOC: ~10,800 TypeScript (66 files)
- Total execution time: ~5.1 hours

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
| 16.5 | 1/2 (glasses integration hardening: reopenDB propagation + eviction + cleanup) | ~4m | 4m |

## Accumulated Context

### Decisions

All decisions logged in PROJECT.md Key Decisions table (22 entries with outcomes).

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
- Hub message:added now renders live messages via appendLiveMessage (12-01, replaces 13-01 stub)
- conversation:named falls through to refreshSessionList() since hub shows conversation names (13-01)
- MENU_SELECT action added to FSM; tap in menu stays in menu state, controller decides when to close (11-01)
- Destructive menu items require confirmation sub-state before execution (11-01)
- Scroll locked during confirmation to prevent accidental navigation (11-01)
- Menu controller uses showMenuOverlay/restoreConversation, not hide/wake (avoids flicker) (11-02)
- Scroll during confirmation cancels the confirmation dialog (11-02)
- /rename auto-generates name from first user message, no keyboard needed (11-02)
- /reset implemented as delete+create (cascade deletes messages) (11-02)
- streaming:end posted AFTER successful save alongside message:added for consistent state (12-01)
- textContent used for message rendering to prevent XSS without escHtml (12-01)
- session:switched sync handler calls both refreshSessionList and loadLiveConversation (12-01)
- hubConversationStore stored at module level for loadLiveConversation access (12-01)
- Extracted streamSSEResponse helper to DRY SSE parsing between sendVoiceTurn and sendTextTurn (12-02)
- Streaming div approach for hub text response: create div on response_start, update on delta (12-02)
- Hub gateway client is separate instance from glasses gateway with independent lifecycle (12-02)
- Send button disabled during request to prevent duplicate text submissions (12-02)
- extractSnippet as pure exported function for testability and reuse (12-03)
- searchMessages uses single readonly IDB transaction over both stores for consistency (12-03)
- Features/Apps page fully replaced by Chat page for conversation history access (12-03)
- Search results rendered with escHtml + highlighted match span for XSS safety (12-03)
- reopenDB uses Promise chain with setTimeout, not async/await, to stay safe outside IDB transactions (14-01)
- SENTINEL_ID exported as named constant for reuse by integrity-checker in Plan 02 (14-01)
- Sentinel filtered in 3 query methods but not getConversation to allow direct lookup (14-01)
- localStorage dangling pointer check runs after tx.oncomplete to guarantee convIds Set is fully populated (14-02)
- cleanupOrphans uses Promise.then chain for two-phase transaction sequencing (readonly verify, then readwrite delete) (14-02)
- IntegrityReport and IntegrityChecker interfaces co-located in integrity-checker.ts (not types.ts) since module-specific (14-02)
- Feature detection uses truthiness check (!navigator.storage) not 'in' operator to handle undefined safely (14-03)
- Hub uses dynamic imports for integrity-checker and storage-health, consistent with hub lazy-loading pattern (14-03)
- Glasses emits bus events for persistence:health and storage:evicted; hub uses console logging (no bus) (14-03)
- reopenDB() uses .then()/.catch() in onclose callback (synchronous fire-and-forget, not async/await) (14-04)
- Initial recoverable:true error kept before reopenDB call; recoverable:false only on max retry exhaustion (14-04)
- Both boot files share localStorage orphan keys for cross-context cleanup (glasses detects, hub cleans or vice versa) (14-05)
- staleOrphans filter (intersection of previous + current) provides scheduling-layer re-verification before IDB-layer re-verification (14-05)
- orphanCount uses conditional spread to omit field entirely when no orphans present (clean payload) (14-05)
- verifyMessage uses separate readonly transaction (not shared with write tx) per Pitfall P1 (15-01)
- verifyMessage never rejects -- resolves false on any IDB error (verification failure is data, not exception) (15-01)
- storageVerified flag resets on persistence:warning to allow re-verification after transient failures (15-01)
- Dual-emit on retry exhaustion: persistence:warning for soft handler + persistence:error for Phase 18 error presenter (15-01)
- Partial save includes hardcoded English ' [response interrupted]' suffix (per research Open Question 3) (15-01)
- Verification is async fire-and-forget -- does not block subsequent saves (15-01)
- Hub uses console.error + showToast for save failures (no event bus per Phase 14 decision) (15-02)
- pendingHubAssistantText cleared before async save to prevent double-save race (15-02)
- User message save failure caught without aborting gateway call or UI flow (15-02)
- DriftReconciler uses callback pattern (not bus) for portability across glasses and hub contexts (16-01)
- SyncMonitor isAlive() returns true when no heartbeat ever received (peer may not have started) (16-01)
- 2-consecutive-mismatch rule prevents false positives during active streaming (16-01)
- countMessages uses IDB index.count() for O(1) performance (16-01)
- SyncMonitor created after syncBridge, destroyed before syncBridge in both contexts (16-02)
- Glasses drift reconciliation re-renders via renderer.destroy()+init() cycle then replays IDB messages (16-02)
- Hub drift reconciliation calls loadLiveConversation() to re-read from IDB (16-02)
- Hub SyncMonitor created after SessionManager so getActiveConversationId can reference mgr (16-02)
- Existing syncBridge.onMessage handlers and auto-save callers left unchanged -- SyncMonitor is independent observer (16-02)
- Heartbeat setInterval async body wrapped in try/catch for IDB resilience; catch is empty (silent skip matching codebase pattern) (quick-8)
- DriftReconciler.handleHeartbeat() lets IDB errors propagate; callers in boot files add .catch(() => {}) (quick-8)
- SyncMonitor.send() removed -- only heartbeats use seq tracking, now inlined in heartbeat callback (quick-8)
- localSeq renamed to heartbeatSeq, sequenceGaps renamed to heartbeatGaps to clarify scope (quick-8)
- Recreate all 5 IDB-dependent modules after reopenDB (store, sessionStore, autoSave, driftReconciler, syncMonitor) instead of partial refresh (16.5-01)
- evictionDetected flag pattern: set boolean during boot, check after renderer init to avoid missed synchronous events (16.5-01)
- driftReconciler.destroy() placed before syncMonitor.destroy() in cleanup to clear mismatch counter before stopping heartbeat (16.5-01)

### Pending Todos

None.

### Blockers/Concerns

- BroadcastChannel support in flutter_inappwebview is unverified on real hardware (SYNC-02 fallback ready)
- IndexedDB durability in Even App WKWebView (iOS) may evict data under storage pressure
- Gateway text turn API for hub text input (HUB-03/04) not confirmed with backend
- Zero new runtime deps constraint (RES-22) -- all v1.3 features must use browser built-ins only

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

## Session Continuity

Last session: 2026-02-28
Stopped at: Completed 16.5-01-PLAN.md (glasses integration hardening)
Resume file: None
