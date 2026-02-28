# Technology Stack

**Project:** Even G2 OpenClaw Chat App
**Researched:** 2026-02-27
**Overall confidence:** HIGH (verified against sibling repo, official SDK, and current package versions)

## Recommended Stack

### Core Build Tooling

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Vite | ^7.2.4 | Build tool, dev server, bundler | Already used in the sibling `even-g2-apps` repo at this exact version. Vite 7 uses Rolldown (Rust-based bundler), supports vanilla-ts template out of the box, and the EvenHub CLI (`evenhub pack`) expects a Vite-produced `dist/` directory. No reason to deviate. | HIGH |
| TypeScript | ~5.9.3 | Type-safe application code | Already used in sibling repo. TypeScript 6.0 is beta-only (released 2026-02-11); stay on 5.9.x for stability. Strict mode is a project requirement. | HIGH |
| vite-plugin-singlefile | ^2.3.0 | Inline JS/CSS into single index.html | EvenHub submission requires a self-contained `dist/index.html`. Version 2.3.0 explicitly supports Vite 7 (`^5.4.11 \|\| ^6.0.0 \|\| ^7.0.0` peer dep). | HIGH |

### Even G2 Platform SDK

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| @evenrealities/even_hub_sdk | ^0.0.6 | Glasses bridge API (display, events, audio) | The official SDK. Provides `waitForEvenAppBridge()`, `EvenAppBridge`, container model (`TextContainerProperty`, `ListContainerProperty`, `ImageContainerProperty`), `textContainerUpgrade()`, `onEvenHubEvent()` callback, and `OsEventTypeList` enum. Already used in sibling repo. This is the only way to communicate with G2 glasses. | HIGH |
| @evenrealities/evenhub-cli | ^0.1.5 | App packaging and submission | Official CLI for `evenhub pack` which takes an `app.json` and `dist/` directory to produce the submission artifact. Already used in sibling repo. | HIGH |

### Streaming & SSE

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| eventsource-parser | ^3.0.6 | Parse SSE stream from gateway backend | 16M+ weekly downloads. Zero dependencies. Provides both callback-based `createParser()` and `EventSourceParserStream` TransformStream for piping through `fetch()` responses. The gateway will stream AI responses as SSE; this parser works with any fetch-based transport without requiring the native `EventSource` API (which cannot set custom headers). TypeScript-first. | HIGH |

### Testing

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Vitest | ^4.0.18 | Unit and integration testing | Project requirement specifies Vitest. Current stable is 4.x with stable browser mode. Reuses Vite config, zero-config TypeScript support, native ESM. 17M weekly downloads. | HIGH |

### State Management (Gesture Machine)

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Custom FSM (no library) | N/A | Gesture state machine (4 inputs) | The gesture input model has exactly 4 inputs (tap, double-tap, scroll-up, scroll-down) and ~6 states (idle, recording, sent, thinking, menu, scrolling). This is a trivial FSM -- under 100 lines of TypeScript. XState adds 16+ KB gzipped for a problem that does not need actors, parallel states, or statecharts. Write a typed `switch`/`Record` machine. | HIGH |

### Persistence

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| localStorage (browser native) | N/A | Settings persistence, session data | Project explicitly calls for localStorage-based persistence with secure masking for keys. No IndexedDB needed -- settings are small JSON objects. Wrap in a typed `SettingsStore` module. | HIGH |

## Supporting Libraries (zero additional runtime dependencies recommended)

| Library | Purpose | Recommendation |
|---------|---------|----------------|
| Web Audio API (native) | Audio capture from glasses microphone via EvenHub SDK audio events | The SDK delivers PCM audio via `bridge.onEvenHubEvent` audioEvent. No MediaRecorder needed -- the glasses handle capture, the web app receives PCM chunks. |
| ReadableStream (native) | Streaming fetch response processing | Native browser API for consuming SSE stream from gateway. Pipe through `TextDecoderStream` then `EventSourceParserStream`. |
| CSS Custom Properties (native) | Design tokens | Already using `even-g2-apps/shared/styles/tokens.css` for the Even design system. Import and extend, do not duplicate. |
| Canvas 2D API (native) | Glasses display image rendering | Already used in sibling repo for pixel rendering. The G2 display is 576x288 4-bit greyscale rendered via `updateImageRawData()`. |

## What NOT to Use

| Technology | Why Not |
|------------|---------|
| React / Preact / Svelte / any framework | The sibling `even-g2-apps` uses vanilla-ts with Vite. EvenHub apps are thin web apps -- no virtual DOM needed. The G2 display uses a firmware container model, not DOM rendering. A framework adds bundle size, complexity, and indirection for zero benefit. |
| XState | 16+ KB gzipped for a 4-input / 6-state FSM. Overkill. The gesture machine is trivially implementable in pure TypeScript with exhaustive type checking. |
| Zustand / Jotai / any state library | App state is minimal: current chat messages, current gesture state, settings object. A simple module-scoped store with typed getters/setters suffices. |
| Tailwind CSS | The Even design system uses its own CSS custom properties and component classes. Adding Tailwind would conflict with the established token system and add build complexity. |
| Socket.IO / ws | The backend gateway streams SSE (server-to-client). Audio input goes via HTTP POST. No bidirectional WebSocket channel is needed for this architecture. |
| IndexedDB / Dexie | Chat history and settings are small. localStorage handles the persistence requirements. If chat history grows beyond limits, truncate old entries -- the glasses display is 576x288 and shows at most a few visible bubbles anyway. |
| TypeScript 6.0 beta | Still in beta as of 2026-02-27. The sibling repo uses 5.9.3. Stay aligned for shared code compatibility. |
| Web Speech API (SpeechRecognition) | Chrome-only, unreliable, and the architecture delegates STT to the backend gateway. The glasses microphone feeds PCM to the gateway which handles transcription. |

## Alternatives Considered

| Category | Recommended | Alternative | Why Recommended Wins |
|----------|-------------|-------------|---------------------|
| Build tool | Vite 7 | esbuild standalone, Webpack | Vite is already used in sibling repo, EvenHub CLI expects Vite output, HMR is instant, vanilla-ts template is first-class |
| SSE parsing | eventsource-parser | Native EventSource, @microsoft/fetch-event-source | Native EventSource cannot set custom headers (needed for auth). @microsoft/fetch-event-source is unmaintained since 2023. eventsource-parser is actively maintained with 16M+ downloads |
| State machine | Custom TypeScript FSM | XState 5, Robot | 4 inputs, 6 states, no parallel/hierarchical needs. Custom FSM is <100 LOC, zero bundle cost, fully typed |
| Testing | Vitest 4 | Jest 30 | Vitest reuses Vite config, native ESM/TS support, project requirement, sibling repo alignment |
| Bundling strategy | vite-plugin-singlefile | manual inline, vite-plugin-inline | vite-plugin-singlefile is well-maintained, explicit Vite 7 support in v2.3.0, simple config |

## Project Structure (Vite vanilla-ts)

```
even-g2-openclaw-chat-app/
  index.html                  # Vite entry point (companion hub UI)
  preview-glasses.html        # Simulator (existing, kept as-is or migrated)
  app.json                    # EvenHub submission manifest
  vite.config.ts              # Vite config with @shared alias, singlefile plugin
  tsconfig.json               # TypeScript strict, bundler mode
  src/
    main.ts                   # App bootstrap, bridge init
    bridge/
      even-bridge.ts          # EvenHub SDK wrapper, event dispatch
      audio-capture.ts        # Audio event handler, PCM chunk forwarding
    chat/
      chat-store.ts           # Chat message model, history management
      bubble-renderer.ts      # Bubble layout for companion view
      viewport.ts             # Virtualized viewport (glasses display)
      stream-handler.ts       # SSE stream consumer, incremental text
    gestures/
      gesture-machine.ts      # 4-input FSM (tap, double-tap, scroll-up, scroll-down)
      gesture-types.ts        # State/event type definitions
    glasses/
      glasses-ui.ts           # G2 container management (text, status, layout)
      display-renderer.ts     # 576x288 content composition
    api/
      gateway-client.ts       # Backend API client (voice submit, SSE stream)
      types.ts                # API request/response types
    settings/
      settings-store.ts       # localStorage wrapper with validation
      settings-types.ts       # Settings schema types
    ui/
      pages/                  # Home, Health, Features, Settings, Logs
      components/             # Shared UI components
      icons/                  # SVG icon registry, animation frames
    types/
      index.ts                # Shared frontend types
  test/
    chat/                     # Chat model and renderer tests
    gestures/                 # FSM tests
    api/                      # API client tests
    settings/                 # Settings store tests
```

## Installation

```bash
# Initialize Vite vanilla-ts project
npm create vite@latest even-g2-openclaw-chat-app -- --template vanilla-ts
cd even-g2-openclaw-chat-app

# Core dependencies
npm install @evenrealities/even_hub_sdk@^0.0.6 eventsource-parser@^3.0.6

# Dev dependencies
npm install -D vite@^7.2.4 typescript@~5.9.3 vitest@^4.0.18 vite-plugin-singlefile@^2.3.0 @evenrealities/evenhub-cli@^0.1.5 @types/node@^22.13.4
```

## Key Configuration

### tsconfig.json (match sibling repo)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["src"]
}
```

### vite.config.ts

```typescript
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
```

### package.json scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest",
    "test:run": "vitest run",
    "pack": "evenhub pack app.json dist"
  }
}
```

## G2 Display Constraints (Stack Implications)

The G2 display model is NOT DOM-based. Understanding this is critical for stack decisions:

- **576x288 pixels per eye**, 4-bit greyscale (16 shades of green), micro-LED
- **Max 4 containers per page** (text, list, image), absolutely positioned with pixel coordinates
- **No CSS, no flexbox, no DOM** on the glasses -- containers are firmware-rendered
- **Text containers**: left-aligned only, no font size control, single fixed-width font, max 2000 chars via `textContainerUpgrade()`
- **Update path**: `createStartUpPageContainer()` for initial layout, `textContainerUpgrade()` for streaming text updates, `rebuildPageContainer()` for layout changes
- **Events**: `bridge.onEvenHubEvent()` delivers tap, scroll boundary (top/bottom), system events, audio PCM, and list selection events

This means the "glasses view" is managed entirely through SDK calls, not DOM manipulation. The companion web UI (index.html) is a standard web app for settings/diagnostics. These are two separate rendering targets from the same codebase.

## Audio Pipeline (No Additional Libraries)

The audio pipeline does NOT use the Web Audio API or MediaRecorder directly:

1. G2 glasses capture audio via built-in microphone
2. EvenHub SDK delivers PCM audio chunks via `bridge.onEvenHubEvent()` audioEvent
3. Frontend accumulates PCM chunks and POSTs to backend gateway
4. Gateway handles STT (WhisperX/OpenAI) and returns transcription
5. Gateway forwards transcription to OpenClaw agent
6. Agent response streams back as SSE, parsed by `eventsource-parser`

For browser-only dev/testing (no glasses connected), use `navigator.mediaDevices.getUserMedia()` as a fallback audio source with `MediaRecorder` to capture webm/opus. This is native browser API -- no library needed.

## Sources

- Even G2 Notes (community documentation): https://github.com/nickustinov/even-g2-notes/blob/main/G2.md (MEDIUM confidence -- community-maintained, not official)
- Even Hub Developer Portal: https://evenhub.evenrealities.com/ (HIGH confidence -- official)
- Even Realities GitHub / EvenDemoApp: https://github.com/even-realities/EvenDemoApp (HIGH confidence -- official reference app)
- Sibling repo `even-g2-apps` at `/home/forge/bibele.kingdom.lv/samples/even-g2-apps/` (HIGH confidence -- first-party, working code with matching SDK versions)
- Vite 7.0 release: https://vite.dev/blog/announcing-vite7 (HIGH confidence -- official)
- Vitest 4.0 release: https://vitest.dev/blog/vitest-4 (HIGH confidence -- official)
- eventsource-parser: https://github.com/rexxars/eventsource-parser (HIGH confidence -- npm 16M+ weekly downloads, TypeScript-first)
- vite-plugin-singlefile: https://github.com/richardtallent/vite-plugin-singlefile (HIGH confidence -- explicit Vite 7 peer dep in v2.3.0)
- TypeScript 6.0 Beta announcement: https://devblogs.microsoft.com/typescript/announcing-typescript-6-0-beta/ (HIGH confidence -- official, confirms beta-only status)
