// ── Build info — injected at compile time by Vite define ──

declare const __COMMIT_HASH__: string;
declare const __BUILD_TIME__: string;

function timeAgo(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ' + (m % 60) + 'm ago';
  const d = Math.floor(h / 24);
  return d + 'd ' + (h % 24) + 'h ago';
}

export function renderBuildInfo(): void {
  const el = document.getElementById('buildInfo');
  if (!el) return;
  const hash = typeof __COMMIT_HASH__ !== 'undefined' ? __COMMIT_HASH__ : 'dev';
  const built = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : null;
  const ago = built ? timeAgo(new Date(built)) : 'dev mode';
  el.textContent = `${hash} \u00B7 built ${ago}`;
}
