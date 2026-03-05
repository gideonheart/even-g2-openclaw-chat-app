// src/menu/command-menu.ts
// Pure command menu state management — maps user actions to state transitions.
// Zero imports, zero side effects, fully testable without SDK or hardware.

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
  confirmingIndex: number | null;
}

export interface MenuSelectResult {
  action: 'execute' | 'confirm' | 'cancel';
  command?: MenuCommand;
}

export const MENU_ITEMS: MenuItem[] = [
  { id: 'new',    label: '/new     New session',    command: 'new',    destructive: false },
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
  if (state.confirmingIndex !== null) return state;
  const newIndex = Math.max(0, state.selectedIndex - 1);
  return { ...state, selectedIndex: newIndex };
}

export function menuScrollDown(state: MenuState): MenuState {
  if (state.confirmingIndex !== null) return state;
  const newIndex = Math.min(state.items.length - 1, state.selectedIndex + 1);
  return { ...state, selectedIndex: newIndex };
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
