# Project Research Summary

**Project:** Even G2 OpenClaw Chat App
**Domain:** Smart glasses voice/chat companion frontend (Even G2 + OpenClaw AI agent)
**Researched:** 2026-02-27
**Confidence:** MEDIUM-HIGH

## Executive Summary

This project is a dual-surface web application: a mobile companion hub UI (standard web page) and a glasses HUD renderer (Even G2 display via SDK container model over BLE), both shipped as a single EvenHub submission package. Experts building for the Even G2 treat the two rendering targets as completely separate concerns within one codebase — the companion hub is a normal responsive web page while the glasses display is driven entirely through SDK calls (not DOM manipulation), using a container model limited to 4 absolute-positioned regions on a 576x288 green monochrome canvas. The recommended approach is vanilla TypeScript with Vite 7, mirroring the sibling `even-g2-apps` repo, with zero UI framework overhead. All credentialed backend calls proxy through the `openclaw-even-g2-voice-gateway` — the frontend never holds real API secrets.

The core value proposition is enabling voice conversations with OpenClaw AI agents through Even G2 glasses, with multi-agent session switching as the key differentiator over Even's built-in single assistant. The recommended build order follows a strict dependency chain: foundation types and settings first, then the EvenBridge SDK wrapper (the hardware gateway that blocks everything glasses-related), then parallel development of gesture FSM, audio capture, and glasses renderer, then data layer (ChatStore + GatewayClient with SSE streaming), then orchestration (StreamThrottle wiring streaming to display), then companion hub UI. This ordering is non-negotiable because the EvenBridge must be initialized and stable before any glasses interaction can be tested.

The primary risks are: (1) per-token BLE display updates that overwhelm the BLE pipe and cause seconds-of-lag — must batch at 150-300ms cadence from day one; (2) the gesture FSM missing tap/double-tap debounce, causing accidental recording triggers; (3) the LC3 audio codec not being browser-native, requiring an architecture decision (gateway decodes, not frontend); and (4) display resolution ambiguity (576x136 vs 576x288 vs 640x350 found in research) that must be verified on real hardware early. EvenHub is early-access with an immature SDK (v0.0.x), so expect breaking changes — keep the bridge integration layer thin and isolated.

## Key Findings

### Recommended Stack

The stack is fully locked in with HIGH confidence, validated against the sibling `even-g2-apps` repo and official Even Realities packages. No UI framework is appropriate — the glasses display is not DOM-based and the companion hub is a thin settings/diagnostics surface. The most critical non-obvious decision is using `eventsource-parser` for SSE (not native `EventSource`, which cannot set custom auth headers) and `vite-plugin-singlefile` to produce the self-contained `dist/index.html` that EvenHub submission requires. Full details in `.planning/research/STACK.md`.

**Core technologies:**
- `@evenrealities/even_hub_sdk@^0.0.6`: Only way to communicate with G2 glasses — provides bridge init, container model, event callbacks, audio control
- `Vite 7 + vite-plugin-singlefile@^2.3.0`: Build tool already used in sibling repo; singlefile plugin produces the required self-contained HTML for EvenHub submission
- `TypeScript ~5.9.3` (strict mode): Type safety without TS 6.0 beta instability; stay aligned with sibling repo
- `eventsource-parser@^3.0.6`: SSE stream parsing for LLM responses; native EventSource cannot set auth headers
- `Vitest@^4.0.18`: Project-required test framework, reuses Vite config, native ESM/TS
- Custom TypeScript FSM (no library): 4 inputs / 6 states is too simple to justify XState's 16+ KB footprint
- `localStorage` (native): Settings and session data; small JSON objects, no IndexedDB needed

**Excluded explicitly:** React/Preact/Svelte, XState, Zustand/Jotai, Tailwind, Socket.IO, IndexedDB, TypeScript 6.0 beta.

### Expected Features

The MVP for EvenHub submission requires a complete voice-conversation loop. Session switching is deferred to v1.x (post-acceptance) because the frontend complexity is low but it needs a stable core loop first. Developer-grade diagnostics (logs, health view, simulator state handoff) are high-priority for the early-access audience. Full details in `.planning/research/FEATURES.md`.

**Must have (table stakes — P1 for EvenHub submission):**
- 4-gesture input state machine (tap, double-tap, scroll-up, scroll-down) — hardware constraint, no keyboard exists
- Tap-to-record voice capture — core interaction
- State icon HUD (recording / sent / thinking / idle) — users cannot tell if glasses heard them without it
- Backend API client with SSE streaming — connects to gateway, receives streaming responses
- Streaming chat bubble display with throttled updates — token-by-token streaming is baseline UX expectation
- Virtualized viewport with page-based scroll — 576x288 canvas shows only 3-5 bubbles
- Settings panel (gateway URL + session key) — bootstrap configuration, required for any API call
- Glasses connection status — basic EvenHub app expectation
- EvenHub submission package — `dist/index.html` with app metadata

**Should have (competitive — P2, add after submission acceptance):**
- Session selection/switching — core OpenClaw differentiator (talk to different agent personas)
- Health/diagnostics view with service checks — multi-hop pipeline (BLE→iPhone→HTTPS→gateway→STT→OpenClaw) needs visibility
- Logs view with filtering and correlation IDs — early-access developer audience expects this
- Hide/Wake UI modes (double-tap to wake blank display) — battery and visual clutter
- Simulator state handoff — developers testing without physical glasses

**Defer (v2+):**
- Configurable gesture mapping — default works; customization adds settings complexity
- Settings export/import JSON — small audience benefit until user base grows
- Conversation history persistence across sessions — localStorage limits, privacy implications; gateway should own this
- R1 ring input integration — separate SDK surface, await adoption growth

**Anti-features (do not build):**
- Direct OpenClaw API calls from browser (exposes API keys in WebView)
- STT/TTS in frontend (WebAssembly Whisper ~500MB, too heavy for WebView)
- Markdown rendering on glasses (single fixed font, no rich text in container model)
- Real-time camera/video (Even G2 has NO camera by design)

### Architecture Approach

The app follows a layered, bridge-first architecture where all glasses communication flows through a single `EvenBridgeService` singleton — nothing calls `bridge.*` directly except this module. This prevents lifecycle race conditions (the bridge must be awaited before audio control; page containers must exist before audio can start). The companion hub UI is completely decoupled from the glasses renderer and can be developed independently. The `StreamThrottle` pattern (buffer SSE tokens, push to BLE display at 150-300ms cadence) is the most critical novel component and should be prototyped early with the simulator. Full details in `.planning/research/ARCHITECTURE.md`.

**Major components:**
1. `EvenBridge` — SDK wrapper, event bus, hardware gateway; single point of contact for all bridge calls
2. `GestureEngine` — pure-function FSM mapping raw SDK events to typed app actions; fully testable without SDK
3. `AudioCapture` — receives PCM frames (16kHz, S16LE, 10ms/frame) from bridge, buffers and POSTs to gateway
4. `GlassesRenderer` + `IconRegistry` — manages up to 4 containers on glasses display; handles layout presets (chat, menu, status), viewport pagination, throttled text pushes
5. `ChatStore` — ordered chat history, streaming state, viewport window computation
6. `GatewayClient` — HTTP client for gateway: audio POST, SSE stream consumption via `fetch()` + `eventsource-parser`
7. `SessionManager` — active session tracking, session list, switch commands
8. `SettingsStore` — typed localStorage wrapper with public/secret partition (secrets never exported)
9. `HubUI` — companion mobile/desktop screens using Even design tokens (home, health, features, settings, logs)
10. `AppState` — global mode coordinator (idle / recording / thinking / error)

**Key patterns:**
- Bridge-First Event Bus: subscribers, not direct calls
- Gesture FSM: pure transitions, no side effects in the machine
- Throttled Streaming Text Push: 150-300ms cadence, not per-token
- Container Layout Manager: fixed presets for chat/menu/status layouts
- Settings Store Secret Separation: public vs. secret partitions with whitelist export

### Critical Pitfalls

1. **Per-token BLE display updates** — Buffer SSE tokens client-side and push to glasses at 150-300ms cadence using `StreamThrottle`. Per-token updates (20-50ms intervals) will overflow the BLE pipe causing seconds of lag. Must be designed into the renderer from day one — retrofitting is expensive.

2. **Gesture tap/double-tap ambiguity without debounce** — Implement a 250-300ms debounce window in the FSM to distinguish single-tap (record) from double-tap (menu). Without it, double-tap always fires single-tap first, causing accidental recordings. Test with synthetic event sequences before connecting to hardware.

3. **LC3 audio codec not browser-native** — The G2 mic streams LC3 over BLE, but no browser decodes LC3 natively. Architecture decision required before writing any audio code: gateway receives and decodes audio (confirmed path per STACK.md — SDK delivers PCM to the web app via `audioEvent.audioPcm`, so the Even iPhone app handles LC3 decoding). Validate this with the actual SDK event payload format early.

4. **SSE stream buffered by proxies** — Intermediary proxies between phone and gateway coalesce chunks, delivering the entire response at once after connection closes. Gateway must set `Cache-Control: no-store, no-transform`, `X-Accel-Buffering: no`, and implement 15-second heartbeat comments. Frontend must use `fetch()` + `ReadableStream` (not `EventSource`, which cannot set auth headers and has a 6-connection limit).

5. **Display resolution ambiguity (576x136 vs 576x288 vs 640x350)** — Research found conflicting specs across sources. All layout dimensions, character count limits, and container coordinates depend on the correct canvas size. Must verify on real G2 hardware or confirmed simulator output before finalizing the glasses renderer layout.

6. **Virtual scroll broken by discrete gesture events** — Even G2 scroll gestures are discrete boundary events (page-up / page-down semantics), not continuous pixel scroll. Page-based pagination in `GlassesRenderer` is the correct model from the start. A continuous-scroll virtual list cannot be adapted to discrete gestures without a full rewrite.

## Implications for Roadmap

Based on the dependency chain from `ARCHITECTURE.md` and feature priorities from `FEATURES.md`, research strongly implies a 6-phase structure:

### Phase 1: Foundation — Types, Settings, App State
**Rationale:** Nothing else can be built without the data contracts and settings bootstrap. Settings store is the dependency for all API calls (gateway URL), and typed interfaces define the contracts between all other modules. No SDK dependency in this phase — can proceed immediately with zero hardware.
**Delivers:** `SettingsStore` (typed localStorage with public/secret partition), `AppState` (mode coordinator), shared type definitions, Vitest test setup
**Addresses:** Settings panel (P1 table stakes), secrets partitioning (security pitfall 5)
**Avoids:** "Single global state object" technical debt; secret leakage via export

### Phase 2: EvenBridge SDK Integration
**Rationale:** The bridge is the hardware gateway that blocks all glasses-related development. It must be stable and well-tested before any other glasses work begins. However, this phase can be developed in parallel with the companion hub UI (Phase 5) since HubUI has no bridge dependency.
**Delivers:** `EvenBridgeService` (SDK init, event bus, typed event dispatch), bridge lifecycle management (page container must exist before audio), browser fallback mode for dev without glasses
**Uses:** `@evenrealities/even_hub_sdk@^0.0.6`
**Avoids:** Direct bridge calls from UI components (Anti-Pattern 1); bridge lifecycle race conditions
**Research flag:** Verify LC3/PCM audio event payload format (`audioEvent.audioPcm` Uint8Array contents) on first SDK integration — PITFALLS.md flags this as ambiguous.

### Phase 3: Gesture FSM + Audio Capture
**Rationale:** These are co-dependent on the bridge (Phase 2) and together form the complete input pipeline. Both should be built and tested before wiring to the API client, because the FSM must be stable before any interaction feature works. The gesture FSM is pure TypeScript and can be tested without hardware.
**Delivers:** `GestureEngine` FSM (4 inputs / 6 states, with tap/double-tap debounce), `AudioCapture` (PCM buffering, browser MediaRecorder fallback for dev), recording duration limit (30-second auto-stop), gesture hint bar on glasses display
**Addresses:** 4-gesture input mapping (P1 table stakes), tap-to-record voice capture (P1 table stakes)
**Avoids:** Tap/double-tap ambiguity (Critical Pitfall 3 in PITFALLS.md); audio format mismatch on Safari/iOS (use `MediaRecorder.isTypeSupported()` detection)

### Phase 4: Glasses Renderer + Streaming Display
**Rationale:** This is the highest-risk and most technically novel phase. The `StreamThrottle` pattern must be correct before any AI response can be shown. Container layout (4-container limit, absolute positioning) requires the display resolution ambiguity to be resolved. Building and validating with the simulator before wiring to real API responses reduces risk.
**Delivers:** `GlassesRenderer` (container layout manager with chat/menu/status presets), `IconRegistry` (state icon animations at 3-6 fps), `StreamThrottle` (150-300ms batched text push), virtualized viewport with page-based pagination, "jump to latest" gesture action
**Addresses:** Streaming chat bubble display (P1 table stakes), state icon HUD (P1 table stakes), scrollable conversation history (P1 table stakes)
**Avoids:** Per-token BLE update overflow (Critical Pitfall 1); 4-container limit violations (Anti-Pattern 3); DOM layout thrashing (Critical Pitfall 2); discrete-gesture virtual scroll failure (Critical Pitfall 7)
**Research flag:** Must validate display resolution (576x288 vs other specs) on connected G2 hardware or confirmed simulator before finalizing container coordinates. Consider this a spike task at phase start.

### Phase 5: Gateway API Client + SSE Streaming
**Rationale:** Depends on `SettingsStore` (Phase 1) for the gateway URL and `ChatStore` for streaming writes. The SSE streaming logic must be built with correct headers and heartbeat detection from the start — retrofitting proxy compatibility is a known pain point.
**Delivers:** `GatewayClient` (audio POST, SSE stream via `fetch()` + `eventsource-parser`), `ChatStore` (ordered history, streaming state, viewport window), heartbeat-based connection health detection, reconnection after phone sleep/wake
**Uses:** `eventsource-parser@^3.0.6`, `fetch()` + `ReadableStream` (not `EventSource`)
**Addresses:** Backend API client with SSE streaming (P1 table stakes), glasses connection status (wires to `getDeviceInfo`/`observeDeviceStatus`)
**Avoids:** SSE proxy buffering (Critical Pitfall 4 — heartbeat + correct response headers required from gateway); EventSource 6-connection limit

### Phase 6: Full Voice Loop Integration + EvenHub Submission
**Rationale:** Wires all prior layers into the complete voice conversation loop: GestureEngine → AudioCapture → GatewayClient → ChatStore → StreamThrottle → GlassesRenderer. This is the integration and polish phase, culminating in the EvenHub submission package.
**Delivers:** Complete voice conversation loop, `SessionManager` (basic: active session from Settings), companion `HubUI` (home, settings screens), EvenHub submission package (`evenhub pack` producing `dist/index.html` with `app.json` metadata), pre-submission checklist validation
**Addresses:** Full P1 feature set; EvenHub submission package (P1 table stakes)
**Avoids:** Missing auto-scroll vs reading position fix; technical debt checklist from PITFALLS.md

### Phase 7: Post-Acceptance — Diagnostics, Session Switching, Dev Tools
**Rationale:** These are high-value features for the early-access developer audience but not required for initial submission acceptance. Build after the core loop is validated in production.
**Delivers:** Session selection/switching UI, health/diagnostics view (service checks, latest turn diagnostics), logs view (ring buffer, info/warn/error filter, correlation IDs, copy-to-clipboard), hide/wake UI mode (double-tap toggle), simulator state handoff from companion hub
**Addresses:** P2 features (session switching, health, logs, hide/wake, simulator)

### Phase Ordering Rationale

- Foundation first (Phase 1) because SettingsStore is the bootstrap dependency for all API calls; no other phase can proceed without it.
- Bridge second (Phase 2) because it unblocks all glasses-related phases; it is the critical path bottleneck.
- Gesture + Audio third (Phase 3) because they have no dependencies on the data layer and need to be stable before integration.
- Renderer + Streaming fourth (Phase 4) because this is the highest-risk phase and benefits most from early simulator validation before real API data.
- API client fifth (Phase 5) because streaming into the already-proven renderer reduces integration risk.
- Integration sixth (Phase 6) because it depends on all prior layers being stable.
- Post-acceptance features last (Phase 7) because they are P2/developer-oriented and should not delay submission.

### Research Flags

Phases likely needing deeper research or spike tasks during planning:

- **Phase 2 (EvenBridge):** Validate the actual `audioEvent.audioPcm` payload format from `@evenrealities/even_hub_sdk v0.0.6` on first integration. PITFALLS.md flags LC3 codec ambiguity — the SDK may deliver pre-decoded PCM (as STACK.md asserts) or raw LC3 (requiring WebAssembly decoder). This must be confirmed with the actual SDK before writing audio code.
- **Phase 4 (Glasses Renderer):** Display resolution ambiguity (576x136 / 576x288 / 640x350) must be resolved via hardware or simulator test at phase start. All container coordinates and character limits depend on the correct value.
- **Phase 5 (Gateway API Client):** SSE streaming behavior behind proxies should be tested in a staging environment (not just localhost) before finalizing the heartbeat and header configuration. Coordinate with `openclaw-even-g2-voice-gateway` team on response headers.

Phases with well-documented patterns (skip dedicated research-phase):

- **Phase 1 (Foundation):** Standard TypeScript module patterns, localStorage typed wrappers — well-documented, no research needed.
- **Phase 3 (Gesture FSM):** Pure TypeScript FSM is a well-understood pattern; FSM structure fully specified in ARCHITECTURE.md with code examples.
- **Phase 6 (EvenHub Submission):** EvenHub CLI (`evenhub pack`) is straightforward; `app.json` schema documented.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Fully validated against sibling `even-g2-apps` repo and official Even Realities packages; version pinning matches working code |
| Features | MEDIUM | EvenHub SDK is early-access v0.0.x with limited public docs; feature expectations derived from competitor analysis and Even's own G1/G2 patterns; core feature set is clear |
| Architecture | MEDIUM-HIGH | Even Hub SDK behavior verified via community notes + official demo apps + Pong game (real rendering patterns); data flow and patterns are clear; SDK lifecycle details may shift with SDK updates |
| Pitfalls | MEDIUM-HIGH | Domain-specific constraints well-verified; EvenHub submission edge cases have LOW confidence due to limited public submission documentation |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Display resolution:** Research found 3 different specs (576x136, 576x288, 640x350). Must verify on hardware during Phase 4. Plan a spike: connect G2, render a full-width text block, measure actual pixel dimensions. Do not finalize container layout until resolved.
- **LC3 vs PCM audio delivery:** STACK.md asserts the SDK delivers PCM to the web app (the Even iPhone app handles LC3 decoding). PITFALLS.md flags this as a risk. Validate the actual `audioEvent.audioPcm` Uint8Array format during Phase 2 bridge integration before writing any audio pipeline code.
- **EvenHub submission acceptance criteria:** Limited public documentation on what triggers rejection. The requirement for self-contained `dist/index.html` is confirmed, but icon dimensions, permission declarations, and review SLAs are unclear. Flag for validation with the EvenHub developer portal before Phase 6.
- **SDK breaking changes:** `@evenrealities/even_hub_sdk` is at v0.0.6. Keep the `EvenBridgeService` isolation layer thin so SDK API changes are contained to one file. Pin the SDK version in `package.json` and evaluate upgrades explicitly.
- **30-second recording limit:** EvenDemoApp protocol documents a 30-second/session limit with 0-255 sequence numbers. The EvenHub SDK wrapper may abstract this or expose it differently. Verify behavior and implement visible countdown + auto-stop during Phase 3.

## Sources

### Primary (HIGH confidence)
- Sibling repo `even-g2-apps` at `/home/forge/bibele.kingdom.lv/samples/even-g2-apps/` — verified working code, matching SDK versions, build tooling
- [Even Hub Developer Portal](https://evenhub.evenrealities.com/) — official SDK overview, developer program
- [EvenDemoApp (official Even Realities)](https://github.com/even-realities/EvenDemoApp) — BLE protocol, display specs, gesture events, audio format reference
- [EH-InNovel (official Even Realities)](https://github.com/even-realities/EH-InNovel) — EvenHub web app architecture, SDK API surface
- [Vite 7.0 release notes](https://vite.dev/blog/announcing-vite7) — Rolldown bundler, vanilla-ts template support
- [Vitest 4.0 release notes](https://vitest.dev/blog/vitest-4) — browser mode stability, native ESM/TS
- [eventsource-parser](https://github.com/rexxars/eventsource-parser) — TypeScript-first SSE parsing, 16M+ weekly downloads
- [vite-plugin-singlefile](https://github.com/richardtallent/vite-plugin-singlefile) — explicit Vite 7 peer dep in v2.3.0
- [TypeScript 6.0 Beta](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0-beta/) — confirms beta-only status, justifies staying on 5.9.x
- [MediaRecorder API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) — format support, browser compatibility
- [Server-Sent Events (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) — SSE standard patterns
- [Google liblc3](https://github.com/google/liblc3) — WebAssembly LC3 decoder option (contingency if SDK doesn't deliver PCM)
- [Google Minimize Browser Reflow](https://developers.google.com/speed/docs/insights/browser-reflow) — layout thrashing prevention

### Secondary (MEDIUM confidence)
- [Even G2 SDK notes (nickustinov)](https://github.com/nickustinov/even-g2-notes/blob/main/G2.md) — G2 display specs (576x288), container system, SDK APIs; community-maintained but detailed
- [Pong for Even G2](https://github.com/nickustinov/pong-even-g2) — real rendering patterns, frame push timing
- [Even G2 BLE Protocol (i-soxi)](https://github.com/i-soxi/even-g2-protocol) — reverse-engineered dual-channel BLE architecture
- [patterns.dev AI UI Patterns](https://www.patterns.dev/react/ai-ui-patterns/) — streaming output, typing indicators, chat bubble UX
- [Android Authority — EvenHub developer program](https://www.androidauthority.com/even-realities-hub-smart-glasses-developers-3629083/) — early-access program details

### Tertiary (LOW confidence — needs validation)
- [smartglassessupport.com](https://smartglassessupport.com/smart-glasses-companion-apps/) — companion app feature expectations across brands
- [Meta AI Glasses companion app](https://www.meta.com/blog/ray-ban-meta-ai-glasses-new-companion-app/) — history tab, settings, voice history patterns
- Smart glasses UX design articles (multiple sources) — general wearable UX principles

---
*Research completed: 2026-02-27*
*Ready for roadmap: yes*
