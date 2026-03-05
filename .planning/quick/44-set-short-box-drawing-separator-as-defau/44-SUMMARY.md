# Quick-44 Summary: Set short box-drawing separator as default

**Date:** 2026-03-05
**Commit:** 0fb18a4

## What changed

Replaced the separator cycling machinery (quick-43) with a hardcoded constant:

```typescript
export const MSG_SEPARATOR = '───';
export const SEPARATOR_OVERHEAD = MSG_SEPARATOR.length + 2; // = 5
```

## Removed

- `SeparatorVariant` interface and `SEPARATOR_VARIANTS` array
- `cycleSeparatorStyle()`, `getSeparatorOverhead()`, `resetSeparatorStyle()`
- `/style` menu item and `'separator'` MenuCommand
- `case 'separator'` in menu-controller + delayed close logic
- `cycleSeparatorStyle` import in menu-controller
- 7 cycling tests (replaced with 4 constant-based tests)

## Result

- `serializeMessages()` joins with `\n───\n`
- `renderViewport()` uses constant `SEPARATOR_OVERHEAD` (5) for budget
- Menu back to 5 items (no /style)
- 677 tests pass, build clean
- Net: -93 lines
