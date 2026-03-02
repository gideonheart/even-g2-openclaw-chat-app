# Roadmap: Even G2 OpenClaw Chat App

## Milestones

- ✅ **v1.0 MVP** — Phases 1-5 (shipped 2026-02-28)
- ✅ **v1.1 Integration** — Phases 6-8 (shipped 2026-02-28)
- ✅ **v1.2 Conversation Intelligence & Hub Interaction** — Phases 9-13 (shipped 2026-02-28)
- ✅ **v1.3 Resilience & Error UX** — Phases 14-19 incl. 16.5, 18.5 (shipped 2026-03-01)

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

<details>
<summary>✅ v1.3 Resilience & Error UX (Phases 14-19) — SHIPPED 2026-03-01</summary>

- [x] Phase 14: Data Integrity Foundation (5/5 plans) — completed 2026-02-28
- [x] Phase 15: Write Verification & Auto-Save Hardening (2/2 plans) — completed 2026-02-28
- [x] Phase 16: Sync Hardening (2/2 plans) — completed 2026-02-28
- [x] Phase 16.5: Integration Hardening (2/2 plans) — completed 2026-02-28
- [x] Phase 17: FSM & Gateway Resilience (2/2 plans) — completed 2026-03-01
- [x] Phase 18: Error UX (2/2 plans) — completed 2026-03-01
- [x] Phase 18.5: Hub Integration Wiring (1/1 plan) — completed 2026-03-01
- [x] Phase 19: Test Infrastructure & Resilience Coverage (2/2 plans) — completed 2026-03-01

</details>

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
| 14. Data Integrity Foundation | v1.3 | 5/5 | Complete | 2026-02-28 |
| 15. Write Verification & Auto-Save Hardening | v1.3 | 2/2 | Complete | 2026-02-28 |
| 16. Sync Hardening | v1.3 | 2/2 | Complete | 2026-02-28 |
| 16.5. Integration Hardening | v1.3 | 2/2 | Complete | 2026-02-28 |
| 17. FSM & Gateway Resilience | v1.3 | 2/2 | Complete | 2026-03-01 |
| 18. Error UX | v1.3 | 2/2 | Complete | 2026-03-01 |
| 18.5. Hub Integration Wiring | v1.3 | 1/1 | Complete | 2026-03-01 |
| 19. Test Infrastructure & Resilience Coverage | v1.3 | 2/2 | Complete | 2026-03-01 |

### Phase 1: v1.4 Voice Loop Polish — Decoupled Input + Voice Queue

**Goal:** Decouple the input FSM from the gateway response lifecycle and add a FIFO voice turn queue, so taps are never blocked by backend processing and multiple turns execute sequentially without aborting in-flight requests
**Depends on:** Phase 0
**Requirements:** [VLQ-01, VLQ-02, VLQ-03, VLQ-04, VLQ-05, VLQ-06, VLQ-07, VLQ-08]
**Plans:** 3 plans

Plans:
- [ ] 01-01-PLAN.md — State-aware reset guard in gesture-handler (response_end/error immune in recording)
- [ ] 01-02-PLAN.md — Voice turn queue in voice-loop-controller (FIFO, bounded, sequential drain)
- [ ] 01-03-PLAN.md — Polish: hint text update, dead code removal, typecheck + regression verification

---
*Full phase details archived to `.planning/milestones/`*
