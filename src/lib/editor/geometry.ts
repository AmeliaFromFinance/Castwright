// Canvas maths for the overlay editor: hit testing, snapping and resizing.
// All values are in overlay pixels unless a name says otherwise.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Box extends Rect {
  /** Degrees, clockwise, around the centre. */
  rotation: number;
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export const MIN_SIZE = 4;

export function rotatePoint(px: number, py: number, cx: number, cy: number, deg: number): [number, number] {
  if (!deg) return [px, py];
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = px - cx;
  const dy = py - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

/** Axis-aligned bounds of a box, whatever its rotation. */
export function bounds(b: Box): Rect {
  if (!b.rotation || b.rotation % 360 === 0) return { x: b.x, y: b.y, w: b.w, h: b.h };
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const pts = [
    rotatePoint(b.x, b.y, cx, cy, b.rotation),
    rotatePoint(b.x + b.w, b.y, cx, cy, b.rotation),
    rotatePoint(b.x + b.w, b.y + b.h, cx, cy, b.rotation),
    rotatePoint(b.x, b.y + b.h, cx, cy, b.rotation)
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function containsPoint(b: Box, px: number, py: number): boolean {
  const [lx, ly] = rotatePoint(px, py, b.x + b.w / 2, b.y + b.h / 2, -(b.rotation || 0));
  return lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h;
}

/** Ids of the boxes under a point, topmost first. `boxes` are in paint order (first is at the back). */
export function hitTest<T extends Box & { id: string }>(boxes: readonly T[], px: number, py: number): string[] {
  const out: string[] = [];
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i]!;
    if (containsPoint(b, px, py)) out.push(b.id);
  }
  return out;
}

/** Alt-click: the next layer under the pointer after the current one, wrapping round. */
export function cycleHit(hits: readonly string[], current: string | null): string | null {
  if (hits.length === 0) return null;
  const i = current ? hits.indexOf(current) : -1;
  return hits[(i + 1) % hits.length] ?? null;
}

// --- snapping -------------------------------------------------------------

export interface SnapTargets {
  x: number[];
  y: number[];
}

export interface Guide {
  axis: 'x' | 'y';
  pos: number;
}

/** Canvas edges and centre plus every other layer's edges and centres. */
export function snapTargets(canvas: { width: number; height: number }, others: readonly Rect[]): SnapTargets {
  const x = new Set<number>([0, canvas.width / 2, canvas.width]);
  const y = new Set<number>([0, canvas.height / 2, canvas.height]);
  for (const r of others) {
    x.add(r.x).add(r.x + r.w / 2).add(r.x + r.w);
    y.add(r.y).add(r.y + r.h / 2).add(r.y + r.h);
  }
  return { x: [...x], y: [...y] };
}

/** Snap distance in overlay pixels, so it feels the same on screen at any zoom. */
export function snapThreshold(zoom: number, screenPx = 6): number {
  return screenPx / (zoom > 0 ? zoom : 1);
}

function nearest(candidates: readonly number[], targets: readonly number[], threshold: number): number | null {
  let best: number | null = null;
  for (const c of candidates) {
    for (const t of targets) {
      const d = t - c;
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  return best;
}

function guidesFor(axis: 'x' | 'y', candidates: readonly number[], targets: readonly number[]): Guide[] {
  const out: Guide[] = [];
  for (const t of targets) {
    if (candidates.some((c) => Math.abs(c - t) < 0.5) && !out.some((g) => g.pos === t)) out.push({ axis, pos: t });
  }
  return out;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

/**
 * How far to shift a moving rect so one of its edges or its centre lines up with a target.
 * `enabled` false (Ctrl/Cmd held, or snapping off) returns no shift.
 */
export function snapMove(rect: Rect, targets: SnapTargets, threshold: number, enabled = true): SnapResult {
  if (!enabled) return { dx: 0, dy: 0, guides: [] };
  const xs = [rect.x, rect.x + rect.w / 2, rect.x + rect.w];
  const ys = [rect.y, rect.y + rect.h / 2, rect.y + rect.h];
  const dx = nearest(xs, targets.x, threshold) ?? 0;
  const dy = nearest(ys, targets.y, threshold) ?? 0;
  return {
    dx,
    dy,
    guides: [
      ...guidesFor(
        'x',
        xs.map((v) => v + dx),
        targets.x
      ),
      ...guidesFor(
        'y',
        ys.map((v) => v + dy),
        targets.y
      )
    ]
  };
}

/** Snaps the edges a resize handle moves. Only for unrotated boxes without an aspect lock. */
export function snapResize(
  rect: Rect,
  handle: Handle,
  targets: SnapTargets,
  threshold: number,
  min = MIN_SIZE
): { rect: Rect; guides: Guide[] } {
  let { x, y, w, h } = rect;
  const guides: Guide[] = [];
  if (handle.includes('e')) {
    const d = nearest([x + w], targets.x, threshold);
    if (d !== null && w + d >= min) {
      w += d;
      guides.push({ axis: 'x', pos: x + w });
    }
  } else if (handle.includes('w')) {
    const d = nearest([x], targets.x, threshold);
    if (d !== null && w - d >= min) {
      x += d;
      w -= d;
      guides.push({ axis: 'x', pos: x });
    }
  }
  if (handle.includes('s')) {
    const d = nearest([y + h], targets.y, threshold);
    if (d !== null && h + d >= min) {
      h += d;
      guides.push({ axis: 'y', pos: y + h });
    }
  } else if (handle.includes('n')) {
    const d = nearest([y], targets.y, threshold);
    if (d !== null && h - d >= min) {
      y += d;
      h -= d;
      guides.push({ axis: 'y', pos: y });
    }
  }
  return { rect: { x, y, w, h }, guides };
}

// --- resizing -------------------------------------------------------------

export interface ResizeOptions {
  keepAspect?: boolean;
  min?: number;
}

/** Where the fixed point sits for a handle: 0 = left/top, 1 = right/bottom, 0.5 = middle. */
function anchorOf(handle: Handle): [number, number] {
  const ax = handle.includes('e') ? 0 : handle.includes('w') ? 1 : 0.5;
  const ay = handle.includes('s') ? 0 : handle.includes('n') ? 1 : 0.5;
  return [ax, ay];
}

/**
 * Resize an unrotated rect by dragging `handle` by (dx, dy). The opposite edge or corner stays put.
 * Never smaller than `min` on either side.
 */
export function resize(start: Rect, handle: Handle, dx: number, dy: number, opts: ResizeOptions = {}): Rect {
  const min = Math.max(1, opts.min ?? MIN_SIZE);
  const horiz = handle.includes('e') || handle.includes('w');
  const vert = handle.includes('n') || handle.includes('s');
  let w = start.w;
  let h = start.h;
  if (handle.includes('e')) w = start.w + dx;
  if (handle.includes('w')) w = start.w - dx;
  if (handle.includes('s')) h = start.h + dy;
  if (handle.includes('n')) h = start.h - dy;

  if (opts.keepAspect && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h;
    let s: number;
    if (horiz && vert) {
      const sx = w / start.w;
      const sy = h / start.h;
      s = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
    } else if (horiz) {
      s = w / start.w;
    } else {
      s = h / start.h;
    }
    s = Math.max(s, min / Math.min(start.w, start.h));
    w = start.w * s;
    h = w / ratio;
  } else {
    w = Math.max(min, w);
    h = Math.max(min, h);
  }

  const [ax, ay] = anchorOf(handle);
  const fx = start.x + ax * start.w;
  const fy = start.y + ay * start.h;
  return { x: fx - ax * w, y: fy - ay * h, w, h };
}

/**
 * Resize a possibly rotated box. (dx, dy) is the pointer movement on the canvas; it's turned
 * into the box's own axes, and the result is shifted so the fixed point doesn't move on screen.
 */
export function resizeBox(start: Box, handle: Handle, dx: number, dy: number, opts: ResizeOptions = {}): Rect {
  const rot = start.rotation || 0;
  const [ldx, ldy] = rotatePoint(dx, dy, 0, 0, -rot);
  const r = resize(start, handle, ldx, ldy, opts);
  if (!rot) return r;
  const [ax, ay] = anchorOf(handle);
  const before = rotatePoint(start.x + ax * start.w, start.y + ay * start.h, start.x + start.w / 2, start.y + start.h / 2, rot);
  const after = rotatePoint(r.x + ax * r.w, r.y + ay * r.h, r.x + r.w / 2, r.y + r.h / 2, rot);
  return { x: r.x + before[0] - after[0], y: r.y + before[1] - after[1], w: r.w, h: r.h };
}

/** Cursor for a handle, turned to match the box's rotation. */
export function handleCursor(handle: Handle, rotation: number): string {
  const order: Handle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  const cursors = ['ns', 'nesw', 'ew', 'nwse', 'ns', 'nesw', 'ew', 'nwse'];
  const step = Math.round((((rotation % 360) + 360) % 360) / 45);
  return `${cursors[(order.indexOf(handle) + step) % 8]}-resize`;
}

export function roundRect(r: Rect): Rect {
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) };
}
