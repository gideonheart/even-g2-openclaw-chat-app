---
phase: 08-evenhub-submission
verified: 2026-02-28T14:00:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
gaps: []
human_verification:
  - test: "Dev server serves preview-glasses.html"
    expected: "Navigating to http://localhost:3200/preview-glasses.html loads the simulator UI"
    why_human: "Cannot start and query a dev server in a static verification pass; Vite config logic verified correct but runtime behavior requires a browser"
---

# Phase 8: EvenHub Submission Verification Report

**Phase Goal:** App is packaged as a valid EvenHub submission with correct metadata, a self-contained production build, and a working .ehpk artifact
**Verified:** 2026-02-28T14:00:00Z
**Status:** PASSED (all automated must-haves verified; one item flagged for optional human confirmation)
**Re-verification:** No -- initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | app.json defines package identity, version, description, permissions (network wildcard, microphone), and entrypoint | VERIFIED | `app.json` contains all required fields: `package_id`, `edition`, `name`, `version`, `min_app_version`, `tagline`, `description`, `author`, `entrypoint: "index.html"`, `permissions.network: ["*"]`, `permissions.microphone: true` |
| 2 | Production build produces only index.html and assets/ in dist/ -- no preview-glasses.html | VERIFIED | `ls dist/` shows only `index.html` (23509 bytes) and `assets/` directory; `dist/preview-glasses.html` does not exist |
| 3 | Production build uses relative asset paths (./assets/) not absolute (/assets/) | VERIFIED | `dist/index.html` contains `src="./assets/main-BN_0RD-1.js"` and `href="./assets/main-BfAqNzuS.css"` -- no `/assets/` references found |
| 4 | Running npm run pack produces a .ehpk artifact file | VERIFIED | `openclaw-chat.ehpk` exists at project root, 42768 bytes (non-zero); excluded from git via `*.ehpk` in `.gitignore` |
| 5 | Dev server still serves preview-glasses.html at http://localhost:3200/preview-glasses.html | VERIFIED (static) / ? HUMAN | `vite.config.ts` conditionally includes `preview-glasses.html` in rollup inputs only when `command === 'serve'`; runtime behaviour requires human confirmation |

**Score:** 5/5 truths verified (automated); 1 flagged for optional human test

---

### Required Artifacts

| Artifact | Expected | Exists | Substantive | Wired | Status |
|----------|----------|--------|-------------|-------|--------|
| `app.json` | EvenHub package metadata | Yes | Yes -- all 11 required fields present with correct values | Yes -- referenced by pack script as first argument | VERIFIED |
| `vite.config.ts` | Conditional rollup inputs and relative base path | Yes | Yes -- `defineConfig(({ command }) => {...})`, `base: './'`, conditional input on `command === 'serve'` | Yes -- drives both build and dev-server output | VERIFIED |
| `package.json` | Pack npm script and evenhub-cli devDependency | Yes | Yes -- `"pack"` script present, `@evenrealities/evenhub-cli: "^0.1.5"` under `devDependencies` | Yes -- script chains `npm run build && evenhub pack app.json dist -o openclaw-chat.ehpk` | VERIFIED |
| `openclaw-chat.ehpk` | EvenHub submission artifact (produced by npm run pack) | Yes | Yes -- 42768 bytes, non-zero size | Yes -- excluded from git (`*.ehpk` in `.gitignore`) | VERIFIED |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `package.json` | `app.json` | pack script references app.json as first argument | WIRED | `package.json` line 13: `"pack": "npm run build && evenhub pack app.json dist -o openclaw-chat.ehpk"` -- matches pattern `evenhub pack app\.json` |
| `app.json` | `dist/index.html` | entrypoint field must match a file in dist/ | WIRED | `app.json` line 10: `"entrypoint": "index.html"` -- `dist/index.html` exists (23509 bytes) |
| `vite.config.ts` | `dist/` | build output with conditional inputs and relative base | WIRED | `vite.config.ts` line 16: `base: './'` -- confirmed in `dist/index.html` which uses `./assets/` paths throughout |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SUB-01 | 08-01-PLAN.md | app.json metadata file defines package identity, version, description, permissions, and entrypoint | SATISFIED | `app.json` contains all required fields; `package_id: "lv.kingdom.bibele.openclawchat"`, `edition: "202601"`, `permissions.network: ["*"]`, `permissions.microphone: true`, `entrypoint: "index.html"` |
| SUB-02 | 08-01-PLAN.md | Production build produces self-contained output suitable for EvenHub packaging | SATISFIED | `dist/` contains only `index.html` + `assets/`; all asset paths are relative (`./assets/`); no dev-only files present |
| SUB-03 | 08-01-PLAN.md | npm script runs `evenhub pack` to produce .ehpk submission artifact | SATISFIED | `package.json` `"pack"` script exists and chains `npm run build && evenhub pack app.json dist -o openclaw-chat.ehpk`; `openclaw-chat.ehpk` at 42768 bytes confirms successful execution |
| SUB-04 | 08-01-PLAN.md | Simulator (preview-glasses.html) excluded from production build but available in dev mode | SATISFIED (automated) | `dist/preview-glasses.html` absent; `vite.config.ts` conditionally adds simulator input only when `command === 'serve'`; dev-mode behaviour pending human confirmation |

No orphaned requirements found -- all four SUB-0x IDs declared in PLAN frontmatter map 1:1 to REQUIREMENTS.md entries, all marked Phase 8 / Complete.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | -- | -- | -- | -- |

No TODOs, FIXMEs, placeholder returns, empty handlers, or stub implementations found in `app.json`, `vite.config.ts`, or `package.json`.

---

### Human Verification Required

#### 1. Dev Server Serves Simulator

**Test:** Run `npm run dev` in the project directory, then navigate to `http://localhost:3200/preview-glasses.html` in a browser.
**Expected:** The simulator page loads (not a 404 or blank screen).
**Why human:** Starting a Vite dev server and making an HTTP request is not possible in a static verification pass. The Vite config logic is provably correct (`command === 'serve'` conditionally includes `preview-glasses.html` in rollup inputs), but the runtime behaviour must be confirmed by a person.

---

### Decisions Accepted (Deviations from CONTEXT.md)

Two deliberate deviations from the user's initial CONTEXT.md decisions were made during research and recorded in the PLAN and SUMMARY:

1. **package_id uses `openclawchat` (no hyphen) instead of `openclaw-chat`** -- the evenhub-cli v0.1.5 regex `^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$` rejects hyphens. Validated empirically. This is correct behaviour; the `.ehpk` artifact at 42768 bytes confirms pack validation passed.

2. **edition uses `"202601"` instead of user's `"202602"`** -- the CLI Zod schema `z.enum(["202601"])` only accepts this value. Validated empirically. Same confirmation: successful `.ehpk` artifact.

Both deviations were forced by CLI validation constraints documented in 08-RESEARCH.md, flagged in 08-01-PLAN.md, and recorded in 08-01-SUMMARY.md. No action required.

---

### Gaps Summary

No gaps. All five observable truths are verified. All four required artifacts exist, are substantive, and are correctly wired. All three key links are confirmed. All four requirement IDs (SUB-01 through SUB-04) are satisfied with direct evidence. No blocker anti-patterns found.

The only open item is optional human confirmation that the dev server serves the simulator at runtime -- the static code analysis provides strong confidence that it does.

---

_Verified: 2026-02-28T14:00:00Z_
_Verifier: Claude (gsd-verifier)_
