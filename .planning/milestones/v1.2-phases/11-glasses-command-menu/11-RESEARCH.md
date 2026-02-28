# Phase 11: Glasses Command Menu - Research

**Researched:** 2026-02-28
**Domain:** Glasses overlay menu rendering, gesture-driven command selection, session management commands, timed auto-dismiss
**Confidence:** HIGH

## Summary

Phase 11 builds a command menu overlay on the glasses display that replaces the current placeholder menu behavior (hide display on menu open, wake on close). The existing codebase already has extensive infrastructure for this feature: the gesture FSM has a fully wired `menu` state with scroll-up, scroll-down, tap-to-dismiss, and double-tap-to-close transitions; the gesture handler emits `gesture:menu-toggle` events with an `active` boolean; and the display controller subscribes to `gesture:menu-toggle` to manage display visibility. The task is to replace the display controller's "hide/wake" response with actual menu rendering, add command execution logic, and implement a 5-second inactivity auto-close timer.

The menu system requires three new modules: (1) a pure-function `CommandMenu` state manager (menu items, selection index, confirmation state), (2) a `MenuRenderer` that serializes menu state to plain text and pushes it to the glasses display via the existing bridge, and (3) a `MenuController` that wires bus events to menu state changes, manages the auto-close timer, and dispatches command execution. Commands (/new, /reset, /switch, /rename, /delete) map directly to existing `SessionManager` methods. The display constraint (576x288, text-only, 1800 chars) means the menu must be rendered as plain text lines with a cursor indicator.

One critical design point: the glasses display has only 2 text containers (status bar + chat). The menu overlay should reuse the chat container (containerID=2), replacing the conversation text with menu text while active, then restoring the conversation view on close. The status bar (containerID=1) continues showing the icon animator. This avoids rebuildPageContainer calls (which are expensive and cause display flicker) and is consistent with how showWelcome/showError already update the chat container.

**Primary recommendation:** Create a pure-function `CommandMenu` module (state + transitions), a `MenuRenderer` that serializes to text, and a `MenuController` event wiring layer. Modify the display controller to delegate to menu rendering when FSM is in `menu` state instead of hiding/waking the display. Add a 5-second inactivity timer. Wire commands to `SessionManager`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MENU-01 | Double-tap opens command menu overlay on glasses display | Gesture FSM already transitions `idle->menu` and `thinking->menu` on double-tap, emitting `TOGGLE_MENU` action. Gesture handler already emits `gesture:menu-toggle { active: true }`. Need to replace display controller's hide/wake with menu rendering. |
| MENU-02 | Scroll up/down navigates menu items | Gesture FSM already handles `scroll-up`/`scroll-down` in `menu` state (stays in menu, emits `SCROLL_UP`/`SCROLL_DOWN`). Display controller already subscribes to scroll events. Need to route scroll events to menu selection index when in menu state. |
| MENU-03 | Tap executes selected command (/new, /reset, /switch, /rename, /delete) | Gesture FSM transitions `menu->idle` on tap with `null` action. Need to intercept this transition and execute the selected command BEFORE dismissing menu. Or: add a new `MENU_SELECT` action to FSM tap-in-menu transition. Commands map to existing `SessionManager` methods. |
| MENU-04 | Destructive actions show confirmation before executing | Need a confirmation sub-state in the menu (e.g., "Delete session? Tap to confirm"). Scroll/double-tap in confirmation cancels and returns to menu. Tap in confirmation executes the destructive action. |
| MENU-05 | Menu auto-closes after 5 seconds of inactivity | `setTimeout` with reset on any gesture input while in menu state. On timeout, emit `gesture:menu-toggle { active: false }` or directly close the menu and return FSM to idle via `reset` input. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native browser APIs | Built-in | setTimeout/clearTimeout for auto-close, Date.now() for timestamps | Zero dependencies, consistent with project philosophy |
| Existing event bus | Project `events.ts` | Menu events flow through typed bus (`gesture:menu-toggle`, `gesture:scroll-up/down`, `gesture:tap`) | Already wired; menu state changes coordinate through bus |
| Existing GlassesRenderer | Project `glasses-renderer.ts` | `textContainerUpgrade(2, text)` to push menu content to chat container | No new SDK calls needed; reuse existing rendering path |
| Existing SessionManager | Project `sessions.ts` | `createSession()`, `renameSession()`, `deleteSession()`, `switchSession()`, `loadSessions()` | All CRUD operations already exist and sync via SyncBridge |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Existing gesture FSM | Project `gesture-fsm.ts` | Already has `menu` state with all transitions | Foundation for menu interaction; may need minor extension for MENU_SELECT |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reusing chat container for menu | `rebuildPageContainer` with 3+ containers | Rebuild is expensive (~100ms), causes display flicker, adds complexity. Text replacement in existing container is instant. |
| Plain text menu rendering | Image-based menu with pixel drawing | G2 has no image container API in current SDK usage; text-only is proven and consistent with all existing display patterns. |
| New FSM action `MENU_SELECT` | Intercepting tap-in-menu in gesture handler | Adding a dedicated action is cleaner and keeps the FSM as the single source of truth for state transitions, but requires modifying the existing stable FSM. Intercepting in the handler is lower-risk but messier. Recommend: add `MENU_SELECT` action. |

**Installation:**
```bash
# No installation needed -- all native APIs and existing project modules
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── menu/
│   ├── command-menu.ts       # NEW - Pure menu state: items, selection, confirm
│   └── menu-controller.ts    # NEW - Event wiring: bus -> menu state -> renderer
├── gestures/
│   ├── gesture-fsm.ts        # MODIFIED - Add MENU_SELECT action for tap-in-menu
│   └── gesture-handler.ts    # MODIFIED - Dispatch MENU_SELECT, emit menu events
├── display/
│   ├── glasses-renderer.ts   # MODIFIED - Add showMenu(text)/hideMenu() methods
│   └── display-controller.ts # MODIFIED - Delegate menu-toggle to menu controller
├── glasses-main.ts           # MODIFIED - Wire menu controller in boot sequence
└── types.ts                  # MODIFIED - Add menu event types to AppEventMap
```

### Pattern 1: Pure Command Menu State (command-menu.ts)
**What:** A pure-function module managing menu state: list of commands, highlighted selection index, and optional confirmation state. No side effects, no bus, no renderer.
**When to use:** This is the core menu logic, consumed by the menu controller.
**Example:**
```typescript
// Source: Project pattern (pure function modules like gesture-fsm.ts, viewport.ts)

export interface MenuItem {
  id: string;
  label: string;
  command: MenuCommand;
  destructive: boolean;
}

export type MenuCommand = 'new' | 'reset' | 'switch' | 'rename' | 'delete';

export interface MenuState {
  items: MenuItem[];
  selectedIndex: number;
  confirmingIndex: number | null;  // non-null when showing confirmation
}

export const MENU_ITEMS: MenuItem[] = [
  { id: 'new',    label: '/new     New session',     command: 'new',    destructive: false },
  { id: 'switch', label: '/switch  Switch session',  command: 'switch', destructive: false },
  { id: 'rename', label: '/rename  Rename session',  command: 'rename', destructive: false },
  { id: 'reset',  label: '/reset   Clear messages',  command: 'reset',  destructive: true },
  { id: 'delete', label: '/delete  Delete session',  command: 'delete', destructive: true },
];

export function createMenuState(): MenuState {
  return {
    items: MENU_ITEMS,
    selectedIndex: 0,
    confirmingIndex: null,
  };
}

export function menuScrollUp(state: MenuState): MenuState {
  if (state.confirmingIndex !== null) return state; // no scroll during confirm
  const newIndex = Math.max(0, state.selectedIndex - 1);
  return { ...state, selectedIndex: newIndex };
}

export function menuScrollDown(state: MenuState): MenuState {
  if (state.confirmingIndex !== null) return state; // no scroll during confirm
  const newIndex = Math.min(state.items.length - 1, state.selectedIndex + 1);
  return { ...state, selectedIndex: newIndex };
}

export interface MenuSelectResult {
  action: 'execute' | 'confirm' | 'cancel';
  command?: MenuCommand;
}

export function menuSelect(state: MenuState): { newState: MenuState; result: MenuSelectResult } {
  // If currently confirming, execute the destructive command
  if (state.confirmingIndex !== null) {
    const item = state.items[state.confirmingIndex];
    return {
      newState: { ...state, confirmingIndex: null },
      result: { action: 'execute', command: item.command },
    };
  }

  const item = state.items[state.selectedIndex];

  // Destructive actions need confirmation first
  if (item.destructive) {
    return {
      newState: { ...state, confirmingIndex: state.selectedIndex },
      result: { action: 'confirm' },
    };
  }

  // Non-destructive: execute immediately
  return {
    newState: state,
    result: { action: 'execute', command: item.command },
  };
}

export function menuCancelConfirm(state: MenuState): MenuState {
  return { ...state, confirmingIndex: null };
}

export function renderMenuText(state: MenuState): string {
  if (state.confirmingIndex !== null) {
    const item = state.items[state.confirmingIndex];
    return [
      '--- Command Menu ---',
      '',
      `  ${item.label}`,
      '',
      '  Are you sure?',
      '  > Tap to confirm',
      '  Scroll/double-tap to cancel',
    ].join('\n');
  }

  const lines = ['--- Command Menu ---', ''];
  for (let i = 0; i < state.items.length; i++) {
    const item = state.items[i];
    const cursor = i === state.selectedIndex ? '> ' : '  ';
    lines.push(`${cursor}${item.label}`);
  }
  lines.push('');
  lines.push('Tap to select | Scroll to navigate');
  return lines.join('\n');
}
```

### Pattern 2: Menu Controller Event Wiring (menu-controller.ts)
**What:** Wires bus events to the pure menu state module and drives the renderer. Manages the 5-second auto-close timer. Coordinates with SessionManager for command execution.
**When to use:** This is the glue layer between gestures, menu state, and command execution.
**Example:**
```typescript
// Source: Project pattern (display-controller.ts event wiring pattern)

export interface MenuControllerDeps {
  bus: EventBus<AppEventMap>;
  renderer: GlassesRenderer;
  sessionManager: SessionManager;
  getActiveSessionId: () => string;
  onSessionSwitch: (sessionId: string) => Promise<void>;
}

export function createMenuController(deps: MenuControllerDeps): MenuController {
  let menuState: MenuState | null = null;
  let autoCloseTimer: ReturnType<typeof setTimeout> | null = null;
  const AUTO_CLOSE_MS = 5000;

  function resetAutoClose(): void {
    if (autoCloseTimer) clearTimeout(autoCloseTimer);
    autoCloseTimer = setTimeout(closeMenu, AUTO_CLOSE_MS);
  }

  function openMenu(): void {
    menuState = createMenuState();
    renderMenu();
    resetAutoClose();
  }

  function closeMenu(): void {
    if (autoCloseTimer) { clearTimeout(autoCloseTimer); autoCloseTimer = null; }
    menuState = null;
    // Restore conversation view
    deps.renderer.wake();
  }

  function renderMenu(): void {
    if (!menuState) return;
    const text = renderMenuText(menuState);
    deps.renderer.showMenuOverlay(text);
  }
  // ... event subscriptions
}
```

### Pattern 3: FSM Extension for Menu Select
**What:** Add a `MENU_SELECT` action to the gesture FSM's tap-in-menu transition. Currently tap in menu state returns `{ nextState: 'idle', action: null }`, which means the menu closes without executing anything. Change to `{ nextState: 'menu', action: { type: 'MENU_SELECT' } }` so the gesture handler can dispatch command execution before the menu closes.
**When to use:** MENU-03 requires tap to execute the selected command.
**Example:**
```typescript
// In gesture-fsm.ts, modify the menu state transitions:
menu: {
  'double-tap':  { nextState: 'idle', action: { type: 'TOGGLE_MENU' } },
  'tap':         { nextState: 'menu', action: { type: 'MENU_SELECT' } },  // CHANGED
  'scroll-up':   { nextState: 'menu', action: { type: 'SCROLL_UP' } },
  'scroll-down': { nextState: 'menu', action: { type: 'SCROLL_DOWN' } },
  'reset':       { nextState: 'idle', action: null },
},
```

**Key design decision:** Tap in menu should NOT immediately transition to idle. The tap triggers `MENU_SELECT`, which may show a confirmation dialog (destructive commands) or execute and then close. The menu controller decides when to close the menu, not the FSM. After command execution, the menu controller emits a reset or toggle event to return the FSM to idle.

### Pattern 4: Glasses Renderer Menu Overlay
**What:** Add two methods to GlassesRenderer: `showMenuOverlay(text: string)` and `restoreConversation()`. The overlay pushes text to containerID=2 (chat area), replacing conversation content. Restore re-renders the conversation viewport.
**When to use:** When the menu opens and closes.
**Example:**
```typescript
// In glasses-renderer.ts:

function showMenuOverlay(text: string): void {
  // Pause streaming if active
  stopFlushTimer();
  // Push menu text to chat container
  bridge.textContainerUpgrade(2, text);
}

function restoreConversation(): void {
  // Re-render viewport from current message state
  renderAndPush();
}
```

### Pattern 5: Auto-Close Timer with Activity Reset (MENU-05)
**What:** A 5-second setTimeout that resets on any user interaction (scroll, tap). On expiry, the menu closes and the FSM returns to idle.
**When to use:** Every menu controller must start this timer on open and reset on any gesture.
**Example:**
```typescript
const AUTO_CLOSE_MS = 5000;
let autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

function resetAutoClose(): void {
  if (autoCloseTimer) clearTimeout(autoCloseTimer);
  autoCloseTimer = setTimeout(() => {
    closeMenu();
    bus.emit('gesture:menu-toggle', { active: false }); // signal FSM
  }, AUTO_CLOSE_MS);
}

// Reset on every gesture while menu is open:
// - scroll-up, scroll-down: resetAutoClose() in scroll handler
// - tap (select): resetAutoClose() before executing
// - double-tap (close): clearTimeout (no auto-close needed)
```

### Anti-Patterns to Avoid
- **Rebuilding page container for menu overlay:** `rebuildPageContainer` is expensive (~100ms) and causes visible flicker. The menu should reuse the existing chat text container via `textContainerUpgrade`.
- **Putting command execution logic in the FSM:** The FSM should remain pure (state + action). Command execution (creating sessions, deleting data) belongs in the menu controller, not the FSM transition table.
- **Blocking on async operations during menu interaction:** Session creation, rename, delete are all async IndexedDB operations. These should be fire-and-forget from the menu's perspective -- close the menu immediately, show confirmation via display, handle errors gracefully.
- **Adding menu state to the existing viewport:** The menu is a completely separate rendering mode. Don't add menu items to the ChatMessage array. Keep menu rendering separate from conversation rendering.
- **Forgetting to restore FSM state after menu auto-close:** If the auto-close timer fires, the gesture FSM is still in `menu` state. The auto-close handler must emit a `reset` input to the FSM to return it to `idle`, or the next gesture will be interpreted as a menu gesture.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Menu item list | Dynamic menu item generation | Static `MENU_ITEMS` array | Only 5 commands, all known at compile time. Dynamic generation adds complexity for zero benefit. |
| Session list for /switch command | Custom session picker UI | Simple "next session" cycling or numbered list in menu text | 576x288 display can barely fit the 5-item command menu. A full session picker would need a sub-menu pattern. Simplest: /switch cycles to next session. |
| Confirmation dialog | Custom modal/overlay system | Confirmation as a menu sub-state | The confirmation is just a different rendering of the same menu (text replacement in containerID=2). No new UI primitives needed. |

**Key insight:** The glasses display is text-only with 576x288 pixels and ~1800 chars. All "UI" is plain text pushed via `textContainerUpgrade`. The menu is just a different string rendered to the same container. There is no DOM, no CSS, no HTML on the glasses -- just plain text.

## Common Pitfalls

### Pitfall 1: FSM State Desync After Auto-Close
**What goes wrong:** The 5-second auto-close timer fires and closes the menu rendering, but the gesture FSM remains in `menu` state. The next tap is interpreted as a menu tap (MENU_SELECT) instead of starting recording.
**Why it happens:** The auto-close handler updates the display and menu controller but forgets to reset the FSM.
**How to avoid:** Auto-close handler must emit `gesture:menu-toggle { active: false }` on the bus AND inject a `reset` input to the gesture handler's FSM. Or: the gesture handler listens for `gesture:menu-toggle { active: false }` and resets its internal state.
**Warning signs:** After menu auto-closes, tap does nothing or behaves unexpectedly.

### Pitfall 2: Scroll Events Reaching Both Menu and Conversation
**What goes wrong:** When the menu is open, scroll events both navigate the menu items AND scroll the conversation underneath.
**Why it happens:** The display controller's existing scroll handler (`gesture:scroll-up` -> `renderer.scrollUp()`) is still active while the menu is open.
**How to avoid:** The menu controller must consume scroll events when the menu is open, preventing them from reaching the conversation scroll handler. Options: (1) check menu state in display controller before forwarding scroll to renderer, (2) menu controller unsubscribes display scroll handlers while active.
**Warning signs:** Menu highlight moves AND conversation scrolls simultaneously.

### Pitfall 3: Race Between Menu Close and Command Execution
**What goes wrong:** User taps to execute a destructive command, the menu closes immediately, but the confirmation dialog hasn't shown yet. Or: the command executes (async) but the display has already restored to conversation view, so the user doesn't see feedback.
**Why it happens:** Closing the menu (restoring conversation view) and executing the command are not sequenced properly.
**How to avoid:** For destructive commands, show confirmation FIRST (keep menu open). For execution, close menu AFTER the command starts (not after it completes -- fire-and-forget pattern). The conversation view restoration will show the correct state (new session, etc.).
**Warning signs:** User sees flash of confirmation then immediate conversation; or command executes without visible confirmation.

### Pitfall 4: /rename Command with No Text Input
**What goes wrong:** The /rename command needs a new name, but glasses have no text input (only 4 gestures).
**Why it happens:** MENU-03 lists /rename as a menu command, but the glasses input model has no keyboard.
**How to avoid:** For v1.2, /rename on glasses could: (a) auto-generate a name from the latest message, (b) use a pre-defined naming pattern (e.g., "Session 1", "Session 2"), or (c) show "Rename from hub" message and defer to the hub UI. Recommend option (a): auto-rename using `generateConversationName()` from the latest user message, which is consistent with the existing auto-naming logic. Alternatively, skip /rename from the glasses menu entirely and note it as hub-only.
**Warning signs:** /rename menu item exists but does nothing useful on glasses.

### Pitfall 5: /switch with Zero or One Sessions
**What goes wrong:** User taps /switch but there's only one session, or no other sessions exist.
**Why it happens:** No guard checking session count before showing the switch option.
**How to avoid:** Either: (a) gray out /switch when only 1 session exists (but text display can't "gray out"), (b) show "No other sessions" feedback message and stay in menu, or (c) hide /switch from menu when there's only one session by building menu items dynamically. Recommend (b): always show the item but display feedback if there's nothing to switch to.
**Warning signs:** /switch causes error or does nothing with no feedback.

### Pitfall 6: Menu Opens During Active Recording/Streaming
**What goes wrong:** The FSM allows double-tap to open menu from `thinking` state but not from `recording` or `sent`. If a menu command like /new or /delete fires during active streaming (FSM was in `thinking`), it could create data corruption.
**Why it happens:** The FSM transitions from `thinking->menu` are defined. During thinking, the gateway is actively streaming response chunks.
**How to avoid:** When executing a command from menu, check if streaming is active. If so, end the current stream first (call `renderer.endStreaming()`), wait for auto-save to flush, then execute the command. Or: only allow non-disruptive commands (/new creates new session without affecting current) while streaming.
**Warning signs:** Partial response saved to wrong session; display shows garbled mix of stream + menu.

## Code Examples

### Menu Text Rendering for 576x288 Display
```typescript
// Source: Project constraint (576x288 display, ~1800 char limit)
// Menu must be compact. Each line is approximately 48 chars wide at default font.
// With 5 items + header + footer = ~10 lines, well within display limits.

function renderMenuText(state: MenuState): string {
  if (state.confirmingIndex !== null) {
    const item = state.items[state.confirmingIndex];
    return [
      '--- Command Menu ---',
      '',
      `  ${item.label}`,
      '',
      '  Are you sure?',
      '  > Tap to confirm',
      '  Scroll to cancel',
    ].join('\n');
  }

  const lines = ['--- Command Menu ---', ''];
  for (let i = 0; i < state.items.length; i++) {
    const item = state.items[i];
    const cursor = i === state.selectedIndex ? '> ' : '  ';
    lines.push(`${cursor}${item.label}`);
  }
  lines.push('');
  lines.push('Tap: select | Scroll: navigate');
  return lines.join('\n');
}
```

### Wiring Menu Controller Into Glasses Boot (glasses-main.ts)
```typescript
// Source: Project pattern (glasses-main.ts Layer 4 display pipeline)
// Insert after displayController init, before Layer 5

import { createMenuController } from './menu/menu-controller';
import { createSessionManager } from './sessions';

const sessionManager = createSessionManager({
  sessionStore: sessionStore!,
  syncBridge,
  origin: 'glasses',
});

const menuController = createMenuController({
  bus,
  renderer,
  sessionManager,
  getActiveSessionId: () => activeConversationId,
  onSessionSwitch: switchToSession,
});

// In cleanup:
menuController.destroy();
```

### Modifying Display Controller to Delegate to Menu
```typescript
// Source: Project code (display-controller.ts)
// Replace the current gesture:menu-toggle handler:

// BEFORE (current):
bus.on('gesture:menu-toggle', ({ active }) => {
  if (active) {
    renderer.hide();   // hides display
  } else {
    renderer.wake();   // restores display
  }
});

// AFTER (Phase 11):
// Remove this handler entirely. Menu controller handles menu-toggle events.
// Or: keep but guard with a flag:
bus.on('gesture:menu-toggle', ({ active }) => {
  // Menu controller handles rendering; display controller just manages scroll guard
  if (active) {
    menuActive = true;   // suppress conversation scroll
  } else {
    menuActive = false;
    renderer.wake();     // only needed if renderer was hidden
  }
});
```

### Extending Gesture FSM for MENU_SELECT
```typescript
// Source: Project code (gesture-fsm.ts)
// Add MENU_SELECT to GestureAction union:

export type GestureAction =
  | { type: 'START_RECORDING' }
  | { type: 'STOP_RECORDING' }
  | { type: 'TOGGLE_MENU' }
  | { type: 'MENU_SELECT' }     // NEW
  | { type: 'SCROLL_UP' }
  | { type: 'SCROLL_DOWN' }
  | null;

// Modify menu.tap transition:
menu: {
  'double-tap':  { nextState: 'idle',  action: { type: 'TOGGLE_MENU' } },
  'tap':         { nextState: 'menu',  action: { type: 'MENU_SELECT' } },  // CHANGED
  'scroll-up':   { nextState: 'menu',  action: { type: 'SCROLL_UP' } },
  'scroll-down': { nextState: 'menu',  action: { type: 'SCROLL_DOWN' } },
  'reset':       { nextState: 'idle',  action: null },
},
```

### Gesture Handler MENU_SELECT Dispatch
```typescript
// Source: Project code (gesture-handler.ts)
// Add to dispatchAction switch:

case 'MENU_SELECT': {
  bus.emit('menu:select', { timestamp: Date.now() });
  break;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Menu opens -> hide display | Menu opens -> render menu text overlay | Phase 11 (this phase) | Users see actual menu instead of blank screen |
| Menu tap -> dismiss with no action | Menu tap -> execute selected command | Phase 11 (this phase) | Menu becomes functional command interface |
| No session commands on glasses | 5 session commands via menu | Phase 11 (this phase) | Full session management without hub |

**Deprecated/outdated:**
- Current display controller `gesture:menu-toggle` handler (hide/wake): Placeholder from Phase 3. Phase 11 replaces with actual menu rendering.
- Current FSM `menu.tap -> idle, null`: Placeholder. Phase 11 changes to `menu.tap -> menu, MENU_SELECT`.

## Open Questions

1. **/rename implementation on glasses**
   - What we know: Glasses have only 4 gestures (tap, double-tap, scroll-up, scroll-down). No text input. MENU-03 lists /rename as a command.
   - What's unclear: How the user provides a new name without a keyboard.
   - Recommendation: Auto-rename using `generateConversationName()` from the most recent user message in the session. If no messages exist, use a timestamp-based name. This is consistent with the existing auto-naming logic and requires no text input. Alternative: remove /rename from glasses menu and make it hub-only.

2. **/switch session selection UX**
   - What we know: With potentially many sessions, a simple "next session" cycle might be frustrating. The display can show ~10 lines of text.
   - What's unclear: Whether to show a session list sub-menu or cycle through sessions.
   - Recommendation: Cycle to next session (chronologically). If only 1 session exists, show "No other sessions" feedback. A sub-menu would add significant complexity for a rare operation on glasses. Users who want to pick a specific session can use the hub.

3. **FSM state after menu command execution**
   - What we know: The FSM needs to return to `idle` (or the pre-menu state like `thinking`) after a command executes.
   - What's unclear: Whether to always return to `idle` or restore the previous state.
   - Recommendation: Always return to `idle`. If the user opened the menu during `thinking` and executes /new, the thinking state is irrelevant. The voice loop controller handles the gateway:chunk events independently. The FSM reset cleans up any stale state.

4. **/reset command scope**
   - What we know: MENU-03 lists /reset. This could mean "clear the current conversation's messages" (keeping the session) or "reset the entire session" (delete and recreate).
   - What's unclear: Exact semantics of /reset vs /delete.
   - Recommendation: /reset = clear messages from current conversation (keep session, start fresh). /delete = delete the entire session and switch to another. This gives users a non-destructive "start over" option.

## Sources

### Primary (HIGH confidence)
- Project source code analysis: gesture-fsm.ts (menu state transitions), gesture-handler.ts (TOGGLE_MENU dispatch), display-controller.ts (menu-toggle handler), glasses-renderer.ts (text container layout, 2-container system), viewport.ts (1800 char limit), sessions.ts (SessionManager API), types.ts (AppEventMap, event types), glasses-main.ts (boot sequence, switchToSession), bridge-types.ts (BridgeService API), icon-animator.ts (status bar), sync-types.ts (SyncMessage types)
- Phase 10 research and implementation: SessionStore, SyncBridge, session switching patterns, cascade delete

### Secondary (MEDIUM confidence)
- Even G2 SDK API patterns observed in even-bridge.ts: `textContainerUpgrade`, `rebuildPageContainer`, `TextContainerProperty` -- these are the only display primitives available

### Tertiary (LOW confidence)
- None. All findings based on direct codebase analysis.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new libraries. Everything builds on existing project modules (event bus, renderer, session manager, gesture FSM).
- Architecture: HIGH - Follows established project patterns (pure-function state, controller wiring, factory pattern). All integration points are well-understood from reading the actual source code.
- Pitfalls: HIGH - Identified from direct analysis of FSM transition table, display controller wiring, and session management async patterns. All pitfalls have concrete prevention strategies grounded in the codebase.

**Research date:** 2026-02-28
**Valid until:** 2026-06-28 (project-internal architecture, no external dependency changes expected)
