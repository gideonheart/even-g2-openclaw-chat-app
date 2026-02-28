// ── Runtime router ──────────────────────────────────────────
// Detects Even App WebView vs browser and boots the correct code path.
// Primary detection: window.flutter_inappwebview (injected by Even App SDK).
// Secondary: ?even URL parameter for manual override during development.

async function main() {
  const isEvenApp =
    typeof (window as any).flutter_inappwebview !== 'undefined' ||
    new URLSearchParams(location.search).has('even');

  if (isEvenApp) {
    const { boot } = await import('./glasses-main');
    await boot();
  } else {
    const { initHub } = await import('./hub-main');
    await initHub();
  }
}

main().catch((err) => {
  console.error('[main] Fatal boot error:', err);
});
