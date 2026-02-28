# Phase 8: EvenHub Submission - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Package the app as a valid EvenHub submission with correct metadata (app.json), a self-contained production build excluding dev-only files, and a working .ehpk artifact produced by an npm script. The simulator (preview-glasses.html) remains available in development but is excluded from the production output.

</domain>

<decisions>
## Implementation Decisions

### Package identity
- package_id: `lv.kingdom.bibele.openclaw-chat`
- Display name: `OpenClaw Chat`
- Tagline: `Voice chat with OpenClaw AI on Even G2`
- Description: `EvenHub companion app for Even G2 that provides voice/chat UX and connects to an OpenClaw backend gateway for STT + AI responses.`
- Author: `bibele.kingdom.lv`
- Entrypoint: `index.html`

### Permission scope
- Network: wildcard `*` — the app connects to a user-configured gateway URL, so any domain must be reachable
- Microphone: declared explicitly — the app captures audio for voice input
- No filesystem permission needed — all assets are bundled in dist/
- Do NOT list individual domains alongside wildcard — wildcard alone is sufficient

### Artifact & versioning
- Output artifact: `openclaw-chat.ehpk`
- Version: synced with package.json (currently `0.1.0`) — single source of truth
- Include `edition` field: `202602` (current month)
- Include `min_app_version`: `0.1.0`
- Pack script: npm script that runs `evenhub pack` to produce the .ehpk

### Claude's Discretion
- Production build configuration details (Vite rollup input separation for dev vs prod)
- How simulator exclusion is implemented technically (conditional build inputs, separate config, etc.)
- evenhub-cli devDependency version choice
- Exact pack script command syntax and flags

</decisions>

<specifics>
## Specific Ideas

- app.json description should match the PRD purpose statement closely
- Follow the patterns established by sample apps (rdt, weather, restapi) for app.json structure — use the fuller format with edition, min_app_version, tagline fields
- Pack script convention from samples: `npm run build && evenhub pack app.json dist -o openclaw-chat.ehpk`

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 08-evenhub-submission*
*Context gathered: 2026-02-28*
