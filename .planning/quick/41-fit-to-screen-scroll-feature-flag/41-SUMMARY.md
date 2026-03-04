# Quick-41 Summary: Fit-to-Screen Scroll (Feature Flag)

## What Changed

Added app-managed scrolling to prevent firmware scroll-to-top when new messages arrive.

### Files Modified

| File | Change |
|------|--------|
| `src/display/viewport.ts` | Added `FIT_TO_SCREEN`, `MAX_VISIBLE_CHARS`, `EFFECTIVE_CHAR_LIMIT`; updated `renderViewport()` to use resolved limit |
| `src/display/glasses-renderer.ts` | Replaced 3 separate imports with single `EFFECTIVE_CHAR_LIMIT`; simplified safety-net truncation |
| `src/__tests__/viewport.test.ts` | Added 4 fit-to-screen tests; updated existing truncation test to use `EFFECTIVE_CHAR_LIMIT` |

### DRY Improvement

The ternary `FIT_TO_SCREEN ? MAX_VISIBLE_CHARS : MAX_VIEWPORT_CHARS` was resolved into a single exported constant `EFFECTIVE_CHAR_LIMIT` in viewport.ts. Both `renderViewport()` and `renderAndPush()` use this shared constant — zero duplication.

### Feature Flag

- `FIT_TO_SCREEN = true` → renders ≤200 chars (fits in 256px container)
- `FIT_TO_SCREEN = false` → renders ≤1800 chars (old behavior, firmware scrolls)
- One-line toggle for instant rollback

## Verification

- 673 tests passing (27 viewport tests including 4 new fit-to-screen tests)
- Build clean: tsc + vite, 0 errors, 10 bundles
- Commit: a7e163e
