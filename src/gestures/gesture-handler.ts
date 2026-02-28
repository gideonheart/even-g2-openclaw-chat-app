// ── Gesture handler — wires bus events to FSM, bridge audio, and audio capture ──
//
// Subscribes to gesture:tap/double-tap/scroll-up/scroll-down on the event bus,
// drives the gesture FSM, dispatches actions to bridge/audio services.
// Includes 275ms tap debounce to prevent false double-tap triggers.
//
// Phase 2 scope: produces hint text strings only. Display rendering is Phase 3.

import { gestureTransition, type GestureState, type GestureInput, type GestureAction } from './gesture-fsm';
import type { EventBus } from '../events';
import type { AppEventMap } from '../types';
import type { BridgeService } from '../bridge/bridge-types';
import type { AudioCapture } from '../audio/audio-capture';

const DEBOUNCE_MS = 275;

export interface GestureHandlerAPI {
  getState(): GestureState;
  getHintText(): string;
  destroy(): void;
}

/**
 * Hint bar text for each FSM state.
 * Pure function — Phase 3 will call this to render on the glasses display.
 */
export function getHintText(state: GestureState): string {
  switch (state) {
    case 'idle':
      return 'Tap to record | Double-tap for menu';
    case 'recording':
      return 'Tap to stop recording';
    case 'sent':
      return 'Processing...';
    case 'thinking':
      return 'AI is thinking... | Double-tap for menu';
    case 'menu':
      return 'Double-tap to close | Scroll to navigate';
    default:
      return '';
  }
}

/**
 * Creates the gesture handler that wires bus gesture events through the FSM
 * to bridge audio control and audio capture lifecycle.
 */
export function createGestureHandler(opts: {
  bus: EventBus<AppEventMap>;
  bridge: BridgeService;
  audioCapture: AudioCapture;
  activeSessionId: () => string;
}): GestureHandlerAPI {
  const { bus, bridge, audioCapture, activeSessionId } = opts;

  let state: GestureState = 'idle';
  let lastTapTs = 0;

  function handleInput(input: GestureInput, timestamp: number): void {
    // Debounce: suppress rapid tap within DEBOUNCE_MS of a previous tap
    if (input === 'tap' && (timestamp - lastTapTs) < DEBOUNCE_MS) {
      return; // suppressed
    }

    if (input === 'tap') {
      lastTapTs = timestamp;
    }

    const transition = gestureTransition(state, input);
    state = transition.nextState;

    if (transition.action !== null) {
      dispatchAction(transition.action);
    }
  }

  function dispatchAction(action: GestureAction): void {
    if (action === null) return;

    switch (action.type) {
      case 'START_RECORDING': {
        const sessionId = activeSessionId();
        audioCapture.startRecording(sessionId);
        bridge.startAudio();
        bus.emit('audio:recording-start', { sessionId });
        break;
      }
      case 'STOP_RECORDING': {
        bridge.stopAudio();
        audioCapture.stopRecording()
          .then((blob) => {
            bus.emit('audio:recording-stop', {
              sessionId: activeSessionId(),
              blob,
            });
          })
          .catch((err) => {
            console.error('[GestureHandler] stopRecording failed:', err);
          });
        break;
      }
      case 'TOGGLE_MENU': {
        bus.emit('gesture:menu-toggle', { active: state === 'menu' });
        break;
      }
      case 'MENU_SELECT': {
        bus.emit('menu:select', { timestamp: Date.now() });
        break;
      }
      case 'SCROLL_UP':
      case 'SCROLL_DOWN':
        // These events are already on the bus from the bridge.
        // The handler only advances FSM state here. Phase 3 display
        // listens directly for scroll events.
        break;
    }
  }

  // Wire bus gesture events to handleInput
  const unsubs: Array<() => void> = [];
  unsubs.push(bus.on('gesture:tap', (p) => handleInput('tap', p.timestamp)));
  unsubs.push(bus.on('gesture:double-tap', (p) => handleInput('double-tap', p.timestamp)));
  unsubs.push(bus.on('gesture:scroll-up', (p) => handleInput('scroll-up', p.timestamp)));
  unsubs.push(bus.on('gesture:scroll-down', (p) => handleInput('scroll-down', p.timestamp)));

  // Reset FSM to idle on gateway error chunks (error recovery)
  unsubs.push(bus.on('gateway:chunk', (chunk) => {
    if (chunk.type === 'error') {
      handleInput('reset', Date.now());
    }
  }));

  function destroy(): void {
    for (const unsub of unsubs) {
      unsub();
    }
    unsubs.length = 0;
  }

  return {
    getState: () => state,
    getHintText: () => getHintText(state),
    destroy,
  };
}
