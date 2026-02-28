# Even G2 OpenClaw Chat App

## What This Is

A public EvenHub app for Even G2 smart glasses that provides voice/chat UX for interacting with an OpenClaw AI agent. Users speak through the glasses, audio is sent to a backend gateway (`openclaw-even-g2-voice-gateway`) for STT processing and OpenClaw agent responses, which stream back as bubble chat in a compact HUD rendered on the 576x288 glasses display. The companion hub provides live conversation view, text input, session management, conversation history browsing with full-text search, and a glasses command menu for hands-free session control. Conversations persist in IndexedDB with real-time two-way sync between glasses and hub via BroadcastChannel.

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

### Active

## Current Milestone: v1.3 Resilience & Error UX

**Goal:** Make the app bulletproof — no silent data loss, no stale state, visible error recovery — across all failure modes and real hardware.

**Target features:**
- IndexedDB write verification, orphan detection/cleanup, referential integrity checks on boot
- Cross-context sync hardening: message loss detection, drift reconciliation, fallback behaviors
- Real-hardware gap closure: BroadcastChannel in flutter_inappwebview, IndexedDB eviction, SDK quirks
- Error resilience: mid-stream gateway failures, stuck FSM states, network drops, corrupted state recovery
- Error UX: visible error states, recovery prompts, sync/storage health indicators
- Test coverage: integration tests for failure scenarios, E2E resilience tests, CI pipeline

#### Data Integrity (ARCHITECTURE.md IntegrityChecker + StorageHealth + PITFALLS P1/P2/P4/P9)

- [ ] **RES-01:** Boot-time integrity check -- scan for orphaned messages (conversationId with no matching conversation) and dangling session pointer (localStorage active ID pointing to deleted conversation). Single read-only IDB transaction. Under 50ms, under 50 lines of code. Do NOT do per-write verification (Pitfall P1). Do NOT auto-delete orphans (Pitfall P2) -- use grace period.
- [ ] **RES-02:** Storage health monitoring -- call navigator.storage.estimate() on boot, emit quota info via event bus. Warn at 80% usage, critical at 95%. Feature-detect with 'storage' in navigator.
- [ ] **RES-03:** Persistent storage request -- call navigator.storage.persist() on first boot. Log whether granted. If denied, show non-dismissible warning on hub health page.
- [ ] **RES-04:** Eviction detection via sentinel record -- write sentinel to IDB on first run. On subsequent boots, if IDB opens but sentinel missing, data was evicted. Emit storage:evicted event. Do NOT show first-run experience when data was evicted (Pitfall P4).
- [ ] **RES-05:** Orphan cleanup with grace period -- mark suspected orphans with timestamp. Only delete after 30-second grace period. Verify orphan status a second time before deletion. Surface orphan counts in hub diagnostics. One integrity check per boot maximum (Pitfall P2).
- [ ] **RES-15:** IDB database onclose handler -- hook IDBDatabase.onclose to detect unexpected closure (eviction, manual clear). Emit persistence:error with type database-closed. Attempt reopenDB().

#### Write & Save Hardening (ARCHITECTURE.md AutoSave + ConversationStore + PITFALLS P1)

- [ ] **RES-06:** Write verification for first message only -- after first successful addMessage() in a session, read back via separate readonly transaction to confirm storage is working. Skip verification for subsequent messages in same session. Re-verify after any persistence:warning event.
- [ ] **RES-07:** Error escalation in auto-save -- after all retries exhausted, emit persistence:error (not just persistence:warning). Include error type, conversationId, recoverable flag.
- [ ] **RES-08:** Partial response preservation -- on mid-stream SSE failure, save partial assistant text with "[response interrupted]" suffix rather than discarding. Clear pendingAssistantText after save.

#### Sync Hardening (ARCHITECTURE.md SyncMonitor + DriftReconciler + PITFALLS P3/P6)

- [ ] **RES-09:** Sync sequence numbering -- add optional seq field to SyncMessage. Each context maintains monotonic counter. Detect gaps in received sequence numbers.
- [ ] **RES-10:** Sync heartbeat -- send sync:heartbeat message every 10 seconds with active conversation message count. Detect peer disconnection after 30 seconds of silence.
- [ ] **RES-11:** Drift reconciliation via IDB re-read -- when heartbeat reveals message count mismatch, re-read from IndexedDB (single source of truth) and re-render. Do NOT build complex sync protocol. IDB is shared, re-reading is cheapest reconciliation (Pitfall P3/P6).
- [ ] **RES-12:** IDB-as-truth sync design -- all sync hardening must work without BroadcastChannel. BC is optional "hurry up" notification. IDB is the authority. Design for poll-with-event-trigger pattern (Pitfall P3).

#### FSM & Gateway Resilience (ARCHITECTURE.md + PITFALLS P7/P8)

- [ ] **RES-13:** FSM watchdog timer -- 45-second timeout for any transient state (recording, sent, thinking). Auto-reset to idle if no transition fires. Emit fsm:watchdog-reset event.
- [ ] **RES-14:** Gateway error classification -- distinguish connection errors (safe to auto-retry) from mid-stream errors (show partial response, prompt user). Add receivedAnyData flag in streamSSEResponse. Do NOT auto-retry mid-stream failures (Pitfall P7).

#### Error UX (ARCHITECTURE.md ErrorPresenter + HealthIndicator + PITFALLS P5/P10)

- [ ] **RES-16:** Glasses error display hierarchy -- transient errors in status bar only (container 0), auto-clear 3 seconds. Recoverable errors in status + hint bar, auto-clear 10 seconds, "tap to retry." Fatal errors full-screen but with "double-tap for menu" escape. Never occupy chat container (container 1) for more than 5 seconds (Pitfall P5).
- [ ] **RES-17:** Hub error display -- toasts for transient errors (auto-clear 5s), persistent banners for ongoing issues with action buttons. Error banner component with severity, message, optional recovery action, optional dismiss.
- [ ] **RES-18:** Hub health page enhancement -- add storage quota indicator (usage/quota/percent), sync status (last heartbeat, sequence gaps), overall health level (ok/degraded/error). Use existing status-dot CSS pattern.
- [ ] **RES-19:** Glasses health policy -- no persistent health indicators on glasses. Only show errors when actionable or temporary. No technical jargon on glasses ("Storage full" not "QuotaExceededError"). Every glasses error has auto-clear or existing gesture dismiss (Pitfall P10).

#### Event System (ARCHITECTURE.md AppEventMap)

- [ ] **RES-20:** New AppEventMap events -- add persistence:error, sync:drift-detected, sync:reconciled, health:status-change, fsm:watchdog-reset event types to src/types.ts. All additive (no breaking changes).

#### Test Infrastructure (STACK.md test helpers)

- [ ] **RES-21:** Failure simulation test helpers -- createFailingStore (fails after N writes), createLossySyncBridge (drops every Nth message). Uses existing fake-indexeddb forceCloseDatabase() for IDB closure simulation. No new dev dependencies.

#### Stack Constraints (STACK.md)

- [ ] **RES-22:** Zero new runtime dependencies -- all features use browser built-in APIs (Storage API, IDB durability, IDBDatabase.onclose). Zero bundle impact.

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

Shipped v1.2 Conversation Intelligence with ~10,300 LOC TypeScript across 60 files, 372 passing tests (25 suites).
Tech stack: Vite, TypeScript strict mode, Vitest, @evenrealities/even_hub_sdk, eventsource-parser, @evenrealities/evenhub-cli, fake-indexeddb (dev).

v1.3 research completed: 3 streams (ARCHITECTURE.md, STACK.md, PITFALLS.md) with HIGH confidence findings. Zero new runtime dependencies needed -- all resilience features use browser built-in APIs (Storage API, IDB durability, IDBDatabase.onclose) and existing project patterns.

Architecture: Pure-function core modules (gesture-fsm.ts, viewport.ts, icon-animator.ts, command-menu.ts) with zero SDK imports. Side effects confined to bridge boundary (even-bridge.ts). Event bus + SyncBridge connects all modules across contexts. Factory pattern for services. Environment router (main.ts) detects Even App WebView vs browser and routes to glasses-main.ts or hub-main.ts. Layer 0-5 initialization sequence in glasses-main.ts ensures correct dependency order. IndexedDB persistence layer with ConversationStore and SessionStore. BroadcastChannel sync with localStorage fallback for cross-context messaging.

App is packaged as .ehpk artifact via `npm run pack` and ready for EvenHub portal submission.

Three milestones shipped (v1.0 MVP → v1.1 Integration → v1.2 Conversation Intelligence) across 13 phases, 28 plans, in ~4.8 hours total execution time.

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

---
*Last updated: 2026-02-28 after v1.3 milestone started*
