# Even G2 OpenClaw Chat App

## What This Is

A public EvenHub frontend app for Even G2 smart glasses that provides voice/chat UX for interacting with an OpenClaw AI agent. Users speak through the glasses, audio is sent to a backend gateway (`openclaw-even-g2-voice-gateway`) for STT processing and OpenClaw agent responses, which stream back as bubble chat in a compact HUD rendered on the 576x288 glasses display. The app includes a companion mobile/desktop hub for settings, diagnostics, and session management. v1.0 shipped core libraries (gesture FSM, bridge wrapper, display pipeline, gateway client) and the complete companion hub UI.

## Current Milestone: v1.1 Integration

**Goal:** Wire all v1.0 library modules together into a working end-to-end voice loop and package for EvenHub submission.

**Target features:**
- End-to-end voice loop (tap → record → gateway → stream → glasses display)
- Runtime main.ts initialization wiring all modules
- EvenHub submission package (self-contained dist/index.html)
- App metadata for EvenHub listing
- Tech debt cleanup (audio frame subscription, orphaned event types)

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

### Active

- [ ] End-to-end voice loop: tap → record → gateway → stream → glasses display
- [ ] Runtime main.ts initialization wiring all modules together
- [ ] EvenHub submission package (self-contained dist/index.html via vite-plugin-singlefile)
- [ ] App metadata for EvenHub listing (name, icon, description, permissions)
- [ ] bridge:audio-frame → audioCapture.onFrame() bus subscription (glasses-mode PCM)
- [ ] Remove orphaned event types from AppEventMap (display:state-change/viewport-update/hide/wake)

### Out of Scope

- OpenClaw secret handling — belongs in gateway repo, not public frontend
- STT provider credentials — belongs in gateway repo
- Direct OpenClaw privileged calls from browser — requires backend policy proxy
- Real-time video/camera features — Even G2 has no camera by design (privacy-first)
- Multi-user/collaborative features — single-user glasses experience
- Custom fonts/themes on glasses — G2 has one fixed font, 4-bit greyscale
- Full conversation transcript export — privacy concern; gateway should own this
- Offline mode — real-time voice loop is core value

## Context

Shipped v1.0 MVP with 5,484 LOC TypeScript across 38 files, 240 passing tests.
Tech stack: Vite, TypeScript strict mode, Vitest, @evenrealities/even_hub_sdk, eventsource-parser.

Architecture: Pure-function core modules (gesture-fsm.ts, viewport.ts, icon-animator.ts) with zero SDK imports. Side effects confined to bridge boundary (even-bridge.ts). Event bus connects all modules. Factory pattern for services (GlassesRenderer, GestureHandler, DisplayController).

All modules are tested library components. Runtime assembly (main.ts entry point wiring) is Phase 6 scope. Companion hub is vanilla JS/HTML with progressive TypeScript migration.

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
| Pure-function core modules | Gesture FSM, viewport, icon animator have zero SDK imports | ✓ Good — fully testable, 240 tests |
| Unicode text icons over 4-bit greyscale | Eliminates pixel packing ambiguity for v1 | ✓ Good — simpler, works well |
| 275ms tap debounce (tap only) | Prevents double-tap false positives without blocking legitimate gestures | ✓ Good |
| Record-based FSM transition table | Cleaner than switch/case, self-documenting, extensible | ✓ Good |
| 200ms streaming flush cadence | Batches token-level updates into readable chunks | ✓ Good |
| 3-container text layout (status/chat/hint) | Separates concerns on glasses display | ✓ Good |
| SDK class wrapping only in even-bridge.ts | All other modules use plain objects + event bus | ✓ Good — clean boundary |

---
*Last updated: 2026-02-28 after v1.1 milestone start*
