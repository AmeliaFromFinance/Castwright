import { describe, expect, it } from 'vitest';
import {
  bounds,
  containsPoint,
  cycleHit,
  handleCursor,
  hitTest,
  resize,
  resizeBox,
  rotatePoint,
  snapMove,
  snapResize,
  snapTargets,
  snapThreshold,
  type Box
} from './geometry';

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);
const box = (x: number, y: number, w: number, h: number, rotation = 0, id = 'a'): Box & { id: string } => ({ id, x, y, w, h, rotation });

describe('bounds', () => {
  it('is the rect itself without rotation', () => {
    expect(bounds(box(10, 20, 100, 50))).toEqual({ x: 10, y: 20, w: 100, h: 50 });
  });

  it('swaps width and height at 90 degrees around the centre', () => {
    const b = bounds(box(0, 0, 100, 50, 90));
    close(b.x, 25);
    close(b.y, -25);
    close(b.w, 50);
    close(b.h, 100);
  });

  it('grows to hold a 45 degree square', () => {
    const b = bounds(box(0, 0, 100, 100, 45));
    close(b.w, Math.SQRT2 * 100);
    close(b.x + b.w / 2, 50);
  });

  it('treats full turns as unrotated', () => {
    expect(bounds(box(5, 5, 10, 10, 360))).toEqual({ x: 5, y: 5, w: 10, h: 10 });
  });
});

describe('hit testing', () => {
  it('respects rotation', () => {
    const b = box(0, 0, 200, 20, 90);
    expect(containsPoint(b, 100, 10)).toBe(true);
    expect(containsPoint(b, 5, 10)).toBe(false);
    expect(containsPoint(b, 100, -80)).toBe(true);
  });

  it('returns ids topmost first', () => {
    const layers = [box(0, 0, 100, 100, 0, 'back'), box(50, 50, 100, 100, 0, 'front'), box(500, 500, 10, 10, 0, 'away')];
    expect(hitTest(layers, 75, 75)).toEqual(['front', 'back']);
    expect(hitTest(layers, 10, 10)).toEqual(['back']);
    expect(hitTest(layers, 300, 300)).toEqual([]);
  });

  it('cycles through stacked layers', () => {
    const hits = ['front', 'middle', 'back'];
    expect(cycleHit(hits, null)).toBe('front');
    expect(cycleHit(hits, 'front')).toBe('middle');
    expect(cycleHit(hits, 'back')).toBe('front');
    expect(cycleHit(hits, 'elsewhere')).toBe('front');
    expect(cycleHit([], 'front')).toBeNull();
  });
});

describe('snapping', () => {
  const canvas = { width: 1920, height: 1080 };

  it('collects canvas and layer edges and centres', () => {
    const t = snapTargets(canvas, [{ x: 100, y: 200, w: 300, h: 100 }]);
    expect(t.x.sort((a, b) => a - b)).toEqual([0, 100, 250, 400, 960, 1920]);
    expect(t.y.sort((a, b) => a - b)).toEqual([0, 200, 250, 300, 540, 1080]);
  });

  it('snaps the nearest edge within the threshold', () => {
    const t = snapTargets(canvas, []);
    const r = snapMove({ x: 4, y: 300, w: 100, h: 100 }, t, 6);
    expect(r.dx).toBe(-4);
    expect(r.dy).toBe(0);
    expect(r.guides).toEqual([{ axis: 'x', pos: 0 }]);
  });

  it('snaps centres to the canvas centre', () => {
    const t = snapTargets(canvas, []);
    const r = snapMove({ x: 857, y: 487, w: 200, h: 100 }, t, 6);
    expect(r.dx).toBe(3);
    expect(r.dy).toBe(3);
    expect(r.guides).toContainEqual({ axis: 'x', pos: 960 });
    expect(r.guides).toContainEqual({ axis: 'y', pos: 540 });
  });

  it('snaps to other layers', () => {
    const t = snapTargets(canvas, [{ x: 600, y: 600, w: 200, h: 50 }]);
    const r = snapMove({ x: 803, y: 100, w: 50, h: 50 }, t, 6);
    expect(r.dx).toBe(-3);
    expect(r.guides).toContainEqual({ axis: 'x', pos: 800 });
  });

  it('ignores targets beyond the threshold', () => {
    const t = snapTargets(canvas, []);
    expect(snapMove({ x: 20, y: 300, w: 100, h: 100 }, t, 6)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('is off while Ctrl/Cmd is held', () => {
    const t = snapTargets(canvas, []);
    expect(snapMove({ x: 2, y: 2, w: 100, h: 100 }, t, 6, false)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('scales the threshold with zoom', () => {
    expect(snapThreshold(1)).toBe(6);
    expect(snapThreshold(0.5)).toBe(12);
    expect(snapThreshold(2)).toBe(3);
    expect(snapThreshold(0)).toBe(6);
    const t = snapTargets(canvas, []);
    const rect = { x: 10, y: 300, w: 100, h: 100 };
    expect(snapMove(rect, t, snapThreshold(1)).dx).toBe(0);
    expect(snapMove(rect, t, snapThreshold(0.5)).dx).toBe(-10);
  });

  it('snaps only the edges a resize handle moves', () => {
    const t = snapTargets(canvas, []);
    const r = snapResize({ x: 100, y: 100, w: 1816, h: 100 }, 'e', t, 6);
    expect(r.rect).toEqual({ x: 100, y: 100, w: 1820, h: 100 });
    expect(r.guides).toEqual([{ axis: 'x', pos: 1920 }]);
    const nw = snapResize({ x: 3, y: 4, w: 100, h: 100 }, 'nw', t, 6);
    expect(nw.rect).toEqual({ x: 0, y: 0, w: 103, h: 104 });
  });
});

describe('resize', () => {
  const start = { x: 100, y: 100, w: 200, h: 100 };

  it('moves only the dragged edge', () => {
    expect(resize(start, 'e', 50, 999)).toEqual({ x: 100, y: 100, w: 250, h: 100 });
    expect(resize(start, 'w', 50, 0)).toEqual({ x: 150, y: 100, w: 150, h: 100 });
    expect(resize(start, 'n', 0, -20)).toEqual({ x: 100, y: 80, w: 200, h: 120 });
    expect(resize(start, 's', 0, 30)).toEqual({ x: 100, y: 100, w: 200, h: 130 });
  });

  it('keeps the opposite corner fixed', () => {
    expect(resize(start, 'nw', -10, -20)).toEqual({ x: 90, y: 80, w: 210, h: 120 });
    expect(resize(start, 'se', 10, 20)).toEqual({ x: 100, y: 100, w: 210, h: 120 });
  });

  it('never goes below the minimum size, holding the anchor', () => {
    expect(resize(start, 'e', -500, 0, { min: 10 })).toEqual({ x: 100, y: 100, w: 10, h: 100 });
    expect(resize(start, 'w', 500, 0, { min: 10 })).toEqual({ x: 290, y: 100, w: 10, h: 100 });
    expect(resize(start, 'n', 0, 500, { min: 8 })).toEqual({ x: 100, y: 192, w: 200, h: 8 });
  });

  it('keeps the aspect ratio with a corner, following the bigger change', () => {
    const r = resize(start, 'se', 100, 10, { keepAspect: true });
    expect(r).toEqual({ x: 100, y: 100, w: 300, h: 150 });
    const nw = resize(start, 'nw', -10, -50, { keepAspect: true });
    expect(nw.w / nw.h).toBeCloseTo(2);
    expect(nw.h).toBe(150);
    expect(nw.x + nw.w).toBe(300);
    expect(nw.y + nw.h).toBe(200);
  });

  it('keeps the aspect ratio with an edge, centred on the other axis', () => {
    const r = resize(start, 'e', 200, 0, { keepAspect: true });
    expect(r).toEqual({ x: 100, y: 50, w: 400, h: 200 });
  });

  it('respects the minimum with the aspect lock', () => {
    const r = resize(start, 'se', -1000, -1000, { keepAspect: true, min: 10 });
    expect(r.h).toBeCloseTo(10);
    expect(r.w).toBeCloseTo(20);
    expect(r.x).toBe(100);
  });
});

describe('resizeBox', () => {
  it('matches resize without rotation', () => {
    const s = { x: 0, y: 0, w: 100, h: 50, rotation: 0 };
    expect(resizeBox(s, 'se', 20, 10)).toEqual(resize(s, 'se', 20, 10));
  });

  it('works in the box axes and keeps the anchor in place when rotated', () => {
    const s = { x: 0, y: 0, w: 100, h: 50, rotation: 90 };
    // At 90 degrees the box's right edge faces down, so dragging down widens it.
    const r = resizeBox(s, 'e', 0, 40);
    close(r.w, 140);
    close(r.h, 50);
    const anchor = (b: Box) => rotatePoint(b.x, b.y + b.h / 2, b.x + b.w / 2, b.y + b.h / 2, b.rotation);
    const [ax, ay] = anchor(s);
    const [bx, by] = anchor({ ...r, rotation: 90 });
    close(ax, bx);
    close(ay, by);
  });
});

describe('handleCursor', () => {
  it('turns with the box', () => {
    expect(handleCursor('e', 0)).toBe('ew-resize');
    expect(handleCursor('e', 90)).toBe('ns-resize');
    expect(handleCursor('nw', 0)).toBe('nwse-resize');
    expect(handleCursor('n', 45)).toBe('nesw-resize');
    expect(handleCursor('n', -90)).toBe('ew-resize');
  });
});
