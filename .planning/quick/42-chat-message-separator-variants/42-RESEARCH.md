# Quick-42: Chat Message Separator Variants Research

**Date:** 2026-03-04
**Status:** Research — pick a variant, test on device

## Goal

Add a visible separator line **under each message** to clearly show where one message ends and the next begins. The separator sits on its own line between messages (replaces current `\n\n` blank line).

## Current vs Proposed

**Current** — blank line between messages:
```
> Hello

How can I help?

> Weather?

Sunny today
```

**Proposed** — separator line replaces blank line:
```
> Hello
………………………………
How can I help?
………………………………
> Weather?
………………………………
Sunny today
```

Same line cost (1 separator line = 1 blank line), but the separator line is **visible** — you can see where each message ends.

## Separator Variants to Test On-Device

### Variant A: Ellipsis `…` (U+2026)

Each `…` character renders as 3 dots. Sits at **baseline** (bottom of character cell) = appears close to the text above, natural "underline" feel.

```
> Hello
……………………………
How can I help?
……………………………
```

- 9 ellipsis chars = 27 visual dots, spans nearly full line width
- **9 chars** per separator (compact)
- Baseline-aligned = less dead space above the dots
- Untested on G2 — needs device verification

### Variant B: Box-drawing `─` (U+2500)

Horizontal line character. Sits **vertically centered** in cell = equal space above and below.

```
> Hello
─────────────────────────────
How can I help?
─────────────────────────────
```

- 28 chars to span full line width
- **28 chars** per separator (expensive)
- Centered = more space above the line (the "space on top" concern)
- Untested on G2

### Variant C: Short box-drawing `───` (3-5 chars)

```
> Hello
───
How can I help?
───
```

- **3-5 chars** per separator (cheapest line variant)
- Subtle but clear visual break
- Untested on G2

### Variant D: ASCII dots `.` (proven safe)

```
> Hello
.........
How can I help?
.........
```

- `.` is **proven working** on G2 (used in loading animation)
- Sits at **baseline** like `…` — close to text above
- 9 dots = **9 chars** per separator
- Guaranteed to render, zero risk

### Variant E: ASCII dashes `-` (proven safe)

```
> Hello
---------
How can I help?
---------
```

- `-` is standard ASCII, guaranteed to work
- Sits at **middle** of character cell (like `─`)
- 9 dashes = **9 chars** per separator
- Safe fallback

### Variant F: Mixed — user vs assistant different separators

User messages get heavier separator, assistant messages get lighter:

```
> Hello
─────────
How can I help?
.........
> Weather?
─────────
Sunny today
.........
```

Or reversed (dots under user, line under assistant).

## Vertical Position Comparison

All separators take 1 line (~37px), but the character sits at different heights within that line:

```
Character height within line cell:

  ┌────────── top of line cell
  │
  │  ─ ━ -    ← middle-aligned (box-drawing, ASCII dash)
  │
  │  . · …    ← baseline-aligned (dots sit lower, closer to text above)
  │  _ ▁      ← bottom-aligned (underscore, lower block)
  └────────── bottom of line cell
```

**Baseline-aligned characters** (`…`, `.`) will feel tighter to the message text above them = more natural "underline" look. Middle-aligned (`─`, `-`) will have visible gap above = feels more like a divider floating between messages.

## Character Budget Impact

Current separator: `\n\n` = 2 chars overhead per message boundary.
New separator: `\n` + separator chars + `\n` = separator length + 2 chars.

| Variant | Chars/separator | Net overhead vs current | Budget impact |
|---------|----------------|------------------------|---------------|
| A: `…………………` (9 ellipsis) | 11 | +9 | -27 chars for 3 separators |
| B: `─────────────────` (28 box) | 30 | +28 | -84 chars for 3 separators |
| C: `───` (3-5 box) | 5-7 | +3-5 | -9-15 chars for 3 separators |
| D: `.........` (9 periods) | 11 | +9 | -27 chars for 3 separators |
| E: `---------` (9 dashes) | 11 | +9 | -27 chars for 3 separators |

With 200-char budget and 4 messages (3 separators):

| Variant | Separator cost | Remaining for content | Messages visible |
|---------|---------------|----------------------|-----------------|
| Current (blank) | 6 chars | 194 chars | ~7 lines, 4 msgs |
| Short (C) | 15-21 chars | 179-185 chars | ~7 lines, 4 msgs |
| Medium (A/D/E) | 33 chars | 167 chars | ~7 lines, 3-4 msgs |
| Full-width (B) | 90 chars | 110 chars | ~7 lines, 2-3 msgs |

**Short separator (Variant C) is cheapest** — nearly same budget as current blank line.

## Implementation Design

### Feature flag in viewport.ts

```typescript
export const CHAT_SEPARATORS = true;
```

### Separator constant

```typescript
// Pick one after on-device testing:
const MSG_SEPARATOR = '……………';     // Variant A: ellipsis (9 chars = 27 dots)
// const MSG_SEPARATOR = '───';     // Variant C: short box-drawing
// const MSG_SEPARATOR = '.........'; // Variant D: ASCII dots (proven safe)
```

### serializeMessages change

```typescript
.join(CHAT_SEPARATORS ? `\n${MSG_SEPARATOR}\n` : '\n\n');
```

### renderViewport addedLength

```typescript
const SEPARATOR_OVERHEAD = CHAT_SEPARATORS
  ? MSG_SEPARATOR.length + 2  // \n + separator + \n
  : 2;                         // \n\n

const addedLength = visibleMessages.length > 0
  ? line.length + SEPARATOR_OVERHEAD
  : line.length;
```

### Files changed

| File | Change |
|------|--------|
| `src/display/viewport.ts` | Add `CHAT_SEPARATORS`, `MSG_SEPARATOR`, update `serializeMessages` join, update `renderViewport` overhead |
| `src/__tests__/viewport.test.ts` | Add separator serialization tests |

`glasses-renderer.ts` — **no changes** (SRP: viewport owns all text formatting).

## On-Device Test Plan — Cycle via Command Menu

Instead of hard-coding a single variant and re-deploying to compare, add a
**`/style` menu item** that cycles through all variants on each tap.

**User flow:** double-tap → menu opens → scroll to `/style` → tap →
separator cycles to next variant → menu closes → chat re-renders with new
separator immediately. Tap again to cycle to the next one.

### Variants to cycle (in order)

| # | ID | Label | Separator string | Notes |
|---|-----|------|-----------------|-------|
| 0 | `off` | Off | *(empty — uses `\n\n`)* | Current behaviour, baseline |
| 1 | `dots` | Dots ......... | `.........` | ASCII dots, proven safe on G2 |
| 2 | `ellipsis` | Ellipsis …………… | `……………` | U+2026, 3 dots/char, untested |
| 3 | `short` | Line ─── | `───` | U+2500 box-drawing, untested |
| 4 | `long` | Line ───────── | `─────────` | Wider box-drawing, untested |

### What to check on device

- [ ] Which separator is most readable?
- [ ] Does `…` (U+2026) render on G2?
- [ ] Does `─` (U+2500) render on G2?
- [ ] Which feels closest to the text above (least dead space)?
- [ ] Is short (`───`) enough visual break, or need wider?

### Implementation summary

| File | Change |
|------|--------|
| `src/display/viewport.ts` | `SEPARATOR_VARIANTS[]`, `cycleSeparatorStyle()`, `getSeparatorOverhead()`, `resetSeparatorStyle()`. `serializeMessages` joins with current variant. `renderViewport` uses `getSeparatorOverhead()` for budget. |
| `src/menu/command-menu.ts` | Add `'separator'` to `MenuCommand` union. Add `/style` item to `MENU_ITEMS`. |
| `src/menu/menu-controller.ts` | Import `cycleSeparatorStyle`. `case 'separator'`: cycle → show overlay "Style: {label}" → delayed close 800ms → chat re-renders. |
| `src/__tests__/viewport.test.ts` | Separator cycle tests, `resetSeparatorStyle()` in `beforeEach`. |
| `src/__tests__/command-menu.test.ts` | Item count 5→6, `/style` item assertion. |

## Rollback

Set separator index to 0 (Off) via `resetSeparatorStyle()` — reverts to
current blank-line format. No feature flag needed since Off is the first
variant in the cycle.
