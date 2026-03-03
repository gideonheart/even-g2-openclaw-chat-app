# ARCHITECTURE — Even G2 Frontend + Gateway Contract

## System Pair

This project is the **frontend half** of a two-repo system:

- Frontend (this repo): `even-g2-openclaw-chat-app`
- Backend: `openclaw-even-g2-voice-gateway`

## Responsibilities

### Frontend (this repo)

Runs in Even App WebView and owns:

- Hub UI (text/settings/sessions/history)
- Glasses runtime UX (gestures, mic capture, display updates)
- Sending text/audio turns to gateway
- Rendering streamed responses and maintaining local conversation/session state

### Gateway (backend repo)

Owns:

- STT provider integration
- OpenClaw agent orchestration
- Streaming response output (SSE/chunked)
- Server-side integrations and secret handling

## End-to-End Flow

1. User interacts in Hub UI and/or through glasses gestures + mic.
2. Frontend submits turn (text/audio) to gateway.
3. Gateway runs STT (if audio) and OpenClaw agent orchestration.
4. Gateway streams response chunks back.
5. Frontend renders live output on glasses runtime and updates Hub conversation/session state.

## Trust + Security Boundary

- **No secrets in frontend.**
- Frontend is public-safe and should not contain privileged keys.
- Credentials, provider keys, and privileged integrations remain in gateway.

## Canonical Paths (local)

- Frontend: `/home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app`
- Gateway: `/home/forge/openclaw-even-g2-voice-gateway`

## API/Contract Notes

- Frontend should treat gateway as the source of backend behavior.
- Contract changes must be versioned and coordinated across both repos.
- Prefer additive changes; document breaking changes explicitly.
