# Project Research Summary

**Project:** Even G2 OpenClaw Chat App — v1.1 Integration Milestone
**Domain:** Smart glasses voice-chat companion app (Even G2 + OpenClaw AI) — runtime wiring + EvenHub submission
**Researched:** 2026-02-28
**Confidence:** HIGH (wiring and architecture), MEDIUM (EvenHub submission specifics)

## Executive Summary

The v1.1 integration milestone is a wiring exercise, not a feature-building exercise. v1.0 shipped 27 requirements across 5 phases (5,484 LOC, 240 tests) and every module needed for end-to-end voice operation exists, is tested, and works in isolation. What is missing is the runtime assembly in `main.ts`: the event bus subscriptions that connect gesture input to audio capture, audio capture to the gateway API, and gateway SSE streaming to the glasses display. The four critical missing wires are: `bridge:audio-frame -> audioCapture.onFrame()`, `audio:recording-stop -> gateway.sendVoiceTurn()`, `gateway.onChunk() -> bus.emit('gateway:chunk')`, and `gateway.onStatusChange() -> bus.emit('gateway:status')`. These are pure JavaScript subscriptions requiring zero new runtime dependencies.

The recommended architecture introduces one new file — `VoiceLoopController` — as a thin, testable glue module that bridges the gateway client's internal event system to the shared event bus. This preserves the v1.0 pattern of factory functions returning plain interfaces, keeps the gateway client bus-agnostic, and makes the integration testable without touching any existing module. The companion hub remains the browser-facing code path; environment detection at the `main.ts` entry point (`'__EVEN_BRIDGE__' in window`) determines whether to boot the glasses runtime or the settings hub, enabling a single `dist/index.html` for EvenHub submission.

The primary risk is initialization ordering: the event bus dispatches synchronously in registration order, meaning `GestureHandler` must subscribe before `DisplayController` or the hint bar shows stale state on every gesture. A secondary risk is EvenHub submission packaging — the `vite-plugin-singlefile` plugin conflicts with the existing multi-page Vite config and should either be handled by removing the simulator from the production build config, or skipped in favor of standard Vite output (which the sibling `even-g2-apps` repo confirms works fine with `evenhub pack`). Both risks have known mitigations and are LOW recovery cost.

## Key Findings

### Recommended Stack

The existing stack (Vite 6.1, TypeScript 5.7, Vitest 3, `@evenrealities/even_hub_sdk@0.0.7`) is complete for runtime wiring. Two new dependencies are needed for EvenHub submission only:

**Core technologies:**
- `vite-plugin-singlefile@^2.3.0`: Inlines all JS/CSS into `dist/index.html` — build-time only, zero runtime cost; peer deps satisfied by current Vite 6 and Rollup 4. Optional per sibling repo evidence but required by PROJECT.md.
- `@evenrealities/evenhub-cli@^0.1.5`: Official `evenhub pack` CLI for `.ehpk` submission artifact — must use official tool (WASM-based packer, no public spec).
- No new runtime dependencies: all voice loop modules (`createEventBus`, `createEvenBridgeService`, `createAudioCapture`, `createGatewayClient`, `createGestureHandler`, `createGlassesRenderer`, `createDisplayController`) exist and are tested.

**Critical finding:** `vite-plugin-singlefile` is a project design choice, not an EvenHub platform requirement. The sibling repo ships standard multi-file Vite output and packages it successfully with `evenhub pack`. If the single-file approach is retained, the existing multi-page Vite config (with `preview-glasses.html`) must be split: single-entry for the production build, dev-only for the simulator.

See `.planning/research/STACK.md` for version compatibility matrix, Vite config diff, and `app.json` field reference.

### Expected Features

**Must have (table stakes — v1.1 scope):**
- End-to-end voice loop wiring (4 event subscriptions) — the app is non-functional without these
- Runtime initialization sequence in `main.ts` with correct dependency and registration order — ordering is a correctness constraint, not a style choice
- Dev-mode bridge detection (`window.__EVEN_BRIDGE__`) and graceful fallback to `BridgeMock` — essential for development without hardware
- CLICK_EVENT quirk fix in `even-bridge.ts` — SDK normalizes value 0 to `undefined`; current code may silently drop taps on real hardware
- `app.json` manifest with all required fields including wildcard `permissions.network` — gateway URL is user-configurable, domain unknown at build time
- `evenhub pack` build script producing `.ehpk` artifact — submission cannot proceed without it
- Orphaned event type cleanup (4 dead types in `AppEventMap`) — trivial but eliminates API surface confusion

**Should have (differentiators — v1.1 scope):**
- Companion hub gateway integration (wire health display to real `gateway.onStatusChange()`) — makes the hub functional rather than decorative
- Error-to-idle FSM transition — without it, a gateway failure leaves the user stuck in "Processing..." indefinitely requiring force-quit
- Gateway lifecycle cleanup on app exit (`beforeunload -> gateway.destroy()`) — prevents heartbeat timer leaks and stale fetch requests

**Defer (v2+):**
- R1 ring input integration — separate hardware, separate SDK surface, requires hardware most users will not have
- Persistent conversation history — gateway-side concern; localStorage is insufficient for voice transcripts
- Automated E2E tests — SDK simulator not mature enough for reliable WebView testing
- Multi-language UI — EvenHub is English-first early-access

See `.planning/research/FEATURES.md` for the complete 16-step initialization sequence and full dependency graph.

### Architecture Approach

The v1.1 architecture follows the v1.0 factory-pattern model exactly: introduce one new module (`VoiceLoopController`) that bridges the gateway client's internal event system to the shared event bus, and rewrite `main.ts` as a pure dependency-injection bootstrap with layered initialization. The environment detection split (`main.ts` dispatching to `glasses-main.ts` or `hub-main.ts`) keeps the single EvenHub submission index.html while maintaining clear separation between the glasses runtime and companion hub code paths.

**Major components:**
1. **EventBus** — synchronous typed pub/sub backbone; registration order is a correctness constraint not just a performance concern
2. **BridgeService / BridgeMock** — single SDK import boundary; `await bridge.init()` must complete before any other module creates subscriptions
3. **VoiceLoopController** (NEW) — ~40-line glue module: subscribes `audio:recording-stop`, calls `gateway.sendVoiceTurn()`, forwards `onChunk` and `onStatusChange` callbacks to the bus; follows factory-pattern for testability
4. **glasses-main.ts** (NEW) — layered initialization: bus -> settings -> bridge -> audioCapture + PCM wire -> gestureHandler -> renderer -> displayController -> gateway + voiceLoop -> cleanup handlers
5. **main.ts** (REWRITE, ~15 lines) — environment detection; dynamically imports `glasses-main` or `hub-main`

See `.planning/research/ARCHITECTURE.md` for complete initialization code, data flow walkthrough, anti-patterns, and new file list.

### Critical Pitfalls

1. **Event bus subscription ordering breaks hint bar** — `DisplayController` reads `gestureHandler.getHintText()` inside gesture event handlers; if `DisplayController` subscribes before `GestureHandler`, it reads pre-transition stale state. Prevention: create `GestureHandler` before `DisplayController` in `glasses-main.ts`; add startup self-test to verify hint text on first gesture.

2. **Bridge init race causes silent recording failures** — `bridge.init()` is async; gesture handler calling `bridge.startAudio()` before the page container exists silently returns `false`. Prevention: strict sequential await chain — `await bridge.init()` then create gesture handler and display controller. Never parallelize bridge init.

3. **Audio frame subscription gap drops first 100-500ms of speech** — `bridge:audio-frame` fires as soon as `audioControl(true)` is called; if the subscription does not exist yet, early PCM frames are silently dropped. Prevention: wire `bus.on('bridge:audio-frame', ({pcm}) => audioCapture.onFrame(pcm))` immediately after creating `audioCapture`, before gesture handler creation.

4. **vite-plugin-singlefile conflicts with multi-page Vite config** — adding the plugin with the existing two-entry (`index.html` + `preview-glasses.html`) config causes a hard Rollup build error ("multiple inputs not supported when inlineDynamicImports is true"). Prevention: remove the simulator from the production build config, or skip singlefile entirely (standard Vite output works with `evenhub pack` per sibling repo).

5. **Voice loop error leaves FSM stuck in `sent` state** — if the gateway returns an error or times out, the gesture FSM has no `error` input and no path back to `idle`; the user is permanently stuck. Prevention: add an `error` input to the FSM that transitions from `sent`/`thinking` to `idle`; implement a 30-second timeout fallback.

See `.planning/research/PITFALLS.md` for the full "Looks Done But Isn't" checklist (9 items), integration gotchas table, and recovery cost estimates for each pitfall.

## Implications for Roadmap

Based on the dependency chain from research, v1.1 maps to three sequential phases. Phase 1 must be complete before Phase 2 can be verified; Phase 2 must be verified before Phase 3 is meaningful.

### Phase 1: Runtime Wiring

**Rationale:** The voice loop is entirely blocked on correct `main.ts` assembly. All other work (EvenHub packaging, error handling, companion hub integration) depends on the voice loop actually running. This must be first.
**Delivers:** A fully wired end-to-end voice loop working in dev mode (keyboard shortcuts triggering mock bridge) — tap -> record -> gateway -> SSE stream -> glasses display.
**Addresses:** All 4 table-stakes event bus subscriptions; runtime initialization sequence with correct layering; dev-mode bridge detection; CLICK_EVENT quirk fix; orphaned event type cleanup.
**Avoids:** Subscription ordering pitfall (enforce GestureHandler-before-DisplayController in `glasses-main.ts`); bridge init race (sequential await chain); audio frame subscription gap (wire immediately after AudioCapture creation).
**New files:** `src/voice-loop/voice-loop-controller.ts` (~40 lines), `src/glasses-main.ts` (~60 lines), `src/hub-main.ts` (extracted from current `main.ts`), rewrite `src/main.ts` (~15 lines).
**Modified files:** `src/types.ts` (remove 4 orphaned event types), `src/bridge/even-bridge.ts` (CLICK_EVENT quirk).

### Phase 2: Error Handling and Lifecycle

**Rationale:** A voice loop that gets stuck on network failure is not shippable. Error recovery must be part of the integration design, not retrofitted after packaging. Depends on Phase 1 being complete and testable in dev mode.
**Delivers:** Resilient voice loop — FSM error-to-idle transitions, 30-second timeout fallback, gateway lifecycle cleanup on app exit, companion hub health display wired to real gateway status.
**Addresses:** Voice loop error recovery (FSM `error` input), gateway cleanup on shutdown (`beforeunload -> gateway.destroy()`), companion hub gateway integration (`gateway.onStatusChange()` -> health UI).
**Avoids:** SSE/heartbeat leak (gateway.destroy on shutdown); stuck FSM state (error input + timeout); UX dead-end requiring force-quit.
**Uses:** Existing FSM (`gesture-fsm.ts`) — add one new input; existing gateway client lifecycle methods (`stopHeartbeat`, `destroy`).

### Phase 3: EvenHub Submission Packaging

**Rationale:** Packaging is the final step and depends on the voice loop working correctly (Phase 1) and being resilient (Phase 2). The build config change is isolated and the risk is well-understood from research.
**Delivers:** Verified `.ehpk` submission artifact — `app.json` manifest, Vite config updated for single-entry production build, `evenhub pack` npm script, `evenhub qr` dev workflow for on-device testing.
**Addresses:** `app.json` manifest (all required fields, wildcard network permission for user-configurable gateway URL), vite-plugin-singlefile integration (multi-page conflict resolved by removing simulator from prod build), `evenhub pack` and `evenhub qr` scripts.
**Avoids:** vite-plugin-singlefile multi-page conflict (Option C: remove simulator entry from production rollupOptions); `app.json` network permission gap (use `"*"`); wrong `entrypoint` path (always `"index.html"`, not `"dist/index.html"`).
**Installs:** `vite-plugin-singlefile@^2.3.0` (devDependency), `@evenrealities/evenhub-cli@^0.1.5`.

### Phase Ordering Rationale

- **Phase 1 first** because end-to-end voice loop function is the single prerequisite for everything else. No point packaging an app that does not work.
- **Phase 2 before Phase 3** because error recovery needs to be verified in dev mode before the Vite build config is changed. Debugging a stuck FSM with a modified build config adds unnecessary surface area.
- **Phases are small and sequential** because the codebase is already mature. Each phase is 1-2 days of focused work. The risks are known and have documented mitigations.

### Research Flags

Phases with standard, well-documented patterns (no further research needed):
- **Phase 1 (Runtime Wiring):** The initialization sequence, factory patterns, and all module interfaces are thoroughly documented in the existing source code and `ARCHITECTURE.md`. The 16-step init sequence is fully specified. Wiring is mechanical.
- **Phase 2 (Error Handling):** FSM modification pattern is established from v1.0. Gateway client lifecycle methods are already implemented. No unknowns.

Phase that may need targeted validation during execution:
- **Phase 3 (EvenHub Packaging):** The EvenHub submission portal is early-access with limited public documentation. The `app.json` schema is reverse-engineered from sibling repo examples, not official docs. Run `evenhub pack --check` as an early validation step. If the portal is not yet accepting submissions, validate the `.ehpk` artifact locally against the sibling repo's known-good packages.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | New deps verified against installed node_modules and sibling repo; version compatibility confirmed via peer dep ranges; vite-plugin-singlefile v2.3.0 Vite 6 compat confirmed in CHANGELOG |
| Features | HIGH (wiring), MEDIUM (submission) | Wiring requirements are from the v1.0 audit — internal authoritative source; EvenHub submission specifics from community docs and sibling repo, not official Even Realities docs |
| Architecture | HIGH | Derived from direct analysis of all 38 source files; initialization ordering constraint documented in display-controller.ts source comments; VoiceLoopController pattern follows established v1.0 factory conventions |
| Pitfalls | HIGH | Event bus ordering and bridge init risks verified against actual implementation; singlefile conflict confirmed by plugin maintainer's "won't fix" on GitHub issue #83; gateway leak patterns verified against gateway-client.ts source |

**Overall confidence:** HIGH for Phase 1 and Phase 2. MEDIUM for Phase 3 due to limited EvenHub submission portal documentation.

### Gaps to Address

- **EvenHub `app.json` schema validation:** Reverse-engineered from 8+ sibling repo examples, not from official docs. Use `evenhub pack --check` during Phase 3 before finalizing the manifest. If `app.json` format has changed with newer CLI versions, the required fields may differ.
- **EvenHub `permissions.network` wildcard acceptance:** `["*"]` wildcard is used in sibling repos but not officially confirmed as accepted syntax in the submission portal. If it is rejected, list known gateway domains as a fallback.
- **vite-plugin-singlefile necessity:** PROJECT.md specifies it; sibling repo evidence says it is unnecessary. Resolve during Phase 3 by attempting packaging with standard Vite output first, adding singlefile only if `evenhub pack` produces a non-functional app.
- **CLICK_EVENT quirk on real hardware:** Documented in community SDK notes; not verifiable without physical Even G2 glasses. The fix (null-check for `undefined` eventType) is trivially safe — apply it unconditionally and verify behavior during on-device testing with the QR code workflow.
- **FSM `sent` vs `thinking` state gap:** The FSM stays in `sent` state during AI streaming; the display controller manages the `thinking` icon independently. This is acceptable for v1.1 but becomes material if Phase 2 error recovery needs the FSM to distinguish `sent` from `thinking` when an error fires mid-stream. Flag for Phase 2 review.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis — all 38 source files in `src/`; `display-controller.ts` ordering note on lines 8-11; `audio-capture.ts` passive `onFrame` interface; `gateway-client.ts` lifecycle methods
- v1.0 Milestone Audit (`.planning/milestones/v1.0-MILESTONE-AUDIT.md`) — authoritative tech debt inventory and integration gap documentation (INT-01, FLOW-05)
- Sibling repo `even-g2-apps` at `/home/forge/bibele.kingdom.lv/samples/even-g2-apps/` — working reference implementation of `evenhub pack` workflow without singlefile plugin
- `@evenrealities/evenhub-cli@0.1.5` README — official CLI pack/qr command documentation
- `@evenrealities/even_hub_sdk@0.0.7` README — SDK bridge interface and lifecycle events (read from installed node_modules)
- `evenhub pack --help` — verified CLI interface locally
- vite-plugin-singlefile GitHub (issue #83) — maintainer confirmation of multi-page incompatibility as "won't fix"
- vite-plugin-singlefile CHANGELOG — v2.3.0 confirmed latest; Vite 6 compatibility confirmed in v2.1.0

### Secondary (MEDIUM confidence)
- `nickustinov/even-g2-notes G2.md` — `app.json` format, CLICK_EVENT quirk, SDK lifecycle events, audio PCM specs; most comprehensive community reference but not official Even Realities documentation
- `nickustinov/pong-even-g2` — working community app showing dev-mode detection pattern (`?dev` URL param) and SDK initialization sequence
- EvenHub Developer Portal — platform overview and pilot program context; submission specifics not publicly documented
- Even Realities GitHub org — official but focused on G1 hardware (EvenDemoApp)
- 8 `app.json` files across local Even G2 sample projects — `app.json` metadata format reverse-engineered from working examples

### Tertiary (LOW confidence — needs validation)
- EvenHub submission portal acceptance criteria — not publicly documented; all knowledge inferred from sibling repo `.ehpk` files and CLI behavior
- Exact `app.json` required vs optional field distinction — inferred from examples, not a published schema document

---
*Research completed: 2026-02-28*
*Ready for roadmap: yes*
