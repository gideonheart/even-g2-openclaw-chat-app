// ── Menu controller — wires bus events to menu state, renderer, and session commands ──
//
// Subscribes to gesture:menu-toggle, menu:select, and scroll events on the bus.
// Manages menu lifecycle: open, scroll, select, confirm, execute, auto-close.
// Follows the factory/closure pattern consistent with the rest of the codebase.

import {
  createMenuState,
  menuScrollUp,
  menuScrollDown,
  menuSelect,
  menuCancelConfirm,
  renderMenuText,
  type MenuState,
  type MenuCommand,
} from './command-menu';
import { generateConversationName } from '../persistence/conversation-store';
import type { EventBus } from '../events';
import type { AppEventMap } from '../types';
import type { GlassesRenderer } from '../display/glasses-renderer';
import type { SessionManager } from '../sessions';
import type { ConversationStore } from '../persistence/types';

// ── Public interface ──────────────────────────────────────

export interface MenuController {
  isOpen(): boolean;
  destroy(): void;
}

export interface MenuControllerDeps {
  bus: EventBus<AppEventMap>;
  renderer: GlassesRenderer;
  sessionManager: SessionManager;
  getActiveSessionId: () => string;
  onSessionSwitch: (sessionId: string) => Promise<void>;
  store: ConversationStore | null;
}

// ── Constants ─────────────────────────────────────────────

const AUTO_CLOSE_MS = 5000;

// ── Factory ───────────────────────────────────────────────

export function createMenuController(deps: MenuControllerDeps): MenuController {
  const { bus, renderer, sessionManager, getActiveSessionId, onSessionSwitch, store } = deps;

  let menuState: MenuState | null = null;
  let autoCloseTimer: ReturnType<typeof setTimeout> | null = null;
  const unsubs: Array<() => void> = [];

  // ── Auto-close timer (MENU-05) ─────────────────────────

  function clearAutoClose(): void {
    if (autoCloseTimer !== null) {
      clearTimeout(autoCloseTimer);
      autoCloseTimer = null;
    }
  }

  function resetAutoClose(): void {
    clearAutoClose();
    autoCloseTimer = setTimeout(() => {
      closeMenu();
    }, AUTO_CLOSE_MS);
  }

  // ── Menu lifecycle ─────────────────────────────────────

  function openMenu(): void {
    menuState = createMenuState();
    renderer.showMenuOverlay(renderMenuText(menuState));
    resetAutoClose();
  }

  function closeMenu(): void {
    // Set menuState to null FIRST to prevent re-entry
    menuState = null;
    clearAutoClose();
    renderer.restoreConversation();
    // Emit menu:close for any interested listeners
    bus.emit('menu:close', {});
  }

  // ── Navigation handlers ────────────────────────────────

  function handleScrollUp(): void {
    if (!menuState) return;
    // During confirmation, scroll cancels the confirmation
    if (menuState.confirmingIndex !== null) {
      menuState = menuCancelConfirm(menuState);
    } else {
      menuState = menuScrollUp(menuState);
    }
    renderer.showMenuOverlay(renderMenuText(menuState));
  }

  function handleScrollDown(): void {
    if (!menuState) return;
    // During confirmation, scroll cancels the confirmation
    if (menuState.confirmingIndex !== null) {
      menuState = menuCancelConfirm(menuState);
    } else {
      menuState = menuScrollDown(menuState);
    }
    renderer.showMenuOverlay(renderMenuText(menuState));
  }

  function handleSelect(): void {
    if (!menuState) return;
    const { newState, result } = menuSelect(menuState);

    if (result.action === 'confirm') {
      // Destructive command needs confirmation -- update state and re-render
      menuState = newState;
      renderer.showMenuOverlay(renderMenuText(menuState));
    } else if (result.action === 'execute' && result.command) {
      // Execute command and close menu
      executeCommand(result.command);
      closeMenu();
    }
  }

  // ── Command execution ──────────────────────────────────

  function executeCommand(command: MenuCommand): void {
    const activeId = getActiveSessionId();

    switch (command) {
      case 'new': {
        sessionManager.createSession()
          .then((session) => onSessionSwitch(session.id))
          .catch((err) => {
            console.error('[MenuController] /new failed:', err);
            renderer.showError('Failed to create session');
          });
        break;
      }

      case 'switch': {
        sessionManager.loadSessions()
          .then((sessions) => {
            if (sessions.length <= 1) {
              // Only one session -- show brief feedback
              renderer.showMenuOverlay('No other sessions');
              setTimeout(() => {
                renderer.restoreConversation();
              }, 1000);
              return;
            }
            // Find the next session after current (cycle)
            const currentIndex = sessions.findIndex((s) => s.id === activeId);
            const nextIndex = (currentIndex + 1) % sessions.length;
            const nextSession = sessions[nextIndex];
            sessionManager.switchSession(nextSession.id);
            onSessionSwitch(nextSession.id);
          })
          .catch((err) => {
            console.error('[MenuController] /switch failed:', err);
            renderer.showError('Failed to switch session');
          });
        break;
      }

      case 'rename': {
        (async () => {
          try {
            let name = 'Session ' + new Date().toLocaleTimeString();
            if (store) {
              const messages = await store.getMessages(activeId);
              const firstUserMsg = messages.find((m) => m.role === 'user');
              if (firstUserMsg) {
                name = generateConversationName(firstUserMsg.text);
              }
            }
            await sessionManager.renameSession(activeId, name);
          } catch (err) {
            console.error('[MenuController] /rename failed:', err);
            renderer.showError('Failed to rename session');
          }
        })();
        break;
      }

      case 'reset': {
        (async () => {
          try {
            await sessionManager.deleteSession(activeId);
            const newSession = await sessionManager.createSession();
            await onSessionSwitch(newSession.id);
          } catch (err) {
            console.error('[MenuController] /reset failed:', err);
            renderer.showError('Failed to reset session');
          }
        })();
        break;
      }

      case 'delete': {
        (async () => {
          try {
            await sessionManager.deleteSession(activeId);
            const remaining = await sessionManager.loadSessions();
            if (remaining.length > 0) {
              await onSessionSwitch(remaining[0].id);
            } else {
              const newSession = await sessionManager.createSession();
              await onSessionSwitch(newSession.id);
            }
          } catch (err) {
            console.error('[MenuController] /delete failed:', err);
            renderer.showError('Failed to delete session');
          }
        })();
        break;
      }
    }
  }

  // ── Event subscriptions ────────────────────────────────

  unsubs.push(
    bus.on('gesture:menu-toggle', ({ active }) => {
      if (active) {
        openMenu();
      } else if (menuState) {
        closeMenu();
      }
    }),
  );

  unsubs.push(
    bus.on('menu:select', () => {
      if (!menuState) return;
      resetAutoClose();
      handleSelect();
    }),
  );

  unsubs.push(
    bus.on('gesture:scroll-up', () => {
      if (!menuState) return;
      resetAutoClose();
      handleScrollUp();
    }),
  );

  unsubs.push(
    bus.on('gesture:scroll-down', () => {
      if (!menuState) return;
      resetAutoClose();
      handleScrollDown();
    }),
  );

  // ── Public API ─────────────────────────────────────────

  function destroy(): void {
    clearAutoClose();
    menuState = null;
    for (const unsub of unsubs) {
      unsub();
    }
    unsubs.length = 0;
  }

  return {
    isOpen: () => menuState !== null,
    destroy,
  };
}
