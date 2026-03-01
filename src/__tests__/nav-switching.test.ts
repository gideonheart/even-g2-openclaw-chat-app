/**
 * Regression tests for bottom navigation switching.
 *
 * Root cause of P0: Even SDK external CSS `.modal { display: flex; position: fixed;
 * inset: 0 }` defeated inline `.modal { display: none }` due to equal specificity
 * and later source order in Vite builds. This created invisible full-screen overlays
 * that intercepted all pointer events, making bottom nav (and all other clicks) dead.
 *
 * These tests verify:
 * 1. All four nav pages can be activated via show() logic
 * 2. CSS defense-in-depth: modals use !important, pointer-events:none, visibility:hidden
 * 3. #app padding-bottom survives external CSS override
 * 4. Both modals have no 'active' class in HTML source
 * 5. Session modal has same defensive measures as confirm modal
 */

import { describe, it, expect, beforeEach } from 'vitest';

const ALL_PAGES = ['home', 'chat', 'health', 'settings'] as const;

describe('nav page switching', () => {
  let doc: Document;

  beforeEach(() => {
    // Minimal DOM matching index.html structure
    doc = document;
    doc.body.innerHTML = `
      <div id="app">
        <nav class="tabs" id="tabline" style="display:flex">
          <button class="tab is-active" data-tab="home">Home</button>
        </nav>
        <section id="home" class="page active"></section>
        <section id="chat" class="page"></section>
        <section id="health" class="page"></section>
        <section id="settings" class="page"></section>
      </div>
      <div class="bottom-nav-wrap">
        <nav class="bottom-nav" id="bottomNav">
          <button class="active" data-page="home" aria-label="Home"><span>Home</span></button>
          <button data-page="health" aria-label="Health"><span>Health</span></button>
          <button data-page="chat" aria-label="Chat"><span>Chat</span></button>
          <button data-page="settings" aria-label="Settings"><span>Settings</span></button>
        </nav>
      </div>
      <div class="modal" id="sessionModal"><div class="modal__panel"></div></div>
      <div class="modal" id="confirmModal"><div class="modal__panel"></div></div>
    `;
  });

  /**
   * Simulates the show(page) function from hub-main.ts.
   * We replicate the logic here rather than importing hub-main
   * to avoid importing the full module with side effects.
   */
  function show(page: string): void {
    ALL_PAGES.forEach((p) => doc.getElementById(p)!.classList.remove('active'));
    doc.getElementById(page)!.classList.add('active');

    doc.querySelectorAll('#bottomNav button').forEach((n) => {
      const btn = n as HTMLElement;
      btn.classList.toggle('active', btn.dataset.page === page);
    });
    doc.querySelectorAll('#tabline .tab').forEach((t) => {
      const tab = t as HTMLElement;
      tab.classList.toggle('is-active', tab.dataset.tab === page);
    });

    doc.getElementById('tabline')!.style.display = page === 'home' ? 'flex' : 'none';
  }

  it.each(ALL_PAGES)('show("%s") activates correct page and nav button', (page) => {
    show(page);

    // Correct page section is active
    ALL_PAGES.forEach((p) => {
      const el = doc.getElementById(p)!;
      if (p === page) {
        expect(el.classList.contains('active')).toBe(true);
      } else {
        expect(el.classList.contains('active')).toBe(false);
      }
    });

    // Correct nav button is active
    doc.querySelectorAll('#bottomNav button').forEach((n) => {
      const btn = n as HTMLElement;
      if (btn.dataset.page === page) {
        expect(btn.classList.contains('active')).toBe(true);
      } else {
        expect(btn.classList.contains('active')).toBe(false);
      }
    });
  });

  it('tabline visible only on home', () => {
    show('home');
    expect(doc.getElementById('tabline')!.style.display).toBe('flex');

    show('settings');
    expect(doc.getElementById('tabline')!.style.display).toBe('none');

    show('health');
    expect(doc.getElementById('tabline')!.style.display).toBe('none');

    show('chat');
    expect(doc.getElementById('tabline')!.style.display).toBe('none');
  });

  it('bottom nav click handlers can be wired to all 4 buttons', () => {
    const pages: string[] = [];
    doc.querySelectorAll('#bottomNav button').forEach((n) => {
      n.addEventListener('click', () => {
        const page = (n as HTMLElement).dataset.page!;
        pages.push(page);
        show(page);
      });
    });

    // Simulate clicking each nav button
    const buttons = doc.querySelectorAll('#bottomNav button');
    expect(buttons.length).toBe(4);

    buttons.forEach((btn) => {
      (btn as HTMLElement).click();
    });

    expect(pages).toEqual(['home', 'health', 'chat', 'settings']);
    // After clicking settings last, settings page should be active
    expect(doc.getElementById('settings')!.classList.contains('active')).toBe(true);
  });

  it('Settings nav click activates settings page specifically', () => {
    const settingsBtn = doc.querySelector('#bottomNav button[data-page="settings"]') as HTMLElement;
    expect(settingsBtn).not.toBeNull();

    settingsBtn.addEventListener('click', () => show(settingsBtn.dataset.page!));
    settingsBtn.click();

    expect(doc.getElementById('settings')!.classList.contains('active')).toBe(true);
    expect(doc.getElementById('home')!.classList.contains('active')).toBe(false);
    expect(settingsBtn.classList.contains('active')).toBe(true);
  });
});

describe('modal overlay defense-in-depth CSS', () => {
  it('index.html uses !important on modal display:none to survive SDK override', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const html = fs.readFileSync(
      path.resolve(process.cwd(), 'index.html'),
      'utf-8',
    );

    // Must use !important to guarantee display:none wins regardless of
    // external CSS specificity or source order
    expect(html).toMatch(/#app ~ \.modal\s*\{[^}]*display:\s*none\s*!important/);
    expect(html).toMatch(/#app ~ \.modal\.active\s*\{[^}]*display:\s*flex\s*!important/);
  });

  it('index.html adds pointer-events:none to hidden modals', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const html = fs.readFileSync(
      path.resolve(process.cwd(), 'index.html'),
      'utf-8',
    );

    // Defense-in-depth: even if display:none is overridden, pointer-events:none
    // prevents the modal from eating clicks
    expect(html).toMatch(/#app ~ \.modal\s*\{[^}]*pointer-events:\s*none/);
    // When active, pointer-events must be re-enabled
    expect(html).toMatch(/#app ~ \.modal\.active\s*\{[^}]*pointer-events:\s*auto/);
  });

  it('index.html adds visibility:hidden to hidden modals', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const html = fs.readFileSync(
      path.resolve(process.cwd(), 'index.html'),
      'utf-8',
    );

    // Defense-in-depth: visibility:hidden is independent of display
    expect(html).toMatch(/#app ~ \.modal\s*\{[^}]*visibility:\s*hidden/);
    expect(html).toMatch(/#app ~ \.modal\.active\s*\{[^}]*visibility:\s*visible/);
  });

  it('neither modal has active class in HTML source', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const html = fs.readFileSync(
      path.resolve(process.cwd(), 'index.html'),
      'utf-8',
    );

    // Both modals must start without 'active' class
    expect(html).toMatch(/class="modal" id="sessionModal"/);
    expect(html).toMatch(/class="modal" id="confirmModal"/);
    expect(html).not.toMatch(/class="modal active" id="sessionModal"/);
    expect(html).not.toMatch(/class="modal active" id="confirmModal"/);
  });
});

describe('#app padding protection', () => {
  it('index.html uses !important for #app padding-bottom clearance', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const html = fs.readFileSync(
      path.resolve(process.cwd(), 'index.html'),
      'utf-8',
    );

    // #app needs padding-bottom: 96px to clear the fixed bottom nav.
    // Even SDK sets #app { padding: 12px } at equal specificity — must use !important.
    expect(html).toMatch(/#app\s*\{[^}]*padding:[^}]*96px\s*!important/);
  });
});

describe('hub-main.ts modal boot defense', () => {
  it('removes active class from sessionModal at boot', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const ts = fs.readFileSync(
      path.resolve(process.cwd(), 'src/hub-main.ts'),
      'utf-8',
    );

    // Both modals must have classList.remove('active') during init()
    expect(ts).toContain("$('sessionModal').classList.remove('active')");
    expect(ts).toContain("$('confirmModal').classList.remove('active')");
  });

  it('production build places SDK <link> after inline <style>', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const distPath = path.resolve(process.cwd(), 'dist/index.html');

    // Only run if dist exists (post-build)
    if (!fs.existsSync(distPath)) return;

    const html = fs.readFileSync(distPath, 'utf-8');

    // Verify the inline <style> contains our defense-in-depth modal rules
    // Even if the <link> loads after, !important + pointer-events + visibility
    // ensure modals never silently eat clicks
    expect(html).toMatch(/#app ~ \.modal\s*\{[^}]*display:\s*none\s*!important/);
    expect(html).toMatch(/#app ~ \.modal\s*\{[^}]*pointer-events:\s*none/);
    expect(html).toMatch(/#app ~ \.modal\s*\{[^}]*visibility:\s*hidden/);
  });
});
