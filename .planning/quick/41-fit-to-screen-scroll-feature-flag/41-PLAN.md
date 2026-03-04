# Quick-41: Fit-to-Screen Scroll (Feature Flag)

## Problem

When new messages arrive or chat is loaded, the firmware TextContainer scroll position resets to the **top** of the rendered text. The user must manually scroll down every time to see the latest messages.

**Root cause:** `MAX_VIEWPORT_CHARS = 1800` allows far more text than fits in the 256px-high chat container. The firmware renders the overflow text and starts displaying from the top — there is no SDK API to set scroll position on a TextContainer.

## Solution

**App-managed scrolling**: render only as much text as physically fits in the visible area. No overflow = no firmware scrolling = latest messages always visible immediately.

The existing `scrollUp()`/`scrollDown()` already handle history navigation by changing the offset and re-rendering a different slice. This change just ensures the rendered slice never overflows the container.

## Feature Flag

Add a `FIT_TO_SCREEN` boolean constant in `src/display/viewport.ts`. When:
- `true` (new behavior): use a smaller char limit that fits in the visible container
- `false` (old behavior): use the original `MAX_VIEWPORT_CHARS = 1800`

This lets us toggle back instantly if the new behavior causes issues on-device.

## Implementation

### Step 1: Add feature flag and visible-area constant to `viewport.ts`

```typescript
// ── Feature flags ────────────────────────────────────────
/** When true, limit rendered text to fit the visible container area
 *  (no firmware scrolling). When false, use the full 1800-char budget
 *  (firmware handles overflow scroll, starts at top). */
export const FIT_TO_SCREEN = true;

/** Approximate character limit that fits in the 256px chat container
 *  without triggering firmware overflow scroll.
 *  576px width ≈ ~28-32 chars/line at default font; 256px height ≈ ~7 lines.
 *  Conservative estimate: 7 lines × 28 chars = ~196 chars.
 *  Tunable constant — adjust after on-device testing. */
export const MAX_VISIBLE_CHARS = 200;
```

### Step 2: Update `renderViewport()` to respect the flag

In the loop that builds visible messages and in the hard-truncation safety net, use the effective limit:

```typescript
const charLimit = FIT_TO_SCREEN ? MAX_VISIBLE_CHARS : MAX_VIEWPORT_CHARS;
```

Replace all references to `MAX_VIEWPORT_CHARS` inside `renderViewport()` with `charLimit`.

### Step 3: Update `renderAndPush()` in `glasses-renderer.ts`

The safety-net truncation in `renderAndPush()` also references `MAX_VIEWPORT_CHARS`. Import `FIT_TO_SCREEN` and `MAX_VISIBLE_CHARS`, and apply the same effective limit:

```typescript
import {
  renderViewport,
  scrollUp as vpScrollUp,
  scrollDown as vpScrollDown,
  MAX_VIEWPORT_CHARS,
  MAX_VISIBLE_CHARS,
  FIT_TO_SCREEN,
} from './viewport';

function renderAndPush(): void {
  const text = renderViewport(viewport);
  const limit = FIT_TO_SCREEN ? MAX_VISIBLE_CHARS : MAX_VIEWPORT_CHARS;
  const safeText = text.length > limit ? text.slice(text.length - limit) : text;
  bridge.textContainerUpgrade(2, safeText);
}
```

### Step 4: Update tests

- Add test case: when `FIT_TO_SCREEN` is effectively on, `renderViewport()` respects `MAX_VISIBLE_CHARS`
- Existing tests continue to pass (they test with the current constant values)

## Files Changed

| File | Change |
|------|--------|
| `src/display/viewport.ts` | Add `FIT_TO_SCREEN`, `MAX_VISIBLE_CHARS` constants; update `renderViewport()` to use effective limit |
| `src/display/glasses-renderer.ts` | Import new constants; update `renderAndPush()` safety-net truncation |
| `tests/display/viewport.test.ts` | Add test for fit-to-screen behavior |

## Tuning Note

`MAX_VISIBLE_CHARS = 200` is a conservative starting estimate. After on-device testing:
- If text is cut too short → increase toward 250-300
- If firmware still scrolls → decrease toward 150
- The constant is easy to adjust without any structural changes

## Rollback

Set `FIT_TO_SCREEN = false` — one line change, instant revert to old behavior.
