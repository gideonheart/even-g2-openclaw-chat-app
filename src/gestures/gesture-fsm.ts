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

/**
 * Complete state transition table for all 5 states and 4 gesture inputs.
 * Missing entries fall through to the default: { nextState: currentState, action: null }.
 */
const TRANSITIONS: Record<GestureState, Partial<Record<GestureInput, GestureTransition>>> = {
  idle: {
    'tap':         { nextState: 'recording', action: { type: 'START_RECORDING' } },
    'double-tap':  { nextState: 'menu',      action: { type: 'TOGGLE_MENU' } },
    'scroll-up':   { nextState: 'idle',      action: { type: 'SCROLL_UP' } },
    'scroll-down': { nextState: 'idle',      action: { type: 'SCROLL_DOWN' } },
  },
  recording: {
    'tap': { nextState: 'sent', action: { type: 'STOP_RECORDING' } },
    // double-tap, scroll-up, scroll-down ignored during recording
  },
  sent: {
    // All inputs ignored while audio is being processed
    // (auto-transitions to 'thinking' externally via event bus)
  },
  thinking: {
    'double-tap': { nextState: 'menu', action: { type: 'TOGGLE_MENU' } },
    // tap, scroll-up, scroll-down ignored during thinking
  },
  menu: {
    'double-tap':  { nextState: 'idle', action: { type: 'TOGGLE_MENU' } },
    'tap':         { nextState: 'idle', action: null },  // dismiss menu
    'scroll-up':   { nextState: 'menu', action: { type: 'SCROLL_UP' } },
    'scroll-down': { nextState: 'menu', action: { type: 'SCROLL_DOWN' } },
  },
};

/**
 * Pure function: given a current state and gesture input, returns the next state and action.
 * Returns { nextState: state, action: null } for any unrecognized state/input combination.
 */
export function gestureTransition(
  state: GestureState,
  input: GestureInput,
): GestureTransition {
  return TRANSITIONS[state]?.[input] ?? { nextState: state, action: null };
}
