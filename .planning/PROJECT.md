# Even G2 OpenClaw Chat App

## What This Is

A public EvenHub frontend app for Even G2 smart glasses that provides voice/chat UX for interacting with an OpenClaw AI agent. Users speak through the glasses, audio is sent to a backend gateway (`openclaw-even-g2-voice-gateway`) for STT processing and OpenClaw agent responses, which stream back as bubble chat in a compact HUD rendered on the 576x288 glasses display. The app also includes a companion mobile/desktop hub for settings, diagnostics, and session management.

## Core Value

Users can have natural voice conversations with an AI assistant through their Even G2 glasses, seeing streaming responses as compact bubble chat on the glasses display.

## Requirements

### Validated

- Validated: Native Even-style frontend shell with bottom nav, settings, logs, simulator entry — existing
- Validated: Even G2 shared design tokens/components integration — existing
- Validated: Mobile zoom disabled and consistent SVG icon bottom nav — existing
- Validated: Simplified settings gear icon for bottom-nav — existing
- Validated: EvenHub frontend at root, simulator preview at /preview-glasses.html — existing

### Active

- [ ] Icon-first HUD with animated state icons (recording, sent, thinking)
- [ ] Bubble chat renderer (user right, assistant left)
- [ ] Scrollable virtualized history viewport (render only visible window)
- [ ] Streaming response renderer with incremental updates
- [ ] Gesture handling state machine (tap, double-tap, scroll up, scroll down)
- [ ] Audio capture and bridge event handling
- [ ] Settings form with validation (backend URL, STT provider, session key, gesture mapping)
- [ ] Settings persistence in localStorage with secure masking for keys
- [ ] Settings export/import JSON (without secrets by default)
- [ ] Session list panel with active marker and switch UX
- [ ] Home screen: glasses connect/disconnect, battery/status, quick action cards
- [ ] Health view: service checks, sync status, latest turn diagnostics
- [ ] Apps/Features view: simulator entry + session actions
- [ ] Logs view with filter (info/warn/error) and correlation ID display
- [ ] Copy diagnostics action for debugging
- [ ] Simulator launcher from frontend with "dev-only" note
- [ ] State handoff mock to simulator via query params
- [ ] Hide/Wake UI modes + menu
- [ ] Mobile polish: safe-area behavior, no horizontal scroll, no clipped cards
- [ ] Backend API client (no secrets in frontend)
- [ ] TypeScript strict mode throughout
- [ ] Test suite using Vitest

### Out of Scope

- OpenClaw secret handling — belongs in gateway repo, not public frontend
- STT provider credentials — belongs in gateway repo
- Direct OpenClaw privileged calls from browser — requires backend policy proxy
- Real-time video/camera features — not part of voice chat UX
- Multi-user/collaborative features — single-user glasses experience

## Context

The Even G2 are smart glasses with a compact 576x288 display. The EvenHub is Even's app marketplace. This app targets submission to EvenHub as a public app. It operates as a frontend-only application that communicates with a separate backend gateway repo (`openclaw-even-g2-voice-gateway`) for all sensitive operations.

Existing codebase already has:
- Native Even-style shell with bottom navigation
- Shared design tokens from `even-g2-apps`
- SVG icon set for bottom nav
- Settings gear icon in nav
- Simulator preview at `/preview-glasses.html`
- Mobile zoom disabled

The UI must operate with only 4 gestures on the glasses: tap, double-tap, scroll up, scroll down. All text rendering targets 150-300ms update cadence; icon animations at 3-6 fps. Max text per response display: 2000 chars. The target canvas is 576x288 pixels.

Development workflow: side-by-side repos with contract-first API development. Frontend points to configurable gateway URL.

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
| Separate frontend from gateway repo | Prevents secret leakage, cleaner OSS, independent release cycles | -- Pending |
| Frontend-only architecture | Public-safe EvenHub app, no privileged calls from browser | -- Pending |
| Contract-first API development | Enables parallel frontend/gateway development with shared types | -- Pending |
| Virtualized viewport rendering | 576x288 display can't show full chat history; render visible window only | -- Pending |
| 4-gesture input model | Hardware constraint of Even G2 glasses; must map all UX to tap/double-tap/scroll | -- Pending |

---
*Last updated: 2026-02-27 after initialization*
