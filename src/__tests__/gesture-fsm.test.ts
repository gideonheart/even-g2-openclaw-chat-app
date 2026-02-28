import { describe, it, expect } from 'vitest';
import {
  gestureTransition,
  type GestureState,
  type GestureInput,
} from '../gestures/gesture-fsm';

describe('gestureTransition', () => {
  // ── idle state ──────────────────────────────────────────────

  describe('idle state', () => {
    it('tap -> recording with START_RECORDING', () => {
      const result = gestureTransition('idle', 'tap');
      expect(result).toEqual({
        nextState: 'recording',
        action: { type: 'START_RECORDING' },
      });
    });

    it('double-tap -> menu with TOGGLE_MENU', () => {
      const result = gestureTransition('idle', 'double-tap');
      expect(result).toEqual({
        nextState: 'menu',
        action: { type: 'TOGGLE_MENU' },
      });
    });

    it('scroll-up -> idle with SCROLL_UP', () => {
      const result = gestureTransition('idle', 'scroll-up');
      expect(result).toEqual({
        nextState: 'idle',
        action: { type: 'SCROLL_UP' },
      });
    });

    it('scroll-down -> idle with SCROLL_DOWN', () => {
      const result = gestureTransition('idle', 'scroll-down');
      expect(result).toEqual({
        nextState: 'idle',
        action: { type: 'SCROLL_DOWN' },
      });
    });
  });

  // ── recording state ─────────────────────────────────────────

  describe('recording state', () => {
    it('tap -> sent with STOP_RECORDING', () => {
      const result = gestureTransition('recording', 'tap');
      expect(result).toEqual({
        nextState: 'sent',
        action: { type: 'STOP_RECORDING' },
      });
    });

    it('double-tap -> recording with null action (ignored)', () => {
      const result = gestureTransition('recording', 'double-tap');
      expect(result).toEqual({
        nextState: 'recording',
        action: null,
      });
    });

    it('scroll-up -> recording with null action (ignored)', () => {
      const result = gestureTransition('recording', 'scroll-up');
      expect(result).toEqual({
        nextState: 'recording',
        action: null,
      });
    });

    it('scroll-down -> recording with null action (ignored)', () => {
      const result = gestureTransition('recording', 'scroll-down');
      expect(result).toEqual({
        nextState: 'recording',
        action: null,
      });
    });
  });

  // ── sent state ──────────────────────────────────────────────

  describe('sent state (all inputs ignored)', () => {
    it('tap -> sent with null action', () => {
      const result = gestureTransition('sent', 'tap');
      expect(result).toEqual({
        nextState: 'sent',
        action: null,
      });
    });

    it('double-tap -> sent with null action', () => {
      const result = gestureTransition('sent', 'double-tap');
      expect(result).toEqual({
        nextState: 'sent',
        action: null,
      });
    });

    it('scroll-up -> sent with null action', () => {
      const result = gestureTransition('sent', 'scroll-up');
      expect(result).toEqual({
        nextState: 'sent',
        action: null,
      });
    });

    it('scroll-down -> sent with null action', () => {
      const result = gestureTransition('sent', 'scroll-down');
      expect(result).toEqual({
        nextState: 'sent',
        action: null,
      });
    });
  });

  // ── thinking state ──────────────────────────────────────────

  describe('thinking state', () => {
    it('double-tap -> menu with TOGGLE_MENU', () => {
      const result = gestureTransition('thinking', 'double-tap');
      expect(result).toEqual({
        nextState: 'menu',
        action: { type: 'TOGGLE_MENU' },
      });
    });

    it('tap -> thinking with null action (ignored)', () => {
      const result = gestureTransition('thinking', 'tap');
      expect(result).toEqual({
        nextState: 'thinking',
        action: null,
      });
    });

    it('scroll-up -> thinking with null action (ignored)', () => {
      const result = gestureTransition('thinking', 'scroll-up');
      expect(result).toEqual({
        nextState: 'thinking',
        action: null,
      });
    });

    it('scroll-down -> thinking with null action (ignored)', () => {
      const result = gestureTransition('thinking', 'scroll-down');
      expect(result).toEqual({
        nextState: 'thinking',
        action: null,
      });
    });
  });

  // ── menu state ──────────────────────────────────────────────

  describe('menu state', () => {
    it('double-tap -> idle with TOGGLE_MENU', () => {
      const result = gestureTransition('menu', 'double-tap');
      expect(result).toEqual({
        nextState: 'idle',
        action: { type: 'TOGGLE_MENU' },
      });
    });

    it('tap -> menu with MENU_SELECT', () => {
      const result = gestureTransition('menu', 'tap');
      expect(result).toEqual({
        nextState: 'menu',
        action: { type: 'MENU_SELECT' },
      });
    });

    it('scroll-up -> menu with SCROLL_UP', () => {
      const result = gestureTransition('menu', 'scroll-up');
      expect(result).toEqual({
        nextState: 'menu',
        action: { type: 'SCROLL_UP' },
      });
    });

    it('scroll-down -> menu with SCROLL_DOWN', () => {
      const result = gestureTransition('menu', 'scroll-down');
      expect(result).toEqual({
        nextState: 'menu',
        action: { type: 'SCROLL_DOWN' },
      });
    });
  });

  // ── reset input (error recovery) ────────────────────────────

  describe('reset input (error recovery)', () => {
    it('idle + reset -> idle with null action', () => {
      const result = gestureTransition('idle', 'reset');
      expect(result).toEqual({
        nextState: 'idle',
        action: null,
      });
    });

    it('recording + reset -> idle with STOP_RECORDING', () => {
      const result = gestureTransition('recording', 'reset');
      expect(result).toEqual({
        nextState: 'idle',
        action: { type: 'STOP_RECORDING' },
      });
    });

    it('sent + reset -> idle with null action', () => {
      const result = gestureTransition('sent', 'reset');
      expect(result).toEqual({
        nextState: 'idle',
        action: null,
      });
    });

    it('thinking + reset -> idle with null action', () => {
      const result = gestureTransition('thinking', 'reset');
      expect(result).toEqual({
        nextState: 'idle',
        action: null,
      });
    });

    it('menu + reset -> idle with null action', () => {
      const result = gestureTransition('menu', 'reset');
      expect(result).toEqual({
        nextState: 'idle',
        action: null,
      });
    });
  });

  // ── fallback behavior ───────────────────────────────────────

  describe('unknown/fallback behavior', () => {
    it('returns current state with null action for unknown input', () => {
      const result = gestureTransition('idle', 'unknown-input' as GestureInput);
      expect(result).toEqual({
        nextState: 'idle',
        action: null,
      });
    });

    it('returns current state with null action for unknown state', () => {
      const result = gestureTransition('unknown-state' as GestureState, 'tap');
      expect(result).toEqual({
        nextState: 'unknown-state',
        action: null,
      });
    });
  });
});
