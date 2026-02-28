# Phase 6: Runtime Wiring - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire all v1.0 library modules (event bus, gesture FSM, gesture handler, audio capture, gateway client, display controller, glasses renderer) into a working end-to-end voice loop via main.ts assembly. Detect Even App WebView vs browser and boot the correct code path. Remove orphaned event types from AppEventMap. Users complete a full voice turn: tap → record → send → see streaming AI response as bubble chat on the glasses display.

</domain>

<decisions>
## Implementation Decisions

### Browser Dev Mode
- Keyboard shortcut triggers voice turns in browser (no on-screen button)
- Toggle mode (press once = start recording, press again = stop) — mirrors the actual glasses tap-tap gesture from the FSM
- Default to real browser microphone (MediaRecorder API) for end-to-end testing with actual speech
- URL parameter or setting toggles mock audio frames for CI/automated testing without mic
- Glasses display renders in the existing separate simulator window (preview-glasses.html), not inline in the browser page

### Boot & Readiness Flow
- Brief boot indicator (~1 second) while modules initialize — subtle icon animation or "connecting…" text on glasses display
- If gateway URL is not configured: block with persistent message "Open companion app to configure" — do NOT allow voice turns until configured
- Ping gateway health endpoint at boot before showing "ready" state
- If health check fails: auto-retry in background (every few seconds) — transition to "ready" automatically when gateway comes online
- No manual retry needed — the heartbeat system handles reconnection

### Idle Display State
- **No hint bar on the glasses display** — hints take too much space on the G2's 640×400 viewport; hints belong in the side menu or companion hub
- Show "Tap to ask" welcome message after boot completes (first time only, before the first voice turn)
- After the first voice turn: idle state shows the last conversation (chat bubbles remain visible, scrollable)
- Welcome message never reappears once the first turn has been completed

### Turn Lifecycle
- Continuous chat — new turns append below previous exchange, building a scrollable conversation history
- Keep only the last N turns in the display buffer to manage memory on the glasses (Claude decides the specific limit based on G2 constraints)
- Auto-scroll follows streaming text by default
- If user manually scrolls up during streaming, auto-scroll pauses until the turn ends
- Brief visual settle (~500ms) after AI response finishes before accepting the next tap — prevents accidental double-triggers

### Claude's Discretion
- Specific keyboard shortcut key for dev mode tap simulation (spacebar is a natural choice)
- Exact number of turns to keep in the display buffer (e.g. 5-10)
- Boot indicator visual style (icon animation vs text)
- Auto-retry interval for gateway health check (should align with existing heartbeat system)
- How the ~500ms settle period is implemented (FSM guard vs display debounce)

</decisions>

<specifics>
## Specific Ideas

- Welcome message should be functional in tone: "Tap to ask" — not warm/playful
- Dev mode keyboard should feel like the actual glasses tap gesture — toggle on/off, not hold-to-talk
- The glasses display is about the chat conversation, not UI chrome — remove hint bar, keep it minimal
- Hints and help text belong in the companion hub or side menu, not on the glasses viewport

</specifics>

<deferred>
## Deferred Ideas

- Hints in side menu option — could be added as a companion hub feature or glasses menu item in a future phase
- Conversation history persistence across app restarts — current scope is in-memory only for this session

</deferred>

---

*Phase: 06-runtime-wiring*
*Context gathered: 2026-02-28*
