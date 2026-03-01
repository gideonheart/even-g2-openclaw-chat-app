/**
 * Regression tests for confirm modal behavior.
 *
 * Root cause of P0: Even SDK external CSS defines .modal { display: flex }
 * which overrode inline .modal { display: none } when Vite build placed
 * <link> after <style>. Modal was visible on every boot.
 *
 * These tests verify:
 * 1. pendingConfirm starts null (no auto-trigger)
 * 2. confirmAction with null pendingConfirm is safe (no-op)
 * 3. CSS specificity fix: #app ~ .modal selector beats .modal
 */

import { describe, it, expect } from 'vitest';
import { createAppState } from '../app-wiring';
import type { AppSettings } from '../types';

function makeSettings(): AppSettings {
  return {
    gatewayUrl: 'https://gw.example.com',
    sessionKey: 'sk-test',
    sttProvider: 'whisperx',
    apiKey: 'ak-test',
  };
}

describe('confirm modal safety', () => {
  it('pendingConfirm is null on fresh app state (no auto-open trigger)', () => {
    const state = createAppState(makeSettings());
    expect(state.pendingConfirm).toBeNull();
  });

  it('confirmAction pattern: null pendingConfirm executes safely', () => {
    // Simulates the confirmAction() function from hub-main.ts
    const state = createAppState(makeSettings());
    expect(state.pendingConfirm).toBeNull();

    // This mirrors confirmAction() — must not throw when pendingConfirm is null
    const action = state.pendingConfirm;
    state.pendingConfirm = null;
    // Modal would be closed here (classList.remove('active'))
    if (action) action(); // no-op — does not throw
  });

  it('pendingConfirm callback executes and clears on confirm', () => {
    const state = createAppState(makeSettings());
    let executed = false;
    state.pendingConfirm = () => { executed = true; };

    // Simulate confirmAction()
    const action = state.pendingConfirm;
    state.pendingConfirm = null;
    if (action) action();

    expect(executed).toBe(true);
    expect(state.pendingConfirm).toBeNull();
  });

  it('closeConfirm pattern: clears pendingConfirm without executing', () => {
    const state = createAppState(makeSettings());
    let executed = false;
    state.pendingConfirm = () => { executed = true; };

    // Simulate closeConfirm() — cancel without executing
    state.pendingConfirm = null;

    expect(executed).toBe(false);
    expect(state.pendingConfirm).toBeNull();
  });
});

describe('confirm modal CSS specificity', () => {
  it('index.html uses #app ~ .modal selector to beat external .modal rule', async () => {
    // Read the source index.html and verify the CSS fix is present
    const fs = await import('fs');
    const path = await import('path');
    const html = fs.readFileSync(
      path.resolve(process.cwd(), 'index.html'),
      'utf-8',
    );

    // Must use #app ~ .modal (specificity 0,1,1,0) not just .modal (0,0,1,0)
    expect(html).toContain('#app ~ .modal');
    expect(html).toContain('#app ~ .modal.active');

    // Confirm modal must NOT have 'active' class in HTML source
    expect(html).toMatch(/class="modal" id="confirmModal"/);
    expect(html).not.toMatch(/class="modal active" id="confirmModal"/);
  });
});
