---
phase: 08-evenhub-submission
plan: 01
subsystem: infra
tags: [evenhub, vite, packaging, ehpk, build-config]

# Dependency graph
requires:
  - phase: 06-runtime-wiring
    provides: Complete working app with all modules wired and 265 passing tests
provides:
  - app.json EvenHub package metadata with validated schema
  - Conditional Vite build config (dev includes simulator, prod excludes it)
  - npm run pack script producing .ehpk submission artifact
affects: []

# Tech tracking
tech-stack:
  added: ["@evenrealities/evenhub-cli@^0.1.5"]
  patterns: ["Conditional Vite defineConfig with command parameter", "Relative base path for WebView compatibility"]

key-files:
  created: [app.json]
  modified: [vite.config.ts, package.json, .gitignore]

key-decisions:
  - "Used package_id 'lv.kingdom.bibele.openclawchat' (no hyphen) -- CLI regex rejects hyphens"
  - "Used edition '202601' instead of '202602' -- CLI Zod enum only accepts '202601'"
  - "Added *.ehpk to .gitignore -- build artifact should not be committed"

patterns-established:
  - "Conditional rollup inputs: command === 'serve' for dev-only pages"
  - "Relative base path: base './' for EvenHub WebView asset loading"
  - "Pack script convention: npm run build && evenhub pack app.json dist -o name.ehpk"

requirements-completed: [SUB-01, SUB-02, SUB-03, SUB-04]

# Metrics
duration: 3min
completed: 2026-02-28
---

# Phase 8 Plan 1: EvenHub Submission Summary

**EvenHub packaging with app.json metadata, conditional Vite build (simulator exclusion + relative paths), and evenhub pack producing 42KB .ehpk artifact**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-28T13:17:45Z
- **Completed:** 2026-02-28T13:20:29Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created app.json with validated EvenHub package metadata (package_id, permissions, entrypoint)
- Reconfigured Vite for production: conditional rollup inputs exclude simulator, relative base path for WebView
- Installed evenhub-cli and added pack npm script producing openclaw-chat.ehpk (42768 bytes)
- All 265 existing tests continue to pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Create app.json and add evenhub-cli + pack script** - `4795e87` (feat)
2. **Task 2: Configure Vite for production build and verify pack pipeline** - `d14bbc0` (feat)

## Files Created/Modified
- `app.json` - EvenHub package metadata (package_id, edition, permissions, entrypoint)
- `vite.config.ts` - Conditional defineConfig with command parameter, base: './', simulator exclusion in prod
- `package.json` - Added evenhub-cli devDependency and pack script
- `.gitignore` - Added *.ehpk pattern for build artifacts

## Decisions Made
- Used `openclawchat` (no hyphen) in package_id instead of user's `openclaw-chat` -- evenhub-cli v0.1.5 regex rejects hyphens (validated empirically during research)
- Used edition `"202601"` instead of user's `"202602"` -- CLI Zod schema only accepts this value (validated empirically during research)
- Added `*.ehpk` to `.gitignore` since it's a generated build artifact (Rule 2 auto-fix)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added *.ehpk to .gitignore**
- **Found during:** Task 2 (pack pipeline verification)
- **Issue:** The .ehpk build artifact would be tracked by git without an ignore pattern
- **Fix:** Added `*.ehpk` to .gitignore
- **Files modified:** .gitignore
- **Verification:** `git status` no longer shows openclaw-chat.ehpk as untracked
- **Committed in:** d14bbc0 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Minor addition to prevent build artifacts in source control. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- App is fully packaged and ready for EvenHub portal submission
- The openclaw-chat.ehpk artifact can be uploaded directly
- All phases complete -- project is ready for v1.0 release

## Self-Check: PASSED

All files verified present, all commits verified in git log.

---
*Phase: 08-evenhub-submission*
*Completed: 2026-02-28*
