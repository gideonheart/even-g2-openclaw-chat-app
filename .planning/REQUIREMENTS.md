# Requirements: Even G2 OpenClaw Chat App

**Defined:** 2026-02-28
**Core Value:** Users can have natural voice conversations with an AI assistant through their Even G2 glasses, seeing streaming responses as compact bubble chat on the glasses display.

## v1.1 Requirements

Requirements for v1.1 Integration milestone. Wires existing v1.0 library modules into working end-to-end voice loop and packages for EvenHub submission.

### Voice Loop Wiring

- [x] **LOOP-01**: User can complete a full voice turn: tap -> record -> send -> see streaming response on glasses
- [x] **LOOP-02**: Runtime main.ts detects Even App WebView vs browser and routes to correct boot path
- [x] **LOOP-03**: Glasses boot sequence initializes all modules in correct dependency order (bus -> bridge -> audio -> gesture -> display -> voice loop)
- [x] **LOOP-04**: VoiceLoopController bridges gateway client events to the app event bus
- [x] **LOOP-05**: bridge:audio-frame events are forwarded to audioCapture.onFrame() for glasses-mode PCM recording
- [x] **LOOP-06**: CLICK_EVENT SDK quirk is handled so tap gestures work on real glasses hardware

### Error Handling & Lifecycle

- [ ] **ERR-01**: FSM transitions to idle state when gateway returns an error mid-turn
- [ ] **ERR-02**: Gateway requests timeout after 30 seconds with user-visible feedback
- [ ] **ERR-03**: App performs graceful shutdown (gateway.destroy, audio cleanup) on unload
- [x] **ERR-04**: Orphaned event types removed from AppEventMap (display:state-change, viewport-update, hide, wake)

### EvenHub Submission

- [ ] **SUB-01**: app.json metadata file defines package identity, version, description, permissions, and entrypoint
- [ ] **SUB-02**: Production build produces self-contained output suitable for EvenHub packaging
- [ ] **SUB-03**: npm script runs `evenhub pack` to produce .ehpk submission artifact
- [ ] **SUB-04**: Simulator (preview-glasses.html) is excluded from production build but available in dev mode

## Future Requirements

Deferred beyond v1.1. Tracked for future milestones.

### Session Management

- **SESS-01**: User can select and switch between OpenClaw agent sessions from companion hub
- **SESS-02**: User receives visual confirmation when session switch completes

### Enhanced Diagnostics

- **DIAG-01**: User can view connection health with service-level status indicators
- **DIAG-02**: User can filter logs by severity level (info/warn/error)
- **DIAG-03**: User can copy correlation IDs for debugging

### UX Polish

- **UX-01**: Glasses display can hide/wake on double-tap
- **UX-02**: Simulator receives state handoff from companion hub via query params

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Configurable gesture mapping | Default mapping sufficient; adds settings complexity |
| R1 ring input integration | Separate accessory with own SDK; defer until ring adoption grows |
| Multi-language UI | EvenHub is early-access, English-first audience |
| Conversation transcript export | Privacy concern; gateway should own this |
| Offline AI mode | Real-time voice loop is core value; requires different architecture |
| Custom fonts/themes on glasses | G2 has one fixed font, 4-bit greyscale; hardware limitation |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| LOOP-01 | Phase 6 | Complete |
| LOOP-02 | Phase 6 | Complete |
| LOOP-03 | Phase 6 | Complete |
| LOOP-04 | Phase 6 | Complete |
| LOOP-05 | Phase 6 | Complete |
| LOOP-06 | Phase 6 | Complete |
| ERR-01 | Phase 7 | Pending |
| ERR-02 | Phase 7 | Pending |
| ERR-03 | Phase 7 | Pending |
| ERR-04 | Phase 6 | Complete |
| SUB-01 | Phase 8 | Pending |
| SUB-02 | Phase 8 | Pending |
| SUB-03 | Phase 8 | Pending |
| SUB-04 | Phase 8 | Pending |

**Coverage:**
- v1.1 requirements: 14 total
- Mapped to phases: 14
- Unmapped: 0

---
*Requirements defined: 2026-02-28*
*Last updated: 2026-02-28 after Phase 6 completion*
