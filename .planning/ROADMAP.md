# Roadmap: Even G2 OpenClaw Chat App

## Milestones

- ✅ **v1.0 MVP** — Phases 1-5 (shipped 2026-02-28)
- ✅ **v1.1 Integration** — Phases 6-8 (shipped 2026-02-28)
- ✅ **v1.2 Conversation Intelligence & Hub Interaction** — Phases 9-13 (shipped 2026-02-28)
- **v1.3 Resilience & Error UX** — Phases 14-19 (active)

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

<details>
<summary>✅ v1.2 Conversation Intelligence & Hub Interaction (Phases 9-13) — SHIPPED 2026-02-28</summary>

- [x] Phase 9: IndexedDB Persistence (2/2 plans) — completed 2026-02-28
- [x] Phase 10: Dynamic Sessions & Cross-Context Sync (3/3 plans) — completed 2026-02-28
- [x] Phase 11: Glasses Command Menu (2/2 plans) — completed 2026-02-28
- [x] Phase 12: Hub Conversation Features (3/3 plans) — completed 2026-02-28
- [x] Phase 13: Phase 9 Verification & Sync Wiring (1/1 plan) — completed 2026-02-28

</details>

## v1.3 Resilience & Error UX (Phases 14-19) -- ACTIVE

<!--
Dependency graph:

Phase 14 (Foundation)
    |
    v
Phase 15 (Write)    Phase 16 (Sync)    Phase 17 (FSM/GW)
    |                    |                    |
    +--------------------+--------------------+
                         |
                         v
                  Phase 18 (Error UX)
                         |
                         v
                  Phase 19 (Tests)
-->

### Phase 14: Data Integrity Foundation
- **Goal:** Boot-time integrity checking, storage health monitoring, eviction detection, and persistent storage -- the foundation all other resilience features depend on.
- **Requirements:** [RES-01, RES-02, RES-03, RES-04, RES-05, RES-15, RES-20 (persistence events only), RES-22]
- **Key deliverables:** integrity-checker.ts, storage-health.ts, sentinel record, IDB onclose handler, persistence event types in AppEventMap
- **Plans:** 5 plans (3 complete + 2 gap closure)
  - [x] 14-01-PLAN.md — Event types, IDB onclose handler, sentinel filtering (Wave 1)
  - [x] 14-02-PLAN.md — IntegrityChecker module with TDD (Wave 2)
  - [x] 14-03-PLAN.md — StorageHealth module + boot wiring (Wave 2)
  - [ ] 14-04-PLAN.md — Gap closure: wire reopenDB() into onclose callbacks (Wave 1)
  - [ ] 14-05-PLAN.md — Gap closure: orphan grace-period lifecycle + hub diagnostics (Wave 1)

### Phase 15: Write Verification & Auto-Save Hardening
- **Goal:** Make the primary write path (auto-save) resilient with verification, error escalation, and partial response preservation -- preventing silent data loss.
- **Requirements:** [RES-06, RES-07, RES-08]
- **Depends on:** Phase 14 (needs persistence:error event type, storage health context)
- **Key deliverables:** verifyMessage() on ConversationStore, enhanced auto-save error escalation, partial response save on mid-stream failure
- **Plans:** [To be planned]

### Phase 16: Sync Hardening
- **Goal:** Detect and recover from cross-context sync drift using IDB-as-truth pattern with sequence numbering and heartbeat.
- **Requirements:** [RES-09, RES-10, RES-11, RES-12, RES-20 (sync events only)]
- **Depends on:** Phase 14 (uses ConversationStore.countMessages for drift detection)
- **Key deliverables:** sync-monitor.ts, drift-reconciler.ts, SyncMessage seq field, heartbeat timer, sync event types
- **Plans:** [To be planned]

### Phase 17: FSM & Gateway Resilience
- **Goal:** Prevent stuck states and handle gateway failures gracefully -- watchdog timer for FSM, error classification for gateway, no auto-retry of mid-stream failures.
- **Requirements:** [RES-13, RES-14, RES-20 (fsm events only)]
- **Depends on:** Phase 14 (event types)
- **Can run parallel with Phase 16.**
- **Key deliverables:** FSM watchdog timer, gateway error classification (connection vs mid-stream), receivedAnyData flag
- **Plans:** [To be planned]

### Phase 18: Error UX
- **Goal:** Surface all error and health signals to users appropriately -- minimal on glasses (status bar, auto-clear), rich on hub (toasts, banners, health page).
- **Requirements:** [RES-16, RES-17, RES-18, RES-19]
- **Depends on:** Phases 14-17 (consumes all error events from prior phases)
- **Key deliverables:** error-presenter.ts (glasses + hub variants), health-indicator.ts, hub health page enhancements, error banner component
- **Plans:** [To be planned]

### Phase 19: Test Infrastructure & Resilience Coverage
- **Goal:** Comprehensive failure scenario testing using existing tools -- test helpers for IDB failures and sync message loss, integration tests for all resilience features.
- **Requirements:** [RES-21]
- **Depends on:** Phases 14-18 (tests exercise all resilience features)
- **Key deliverables:** failure-helpers.ts, integration test suite for integrity/sync/error scenarios
- **Plans:** [To be planned]

## Progress

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
| 9. IndexedDB Persistence | v1.2 | 2/2 | Complete | 2026-02-28 |
| 10. Dynamic Sessions & Cross-Context Sync | v1.2 | 3/3 | Complete | 2026-02-28 |
| 11. Glasses Command Menu | v1.2 | 2/2 | Complete | 2026-02-28 |
| 12. Hub Conversation Features | v1.2 | 3/3 | Complete | 2026-02-28 |
| 13. Phase 9 Verification & Sync Wiring | v1.2 | 1/1 | Complete | 2026-02-28 |
| 14. Data Integrity Foundation | v1.3 | 3/5 | Gap Closure | -- |
| 15. Write Verification & Auto-Save Hardening | v1.3 | 0/? | Not Started | -- |
| 16. Sync Hardening | v1.3 | 0/? | Not Started | -- |
| 17. FSM & Gateway Resilience | v1.3 | 0/? | Not Started | -- |
| 18. Error UX | v1.3 | 0/? | Not Started | -- |
| 19. Test Infrastructure & Resilience Coverage | v1.3 | 0/? | Not Started | -- |

---
*Full phase details archived to `.planning/milestones/`*
