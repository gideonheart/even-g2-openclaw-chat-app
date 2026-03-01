# Even G2 OpenClaw Chat App

## What This Is

A public EvenHub app for Even G2 smart glasses that provides voice/chat UX for interacting with an OpenClaw AI agent. Users speak through the glasses, audio is sent to a backend gateway (`openclaw-even-g2-voice-gateway`) for STT processing and OpenClaw agent responses, which stream back as bubble chat in a compact HUD rendered on the 576x288 glasses display. The companion hub provides live conversation view, text input, session management, conversation history browsing with full-text search, and a glasses command menu for hands-free session control. Conversations persist in IndexedDB with real-time two-way sync between glasses and hub via BroadcastChannel. The app includes comprehensive resilience: boot-time integrity checking, write verification, sync heartbeat with drift reconciliation, FSM watchdog, and visible error recovery on both glasses and hub.

## Core Value

Users can have natural voice conversations with an AI assistant through their Even G2 glasses, seeing streaming responses as compact bubble chat on the glasses display.

## Requirements

### Validated

- ✓ TypeScript strict mode infrastructure with Vite + Vitest — v1.0
- ✓ Settings store with validation, secret partitioning, localStorage persistence, export/import — v1.0
- ✓ EvenBridge SDK wrapper with lifecycle management and typed event bus — v1.0
- ✓ Dev-mode mock bridge with keyboard shortcuts for testing without glasses — v1.0
- ✓ Dual-mode audio capture (glasses PCM frames + browser MediaRecorder fallback) — v1.0
- ✓ Pure-function gesture FSM (5 states × 4 inputs) with transition table — v1.0
- ✓ Gesture handler with 275ms tap debounce, action dispatch, and hint bar text — v1.0
- ✓ Icon-first HUD with animated state icons (idle, recording, sent, thinking) at 3-6 fps — v1.0
- ✓ Bubble chat renderer (user right-aligned, assistant left-aligned) — v1.0
- ✓ Virtualized viewport with 1800-char SDK limit windowing — v1.0
- ✓ Streaming response renderer with 200ms batched update cadence — v1.0
- ✓ GlassesRenderer service with 3-container text layout, scroll, hide/wake — v1.0
- ✓ Display controller event wiring (bus → renderer → bridge SDK) — v1.0
- ✓ Gateway API client with SSE streaming via eventsource-parser — v1.0
- ✓ Connection health monitoring with heartbeat detection — v1.0
- ✓ Auto-reconnect after connectivity loss — v1.0
- ✓ Companion hub: home, health, logs, sessions, settings pages — v1.0
- ✓ Simulator at /preview-glasses.html with hub launcher — v1.0
- ✓ Native Even-style shell with bottom nav, SVG icons, active states — v1.0
- ✓ Mobile polish: safe-area insets, no horizontal scroll, no clipped cards — v1.0
- ✓ End-to-end voice loop: tap → record → gateway → stream → glasses display — v1.1
- ✓ Runtime main.ts initialization wiring all modules together — v1.1
- ✓ EvenHub submission package (self-contained dist via Vite build) — v1.1
- ✓ App metadata for EvenHub listing (name, icon, description, permissions) — v1.1
- ✓ bridge:audio-frame → audioCapture.onFrame() bus subscription (glasses-mode PCM) — v1.1
- ✓ Remove orphaned event types from AppEventMap — v1.1
- ✓ FSM reset on gateway errors with immediate retry capability — v1.1
- ✓ 30-second gateway timeout with user-visible feedback — v1.1
- ✓ Graceful shutdown (gateway.destroy, audio cleanup) on unload — v1.1
- ✓ CLICK_EVENT SDK quirk handled for real glasses hardware — v1.1

- ✓ IndexedDB conversation persistence with auto-save and boot recovery — v1.2
- ✓ Event bus bridge (BroadcastChannel + localStorage fallback) for real-time hub ↔ glasses sync — v1.2
- ✓ Dynamic sessions: create, rename, delete with cascade delete of messages — v1.2
- ✓ Glasses command menu via double-tap (/new, /reset, /switch, /rename, /delete) with confirmation — v1.2
- ✓ Hub live view of glasses conversation with streaming indicator — v1.2
- ✓ Hub text input with gateway sendTextTurn and streaming response — v1.2
- ✓ Conversation history browsing with transcript viewer and delete — v1.2
- ✓ Full-text search across conversation history with highlighted snippets — v1.2

- ✓ Boot-time integrity check with orphan detection, sentinel verification, dangling pointer fix — v1.3
- ✓ Storage health monitoring with quota estimation and persistent storage request — v1.3
- ✓ Eviction detection via sentinel record with storage:evicted event — v1.3
- ✓ Orphan cleanup with 30-second grace period and cross-context coordination — v1.3
- ✓ IDB onclose handler with reopenDB() retry and module recreation — v1.3
- ✓ Write verification for first message per session with re-verify after warnings — v1.3
- ✓ Auto-save error escalation to persistence:error after retry exhaustion — v1.3
- ✓ Partial response preservation with "[response interrupted]" suffix — v1.3
- ✓ Sync sequence numbering with gap detection on heartbeat messages — v1.3
- ✓ Sync heartbeat every 10s with 30s peer disconnection detection — v1.3
- ✓ Drift reconciliation via IDB re-read with 2-consecutive-mismatch rule — v1.3
- ✓ IDB-as-truth sync design (BroadcastChannel optional, IDB authoritative) — v1.3
- ✓ FSM 45-second watchdog timer with auto-reset to idle — v1.3
- ✓ Gateway error classification: connection vs mid-stream, no auto-retry of mid-stream — v1.3
- ✓ Glasses 3-tier error display: transient 3s, recoverable 10s, fatal full-screen — v1.3
- ✓ Hub toasts (5s auto-clear) and persistent banners with dismiss for errors — v1.3
- ✓ Hub health page: 5 status dots (Gateway, STT, Session, Storage, Sync) — v1.3
- ✓ Glasses health policy: no persistent indicators, user-friendly language, auto-clear — v1.3
- ✓ New AppEventMap events: persistence:error, sync:drift-detected, sync:reconciled, fsm:watchdog-reset — v1.3
- ✓ Failure simulation test helpers: createFailingStore, createLossySyncBridge, createDelayedStore — v1.3
- ✓ Zero new runtime dependencies — all resilience features use browser built-in APIs — v1.3

### Active

(None yet — define requirements for next milestone with `/gsd:new-milestone`)

### Out of Scope

- OpenClaw secret handling — belongs in gateway repo, not public frontend
- STT provider credentials — belongs in gateway repo
- Direct OpenClaw privileged calls from browser — requires backend policy proxy
- Real-time video/camera features — Even G2 has no camera by design (privacy-first)
- Multi-user/collaborative features — single-user glasses experience
- Custom fonts/themes on glasses — G2 has one fixed font, 4-bit greyscale
- Full conversation transcript export — privacy concern; gateway should own this
- Offline mode — real-time voice loop is core value
- Configurable gesture mapping — default mapping sufficient; adds settings complexity
- R1 ring input integration — separate accessory with own SDK; defer until ring adoption grows
- Multi-language UI — EvenHub is early-access, English-first audience

## Context

Shipped v1.3 Resilience & Error UX with 14,436 LOC TypeScript across 78 files, 498 passing tests (35 suites).
Tech stack: Vite, TypeScript strict mode, Vitest, @evenrealities/even_hub_sdk, eventsource-parser, @evenrealities/evenhub-cli, fake-indexeddb (dev). Zero new runtime dependencies added in v1.3.

Architecture: Pure-function core modules (gesture-fsm.ts, viewport.ts, icon-animator.ts, command-menu.ts) with zero SDK imports. Side effects confined to bridge boundary (even-bridge.ts). Event bus + SyncBridge connects all modules across contexts. Factory pattern for services. Environment router (main.ts) detects Even App WebView vs browser and routes to glasses-main.ts or hub-main.ts. Layer 0-5 initialization sequence in glasses-main.ts ensures correct dependency order. IndexedDB persistence layer with ConversationStore and SessionStore. BroadcastChannel sync with localStorage fallback for cross-context messaging. Resilience layer: IntegrityChecker + StorageHealth at boot, SyncMonitor + DriftReconciler for cross-context consistency, ErrorPresenter for user-facing error display, FSM watchdog for stuck state recovery.

App is packaged as .ehpk artifact via `npm run pack` and ready for EvenHub portal submission.

Four milestones shipped (v1.0 MVP → v1.1 Integration → v1.2 Conversation Intelligence → v1.3 Resilience & Error UX) across 21 phases (incl. 16.5, 18.5), 46 plans, in ~13.2 hours total execution time.

Known tech debt from v1.3: Hub quota-exceeded toast never fires (emission gap), hub watchdog toast unreachable (glasses-only event, no bridge relay), boot-time eviction error fires before presenter registration. All low severity.

## Constraints

- **Display**: 576x288 pixel canvas on Even G2 glasses — forces icon-first, compact bubble text design
- **Input**: Only 4 gestures available (tap, double-tap, scroll up, scroll down) — all interactions must map to these
- **Performance**: 150-300ms text update cadence, 3-6 fps icon animations — no heavy repaints
- **Security**: No secrets in frontend repo — all credentials handled by backend gateway
- **Tech Stack**: TypeScript strict mode, Vitest, EvenRealities native UI patterns, SRP/DRY modules
- **Rendering**: Virtualized viewport — keep full chat in memory, render only visible window on glasses
- **Submission**: Must produce EvenHub-compatible dist/index.html with app metadata

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Separate frontend from gateway repo | Prevents secret leakage, cleaner OSS, independent release cycles | ✓ Good |
| Frontend-only architecture | Public-safe EvenHub app, no privileged calls from browser | ✓ Good |
| Contract-first API development | Enables parallel frontend/gateway development with shared types | ✓ Good |
| Virtualized viewport rendering | 576x288 display can't show full chat history; render visible window only | ✓ Good — 1800-char limit with 200-char buffer |
| 4-gesture input model | Hardware constraint of Even G2 glasses; must map all UX to tap/double-tap/scroll | ✓ Good — FSM cleanly handles all states |
| Pure-function core modules | Gesture FSM, viewport, icon animator have zero SDK imports | ✓ Good — fully testable, 265 tests |
| Unicode text icons over 4-bit greyscale | Eliminates pixel packing ambiguity for v1 | ✓ Good — simpler, works well |
| 275ms tap debounce (tap only) | Prevents double-tap false positives without blocking legitimate gestures | ✓ Good |
| Record-based FSM transition table | Cleaner than switch/case, self-documenting, extensible | ✓ Good |
| 200ms streaming flush cadence | Batches token-level updates into readable chunks | ✓ Good |
| 3-container text layout (status/chat/hint) | Separates concerns on glasses display | ✓ Good |
| SDK class wrapping only in even-bridge.ts | All other modules use plain objects + event bus | ✓ Good — clean boundary |
| Environment router pattern | Thin main.ts with dynamic imports based on runtime detection | ✓ Good — v1.1 |
| Layer 0-5 init sequence | Strict dependency order ensures modules ready before subscribers | ✓ Good — v1.1 |
| Settings getter pattern | Pass () => settings instead of reference for current values at call time | ✓ Good — v1.1 |
| setTimeout + abort for timeout | AbortSignal.any() not available in Node test environment | ✓ Good — broader compat — v1.1 |
| Error bubbles as assistant role | Avoids ChatMessage type changes, consistent rendering | ✓ Good — v1.1 |
| Cleanup only in glasses mode | Browser devMode tab switching fires visibilitychange incorrectly | ✓ Good — v1.1 |
| package_id without hyphens | evenhub-cli regex rejects hyphens in package_id | ✓ Good — v1.1 |
| edition '202601' | evenhub-cli Zod enum only accepts '202601' | ✓ Good — v1.1 |
| BroadcastChannel + localStorage fallback | Feature-detect BC, fall back to set+remove pattern for sync | ✓ Good — v1.2 |
| Cascade delete via raw IDB cursor | Atomically deletes session + all messages in single transaction | ✓ Good — v1.2 |
| FSM MENU_SELECT action | Tap in menu stays in menu state; controller decides close timing | ✓ Good — v1.2 |
| Shared streamSSEResponse helper | DRY SSE parsing between sendVoiceTurn and sendTextTurn | ✓ Good — v1.2 |
| textContent for message rendering | Prevents XSS without escHtml utility for live conversation | ✓ Good — v1.2 |
| IDB cursor-based full-text search | searchMessages scans all messages with limit + snippet extraction | ✓ Good — v1.2 |
| reopenDB with Promise chain | Stay safe outside IDB transactions; 3 retries with 1s cooldown | ✓ Good — v1.3 |
| Sentinel filtering in queries only | Filter __sentinel__ in list/search/count but allow direct getConversation lookup | ✓ Good — v1.3 |
| Orphan grace period with cross-context keys | 30s delay + localStorage shared keys for glasses/hub cooperation | ✓ Good — v1.3 |
| verifyMessage never rejects | Resolves false on any IDB error; verification failure is data, not exception | ✓ Good — v1.3 |
| Dual-emit on retry exhaustion | persistence:warning for soft handler + persistence:error for error presenter | ✓ Good — v1.3 |
| DriftReconciler callback pattern | Bus-agnostic via callback for portability across glasses and hub contexts | ✓ Good — v1.3 |
| 2-consecutive-mismatch rule | Prevents false positive drift during active streaming | ✓ Good — v1.3 |
| IDB-as-truth sync design | BroadcastChannel is "hurry up" notification; IDB is authority | ✓ Good — v1.3 |
| Watchdog external to pure FSM | Timer logic in gesture-handler.ts, not pure gesture-fsm.ts | ✓ Good — v1.3 |
| receivedAnyData flag for error classification | Distinguishes connection vs mid-stream failures; no auto-retry of mid-stream | ✓ Good — v1.3 |
| 3-tier auto-clear on glasses | 3s transient / 10s recoverable / 5s watchdog; icon animator paused during errors | ✓ Good — v1.3 |
| hubBus for hub error wiring | Module-level event bus in hub for error presenter subscription | ✓ Good — v1.3 |
| Recreate all 5 IDB modules after reopenDB | Full recreation (store, session, autoSave, drift, sync) for clean state | ✓ Good — v1.3 |
| cachedQuota for sync health display | Module-level cached quota so refreshHealthDisplay stays synchronous | ✓ Good — v1.3 |

---
*Last updated: 2026-03-01 after v1.3 milestone*
