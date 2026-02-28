# Phase 8: EvenHub Submission - Research

**Researched:** 2026-02-28
**Domain:** EvenHub packaging, Vite build configuration, app metadata
**Confidence:** HIGH

## Summary

Phase 8 packages the completed app as a valid EvenHub submission. The EvenHub ecosystem uses `@evenrealities/evenhub-cli` (v0.1.5, the only version published) for packaging. The `evenhub pack` command takes an `app.json` metadata file and a built dist folder, validates the metadata against a Zod schema, verifies the entrypoint exists, and produces a `.ehpk` binary artifact via a Rust WASM packer.

The current Vite config has two issues for production: (1) it includes `preview-glasses.html` as a rollup input, causing the simulator to appear in `dist/`, and (2) it uses the default `base: '/'` which produces absolute asset paths (`/assets/main.js`) instead of the relative paths (`./assets/main.js`) that EvenHub WebView requires. Both are straightforward Vite config changes. The app.json schema validation requires a specific `package_id` format (lowercase segments separated by dots, no hyphens), and the `edition` enum is locked to `"202601"` in the current CLI version.

**Primary recommendation:** Create `app.json` with validated metadata, reconfigure Vite build to exclude simulator and use relative paths, add `@evenrealities/evenhub-cli` as devDependency, and add `pack` npm script following the established community pattern.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- package_id: `lv.kingdom.bibele.openclaw-chat` (NOTE: hyphens invalid -- see Open Questions)
- Display name: `OpenClaw Chat`
- Tagline: `Voice chat with OpenClaw AI on Even G2`
- Description: `EvenHub companion app for Even G2 that provides voice/chat UX and connects to an OpenClaw backend gateway for STT + AI responses.`
- Author: `bibele.kingdom.lv`
- Entrypoint: `index.html`
- Network permission: wildcard `*` (validated -- works with evenhub pack)
- Microphone permission: declared explicitly (NOTE: no schema field -- see Open Questions)
- No filesystem permission
- No individual domains alongside wildcard
- Output artifact: `openclaw-chat.ehpk`
- Version: synced with package.json (`0.1.0`)
- Edition: `202602` (NOTE: invalid in CLI v0.1.5 -- see Open Questions)
- min_app_version: `0.1.0`
- Pack script: `npm run build && evenhub pack app.json dist -o openclaw-chat.ehpk`

### Claude's Discretion
- Production build configuration details (Vite rollup input separation for dev vs prod)
- How simulator exclusion is implemented technically
- evenhub-cli devDependency version choice
- Exact pack script command syntax and flags

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SUB-01 | app.json metadata file defines package identity, version, description, permissions, and entrypoint | Zod schema fully reverse-engineered from CLI source; 8 sibling app.json files analyzed; validation tested with actual `evenhub pack` |
| SUB-02 | Production build produces self-contained output suitable for EvenHub packaging | Vite `base: './'` pattern confirmed from rdt/weather siblings; rollup input separation pattern documented |
| SUB-03 | npm script runs `evenhub pack` to produce .ehpk submission artifact | Pack command syntax confirmed across 10+ sibling apps; `@evenrealities/evenhub-cli@^0.1.5` is the universal devDependency |
| SUB-04 | Simulator (preview-glasses.html) excluded from production build but available in dev mode | Vite conditional rollup input pattern documented; environment-based config supported natively |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @evenrealities/evenhub-cli | ^0.1.5 | CLI for packing .ehpk artifacts | Only packaging tool; used by every EvenHub app in the ecosystem |
| vite | ^6.1.0 (already installed) | Build tool producing dist/ output | Already the project's bundler; all sibling apps use Vite |

### Supporting
No additional libraries needed. This phase is configuration-only.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| evenhub-cli pack | Manual zip | .ehpk is a custom WASM-generated binary format, not a zip; CLI is required |
| vite-plugin-singlefile | Standard Vite multi-file output | STATE.md notes sibling apps ship standard Vite output successfully; single-file is unnecessary complexity |

**Installation:**
```bash
npm install --save-dev @evenrealities/evenhub-cli@^0.1.5
```

## Architecture Patterns

### Recommended Project Structure
```
.
├── app.json                    # EvenHub metadata (root, next to package.json)
├── index.html                  # Main app entry (already exists)
├── preview-glasses.html        # Simulator (dev only, excluded from prod build)
├── vite.config.ts              # Modified: conditional rollup inputs, base: './'
├── package.json                # Modified: add pack script, add evenhub-cli dep
└── dist/                       # Production output (only index.html + assets/)
    ├── index.html
    └── assets/
        ├── main-[hash].js
        ├── main-[hash].css
        └── ...
```

### Pattern 1: app.json Metadata File
**What:** A JSON file at project root defining the EvenHub package identity and permissions.
**When to use:** Required for every EvenHub submission.
**Example:**
```json
{
  "package_id": "lv.kingdom.bibele.openclawchat",
  "edition": "202601",
  "name": "OpenClaw Chat",
  "version": "0.1.0",
  "min_app_version": "0.1.0",
  "tagline": "Voice chat with OpenClaw AI on Even G2",
  "description": "EvenHub companion app for Even G2 that provides voice/chat UX and connects to an OpenClaw backend gateway for STT + AI responses.",
  "author": "bibele.kingdom.lv",
  "entrypoint": "index.html",
  "permissions": {
    "network": ["*"],
    "microphone": true
  }
}
```
Source: Zod schema extracted from `@evenrealities/evenhub-cli@0.1.5/main.js`; validated against `evenhub pack`.

### Pattern 2: Conditional Vite Rollup Inputs (Dev vs Prod)
**What:** Use Vite's `mode` or `command` parameter in `defineConfig` to include the simulator page only during development.
**When to use:** When multi-page dev setup should not leak into production build.
**Example:**
```typescript
// Source: Vite official docs (defineConfig with command parameter)
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ command }) => {
  const input: Record<string, string> = {
    main: resolve(__dirname, 'index.html'),
  };

  // Only include simulator in dev mode
  if (command === 'serve') {
    input.simulator = resolve(__dirname, 'preview-glasses.html');
  }

  return {
    root: '.',
    base: './',                    // Relative paths for EvenHub WebView
    resolve: {
      alias: { '@': resolve(__dirname, 'src') },
    },
    build: {
      outDir: 'dist',
      rollupOptions: { input },
    },
    server: { port: 3200, open: true },
    test: {
      globals: true,
      environment: 'jsdom',
      include: ['src/**/*.test.ts'],
    },
  };
});
```

### Pattern 3: Pack Script Convention
**What:** An npm script that chains build + pack into a single command.
**When to use:** Standard across all EvenHub apps.
**Example:**
```json
{
  "scripts": {
    "pack": "npm run build && evenhub pack app.json dist -o openclaw-chat.ehpk"
  }
}
```
Source: Confirmed across 10+ sibling apps (rdt, weather, tetris, snake, pong, tesla, smart-cart, jarvis-triage, even_g2_simple_code, even-g2-apps).

### Anti-Patterns to Avoid
- **Absolute base path in Vite:** Default `base: '/'` produces `/assets/main.js` paths. EvenHub WebView loads from a local context where absolute paths fail. Always use `base: './'`.
- **Including dev-only files in dist:** Current config includes `preview-glasses.html` in rollup inputs for all builds. This bloats the .ehpk and exposes internal tooling.
- **Using `vite-plugin-singlefile`:** STATE.md explicitly notes that sibling repos ship standard Vite output successfully. The plugin adds unnecessary complexity.
- **Hyphens in package_id:** The CLI regex `^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$` rejects hyphens. Use only lowercase letters and digits per segment.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| .ehpk artifact creation | Custom zip/archive script | `evenhub pack` command | .ehpk is a custom binary format produced by a Rust WASM module; cannot be replicated manually |
| app.json schema validation | Manual JSON checks | `evenhub pack` built-in Zod validation | CLI validates all fields, provides clear error messages, and checks entrypoint existence |
| Dev/prod build separation | Separate vite config files | Vite `defineConfig(({ command }) => ...)` | Native Vite pattern; single config, no duplication |

**Key insight:** The entire phase is configuration work -- creating app.json, modifying vite.config.ts, adding npm scripts, and installing one devDependency. No custom code is needed.

## Common Pitfalls

### Pitfall 1: Absolute Asset Paths
**What goes wrong:** Built index.html references `/assets/main-[hash].js` instead of `./assets/main-[hash].js`. App loads blank in EvenHub WebView.
**Why it happens:** Vite's default `base` is `'/'`, which produces absolute paths.
**How to avoid:** Set `base: './'` in vite.config.ts.
**Warning signs:** After building, check `dist/index.html` for `src="/assets/` or `href="/assets/` -- these MUST be `./assets/`.

### Pitfall 2: Invalid package_id Format
**What goes wrong:** `evenhub pack` rejects the app.json with "must be a valid package name" error.
**Why it happens:** The regex requires `^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$`. Hyphens, underscores, uppercase, and starting with digits are all rejected.
**How to avoid:** Use only lowercase letters and digits, separated by dots. Example: `lv.kingdom.bibele.openclawchat` not `lv.kingdom.bibele.openclaw-chat`.
**Warning signs:** Any non-alphanumeric character (except dots as separators) in package_id.

### Pitfall 3: Edition Enum Mismatch
**What goes wrong:** `evenhub pack` rejects `edition: "202602"` with "Invalid input: expected '202601'" error.
**Why it happens:** The CLI v0.1.5 Zod schema uses `z.enum(["202601"])` -- only one value is currently valid.
**How to avoid:** Use `"202601"` until a newer CLI version is released that supports `"202602"`.
**Warning signs:** Any edition value other than `"202601"`.

### Pitfall 4: Simulator in Production Build
**What goes wrong:** `preview-glasses.html` appears in `dist/`, bloating the .ehpk artifact with dev-only content.
**Why it happens:** Current vite.config.ts includes `simulator` in rollupOptions.input unconditionally.
**How to avoid:** Use conditional input based on `command === 'serve'` vs `command === 'build'`.
**Warning signs:** Check `ls dist/` after build -- only `index.html` and `assets/` should exist.

### Pitfall 5: evenhub-cli in dependencies instead of devDependencies
**What goes wrong:** CLI gets bundled or increases package size unnecessarily.
**Why it happens:** Running `npm install @evenrealities/evenhub-cli` without `--save-dev`.
**How to avoid:** Always install with `--save-dev`. Note: the rdt sample puts it in `dependencies` (not ideal), but most others correctly use `devDependencies`.
**Warning signs:** Check package.json -- evenhub-cli should be under `devDependencies`.

## Code Examples

Verified patterns from actual testing and sibling app analysis:

### Complete app.json (Validated)
```json
{
  "package_id": "lv.kingdom.bibele.openclawchat",
  "edition": "202601",
  "name": "OpenClaw Chat",
  "version": "0.1.0",
  "min_app_version": "0.1.0",
  "tagline": "Voice chat with OpenClaw AI on Even G2",
  "description": "EvenHub companion app for Even G2 that provides voice/chat UX and connects to an OpenClaw backend gateway for STT + AI responses.",
  "author": "bibele.kingdom.lv",
  "entrypoint": "index.html",
  "permissions": {
    "network": ["*"],
    "microphone": true
  }
}
```
Source: Tested with `evenhub pack` -- passes validation and produces valid .ehpk.

### Modified vite.config.ts
```typescript
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ command }) => {
  const input: Record<string, string> = {
    main: resolve(__dirname, 'index.html'),
  };

  if (command === 'serve') {
    input.simulator = resolve(__dirname, 'preview-glasses.html');
  }

  return {
    root: '.',
    base: './',
    resolve: {
      alias: { '@': resolve(__dirname, 'src') },
    },
    build: {
      outDir: 'dist',
      rollupOptions: { input },
    },
    server: { port: 3200, open: true },
    test: {
      globals: true,
      environment: 'jsdom',
      include: ['src/**/*.test.ts'],
    },
  };
});
```
Source: Vite official defineConfig API; tested pattern.

### Modified package.json scripts
```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "pack": "npm run build && evenhub pack app.json dist -o openclaw-chat.ehpk",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@evenrealities/evenhub-cli": "^0.1.5"
  }
}
```
Source: Pack script pattern from 10+ sibling apps.

### Verification Commands
```bash
# After build: verify no simulator in dist
ls dist/
# Expected: assets/ index.html (NO preview-glasses.html)

# After build: verify relative paths
grep -o 'src="[^"]*"' dist/index.html
# Expected: src="./assets/..." (NOT src="/assets/...")

# Pack and verify artifact
npm run pack
# Expected: "Successfully packed openclaw-chat.ehpk (NNNNN bytes)"

# Verify dev server still serves simulator
npm run dev
# Then navigate to http://localhost:3200/preview-glasses.html -- should load
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `"permissions": ["microphone"]` (Clawbber-style array) | `"permissions": { "network": [...], "fs": [...] }` (object with typed keys) | evenhub-cli v0.1.5 | Old array format fails Zod validation; use object format |
| `"entry": "index.html"` (Clawbber-style) | `"entrypoint": "index.html"` | evenhub-cli v0.1.5 | Field name changed; old name fails validation |
| No edition field | `"edition": "202601"` required enum | evenhub-cli v0.1.5 | Must use exact enum value; currently only "202601" valid |

**Deprecated/outdated:**
- `vite-plugin-singlefile`: STATE.md notes this is unnecessary -- sibling repos ship standard multi-file Vite output with `evenhub pack` successfully
- Array-style permissions: Replaced by object-style `{ network: [], fs: [] }`

## Open Questions

1. **package_id contains hyphens -- `openclaw-chat` fails validation**
   - What we know: The Zod regex `^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$` rejects hyphens. The user decided on `lv.kingdom.bibele.openclaw-chat`.
   - Tested: `evenhub pack` rejects `lv.kingdom.bibele.openclaw-chat` but accepts `lv.kingdom.bibele.openclawchat`.
   - Recommendation: Use `lv.kingdom.bibele.openclawchat` (remove hyphen). This is the most common convention in sibling apps (e.g., `com.nickustinov.weather`, `com.bryanbaldwin.smartcart`). Flag to user during planning.

2. **edition "202602" is not valid in CLI v0.1.5**
   - What we know: The edition enum in the CLI only contains `"202601"`. User decided on `"202602"`.
   - Tested: `evenhub pack` rejects `"202602"` with "Invalid input: expected '202601'".
   - Recommendation: Use `"202601"` for now. This is what every existing app uses. A newer CLI version may add `"202602"` later. Flag to user during planning.

3. **Microphone permission has no dedicated schema field**
   - What we know: The permissions Zod schema only defines `network` and `fs` arrays. `"microphone": true` passes validation because Zod allows extra keys by default, but it may not be enforced by the EvenHub runtime.
   - Tested: `"microphone": true` in the permissions object does NOT cause validation errors.
   - Recommendation: Include `"microphone": true` in permissions as the user decided. It passes pack validation and may be recognized by the EvenHub runtime even though the CLI schema doesn't explicitly define it. The Clawbber app (a voice-input app) used a different format, suggesting microphone permissions exist at the platform level.

## Sources

### Primary (HIGH confidence)
- `@evenrealities/evenhub-cli@0.1.5` source code (main.js) - Zod schema extracted, pack function analyzed
- `@evenrealities/evenhub-cli@0.1.5` README.md - Command documentation
- Direct `evenhub pack` testing - Validated app.json fields, wildcard network, edition enum, package_id regex

### Secondary (MEDIUM confidence)
- 8 sibling app.json files analyzed (rdt, weather, restapi, clawbber, smart-cart, tetris, jarvis-triage, even-g2-apps)
- 10+ sibling package.json files analyzed for pack script patterns
- Sibling vite.config.ts files (rdt, weather) for `base: './'` pattern

### Tertiary (LOW confidence)
- Microphone permission runtime behavior: Only validated that it passes CLI pack; unclear if EvenHub runtime uses it

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Only one packaging tool exists; version confirmed; installation pattern universal
- Architecture: HIGH - Vite conditional config is well-documented; patterns confirmed across sibling apps; build output verified
- Pitfalls: HIGH - All pitfalls discovered through direct testing with `evenhub pack`; package_id regex and edition enum validated empirically

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (stable -- evenhub-cli has only one published version; changes unlikely to be breaking)
