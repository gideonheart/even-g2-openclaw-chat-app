import { describe, it, expect } from 'vitest';
import {
  createMenuState,
  menuScrollUp,
  menuScrollDown,
  menuSelect,
  menuCancelConfirm,
  renderMenuText,
  MENU_ITEMS,
  type MenuState,
} from '../menu/command-menu';

describe('CommandMenu', () => {
  // ── 1. createMenuState ─────────────────────────────────────

  describe('createMenuState', () => {
    it('returns state with 5 items, selectedIndex=0, confirmingIndex=null', () => {
      const state = createMenuState();
      expect(state.items).toHaveLength(5);
      expect(state.selectedIndex).toBe(0);
      expect(state.confirmingIndex).toBeNull();
    });

    it('items match MENU_ITEMS in order', () => {
      const state = createMenuState();
      expect(state.items).toBe(MENU_ITEMS);
      expect(state.items[0].id).toBe('new');
      expect(state.items[1].id).toBe('switch');
      expect(state.items[2].id).toBe('rename');
      expect(state.items[3].id).toBe('reset');
      expect(state.items[4].id).toBe('delete');
    });
  });

  // ── 2. menuScrollUp ───────────────────────────────────────

  describe('menuScrollUp', () => {
    it('decrements selectedIndex from 2 to 1', () => {
      const state = createMenuState();
      const s = { ...state, selectedIndex: 2 };
      const result = menuScrollUp(s);
      expect(result.selectedIndex).toBe(1);
    });

    it('clamps at 0 when already at top', () => {
      const state = createMenuState();
      const result = menuScrollUp(state); // selectedIndex=0
      expect(result.selectedIndex).toBe(0);
    });

    it('does not mutate original state', () => {
      const state = createMenuState();
      const s = { ...state, selectedIndex: 2 };
      menuScrollUp(s);
      expect(s.selectedIndex).toBe(2);
    });
  });

  // ── 3. menuScrollDown ─────────────────────────────────────

  describe('menuScrollDown', () => {
    it('increments selectedIndex from 2 to 3', () => {
      const state = createMenuState();
      const s = { ...state, selectedIndex: 2 };
      const result = menuScrollDown(s);
      expect(result.selectedIndex).toBe(3);
    });

    it('clamps at 4 (last item) when already at bottom', () => {
      const state = createMenuState();
      const s = { ...state, selectedIndex: 4 };
      const result = menuScrollDown(s);
      expect(result.selectedIndex).toBe(4);
    });

    it('does not mutate original state', () => {
      const state = createMenuState();
      const s = { ...state, selectedIndex: 2 };
      menuScrollDown(s);
      expect(s.selectedIndex).toBe(2);
    });
  });

  // ── 4. Scroll locked during confirm ───────────────────────

  describe('scroll locked during confirm', () => {
    it('menuScrollUp returns same state when confirmingIndex is set', () => {
      const state: MenuState = {
        items: MENU_ITEMS,
        selectedIndex: 2,
        confirmingIndex: 3,
      };
      const result = menuScrollUp(state);
      expect(result).toBe(state); // exact same reference
    });

    it('menuScrollDown returns same state when confirmingIndex is set', () => {
      const state: MenuState = {
        items: MENU_ITEMS,
        selectedIndex: 2,
        confirmingIndex: 3,
      };
      const result = menuScrollDown(state);
      expect(result).toBe(state); // exact same reference
    });
  });

  // ── 5. menuSelect on non-destructive item ─────────────────

  describe('menuSelect on non-destructive item', () => {
    it('returns execute action with command for /new (index 0)', () => {
      const state = createMenuState(); // selectedIndex=0 -> "new"
      const { result } = menuSelect(state);
      expect(result).toEqual({ action: 'execute', command: 'new' });
    });

    it('returns execute action with command for /switch (index 1)', () => {
      const state: MenuState = { items: MENU_ITEMS, selectedIndex: 1, confirmingIndex: null };
      const { result } = menuSelect(state);
      expect(result).toEqual({ action: 'execute', command: 'switch' });
    });

    it('returns execute action with command for /rename (index 2)', () => {
      const state: MenuState = { items: MENU_ITEMS, selectedIndex: 2, confirmingIndex: null };
      const { result } = menuSelect(state);
      expect(result).toEqual({ action: 'execute', command: 'rename' });
    });
  });

  // ── 6. menuSelect on destructive item -> confirm ──────────

  describe('menuSelect on destructive item', () => {
    it('returns confirm action for /reset (index 3)', () => {
      const state: MenuState = { items: MENU_ITEMS, selectedIndex: 3, confirmingIndex: null };
      const { newState, result } = menuSelect(state);
      expect(result).toEqual({ action: 'confirm' });
      expect(newState.confirmingIndex).toBe(3);
    });

    it('returns confirm action for /delete (index 4)', () => {
      const state: MenuState = { items: MENU_ITEMS, selectedIndex: 4, confirmingIndex: null };
      const { newState, result } = menuSelect(state);
      expect(result).toEqual({ action: 'confirm' });
      expect(newState.confirmingIndex).toBe(4);
    });
  });

  // ── 7. menuSelect while confirming -> execute ─────────────

  describe('menuSelect while confirming', () => {
    it('executes the confirmed destructive command for /reset', () => {
      const state: MenuState = { items: MENU_ITEMS, selectedIndex: 3, confirmingIndex: 3 };
      const { newState, result } = menuSelect(state);
      expect(result).toEqual({ action: 'execute', command: 'reset' });
      expect(newState.confirmingIndex).toBeNull();
    });

    it('executes the confirmed destructive command for /delete', () => {
      const state: MenuState = { items: MENU_ITEMS, selectedIndex: 4, confirmingIndex: 4 };
      const { newState, result } = menuSelect(state);
      expect(result).toEqual({ action: 'execute', command: 'delete' });
      expect(newState.confirmingIndex).toBeNull();
    });
  });

  // ── 8. menuCancelConfirm ──────────────────────────────────

  describe('menuCancelConfirm', () => {
    it('resets confirmingIndex to null', () => {
      const state: MenuState = { items: MENU_ITEMS, selectedIndex: 3, confirmingIndex: 3 };
      const result = menuCancelConfirm(state);
      expect(result.confirmingIndex).toBeNull();
      expect(result.selectedIndex).toBe(3); // preserved
    });

    it('does not mutate original state', () => {
      const state: MenuState = { items: MENU_ITEMS, selectedIndex: 3, confirmingIndex: 3 };
      menuCancelConfirm(state);
      expect(state.confirmingIndex).toBe(3);
    });
  });

  // ── 9. renderMenuText normal state ────────────────────────

  describe('renderMenuText normal state', () => {
    it('renders header + 5 items with cursor on selected + footer', () => {
      const state = createMenuState(); // selectedIndex=0
      const text = renderMenuText(state);

      expect(text).toContain('--- Command Menu ---');
      expect(text).toContain('> /new     New session');
      expect(text).toContain('  /switch  Switch session');
      expect(text).toContain('  /rename  Rename session');
      expect(text).toContain('  /reset   Clear messages');
      expect(text).toContain('  /delete  Delete session');
      expect(text).toContain('Tap to select | Scroll to navigate');
    });

    it('moves cursor indicator to selected item', () => {
      const state: MenuState = { items: MENU_ITEMS, selectedIndex: 2, confirmingIndex: null };
      const text = renderMenuText(state);

      expect(text).toContain('  /new     New session');
      expect(text).toContain('  /switch  Switch session');
      expect(text).toContain('> /rename  Rename session');
      expect(text).toContain('  /reset   Clear messages');
      expect(text).toContain('  /delete  Delete session');
    });
  });

  // ── 10. renderMenuText confirm state ──────────────────────

  describe('renderMenuText confirm state', () => {
    it('shows item label + confirmation prompt for /reset', () => {
      const state: MenuState = { items: MENU_ITEMS, selectedIndex: 3, confirmingIndex: 3 };
      const text = renderMenuText(state);

      expect(text).toContain('--- Command Menu ---');
      expect(text).toContain('/reset   Clear messages');
      expect(text).toContain('Are you sure?');
      expect(text).toContain('Tap to confirm');
    });

    it('shows item label + confirmation prompt for /delete', () => {
      const state: MenuState = { items: MENU_ITEMS, selectedIndex: 4, confirmingIndex: 4 };
      const text = renderMenuText(state);

      expect(text).toContain('/delete  Delete session');
      expect(text).toContain('Are you sure?');
    });

    it('does not show cursor indicators in confirm state', () => {
      const state: MenuState = { items: MENU_ITEMS, selectedIndex: 3, confirmingIndex: 3 };
      const text = renderMenuText(state);

      // Should not contain lines with '> /' for other items
      const lines = text.split('\n');
      const cursorLines = lines.filter(l => l.startsWith('> /'));
      expect(cursorLines).toHaveLength(0);
    });
  });
});
