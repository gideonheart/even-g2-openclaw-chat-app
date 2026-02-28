// src/gestures/gesture-fsm.ts
// Pure gesture finite state machine — maps (currentState, inputEvent) to { nextState, action }
// Zero imports, zero side effects, fully testable without SDK or hardware.

export type GestureState = 'idle' | 'recording' | 'sent' | 'thinking' | 'menu';

export type GestureInput = 'tap' | 'double-tap' | 'scroll-up' | 'scroll-down';

export type GestureAction =
  | { type: 'START_RECORDING' }
  | { type: 'STOP_RECORDING' }
  | { type: 'TOGGLE_MENU' }
  | { type: 'SCROLL_UP' }
  | { type: 'SCROLL_DOWN' }
  | null;

export interface GestureTransition {
  nextState: GestureState;
  action: GestureAction;
}

export function gestureTransition(
  _state: GestureState,
  _input: GestureInput,
): GestureTransition {
  throw new Error('not implemented');
}
