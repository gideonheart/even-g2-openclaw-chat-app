# Requirements: Even G2 OpenClaw Chat App

**Defined:** 2026-02-28
**Core Value:** Users can have natural voice conversations with an AI assistant through their Even G2 glasses, seeing streaming responses as compact bubble chat on the glasses display.

## v1 Requirements

Requirements for initial release (EvenHub submission). Each maps to roadmap phases.

### Voice Interaction

- [ ] **VOICE-01**: User can tap to start voice recording on glasses
- [ ] **VOICE-02**: User can tap again to stop voice recording
- [ ] **VOICE-03**: Audio is captured from glasses microphone via Even SDK bridge events
- [ ] **VOICE-04**: Captured audio is buffered and sent to backend gateway for STT processing

### State Icons HUD

- [ ] **ICONS-01**: Glasses display shows idle icon when no conversation is active
- [ ] **ICONS-02**: Glasses display shows blinking recording icon during voice capture
- [ ] **ICONS-03**: Glasses display shows sent icon after recording stops
- [ ] **ICONS-04**: Glasses display shows thinking throbber while awaiting OpenClaw response
- [ ] **ICONS-05**: Icon animations render at 3-6 fps on the glasses display

### Chat Display

- [ ] **CHAT-01**: User transcript appears as right-aligned bubble on glasses display
- [ ] **CHAT-02**: Assistant response appears as left-aligned bubble on glasses display
- [ ] **CHAT-03**: Assistant response streams incrementally with 150-300ms update cadence (not per-token)
- [ ] **CHAT-04**: Chat viewport is virtualized: full history in memory, only visible window rendered on glasses
- [ ] **CHAT-05**: User can scroll up through conversation history via scroll-up gesture
- [ ] **CHAT-06**: User can scroll down / jump to latest via scroll-down gesture
- [ ] **CHAT-07**: Text upgrades do not exceed 2000 characters per SDK call

### Gesture Input

- [ ] **GEST-01**: Tap gesture maps to start/stop voice recording
- [ ] **GEST-02**: Double-tap gesture maps to menu/wake toggle
- [ ] **GEST-03**: Scroll-up gesture maps to conversation history scroll up
- [ ] **GEST-04**: Scroll-down gesture maps to scroll down / jump to latest
- [ ] **GEST-05**: Tap vs double-tap disambiguation uses 250-300ms debounce window in FSM
- [ ] **GEST-06**: Gesture hint bar displayed on glasses when contextually relevant

### Settings

- [ ] **SETT-01**: User can configure backend gateway URL in settings form
- [ ] **SETT-02**: User can select STT provider from available options
- [ ] **SETT-03**: User can configure session key / metadata
- [ ] **SETT-04**: Settings form validates all inputs before saving
- [ ] **SETT-05**: Settings persist in localStorage across browser sessions
- [ ] **SETT-06**: Secret/key inputs display with secure masking UX (show/hide toggle)
- [ ] **SETT-07**: User can export settings as JSON (secrets excluded by default)
- [ ] **SETT-08**: User can import settings from JSON file with validation

### Sessions

- [ ] **SESS-01**: User can view list of available sessions with active session marker
- [ ] **SESS-02**: User can switch active session from session list panel
- [ ] **SESS-03**: Session switch shows confirmation dialog and state toast on completion

### Home & Status

- [ ] **HOME-01**: Home screen shows glasses connection/disconnection status
- [ ] **HOME-02**: Home screen shows battery level and device status indicators
- [ ] **HOME-03**: Home screen displays quick action cards for common tasks

### Health & Diagnostics

- [ ] **HLTH-01**: Health view displays service check indicators (gateway online, STT ready, session active)
- [ ] **HLTH-02**: Health view shows sync status with backend gateway
- [ ] **HLTH-03**: Health view shows latest voice turn diagnostics

### Logs

- [ ] **LOGS-01**: Logs view displays entries with info/warn/error level filtering
- [ ] **LOGS-02**: Logs view shows correlation IDs for tracing voice turns end-to-end
- [ ] **LOGS-03**: User can copy diagnostics payload to clipboard for debugging/reporting

### Simulator

- [ ] **SIM-01**: Glasses simulator accessible at dedicated /preview-glasses.html route
- [ ] **SIM-02**: Companion hub includes simulator launch button with "dev-only" indicator
- [ ] **SIM-03**: State can be handed off to simulator via query parameters

### Backend API

- [ ] **API-01**: API client communicates with backend gateway without holding any secrets
- [ ] **API-02**: Streaming responses received via SSE using fetch() + eventsource-parser (not native EventSource)
- [ ] **API-03**: Connection health monitored with heartbeat detection
- [ ] **API-04**: Client reconnects automatically after connectivity loss (phone sleep/wake)

### Even Bridge

- [ ] **BRDG-01**: EvenBridge service wraps SDK initialization, lifecycle, and teardown
- [ ] **BRDG-02**: Bridge events dispatched via typed event bus (no direct bridge.* calls from UI)
- [ ] **BRDG-03**: Development fallback mode enables building/testing without physical glasses connected

### UI Modes

- [ ] **UIMD-01**: Glasses display supports hide mode (blank canvas when not actively conversing)
- [ ] **UIMD-02**: Double-tap wakes glasses display from hidden mode

### Mobile Polish

- [ ] **MOBL-01**: Companion hub handles iOS safe-area insets correctly (bottom browser chrome)
- [ ] **MOBL-02**: No horizontal scroll or clipped cards on any mobile viewport

### UI Shell

- [ ] **SHEL-01**: Bottom navigation icons use clean SVG line icons matching Even native design language
- [ ] **SHEL-02**: Top bar + tabs mirror native Even app hierarchy
- [ ] **SHEL-03**: Bottom nav alignment and active states finalized for iPhone viewport
- [ ] **SHEL-04**: App information architecture: Home, Health, Apps/Features, Settings tabs

### Platform

- [ ] **PLAT-01**: TypeScript strict mode enabled across entire codebase
- [ ] **PLAT-02**: Test suite implemented using Vitest with meaningful coverage of core modules
- [ ] **PLAT-03**: EvenHub submission package produces self-contained dist/index.html via vite-plugin-singlefile
- [ ] **PLAT-04**: App metadata (name, icon, description, permissions) included for EvenHub listing

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Input

- **AINP-01**: User can remap gesture-to-action assignments via settings
- **AINP-02**: R1 ring input integration when Even SDK surface stabilizes

### Persistence

- **PERS-01**: Conversation history persists across browser sessions (gateway-backed)
- **PERS-02**: Offline read-only access to cached recent conversation history

### Internationalization

- **I18N-01**: UI supports multiple languages with translation system

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Direct OpenClaw API calls from browser | Exposes API keys in WebView; secrets belong in gateway repo |
| STT/TTS processing in frontend | WebAssembly Whisper ~500MB too heavy for WebView; gateway handles STT |
| Rich text/markdown on glasses display | G2 has single fixed font, no rich text in SDK container model |
| Camera/video features | Even G2 has NO camera by design (privacy-first hardware) |
| Multi-user/collaborative features | G2 is single-user wearable with single BLE connection |
| Custom fonts/themes on glasses | G2 has one fixed font, 4-bit greyscale, no SDK font customization |
| Full conversation transcript export | Privacy concern with voice transcripts; gateway should own this |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SETT-01 | Phase 1 | Pending |
| SETT-02 | Phase 1 | Pending |
| SETT-03 | Phase 1 | Pending |
| SETT-04 | Phase 1 | Pending |
| SETT-05 | Phase 1 | Pending |
| SETT-06 | Phase 1 | Pending |
| SETT-07 | Phase 1 | Pending |
| SETT-08 | Phase 1 | Pending |
| PLAT-01 | Phase 1 | Pending |
| PLAT-02 | Phase 1 | Pending |
| BRDG-01 | Phase 2 | Pending |
| BRDG-02 | Phase 2 | Pending |
| BRDG-03 | Phase 2 | Pending |
| GEST-01 | Phase 2 | Pending |
| GEST-02 | Phase 2 | Pending |
| GEST-03 | Phase 2 | Pending |
| GEST-04 | Phase 2 | Pending |
| GEST-05 | Phase 2 | Pending |
| GEST-06 | Phase 2 | Pending |
| VOICE-01 | Phase 2 | Pending |
| VOICE-02 | Phase 2 | Pending |
| VOICE-03 | Phase 2 | Pending |
| VOICE-04 | Phase 2 | Pending |
| ICONS-01 | Phase 3 | Pending |
| ICONS-02 | Phase 3 | Pending |
| ICONS-03 | Phase 3 | Pending |
| ICONS-04 | Phase 3 | Pending |
| ICONS-05 | Phase 3 | Pending |
| CHAT-01 | Phase 3 | Pending |
| CHAT-02 | Phase 3 | Pending |
| CHAT-03 | Phase 3 | Pending |
| CHAT-04 | Phase 3 | Pending |
| CHAT-05 | Phase 3 | Pending |
| CHAT-06 | Phase 3 | Pending |
| CHAT-07 | Phase 3 | Pending |
| UIMD-01 | Phase 3 | Pending |
| UIMD-02 | Phase 3 | Pending |
| API-01 | Phase 4 | Pending |
| API-02 | Phase 4 | Pending |
| API-03 | Phase 4 | Pending |
| API-04 | Phase 4 | Pending |
| HOME-01 | Phase 5 | Pending |
| HOME-02 | Phase 5 | Pending |
| HOME-03 | Phase 5 | Pending |
| HLTH-01 | Phase 5 | Pending |
| HLTH-02 | Phase 5 | Pending |
| HLTH-03 | Phase 5 | Pending |
| LOGS-01 | Phase 5 | Pending |
| LOGS-02 | Phase 5 | Pending |
| LOGS-03 | Phase 5 | Pending |
| SESS-01 | Phase 5 | Pending |
| SESS-02 | Phase 5 | Pending |
| SESS-03 | Phase 5 | Pending |
| SIM-01 | Phase 5 | Pending |
| SIM-02 | Phase 5 | Pending |
| SIM-03 | Phase 5 | Pending |
| SHEL-01 | Phase 5 | Pending |
| SHEL-02 | Phase 5 | Pending |
| SHEL-03 | Phase 5 | Pending |
| SHEL-04 | Phase 5 | Pending |
| MOBL-01 | Phase 5 | Pending |
| MOBL-02 | Phase 5 | Pending |
| PLAT-03 | Phase 6 | Pending |
| PLAT-04 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 64 total
- Mapped to phases: 64
- Unmapped: 0

---
*Requirements defined: 2026-02-28*
*Last updated: 2026-02-28 after roadmap creation*
