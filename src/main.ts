// ── Runtime router ──────────────────────────────────────────
// The Even App runs BOTH the glasses display and the phone-side Hub UI
// in a single WebView.  glasses-main drives the AR display via the SDK
// bridge while hub-main wires up the phone-screen companion UI (bottom
// nav, settings, health, chat history, etc.).
//
// Detection: window.flutter_inappwebview is injected by the Even App SDK.
//   - Present  -> Even App WebView  -> boot glasses-main AND hub-main
//   - Absent   -> plain browser     -> boot hub-main only (dev / standalone)
//   - ?even URL param forces glasses-main in a browser for dev testing.

type MainDeps = {
  initHub: () => Promise<void>;
  bootGlasses: () => Promise<void>;
};

async function defaultInitHub(): Promise<void> {
  const { initHub } = await import('./hub-main');
  await initHub();
}

async function defaultBootGlasses(): Promise<void> {
  const { boot } = await import('./glasses-main');
  await boot();
}

export async function main(deps: MainDeps = {
  initHub: defaultInitHub,
  bootGlasses: defaultBootGlasses,
}): Promise<void> {
  const hasFlutterBridge =
    typeof (window as any).flutter_inappwebview !== 'undefined';
  const forceEvenDev = new URLSearchParams(location.search).has('even');

  // Hub UI is always needed (phone screen / standalone browser).
  // IMPORTANT: initHub failures must not block glasses boot in dual-runtime mode.
  try {
    await deps.initHub();
  } catch (err) {
    console.error('[main] Hub init failed (continuing):', err);
  }

  // Glasses runtime is added when running inside Even App (or ?even dev flag)
  if (hasFlutterBridge || forceEvenDev) {
    await deps.bootGlasses();
  }
}

if (!(import.meta as any).vitest) {
  import('./build-info').then(({ renderBuildInfo }) => renderBuildInfo());
  main().catch((err) => {
    console.error('[main] Fatal boot error:', err);
  });
}
