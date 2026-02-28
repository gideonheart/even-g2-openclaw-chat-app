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

export const MENU_ITEMS: MenuItem[] = [];

export function createMenuState(): MenuState {
  throw new Error('not implemented');
}

export function menuScrollUp(_state: MenuState): MenuState {
  throw new Error('not implemented');
}

export function menuScrollDown(_state: MenuState): MenuState {
  throw new Error('not implemented');
}

export function menuSelect(_state: MenuState): { newState: MenuState; result: MenuSelectResult } {
  throw new Error('not implemented');
}

export function menuCancelConfirm(_state: MenuState): MenuState {
  throw new Error('not implemented');
}

export function renderMenuText(_state: MenuState): string {
  throw new Error('not implemented');
}
