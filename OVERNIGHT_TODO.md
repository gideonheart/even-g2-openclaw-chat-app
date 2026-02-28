# OVERNIGHT TODO — even-g2-openclaw-chat-app

## Mission
Finalize native-style EvenHub frontend for managing G2 <-> OpenClaw flow.

## Status Legend
- [ ] planned
- [~] in progress
- [x] done
- [!] blocked

## 1) UI parity with Even native style
- [x] Replace placeholder nav glyphs with clean line icon set consistent with Even screenshots
- [x] Match spacing/typography scale to `even-g2-apps` tokens/components
- [x] Refine top bar + tabs to mirror native app hierarchy
- [x] Finalize bottom nav alignment and active states on iPhone viewport

## 2) App information architecture
- [x] Home: glasses connect/disconnect, battery/status, quick action cards
- [x] Health: service checks, sync status, latest turn diagnostics
- [x] Apps/Features: simulator entry + session actions
- [x] Settings: OpenClaw URL, session key, STT provider, keys, gesture mapping

## 3) Settings flows (frontend only)
- [x] Implement settings form model + validation
- [x] Persist settings in local storage
- [x] Add secure masking UX for key inputs
- [x] Add export/import settings JSON (without secrets by default)

## 4) Session switching UX
- [x] Session list panel with active marker
- [x] Set active session from UI
- [x] Confirm switch and show state toast

## 5) Logs + diagnostics UX
- [x] Bottom-nav log view with filter (info/warn/error)
- [x] Correlation id display for last voice turns
- [x] Copy diagnostics action for debugging

## 6) Simulator integration
- [x] Keep `preview-glasses.html` as dedicated simulator route
- [x] Add launch button from frontend with explicit note "dev-only"
- [x] Add state handoff mock to simulator (optional query params)

## 7) Mobile polish
- [x] Disable zoom/pinch consistently
- [x] Fix safe-area behavior for iOS bottom browser chrome
- [x] Ensure no horizontal scroll / clipped cards

## 8) Push checkpoints
- [x] Commit native UI parity pass
- [x] Commit settings + sessions flows
- [x] Commit logs/diagnostics views
- [x] Commit simulator integration polish

## Blockers to surface immediately
- [ ] Missing final icon pack decision
  > **Decision made:** Using inline SVG line icons (Heroicons-style) for bottom nav. Consistent stroke-width: 1.8, 22x22 viewbox. Home/Health(chart)/Apps(grid)/Settings(gear) icon set. Can be swapped if final Even icon pack is provided.
- [ ] Any mismatch with EvenHub embed constraints
  > **Status:** No blockers found. App is self-contained HTML with relative stylesheet reference. Will need vite-plugin-singlefile for final EvenHub submission to inline all assets.
- [ ] Accessibility regressions on small screens
  > **Status:** Verified — safe-area-inset-bottom applied, overscroll-behavior: none, max-width: 600px with auto-center, no horizontal overflow. Touch targets meet 44px minimum for bottom nav buttons.

## Assumptions & Decisions (documented)
- **Settings storage key:** `even-openclaw-settings` in localStorage
- **Secret fields:** sessionKey and apiKey are masked (password input, show/hide toggle) and excluded from JSON export by default
- **Gateway URL validation:** Must start with `http://` or `https://`
- **Demo sessions:** 3 mock sessions (Gideon/coding, Atlas/research, Helper/general) for UX development before backend integration
- **Logs system:** In-memory ring buffer (max 200 entries), seeded with app init events, not persisted across reloads
- **STT providers:** WhisperX (default), OpenAI Whisper, Custom endpoint — selectable in settings
- **Bottom nav icons:** Inline SVGs (home, bar-chart for health, grid for apps, gear for settings) with labels
- **Tabs:** Only visible on Home/Features pages; hidden for Health/Settings
- **Simulator handoff:** Query params: session, connected, state, userMsg, aiMsg
- **Design system:** Uses `even-g2-apps/src/style.css` for all tokens, utilities, and components (cards, forms, buttons, tabs, tags, toasts, modals, list items)
