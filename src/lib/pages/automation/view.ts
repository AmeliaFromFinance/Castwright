// Pan and zoom of the flow canvas. A world point p shows at p * zoom + (x, y) on screen.
import type { Point, Rect } from './graph';

export interface View {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2;

export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export function toWorld(v: View, p: Point): Point {
  return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom };
}

export function toScreen(v: View, p: Point): Point {
  return { x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y };
}

/** Zoom to `zoom`, keeping the world point under screen point `at` where it is. */
export function zoomAt(v: View, zoom: number, at: Point): View {
  const z = clampZoom(zoom);
  const w = toWorld(v, at);
  return { zoom: z, x: at.x - w.x * z, y: at.y - w.y * z };
}

export interface Pad {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Show all of `r` in a `w` by `h` viewport, leaving `pad` free, no closer than `maxZoom`. */
export function fitView(r: Rect | null, w: number, h: number, pad: number | Pad = 56, maxZoom = 1): View {
  const p = typeof pad === 'number' ? { top: pad, right: pad, bottom: pad, left: pad } : pad;
  if (!r || w <= 0 || h <= 0) return { x: p.left, y: p.top, zoom: 1 };
  const aw = Math.max(1, w - p.left - p.right);
  const ah = Math.max(1, h - p.top - p.bottom);
  const zoom = clampZoom(Math.min(maxZoom, aw / Math.max(1, r.w), ah / Math.max(1, r.h)));
  return { zoom, x: p.left + (aw - r.w * zoom) / 2 - r.x * zoom, y: p.top + (ah - r.h * zoom) / 2 - r.y * zoom };
}

/** Put world point `p` in the middle of a `w` by `h` viewport. */
export function centerOn(v: View, p: Point, w: number, h: number): View {
  return { ...v, x: w / 2 - p.x * v.zoom, y: h / 2 - p.y * v.zoom };
}

/** The part of the world a `w` by `h` viewport shows. */
export function visibleRect(v: View, w: number, h: number): Rect {
  return { x: -v.x / v.zoom, y: -v.y / v.zoom, w: w / v.zoom, h: h / v.zoom };
}
