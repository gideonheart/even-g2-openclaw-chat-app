# PRD — even-g2-openclaw-chat-app

## Purpose
Public Even Hub frontend app for Even G2 that provides voice/chat UX and connects to a backend gateway (`openclaw-even-g2-voice-gateway`) for STT + OpenClaw agent responses.

## Scope (Frontend-only)
- Even Hub web app UI (icon-first, animated state icons, bubble chat)
- Gesture handling: tap / double-tap / scroll up / scroll down
- Audio capture + bridge event handling
- Settings menu (backend URL, provider choice, session selection metadata)
- Streaming response renderer in chat viewport

## Explicit Non-Scope
- No OpenClaw secret handling in this repo
- No STT provider credentials in this repo
- No direct OpenClaw privileged calls from browser without backend policy

## Why separate from gateway repo
- Keeps hosted Even Hub app public-safe
- Prevents secret leakage risk
- Cleaner OSS adoption
- Independent release cycle for UI vs backend integrations

## UX requirements (G2)
- Icon-first HUD, minimal text chrome
- Recording blinking icon
- Sent icon after stop
- Thinking throbber while waiting OpenClaw
- Bubble chat:
  - right: user transcript
  - left: assistant response
- Scrollable virtualized history window
- Hide/Wake UI modes + menu

## Technical requirements
- TypeScript strict mode
- EvenRealities native UI approach (aligned with even-g2-apps patterns)
- SRP/DRY modules, no monolith files
- Test suite using Vitest (same direction as OpenClaw)

## Repo structure (proposed)
- `src/app/` — startup/bootstrapping
- `src/bridge/` — Even bridge integration
- `src/ui/` — screens/components
- `src/gestures/` — 4-input mapping state machine
- `src/chat/` — bubble model + viewport virtualization
- `src/icons/` — animation frame registry
- `src/api/` — backend client (no secrets)
- `src/settings/` — persisted app settings
- `src/types/` — shared frontend types
- `test/` — unit/integration tests

## How to develop both repos at the same time (recommended)
Do **not** merge into one monolith.

Use side-by-side repos:
- `/home/forge/even-g2-openclaw-chat-app`
- `/home/forge/openclaw-even-g2-voice-gateway`

Workflow:
1. Run frontend dev server in app repo
2. Run gateway service in gateway repo
3. Frontend points to local gateway URL in Settings
4. Contract-first development:
   - maintain `docs/api-contract.md` in both repos
   - add contract tests in frontend + gateway
5. Version coupling by tags:
   - frontend supports gateway API `v1`
   - breakages require version bump + migration notes

Optional (later): extract shared API types to tiny third package/repo for generated types.

## EvenHub submission artifacts
- Hosted `dist/index.html` URL
- App name, icon, short description
- Required permissions note (audio/events)
- GitHub repo link
- Support/troubleshooting URL

## Milestones
1. M1: UI shell + gestures + status icons
2. M2: streaming bubble renderer + history virtualization
3. M3: settings/menu + session switching UI
4. M4: integration hardening + tests + submission package

