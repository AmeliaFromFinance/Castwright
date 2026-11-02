import { isTauri } from '$lib/api/backend';

export const ZOOM_MIN = 50;
export const ZOOM_MAX = 250;
export const ZOOM_STEPS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250];

export function clampZoom(pct: number): number {
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pct || 100)));
}

/** Next step up or down from `pct`, like browser zoom. */
export function stepZoom(pct: number, dir: 1 | -1): number {
  const cur = clampZoom(pct);
  if (dir > 0) return ZOOM_STEPS.find((s) => s > cur) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find((s) => s < cur) ?? ZOOM_MIN;
}

let applied = 0;

/**
 * The desktop app uses the webview's own zoom, which keeps mouse positions
 * right for dragging. In a browser (demo) CSS zoom stands in.
 */
export function applyZoom(pct: number): void {
  const z = clampZoom(pct);
  if (z === applied) return;
  applied = z;
  if (isTauri()) {
    import('@tauri-apps/api/webview')
      .then(({ getCurrentWebview }) => getCurrentWebview().setZoom(z / 100))
      .catch(() => cssZoom(z));
  } else {
    cssZoom(z);
  }
}

/** CSS zoom also scales `100vh`, so full-height layouts divide by --css-zoom. */
function cssZoom(z: number): void {
  const root = document.documentElement.style;
  root.setProperty('zoom', z === 100 ? '' : String(z / 100));
  root.setProperty('--css-zoom', String(z / 100));
}

/** For tests. */
export function resetZoomCache(): void {
  applied = 0;
}
