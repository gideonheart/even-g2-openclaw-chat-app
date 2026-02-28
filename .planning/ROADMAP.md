# Roadmap: Even G2 OpenClaw Chat App

## Overview

This roadmap delivers a voice-chat companion app for Even G2 smart glasses, progressing from foundational types and settings through SDK integration, glasses display rendering, backend API connectivity, companion hub UI, and finally full voice-loop integration with EvenHub submission packaging. The six phases follow the strict dependency chain demanded by the hardware: nothing glasses-related works without the bridge, nothing streams without the API client, and nothing ships without integration testing on the complete loop.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation & Settings** - Types, settings store with secret partitioning, TS strict mode, Vitest setup
- [ ] **Phase 2: Even Bridge & Input Pipeline** - SDK wrapper, gesture FSM with tap/double-tap debounce, audio capture
- [ ] **Phase 3: Glasses Display & Streaming** - Icon HUD, bubble chat renderer, virtualized viewport, stream throttle, UI modes
- [x] **Phase 4: Gateway API Client** - HTTP client, SSE streaming via fetch + eventsource-parser, health monitoring, reconnection
- [x] **Phase 5: Companion Hub UI** - Home, health, logs, sessions, simulator, shell navigation, mobile polish
- [ ] **Phase 6: Voice Loop Integration & Submission** - End-to-end wiring, EvenHub submission package with app metadata

## Phase Details

### Phase 1: Foundation & Settings
**Goal**: Users can configure and persist all app settings needed to connect to their backend gateway, with secrets handled safely
**Depends on**: Nothing (first phase)
**Requirements**: SETT-01, SETT-02, SETT-03, SETT-04, SETT-05, SETT-06, SETT-07, SETT-08, PLAT-01, PLAT-02
**Success Criteria** (what must be TRUE):
  1. User can fill out a settings form with gateway URL, STT provider, and session key, and invalid inputs are rejected before saving
  2. User's settings survive a full browser reload (persisted in localStorage)
  3. Secret fields (session key) display masked by default with a show/hide toggle, and exported JSON omits secrets unless explicitly included
  4. User can import a previously exported JSON settings file and the app validates it before applying
  5. Running `npx vitest` executes a test suite against core modules with TypeScript in strict mode
**Plans**: Complete

Plans:
- [x] 01-01: TypeScript strict mode + Vite + Vitest infrastructure
- [x] 01-02: Settings store with types, validation, secret partitioning, export/import

### Phase 2: Even Bridge & Input Pipeline
**Goal**: Users can interact with the glasses via all four gestures and initiate voice recording through tap, with the bridge abstracting all SDK complexity behind typed events
**Depends on**: Phase 1
**Requirements**: BRDG-01, BRDG-02, BRDG-03, GEST-01, GEST-02, GEST-03, GEST-04, GEST-05, GEST-06, VOICE-01, VOICE-02, VOICE-03, VOICE-04
**Success Criteria** (what must be TRUE):
  1. EvenBridge initializes the SDK, dispatches typed events on an event bus, and tears down cleanly -- no UI component calls bridge methods directly
  2. Tapping starts voice recording; tapping again stops it; a 250-300ms debounce window prevents double-tap from triggering a false recording start
  3. Double-tap toggles the menu/wake state; scroll-up and scroll-down dispatch their respective navigation actions
  4. Audio is captured from the glasses microphone (or browser fallback in dev mode) and buffered for sending to the gateway
  5. A gesture hint bar appears on the glasses display when contextually relevant (e.g., during conversation scroll)
**Plans**: 3 plans

Plans:
- [ ] 02-01-PLAN.md — Gesture FSM pure function (TDD: state transitions for all 4 gestures across 5 states)
- [ ] 02-02-PLAN.md — EvenBridge service, dev mock bridge, audio capture with glasses/browser fallback
- [ ] 02-03-PLAN.md — Gesture handler wiring with debounce, action dispatch, and hint bar text

### Phase 3: Glasses Display & Streaming
**Goal**: Users see a responsive glasses HUD with animated state icons and streaming bubble chat that renders efficiently on the 576x288 canvas
**Depends on**: Phase 2
**Requirements**: ICONS-01, ICONS-02, ICONS-03, ICONS-04, ICONS-05, CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-06, CHAT-07, UIMD-01, UIMD-02
**Success Criteria** (what must be TRUE):
  1. Glasses display shows the correct state icon (idle, recording, sent, thinking) with animations at 3-6 fps, transitioning automatically as conversation state changes
  2. User speech appears as a right-aligned bubble and assistant responses appear as left-aligned bubbles, with assistant text streaming in at 150-300ms update cadence (not per-token)
  3. User can scroll up through conversation history and scroll down / jump to latest using gestures, with only the visible viewport window rendered on glasses (virtualized)
  4. No single SDK text update exceeds 2000 characters
  5. Double-tap hides the glasses display (blank canvas); another double-tap wakes it back
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD
- [ ] 03-03: TBD

### Phase 4: Gateway API Client
**Goal**: The app can communicate with the backend gateway to send audio and receive streaming AI responses over SSE, with resilient connectivity
**Depends on**: Phase 1
**Requirements**: API-01, API-02, API-03, API-04
**Success Criteria** (what must be TRUE):
  1. API client sends audio to the gateway and receives streaming SSE responses using fetch() + eventsource-parser (not native EventSource), with no secrets stored in frontend code
  2. Connection health is monitored via heartbeat detection, and the health status is queryable by other modules
  3. After connectivity loss (phone sleep, network drop), the client automatically reconnects without user intervention
**Plans**: Complete

Plans:
- [x] 04-01: Gateway client with SSE parser, heartbeat, auto-reconnect (13 tests)

### Phase 5: Companion Hub UI
**Goal**: Users have a fully functional mobile/desktop companion app with home status, health diagnostics, session management, logs, simulator access, and polished navigation
**Depends on**: Phase 1, Phase 4
**Requirements**: HOME-01, HOME-02, HOME-03, HLTH-01, HLTH-02, HLTH-03, LOGS-01, LOGS-02, LOGS-03, SESS-01, SESS-02, SESS-03, SIM-01, SIM-02, SIM-03, SHEL-01, SHEL-02, SHEL-03, SHEL-04, MOBL-01, MOBL-02
**Success Criteria** (what must be TRUE):
  1. Home screen displays glasses connection/disconnection status, battery level, and quick action cards for common tasks
  2. Health view shows service check indicators (gateway online, STT ready, session active), sync status, and latest voice turn diagnostics
  3. Logs view displays filterable entries (info/warn/error) with correlation IDs, and user can copy diagnostics payload to clipboard
  4. User can view a session list with active marker, switch sessions with confirmation dialog and toast feedback
  5. Simulator is accessible at /preview-glasses.html with a launch button in the hub marked "dev-only", and state can be handed off via query parameters
  6. Bottom navigation uses clean SVG line icons matching Even native design, with correct active states on iPhone viewport, and the app has no horizontal scroll or clipped cards on any mobile viewport (safe-area insets handled)
**Plans**: Complete

Plans:
- [x] 05-01: Home, health, sessions, settings pages with native Even design tokens
- [x] 05-02: Logs view with filtering, diagnostics copy, simulator integration
- [x] 05-03: Mobile polish, safe-area handling, bottom nav finalization

### Phase 6: Voice Loop Integration & Submission
**Goal**: The complete voice conversation loop works end-to-end (gesture to audio to gateway to streaming display) and the app is packaged for EvenHub submission
**Depends on**: Phase 2, Phase 3, Phase 4, Phase 5
**Requirements**: PLAT-03, PLAT-04
**Success Criteria** (what must be TRUE):
  1. User can tap to record, audio is sent to gateway, AI response streams back as bubble chat on the glasses display -- the full loop works without manual intervention
  2. EvenHub submission package produces a self-contained dist/index.html via vite-plugin-singlefile with app metadata (name, icon, description, permissions)
  3. All prior phase success criteria still pass (no regressions from integration wiring)
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6
Note: Phase 4 depends only on Phase 1, so it could execute in parallel with Phases 2-3 if desired.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Settings | 2/2 | Complete | 2026-02-28 |
| 2. Even Bridge & Input Pipeline | 0/3 | Not started | - |
| 3. Glasses Display & Streaming | 0/3 | Not started | - |
| 4. Gateway API Client | 1/1 | Complete | 2026-02-28 |
| 5. Companion Hub UI | 3/3 | Complete | 2026-02-28 |
| 6. Voice Loop Integration & Submission | 0/2 | Not started | - |
