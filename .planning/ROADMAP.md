# Roadmap: Even G2 OpenClaw Chat App

## Milestones

- ✅ **v1.0 MVP** — Phases 1-5 (shipped 2026-02-28)
- 📋 **v1.1 Integration** — Phase 6 (planned)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-5) — SHIPPED 2026-02-28</summary>

- [x] Phase 1: Foundation & Settings (2/2 plans) — completed 2026-02-28
- [x] Phase 2: Even Bridge & Input Pipeline (3/3 plans) — completed 2026-02-28
- [x] Phase 3: Glasses Display & Streaming (3/3 plans) — completed 2026-02-28
- [x] Phase 4: Gateway API Client (1/1 plan) — completed 2026-02-28
- [x] Phase 5: Companion Hub UI (3/3 plans) — completed 2026-02-28

</details>

### 📋 v1.1 Integration (Planned)

- [ ] Phase 6: Voice Loop Integration & Submission (2 plans)

**Goal**: The complete voice conversation loop works end-to-end (gesture to audio to gateway to streaming display) and the app is packaged for EvenHub submission
**Depends on**: Phase 2, Phase 3, Phase 4, Phase 5
**Requirements**: PLAT-03, PLAT-04
**Success Criteria** (what must be TRUE):
  1. User can tap to record, audio is sent to gateway, AI response streams back as bubble chat on the glasses display -- the full loop works without manual intervention
  2. EvenHub submission package produces a self-contained dist/index.html via vite-plugin-singlefile with app metadata (name, icon, description, permissions)
  3. All prior phase success criteria still pass (no regressions from integration wiring)

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation & Settings | v1.0 | 2/2 | Complete | 2026-02-28 |
| 2. Even Bridge & Input Pipeline | v1.0 | 3/3 | Complete | 2026-02-28 |
| 3. Glasses Display & Streaming | v1.0 | 3/3 | Complete | 2026-02-28 |
| 4. Gateway API Client | v1.0 | 1/1 | Complete | 2026-02-28 |
| 5. Companion Hub UI | v1.0 | 3/3 | Complete | 2026-02-28 |
| 6. Voice Loop Integration | v1.1 | 0/2 | Not started | - |
