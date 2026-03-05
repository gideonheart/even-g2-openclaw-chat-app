---
phase: quick-43
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
requirements: [SEP-01, SEP-02]

must_haves:
  truths:
    - "Tapping /style in the command menu cycles the separator to the next variant"
    - "Chat display uses the current separator variant between messages"
    - "renderViewport budget calculation accounts for separator overhead dynamically"
    - "Separator starts at Off (index 0) matching current blank-line behavior"
  artifacts:
    - path: "src/display/viewport.ts"
      provides: "SEPARATOR_VARIANTS array, cycleSeparatorStyle(), getSeparatorOverhead(), resetSeparatorStyle()"
      contains: "SEPARATOR_VARIANTS"
    - path: "src/menu/command-menu.ts"
      provides: "separator command and /style menu item"
      contains: "separator"
    - path: "src/menu/menu-controller.ts"
      provides: "separator command handler with overlay feedback"
      contains: "cycleSeparatorStyle"
  key_links:
    - from: "src/menu/menu-controller.ts"
      to: "src/display/viewport.ts"
      via: "import cycleSeparatorStyle"
      pattern: "cycleSeparatorStyle"
    - from: "src/display/viewport.ts serializeMessages"
      to: "SEPARATOR_VARIANTS"
      via: "currentVariantIndex indexes into array for join separator"
      pattern: "SEPARATOR_VARIANTS\\[currentVariantIndex\\]"
    - from: "src/display/viewport.ts renderViewport"
      to: "getSeparatorOverhead"
      via: "dynamic overhead replaces hard-coded +2"
      pattern: "getSeparatorOverhead"
---

<objective>
Add separator style cycling to the glasses chat display via a /style command menu item.

Purpose: Enable on-device testing of 5 separator variants (Off, dots, ellipsis, short line, long line) without redeploying. Each tap of /style cycles to the next variant and immediately re-renders chat.

Output: Working /style menu item that cycles separators, with dynamic budget calculation and full test coverage.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/42-chat-message-separator-variants/42-RESEARCH.md
@src/display/viewport.ts
@src/menu/command-menu.ts
@src/menu/menu-controller.ts
@src/__tests__/viewport.test.ts
@src/__tests__/command-menu.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add separator variants and cycling to viewport.ts + tests</name>
  <files>src/display/viewport.ts, src/__tests__/viewport.test.ts</files>
  <action>
In viewport.ts, add the following after the existing constants section:

1. Define the SeparatorVariant interface and SEPARATOR_VARIANTS array:
```typescript
interface SeparatorVariant {
  id: string;
  label: string;
  separator: string;
}

export const SEPARATOR_VARIANTS: readonly SeparatorVariant[] = [
  { id: 'off',      label: 'Off',              separator: '' },
  { id: 'dots',     label: 'Dots .........',   separator: '.........' },
  { id: 'ellipsis', label: 'Ellipsis ……………',  separator: '……………' },
  { id: 'short',    label: 'Line ───',         separator: '───' },
  { id: 'long',     label: 'Line ─────────',   separator: '─────────' },
] as const;
```

2. Add module-level mutable index (not exported -- internal state):
```typescript
let currentVariantIndex = 0;
```

3. Export three functions:
- `cycleSeparatorStyle(): string` -- increments index (wraps around), returns the new variant's label. This is what the menu controller calls.
- `getSeparatorOverhead(): number` -- returns the current separator's character cost (separator.length + 2 for the newlines, or 2 when separator is empty/off).
- `resetSeparatorStyle(): void` -- resets index to 0 (Off). Used in tests' beforeEach.

4. Update `serializeMessages()`: Change the `.join('\n\n')` to use the current variant:
```typescript
const sep = SEPARATOR_VARIANTS[currentVariantIndex].separator;
return messages.map(...).join(sep ? `\n${sep}\n` : '\n\n');
```

5. Update `renderViewport()`: Replace the hard-coded `+ 2` in addedLength calculation with `getSeparatorOverhead()`:
```typescript
const addedLength = visibleMessages.length > 0
  ? line.length + getSeparatorOverhead()
  : line.length;
```

In viewport.test.ts:

1. Import `SEPARATOR_VARIANTS, cycleSeparatorStyle, getSeparatorOverhead, resetSeparatorStyle` from viewport.

2. Add `beforeEach(() => { resetSeparatorStyle(); })` to the top-level describe OR to each separator-related describe block to ensure test isolation.

3. Add a new describe block 'separator cycling (quick-43)' with tests:
   - "starts at variant 0 (Off) with overhead 2" -- getSeparatorOverhead() === 2
   - "cycleSeparatorStyle advances to variant 1 (dots) and returns label" -- call cycle, check return value matches SEPARATOR_VARIANTS[1].label, check overhead === 9 + 2 = 11
   - "cycling wraps around after last variant" -- cycle 5 times (variants.length), check overhead is back to 2 (Off)
   - "serializeMessages uses dots separator after one cycle" -- cycle once, serialize two messages, expect join to contain '\n.........\n'
   - "serializeMessages uses blank line when Off" -- no cycle, serialize two messages, expect '\n\n' separator (no dots)
   - "renderViewport accounts for separator overhead in budget" -- cycle to dots (overhead 11), create messages, verify rendered output length <= EFFECTIVE_CHAR_LIMIT
   - "resetSeparatorStyle returns to Off" -- cycle twice, reset, check overhead === 2

4. Update existing serializeMessages test "separates messages with blank line" -- add resetSeparatorStyle() to the existing beforeEach or add one for the serializeMessages describe, since the separator state is now mutable. This prevents test coupling.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/viewport.test.ts</automated>
  </verify>
  <done>SEPARATOR_VARIANTS exported with 5 variants. cycleSeparatorStyle/getSeparatorOverhead/resetSeparatorStyle exported and tested. serializeMessages joins with current variant separator. renderViewport uses dynamic overhead. All existing + new viewport tests pass.</done>
</task>

<task type="auto">
  <name>Task 2: Add /style menu item and separator command handler + tests</name>
  <files>src/menu/command-menu.ts, src/menu/menu-controller.ts, src/__tests__/command-menu.test.ts</files>
  <action>
In command-menu.ts:

1. Add `'separator'` to the MenuCommand union type:
```typescript
export type MenuCommand = 'new' | 'reset' | 'switch' | 'rename' | 'delete' | 'separator';
```

2. Add a /style item to MENU_ITEMS. Insert it as the FIRST item (index 0) so it is immediately accessible without scrolling past session commands:
```typescript
{ id: 'style', label: '/style   Separator style', command: 'separator', destructive: false },
```
The full MENU_ITEMS array becomes 6 items: style, new, switch, rename, reset, delete.

In menu-controller.ts:

1. Import `cycleSeparatorStyle` from `'../display/viewport'`.

2. Add a `case 'separator'` in the `executeCommand` switch. The handler should:
   - Call `cycleSeparatorStyle()` which returns the new label string.
   - Show a brief overlay with `renderer.showMenuOverlay(`Style: ${label}`)`.
   - Use `setTimeout(() => { renderer.restoreConversation(); bus.emit('menu:close', {}); }, 800)` for a delayed close so the user sees the feedback before the chat re-renders with the new separator.
   - Do NOT call `closeMenu()` directly (it would close immediately). Instead, set `menuState = null` and `clearAutoClose()` inside the setTimeout callback after restoreConversation, OR simply call closeMenu() inside the setTimeout. Choose the cleaner approach: call closeMenu() inside setTimeout, but guard against double-close by checking menuState is still set.

   ```typescript
   case 'separator': {
     const label = cycleSeparatorStyle();
     renderer.showMenuOverlay(`Style: ${label}`);
     clearAutoClose();
     setTimeout(() => {
       if (menuState !== null || autoCloseTimer !== null) {
         closeMenu();
       } else {
         // Menu already closed (e.g., user double-tapped to exit)
         renderer.restoreConversation();
       }
     }, 800);
     break;
   }
   ```

   Wait -- looking at the code flow: `handleSelect` calls `executeCommand` then `closeMenu()`. For separator, we need to NOT close immediately. Refactor handleSelect so that for 'separator' command, it skips the closeMenu() call. The cleanest approach:

   In `handleSelect()`, change the execute branch:
   ```typescript
   } else if (result.action === 'execute' && result.command) {
     if (result.command === 'separator') {
       // Separator has delayed close -- handled inside executeCommand
       executeCommand(result.command);
     } else {
       executeCommand(result.command);
       closeMenu();
     }
   }
   ```

   Then in executeCommand case 'separator':
   ```typescript
   case 'separator': {
     const label = cycleSeparatorStyle();
     renderer.showMenuOverlay(`Style: ${label}`);
     clearAutoClose();
     setTimeout(() => closeMenu(), 800);
     break;
   }
   ```

In command-menu.test.ts:

1. Update the createMenuState test: item count 5 -> 6, and update the item order assertions to reflect the new /style item at index 0. The existing items shift by one index:
   - index 0: style
   - index 1: new
   - index 2: switch
   - index 3: rename
   - index 4: reset
   - index 5: delete

2. Update all selectedIndex references in tests (e.g., /reset was index 3, now index 4; /delete was index 4, now index 5; /rename was index 2, now index 3; etc.).

3. Add test: "menuSelect on /style returns execute with separator command" -- create state with selectedIndex=0, call menuSelect, expect { action: 'execute', command: 'separator' }.

4. Update renderMenuText tests: the normal state should now show 6 items including '/style   Separator style'.

5. Update the clamp tests: menuScrollDown clamps at 5 (was 4).
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/command-menu.test.ts src/__tests__/viewport.test.ts</automated>
  </verify>
  <done>/style is the first menu item. Selecting it executes 'separator' command. menu-controller cycles separator, shows "Style: {label}" overlay, then closes after 800ms. All 6 menu items render correctly. All command-menu and viewport tests pass.</done>
</task>

</tasks>

<verification>
Run the full test suite to confirm no regressions:
```bash
npx vitest run
```
All tests pass. Build check:
```bash
npm run build
```
No TypeScript errors.
</verification>

<success_criteria>
- /style appears as first item in the command menu (6 items total)
- Tapping /style cycles through Off -> Dots -> Ellipsis -> Short line -> Long line -> Off
- Chat messages use the current separator variant between messages
- renderViewport budget correctly accounts for variable separator overhead
- Brief "Style: {label}" overlay shown for 800ms before menu closes
- All existing tests updated for new menu item count/indices
- New separator cycling tests pass with isolation via resetSeparatorStyle()
- Full test suite green, build clean
</success_criteria>

<output>
After completion, create `.planning/quick/43-separator-style-cycling-via-style-menu-i/43-SUMMARY.md`
</output>
