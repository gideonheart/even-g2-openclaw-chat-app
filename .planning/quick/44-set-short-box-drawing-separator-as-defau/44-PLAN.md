---
phase: quick-44
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/display/viewport.ts
  - src/menu/command-menu.ts
  - src/menu/menu-controller.ts
  - src/__tests__/viewport.test.ts
  - src/__tests__/command-menu.test.ts
autonomous: true
requirements: [SEP-03]
---

<objective>
Replace separator cycling (quick-43) with a hardcoded short box-drawing separator (───).
Remove /style menu item and all cycling machinery. Simplify viewport to a constant separator.
</objective>

<tasks>

<task type="auto">
  <name>Task 1: Replace cycling with constant separator in viewport.ts + revert menu</name>
  <files>src/display/viewport.ts, src/menu/command-menu.ts, src/menu/menu-controller.ts, src/__tests__/viewport.test.ts, src/__tests__/command-menu.test.ts</files>
  <action>
**viewport.ts:**
- Remove: SeparatorVariant interface, SEPARATOR_VARIANTS array, currentVariantIndex, cycleSeparatorStyle(), getSeparatorOverhead(), resetSeparatorStyle()
- Add: `export const MSG_SEPARATOR = '───';` and `export const SEPARATOR_OVERHEAD = MSG_SEPARATOR.length + 2;` (= 5, for \n + ─── + \n)
- Update serializeMessages: `.join(\`\n${MSG_SEPARATOR}\n\`)`
- Update renderViewport: replace `getSeparatorOverhead()` with `SEPARATOR_OVERHEAD`

**command-menu.ts:**
- Remove `'separator'` from MenuCommand union type
- Remove /style menu item from MENU_ITEMS (back to 5 items)

**menu-controller.ts:**
- Remove `import { cycleSeparatorStyle }` line
- Remove `case 'separator'` block from executeCommand
- Remove separator special-case from handleSelect (revert to simple executeCommand + closeMenu for all non-destructive)

**viewport.test.ts:**
- Remove imports: SEPARATOR_VARIANTS, cycleSeparatorStyle, getSeparatorOverhead, resetSeparatorStyle
- Add imports: MSG_SEPARATOR, SEPARATOR_OVERHEAD
- Remove all beforeEach resetSeparatorStyle() calls
- Replace 'separator cycling (quick-43)' describe block with simpler 'message separator (quick-44)' tests:
  - MSG_SEPARATOR is '───'
  - SEPARATOR_OVERHEAD is 5
  - serializeMessages joins with \n───\n
  - renderViewport respects SEPARATOR_OVERHEAD in budget
- Update existing 'separates messages with blank line' test to expect ───

**command-menu.test.ts:**
- Revert item count 6→5, revert all indices back to original (new=0, switch=1, rename=2, reset=3, delete=4)
- Remove /style test
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run && npm run build</automated>
  </verify>
  <done>Short box-drawing separator (───) is hardcoded default. No cycling, no /style menu item. All tests pass, build clean.</done>
</task>

</tasks>
