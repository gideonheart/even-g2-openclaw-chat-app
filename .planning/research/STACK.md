# Stack Research: v1.1 Integration Additions

**Project:** Even G2 OpenClaw Chat App -- v1.1 Integration Milestone
**Domain:** EvenHub smart glasses app -- runtime wiring + submission packaging
**Researched:** 2026-02-28
**Confidence:** HIGH

## Scope

This research covers ONLY the stack additions needed for v1.1:
1. Single-file build packaging (vite-plugin-singlefile)
2. EvenHub submission tooling (@evenrealities/evenhub-cli)
3. EvenHub app metadata format (app.json)
4. Runtime wiring considerations (no new deps -- existing modules)

The existing stack (Vite 6, TypeScript 5.7, Vitest 3, @evenrealities/even_hub_sdk 0.0.7, jsdom, eventsource-parser) is validated and NOT re-researched.

## Critical Finding: vite-plugin-singlefile Is Optional

The PROJECT.md specifies "self-contained dist/index.html via vite-plugin-singlefile" but investigation of 35+ Even G2 sample apps reveals that NONE use vite-plugin-singlefile. The standard EvenHub submission workflow is:

1. `vite build` produces a standard multi-file `dist/` directory
2. `evenhub pack app.json dist/` bundles the entire directory into a `.ehpk` archive
3. The `.ehpk` file is the submission artifact

**Recommendation:** Still add vite-plugin-singlefile because the PROJECT.md explicitly requires it, and a self-contained index.html has real advantages for this project: it simplifies the WebView loading (single file = no relative path resolution issues), eliminates asset path bugs, and works offline when cached. But understand it is a project design choice, not an EvenHub platform requirement.

## New Dependencies

### Build Tooling

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| vite-plugin-singlefile | ^2.3.0 | Inline all JS/CSS into dist/index.html | Produces a single self-contained HTML file. v2.3.0 supports Vite `^5.4.11 \|\| ^6.0.0 \|\| ^7.0.0` -- our Vite 6.1 is fully covered. Peer dep on `rollup ^4.44.1` is satisfied by Vite 6's bundled Rollup 4. Adds zero runtime cost (build-time only). 480K+ weekly npm downloads. MIT licensed. | HIGH |
| @evenrealities/evenhub-cli | ^0.1.5 | `evenhub pack` command for .ehpk submission | Official Even Realities CLI. Used by the sibling even-g2-apps repo at this exact version. Provides `evenhub pack <json> <project>` which takes app.json + dist/ directory and produces the .ehpk submission artifact. Also provides `evenhub init` for scaffolding app.json and `evenhub login` for account auth. Peer dep: TypeScript ^5. | HIGH |

### Runtime Dependencies

No new runtime dependencies are needed. The voice loop wiring connects existing modules:
- `createEventBus()` (events.ts) -- already exists
- `createEvenBridgeService()` (bridge/even-bridge.ts) -- already exists
- `createAudioCapture()` (audio/audio-capture.ts) -- already exists
- `createGatewayClient()` (api/gateway-client.ts) -- already exists
- `createGestureHandler()` (gestures/gesture-handler.ts) -- already exists
- `createGlassesRenderer()` (display/glasses-renderer.ts) -- already exists
- `createDisplayController()` (display/display-controller.ts) -- already exists

The entire voice loop (tap -> record -> gateway -> stream -> glasses display) is assembled by wiring these existing factory functions together in main.ts with the shared event bus.

## Vite Config Integration

### Current vite.config.ts

The existing config has multi-page input (index.html + preview-glasses.html) and a test block. The singlefile plugin requires specific changes.

### Required Changes

```typescript
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  root: '.',
  plugins: [viteSingleFile()],        // <-- ADD
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    // CHANGE: Single entry for EvenHub submission.
    // The simulator (preview-glasses.html) is a dev tool, not part of
    // the submission package. Build it separately if needed.
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
  server: {
    port: 3200,
    open: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
```

### Key Integration Points

1. **Single entry point**: The EvenHub submission needs one index.html. The multi-page config (index.html + preview-glasses.html) must change to single-entry for the production build. The simulator is a dev tool.

2. **Plugin defaults are correct**: `useRecommendedBuildConfig: true` (default) sets `cssCodeSplit: false`, `assetsInlineLimit: Infinity`, and disables code-splitting -- all correct for a single-file output.

3. **removeViteModuleLoader**: Leave at default (`false`). The Vite module loader is tiny and removing it can cause issues with dynamic imports if any are used.

4. **No CSS/asset concerns**: The project uses inline styles in index.html (no separate CSS files) and no image assets. The singlefile plugin will inline the single JS bundle.

## app.json Metadata Format

The EvenHub app.json format is reverse-engineered from 8+ sample apps in the local codebase. Fields observed:

### Required Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `package_id` | string | Reverse-domain unique identifier | `"com.openclaw.even-g2-chat"` |
| `name` | string | Display name in EvenHub store | `"OpenClaw Chat"` |
| `version` | string | Semver version | `"1.1.0"` |
| `description` | string | App description | `"Voice chat with OpenClaw AI..."` |
| `author` | string | Developer name or email | `"Your Name"` |
| `entrypoint` | string | Main HTML file in dist/ | `"index.html"` |

### Optional Fields

| Field | Type | Description | When to Use |
|-------|------|-------------|-------------|
| `edition` | string | Edition code (YYYYMM format) | Versioning metadata |
| `min_app_version` | string | Minimum Even App version required | If using newer SDK features |
| `tagline` | string | Short marketing tagline | EvenHub listing |
| `permissions.network` | string[] | Allowed network domains | Apps that make HTTP requests |
| `permissions.fs` | string[] | Allowed filesystem paths | Apps with local assets |

### Recommended app.json for This Project

```json
{
  "package_id": "com.openclaw.even-g2-chat",
  "edition": "202602",
  "name": "OpenClaw Chat",
  "version": "1.1.0",
  "min_app_version": "0.1.0",
  "tagline": "Voice chat with AI through your G2 glasses.",
  "description": "Speak through your Even G2 glasses, get streaming AI responses displayed as compact bubble chat on the heads-up display. Powered by OpenClaw.",
  "author": "OpenClaw",
  "entrypoint": "index.html",
  "permissions": {
    "network": ["*"]
  }
}
```

**Note on `permissions.network`**: This app sends audio to a user-configurable gateway URL (not a fixed domain), so the network permission must be broad. Use `["*"]` or list the expected gateway domains. If EvenHub requires explicit domains, the gateway URL from settings would need to match.

## Installation

```bash
# New dev dependency (build-time only)
npm install -D vite-plugin-singlefile@^2.3.0

# New dependency (submission CLI)
npm install @evenrealities/evenhub-cli@^0.1.5
```

### Package.json Script Additions

```json
{
  "scripts": {
    "pack": "evenhub pack app.json dist",
    "build:submit": "tsc && vite build && evenhub pack app.json dist"
  }
}
```

## What NOT to Add

| Avoid | Why | What to Do Instead |
|-------|-----|-------------------|
| Framework (React, Svelte, etc.) | Project is vanilla TS with direct DOM manipulation. 440-line main.ts is manageable. Adding a framework for runtime wiring would be overengineering. | Wire factories manually in main.ts init() |
| State management library (XState, Zustand) | Gesture FSM is 50 lines. App state is a plain object. Event bus handles all pub/sub. | Keep createAppState() + event bus pattern |
| Vite version upgrade to 7.x | Current Vite 6.1 is stable. vite-plugin-singlefile supports it. Upgrading Vite is unnecessary churn for this milestone. | Stay on Vite ^6.1.0 |
| TypeScript upgrade to 5.9/6.0 | Current ^5.7.0 works. No features needed from newer versions. | Stay on ^5.7.0 |
| eventsource-parser (explicit install) | The project's gateway-client.ts has a hand-rolled SSE parser (parseSSELines). The eventsource-parser package is listed in PROJECT.md context but is NOT in package.json dependencies. Do NOT add it -- the existing parser works and has tests. | Keep the existing parseSSELines() |
| vite-plugin-singlefile-compression | Adds gzip/brotli compression to the single file. Unnecessary -- the .ehpk format handles packaging and the WebView loads locally. | Use standard vite-plugin-singlefile |
| Additional test frameworks | Vitest 3 with jsdom handles all testing needs. The new wiring code is integration-level (connect factories, verify events flow). | Write integration tests with Vitest |

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| vite-plugin-singlefile ^2.3.0 | Manual Rollup config with `inlineDynamicImports` | Plugin is battle-tested, handles edge cases (base64 encoding, CSS inlining), and has 480K+ weekly downloads. Manual config is error-prone. |
| vite-plugin-singlefile ^2.3.0 | Skip single-file, use standard Vite build | Standard build works fine with `evenhub pack`. But PROJECT.md explicitly requires self-contained index.html, and it has genuine benefits for WebView reliability. |
| @evenrealities/evenhub-cli ^0.1.5 | Manual .ehpk creation | The .ehpk format uses a WASM-based packer (ehpk_pack_bg.wasm). No public spec. Must use official CLI. |
| evenhub-cli as dependency | evenhub-cli as global install | Keeping it as a project dependency ensures reproducible builds. Anyone cloning the repo gets the right version via `npm install`. |

## Version Compatibility Matrix

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| vite-plugin-singlefile@^2.3.0 | vite@^6.1.0 | Peer dep: `vite ^5.4.11 \|\| ^6.0.0 \|\| ^7.0.0`. Our Vite 6.1 is in range. |
| vite-plugin-singlefile@^2.3.0 | rollup@^4.x | Peer dep: `rollup ^4.44.1`. Vite 6 bundles Rollup 4. Satisfied. |
| @evenrealities/evenhub-cli@^0.1.5 | typescript@^5.x | Peer dep: `typescript ^5`. Our TS ^5.7.0 is in range. |
| @evenrealities/even_hub_sdk@^0.0.7 | vite-plugin-singlefile | SDK is ESM with `"sideEffects": false`. Tree-shaking and inlining work correctly. |

## Runtime Wiring Architecture (No New Deps)

The voice loop wiring in main.ts follows a specific initialization order dictated by module dependencies:

```
1. createEventBus<AppEventMap>()           -- shared bus, no deps
2. createAudioCapture(devMode)             -- standalone, no bus dep
3. createEvenBridgeService(bus)            -- needs bus
4. createGatewayClient()                   -- standalone
5. createGestureHandler({bus, bridge, audioCapture, activeSessionId})
                                           -- needs bus, bridge, audioCapture
6. createGlassesRenderer({bridge, bus})    -- needs bridge, bus
7. createDisplayController({bus, renderer, gestureHandler})
                                           -- needs bus, renderer, gestureHandler
                                           -- MUST be created AFTER gestureHandler
                                              (event registration order matters)
```

The critical wiring gap (from PROJECT.md active requirements):
- `bridge:audio-frame` -> `audioCapture.onFrame()` bus subscription is NOT yet wired
- `audio:recording-stop` -> `gateway.sendVoiceTurn()` is NOT yet wired
- `gateway:chunk` -> event bus forwarding is NOT yet wired

These are pure event bus subscriptions in main.ts, requiring zero new libraries.

## Sources

- [vite-plugin-singlefile GitHub](https://github.com/richardtallent/vite-plugin-singlefile) -- README, CHANGELOG, package.json verified
- [vite-plugin-singlefile Vite 6 compatibility issue #104](https://github.com/richardtallent/vite-plugin-singlefile/issues/104) -- resolved in v2.1.0
- [vite-plugin-singlefile CHANGELOG](https://github.com/richardtallent/vite-plugin-singlefile/blob/main/CHANGELOG.md) -- v2.3.0 confirmed latest
- @evenrealities/even_hub_sdk README.md -- read from installed node_modules (v0.0.7)
- @evenrealities/evenhub-cli package.json -- read from sibling repo node_modules (v0.1.5)
- `evenhub pack --help` -- verified CLI interface locally
- 8 app.json files across local Even G2 sample projects -- metadata format reverse-engineered
- [EvenHub Developer Portal](https://evenhub.evenrealities.com/) -- platform overview
- Sibling repo even-g2-apps/package.json -- reference implementation of build + pack workflow

---
*Stack research for: v1.1 Integration milestone (runtime wiring + EvenHub submission)*
*Researched: 2026-02-28*
