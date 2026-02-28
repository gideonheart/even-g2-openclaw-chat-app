# Roadmap: Even G2 OpenClaw Chat App

## Milestones

- ✅ **v1.0 MVP** - Phases 1-5 (shipped 2026-02-28)
- 🚧 **v1.1 Integration** - Phases 6-8 (in progress)

## Phases

<details>
<summary>v1.0 MVP (Phases 1-5) - SHIPPED 2026-02-28</summary>

- [x] **Phase 1: Foundation & Settings** - TypeScript infrastructure, settings store, event bus (2/2 plans)
- [x] **Phase 2: Even Bridge & Input Pipeline** - Gesture FSM, bridge wrapper, audio capture (3/3 plans)
- [x] **Phase 3: Glasses Display & Streaming** - Viewport, renderer, display controller (3/3 plans)
- [x] **Phase 4: Gateway API Client** - SSE streaming, heartbeat, auto-reconnect (1/1 plan)
- [x] **Phase 5: Companion Hub UI** - Home, health, logs, sessions, settings, mobile polish (3/3 plans)

</details>

### v1.1 Integration (In Progress)

**Milestone Goal:** Wire all v1.0 library modules into a working end-to-end voice loop and package for EvenHub submission.

- [ ] **Phase 6: Runtime Wiring** - Wire all modules into a working voice loop via main.ts assembly
- [ ] **Phase 7: Error Handling & Lifecycle** - Resilient voice loop with error recovery and graceful shutdown
- [ ] **Phase 8: EvenHub Submission** - App manifest, production build, and .ehpk submission artifact

## Phase Details

### Phase 6: Runtime Wiring
**Goal**: Users can complete a full voice conversation turn through the glasses -- tap to record, audio sent to gateway, streaming AI response appears as bubble chat on the glasses display
**Depends on**: Phases 1-5 (all v1.0 library modules)
**Requirements**: LOOP-01, LOOP-02, LOOP-03, LOOP-04, LOOP-05, LOOP-06, ERR-04
**Success Criteria** (what must be TRUE):
  1. User can tap the glasses (or press keyboard shortcut in dev mode), speak, and see the AI response stream as bubble chat on the glasses display -- the full voice turn completes without manual intervention
  2. App detects whether it is running inside Even App WebView or a browser and boots the correct code path (glasses runtime vs companion hub)
  3. All modules initialize in correct dependency order -- gesture handler subscribes before display controller, audio frame subscription exists before first tap, bridge init completes before any module calls bridge methods
  4. Orphaned event types (display:state-change, viewport-update, hide, wake) are removed from AppEventMap and no code references them
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD

### Phase 7: Error Handling & Lifecycle
**Goal**: Voice loop recovers gracefully from errors -- gateway failures return the user to idle state, timeouts provide feedback, and app shutdown cleans up resources
**Depends on**: Phase 6
**Requirements**: ERR-01, ERR-02, ERR-03
**Success Criteria** (what must be TRUE):
  1. When the gateway returns an error mid-turn, the gesture FSM transitions back to idle and the user can immediately start a new voice turn without restarting the app
  2. If a gateway request takes longer than 30 seconds, the turn is cancelled with user-visible feedback on the glasses display and the user can retry
  3. When the app is closed or navigated away from, gateway connections are destroyed and audio resources are released -- no leaked timers or fetch requests
**Plans**: TBD

Plans:
- [ ] 07-01: TBD

### Phase 8: EvenHub Submission
**Goal**: App is packaged as a valid EvenHub submission with correct metadata, a self-contained production build, and a working .ehpk artifact
**Depends on**: Phase 7
**Requirements**: SUB-01, SUB-02, SUB-03, SUB-04
**Success Criteria** (what must be TRUE):
  1. app.json defines package identity, version, description, permissions (including wildcard network), and entrypoint -- and passes evenhub pack validation
  2. Production build produces self-contained output suitable for EvenHub packaging, with no reference to external assets or dev-only files
  3. Running the pack npm script produces a .ehpk artifact that can be submitted to the EvenHub portal
  4. Simulator (preview-glasses.html) is available during development but excluded from the production build output
**Plans**: TBD

Plans:
- [ ] 08-01: TBD

## Progress

**Execution Order:** Phases execute sequentially: 6 -> 7 -> 8

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation & Settings | v1.0 | 2/2 | Complete | 2026-02-28 |
| 2. Even Bridge & Input Pipeline | v1.0 | 3/3 | Complete | 2026-02-28 |
| 3. Glasses Display & Streaming | v1.0 | 3/3 | Complete | 2026-02-28 |
| 4. Gateway API Client | v1.0 | 1/1 | Complete | 2026-02-28 |
| 5. Companion Hub UI | v1.0 | 3/3 | Complete | 2026-02-28 |
| 6. Runtime Wiring | v1.1 | 0/? | Not started | - |
| 7. Error Handling & Lifecycle | v1.1 | 0/? | Not started | - |
| 8. EvenHub Submission | v1.1 | 0/? | Not started | - |
