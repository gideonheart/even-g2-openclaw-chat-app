# Feature Research

**Domain:** Smart glasses voice/chat companion app (Even G2 + OpenClaw AI agent)
**Researched:** 2026-02-27
**Confidence:** MEDIUM -- EvenHub SDK is early-access with limited public docs; feature expectations derived from competitor analysis + Even's own G1/G2 patterns + general AI chat UX patterns

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete or broken.

#### Voice Interaction Core

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Tap-to-record voice capture | The fundamental input method; Even G2 has no keyboard, voice is the primary interaction. Users of Meta glasses, RayNeo, etc. all have single-gesture voice activation. | MEDIUM | Must handle tap=start, tap-again=stop via gesture state machine. Even SDK provides mic access. Audio in LC3 format per BLE protocol. |
| State icon HUD (recording/sent/thinking/idle) | Every voice assistant shows processing state. Without it, users cannot tell if the glasses heard them. Even's own AI shows state indicators on the G2. | LOW | 4 states with icon animation at 3-6 fps. The 576x288 canvas has room for a status bar at top. Map to Even SDK container system. |
| Streaming chat bubble display | Token-by-token streaming is the 2025/2026 baseline UX for AI chat (established by ChatGPT). Dumping full text at once feels broken. Even's SDK supports `textContainerUpgrade` for partial text updates. | HIGH | Must use incremental updates within 150-300ms cadence. Max 2000 chars per upgrade. Virtualized viewport essential for 576x288 canvas. SSE from gateway. |
| User/assistant bubble separation | Standard chat UX: user right, assistant left. Even demo app shows this pattern. Every chat interface from WhatsApp to ChatGPT does this. | LOW | Right-aligned user transcript, left-aligned AI response. On 576x288 monochrome green, differentiation via alignment + prefix glyph. |
| Scrollable conversation history | Users expect to scroll back through recent exchanges. Even SDK fires `SCROLL_TOP_EVENT` / `SCROLL_BOTTOM_EVENT` boundary events for scroll gesture handling. | MEDIUM | Virtualized viewport: keep full history in memory, render only visible window. Scroll up/down gestures map to history navigation. |

#### Companion Hub (Mobile/Desktop)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Glasses connection status | Every smart glasses companion app (Meta AI, Vuzix Companion, Even Realities app) shows connect/disconnect state and battery level prominently. | LOW | Already stubbed in existing shell. Wire to Even SDK `getDeviceInfo()` and `observeDeviceStatus()`. |
| Settings panel (gateway URL, STT provider, session key) | Users must configure where their backend lives. This is a frontend-only app connecting to a separate gateway -- there is no zero-config path. | MEDIUM | Form with validation, localStorage persistence. Secure masking for keys. No secrets actually stored (keys are session metadata, not API credentials). |
| Session selection/switching | OpenClaw supports multiple agent sessions (personas). Users need to pick which session they are talking to. This is core to the product's value proposition (multiple AI agents via one glasses UX). | MEDIUM | Session list with active marker. Confirm-and-switch UX. State toast on change. Gateway API call to list/switch sessions. |
| Health/diagnostics view | Smart glasses apps universally include connection health and troubleshooting. Even's own app shows sync status. When voice goes through BLE->iPhone->HTTPS->gateway->STT->OpenClaw, users need visibility into what broke. | MEDIUM | Service check indicators (gateway online, STT ready, session active). Latest turn diagnostics. Correlation ID display for debugging. |

#### Platform Requirements

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| 4-gesture input mapping | Hardware constraint, not optional. Even G2 only provides: tap, double-tap, scroll-up, scroll-down. All UX must map to exactly these 4 inputs. | MEDIUM | State machine: tap=record/stop, double-tap=menu/wake, scroll=history. Must be consistent and discoverable via hint bar on glasses display. |
| Mobile-safe responsive layout | Companion hub runs in mobile browser / EvenHub WebView. No zoom, safe-area handling, no clipped content. Users expect native-feeling web apps. | LOW | Already partially implemented. Needs polish for safe-area insets and no horizontal scroll. |
| EvenHub submission package | Gatekeeping requirement: no submission artifact = no distribution on Even's marketplace. Must produce `dist/index.html` with app metadata. | LOW | Build pipeline producing single HTML entry point. App name, icon, description, permissions (audio/events). |

### Differentiators (Competitive Advantage)

Features that set this app apart from Even's built-in AI assistant and other EvenHub apps.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| OpenClaw multi-agent sessions | Even's built-in AI is a single assistant. This app lets users talk to different OpenClaw agent personas (e.g., "Gideon" coding assistant, "Atlas" research agent) and switch between them. No other EvenHub app does this. | LOW (frontend) | The complexity lives in the gateway. Frontend just renders session list and sends switch commands. This is the core differentiator. |
| Settings export/import JSON | Power users and developers want to back up/share their configuration. No other glasses companion app offers this. Especially valuable in a dev-oriented early-access ecosystem. | LOW | JSON serialization of settings minus secrets. Import with validation. Simple but appreciated by the EvenHub developer audience. |
| Glasses-side simulator with state handoff | Developers can preview exactly what the 576x288 green monochrome display looks like without having actual glasses. State can be passed via query params from the companion hub. No other EvenHub app includes an integrated simulator. | MEDIUM | Already have `preview-glasses.html`. Need state handoff (current chat state, icons, etc.) via query params or postMessage. Extremely valuable for the early-access developer community. |
| Configurable gesture mapping | Let users remap what tap/double-tap/scroll do. Even's built-in apps have fixed gesture assignments. Users who primarily browse history vs. primarily record could optimize their mapping. | MEDIUM | Settings UI for gesture->action mapping. Default mapping works out of box, customization is a power-user differentiator. |
| Logs view with filtering and correlation IDs | Deep diagnostic visibility with info/warn/error filtering and correlation IDs linking a single voice turn from audio capture through STT to OpenClaw response. Developer-grade transparency. | MEDIUM | Ring buffer of log entries with filter buttons. Copy diagnostics action for pasting into issue reports. Invaluable for the early-access EvenHub developer audience. |
| Hide/Wake UI modes | Glasses display can go dark when not in use, wake on double-tap. Saves visual clutter and battery. Even's built-in apps don't expose this level of control to third-party apps. | LOW | State toggle: hidden (blank canvas) vs. active (show chat/status). Double-tap to wake is natural -- matches phone lock/unlock mental model. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but should NOT be built.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Direct OpenClaw API calls from browser | "Why add a gateway? Just call OpenClaw directly." | Exposes API keys in public frontend code. EvenHub apps are web apps loaded in WebView -- any secrets are extractable. Even's SDK docs emphasize the iPhone-as-proxy model, not direct cloud calls from the glasses app. | Use the `openclaw-even-g2-voice-gateway` backend. Frontend sends audio/text to gateway, gateway handles all credentialed calls. |
| STT/TTS processing in the frontend | "Run Whisper in the browser for lower latency." | WebAssembly Whisper is ~500MB, too heavy for a WebView-hosted app. Battery drain on phone. Unreliable on mobile Safari/Chrome. EvenHub apps should be lightweight. | Gateway handles STT. Audio goes BLE->iPhone->gateway->STT provider. Frontend just sends and receives. |
| Rich text/markdown rendering on glasses | "Format AI responses with bold, headers, lists." | The G2 display is 576x288 monochrome with a single fixed font, no style options. The SDK container system has no rich text support. Attempting to parse markdown and render it would produce visual garbage. | Plain text with `\n` line breaks. Use prefix characters (`>`, `-`, `*`) for minimal visual structure if needed. Formatting belongs in the companion hub, not on glasses. |
| Multi-user / collaborative features | "Let multiple people share a glasses session." | Even G2 is a personal wearable. Single BLE connection to one phone. The entire hardware model is single-user. Adding collaboration would require architectural complexity with zero hardware support. | Single-user sessions. If someone else wants to interact, they use their own glasses+app. |
| Real-time camera/video features | "Use the glasses camera for visual AI." | Even G2 has NO camera. This is a deliberate privacy-first design decision by Even Realities. There is no camera hardware to access. | Focus on voice+text modality. This is a voice chat app, not a visual AI app. |
| Offline AI / local model inference | "Work without internet." | OpenClaw agents require server-side execution. STT requires cloud providers. The gateway architecture assumes connectivity. Offline mode would require a completely different architecture and would not use OpenClaw at all. | Show clear "offline" status indicator. Cache recent conversation history for read-only review. Reconnect automatically when connectivity returns. |
| Full conversation transcript export | "Export entire chat history as a file." | Privacy concern -- voice transcripts may contain sensitive information. Also, localStorage has size limits (~5MB) that make storing extensive history risky. WebView storage can be cleared by the OS. | Show scrollable in-app history for current and recent sessions. Let users copy individual turns. Full export belongs in the gateway, not the frontend. |
| Custom fonts / themes on glasses display | "Let users pick font size or color themes." | G2 has one fixed font, 4-bit greyscale (16 shades of green), no font size options in the SDK. Container system does not support font customization. | Consistent rendering everyone gets. Companion hub can have light/dark theme since it's standard web. Glasses rendering is hardware-determined. |

## Feature Dependencies

```
[Audio Capture + Gesture State Machine]
    |
    +--requires--> [4-Gesture Input Mapping]
    |
    +--requires--> [Backend API Client]
    |                   |
    |                   +--requires--> [Settings (gateway URL)]
    |
    +--enables--> [State Icon HUD]
    |
    +--enables--> [Streaming Chat Bubble Display]
                       |
                       +--requires--> [Virtualized Viewport]
                       |
                       +--requires--> [Backend API Client (SSE streaming)]
                       |
                       +--enables--> [Scrollable Conversation History]

[Settings Panel]
    |
    +--enables--> [Session Selection/Switching]
    |
    +--enables--> [Settings Export/Import]
    |
    +--enables--> [Configurable Gesture Mapping]

[Health/Diagnostics View]
    |
    +--requires--> [Backend API Client]
    |
    +--enhances--> [Logs View with Filtering]

[Glasses-side Simulator]
    |
    +--enhances--> [Streaming Chat Bubble Display]
    |
    +--enhances--> [State Icon HUD]

[Glasses Connection Status]
    |
    +--requires--> [Even SDK Bridge (getDeviceInfo, observeDeviceStatus)]

[Hide/Wake UI Modes]
    |
    +--enhances--> [State Icon HUD]
    |
    +--requires--> [4-Gesture Input Mapping (double-tap)]
```

### Dependency Notes

- **Streaming Chat requires Backend API Client:** No chat without a connection to the gateway for SSE streaming responses.
- **Backend API Client requires Settings:** Gateway URL must be configured before any API calls work. Settings is the bootstrap dependency.
- **Session Switching requires Settings:** Session list comes from the gateway, which requires configured connection.
- **Gesture State Machine is foundational:** Without gesture handling, there is no input on the glasses. This must be built first or in parallel with voice capture.
- **Simulator enhances but doesn't block:** The simulator is a dev tool that mirrors the glasses display. It can be built independently and connected later via state handoff.
- **Logs View enhances Diagnostics:** Logs are a superset of the health view. Health shows current status; logs show history. Build health first, add log history after.

## MVP Definition

### Launch With (v1) -- EvenHub Submission Minimum

The absolute minimum to submit a working app to EvenHub that delivers on the core value proposition: "voice conversations with AI through Even G2 glasses."

- [ ] **4-gesture input state machine** -- Without this, the app cannot receive any user input on glasses
- [ ] **Tap-to-record voice capture** -- Core interaction: user speaks, audio is captured
- [ ] **State icon HUD (recording/sent/thinking/idle)** -- Users must see what the glasses are doing
- [ ] **Backend API client with SSE streaming** -- Connects to gateway, receives streaming responses
- [ ] **Streaming chat bubble display** -- Shows AI responses token-by-token on 576x288 canvas
- [ ] **Virtualized viewport with scroll** -- Enables reading responses that exceed one screen
- [ ] **Settings panel (gateway URL + session key)** -- Bootstrap configuration to connect to backend
- [ ] **Glasses connection status** -- Must show if glasses are connected (basic EvenHub app expectation)
- [ ] **EvenHub submission package** -- dist/index.html with metadata for marketplace listing

### Add After Validation (v1.x)

Features to add once core voice-chat loop is working and the app is accepted into EvenHub.

- [ ] **Session selection/switching** -- Trigger: users want to talk to different OpenClaw agents
- [ ] **Health/diagnostics view** -- Trigger: users report issues and need troubleshooting visibility
- [ ] **Logs view with filtering** -- Trigger: developers in early-access need debug tools
- [ ] **Settings persistence improvements** -- Trigger: users lose settings (WebView storage cleared)
- [ ] **Hide/Wake UI modes** -- Trigger: users complain about always-on display clutter
- [ ] **Simulator state handoff** -- Trigger: developers want to test without physical glasses

### Future Consideration (v2+)

Features to defer until product-market fit is established within the EvenHub ecosystem.

- [ ] **Configurable gesture mapping** -- Why defer: default mapping works; customization adds settings complexity
- [ ] **Settings export/import JSON** -- Why defer: small audience benefit until there are many users
- [ ] **Conversation history persistence across sessions** -- Why defer: localStorage limits, privacy implications, gateway should own this
- [ ] **Multi-language UI** -- Why defer: EvenHub is early-access, English-first audience
- [ ] **R1 ring input integration** -- Why defer: Even's R1 ring is a separate accessory with its own SDK surface; add when ring adoption grows

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| 4-gesture input state machine | HIGH | MEDIUM | P1 |
| Tap-to-record voice capture | HIGH | MEDIUM | P1 |
| State icon HUD | HIGH | LOW | P1 |
| Backend API client (SSE) | HIGH | MEDIUM | P1 |
| Streaming chat bubble display | HIGH | HIGH | P1 |
| Virtualized viewport + scroll | HIGH | HIGH | P1 |
| Settings panel (gateway URL, session) | HIGH | MEDIUM | P1 |
| Glasses connection status | MEDIUM | LOW | P1 |
| EvenHub submission package | HIGH | LOW | P1 |
| Session selection/switching | HIGH | MEDIUM | P2 |
| Health/diagnostics view | MEDIUM | MEDIUM | P2 |
| Logs view with filtering | MEDIUM | MEDIUM | P2 |
| Hide/Wake UI modes | MEDIUM | LOW | P2 |
| Simulator state handoff | MEDIUM | MEDIUM | P2 |
| Settings export/import | LOW | LOW | P3 |
| Configurable gesture mapping | LOW | MEDIUM | P3 |
| R1 ring integration | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for EvenHub submission (core voice-chat loop)
- P2: Should have, add after submission acceptance
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | Even Built-in AI | Meta AI Glasses | Vuzix Companion | Our Approach |
|---------|-----------------|-----------------|-----------------|--------------|
| Voice activation | Touch + hold on touchbar | "Hey Meta" wake word | Hardware button | Tap gesture (simpler, no wake word needed) |
| AI response display | Floating text on glasses | Audio-only (no display on Ray-Ban) | Text on Blade display | Streaming bubble chat on 576x288 green display |
| Multi-agent / session switching | Single assistant only | Single Meta AI | Single assistant | Multiple OpenClaw agent sessions -- core differentiator |
| Conversation history | Limited, in Even app | History tab in Meta AI app | Not available | Scrollable virtualized viewport on glasses + companion hub |
| Settings/config | Within Even app | Meta AI app settings | Vuzix Companion app | Dedicated settings panel with gateway/STT/session config |
| Diagnostics | Not exposed | Not exposed | Basic connection info | Full health view + filterable logs + correlation IDs |
| Developer tools | Even Hub simulator (separate) | None | None | Integrated simulator with state handoff from companion |
| Gesture customization | Fixed gestures | Fixed "Hey Meta" | Fixed hardware buttons | Configurable gesture mapping (future P3) |
| Offline capability | Limited caching | Some offline features | Offline pairing | No offline AI (by design); read-only cached history |
| Privacy model | No camera, no speaker | Has camera + speaker (privacy concerns) | Has camera | No camera, no speaker, no secrets in frontend -- strongest privacy posture |

## EvenHub-Specific Considerations

The EvenHub ecosystem is early-access (as of early 2026). This shapes feature priorities:

1. **Developer-first audience**: Early EvenHub users are developers. Diagnostic tools, simulator, and logs are more valuable now than they would be for a mass-market app.
2. **SDK is immature**: `@evenrealities/even_hub_sdk` is at v0.0.x. Expect breaking changes. Keep the SDK integration layer thin and isolated.
3. **Container system constraints**: Max 4 containers per page. Absolute pixel positioning. No CSS/flexbox on glasses. The companion hub can be rich; the glasses UI must be spartan.
4. **iPhone-as-proxy model**: All communication flows through the iPhone's WebView. This adds latency (HTTPS -> iPhone -> BLE -> Glasses). Design for 200-500ms round-trip minimum for display updates.
5. **Small app catalog**: Being among the first AI voice chat apps on EvenHub gives first-mover advantage. Shipping fast matters more than feature completeness.

## Sources

- [Even Hub Developer Portal](https://evenhub.evenrealities.com/) -- SDK overview, developer program info (MEDIUM confidence)
- [Even Realities GitHub - EvenDemoApp](https://github.com/even-realities/EvenDemoApp) -- BLE protocol, display specs (G1: 576x136), gesture events, audio format (HIGH confidence)
- [Even Realities GitHub - EH-InNovel](https://github.com/even-realities/EH-InNovel) -- EvenHub web app architecture, SDK API surface (`@evenrealities/even_hub_sdk` v0.0.6) (HIGH confidence)
- [nickustinov/even-g2-notes](https://github.com/nickustinov/even-g2-notes/blob/main/G2.md) -- G2 display specs (576x288, 4-bit greyscale), container system (max 4), text limits (1000/2000 chars), SDK APIs (HIGH confidence)
- [i-soxi/even-g2-protocol](https://github.com/i-soxi/even-g2-protocol) -- BLE protocol reverse engineering, dual-channel architecture (MEDIUM confidence)
- [patterns.dev AI UI Patterns](https://www.patterns.dev/react/ai-ui-patterns/) -- Streaming output, typing indicators, error handling, chat bubble UX (HIGH confidence)
- [IBM Community - SSE for Real-Time Chat](https://community.ibm.com/community/user/blogs/anjana-m-r/2025/10/03/server-sent-events-the-perfect-match-for-real-time) -- SSE as standard for LLM streaming (HIGH confidence)
- [Even Realities Smart Glasses Overview](https://www.evenrealities.com/smart-glasses) -- G2 capabilities, no camera, no speaker (HIGH confidence)
- [smartglassessupport.com](https://smartglassessupport.com/smart-glasses-companion-apps/) -- Companion app feature expectations across brands (MEDIUM confidence)
- [Meta AI Glasses companion app](https://www.meta.com/blog/ray-ban-meta-ai-glasses-new-companion-app/) -- History tab, settings, voice history patterns (MEDIUM confidence)
- [Vuzix Companion App](https://play.google.com/store/apps/details?id=com.vuzix.companion&hl=en_US) -- Connection management, device settings patterns (LOW confidence)
- [Android Authority - EvenHub developer program](https://www.androidauthority.com/even-realities-hub-smart-glasses-developers-3629083/) -- Early-access program details (MEDIUM confidence)

---
*Feature research for: Even G2 OpenClaw voice/chat companion app*
*Researched: 2026-02-27*
