import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Layer } from '$lib/bindings/Layer';
import type { Overlay } from '$lib/bindings/Overlay';
import { DEFAULT_TEXT } from '$lib/overlay/styles';
import { shortcutFor } from './keys';
import { createLayer } from './layers';
import { alignLayers, applyTextPatch, distributeLayers, mainStyles, merge, mergeStyles, textPatch, unionRect } from './multi';
import { EditorStore } from './store.svelte';

const doc = (): Overlay => ({ id: 'o', name: 'O', width: 1920, height: 1080, layers: [], fonts: [], updated_at: 0 });

function make(type: Parameters<typeof createLayer>[0], x: number, y: number, w = 100, h = 50): Layer {
  const l = createLayer(type, doc());
  return { ...l, x, y, w, h, rotation: 0 };
}

describe('merging values', () => {
  it('reports mixed values', () => {
    expect(merge([1, 1, 1])).toEqual({ value: 1, mixed: false });
    expect(merge([1, 2])).toEqual({ value: 1, mixed: true });
    expect(merge([{ a: 1 }, { a: 1 }]).mixed).toBe(false);
  });

  it('marks the text fields that differ as mixed', () => {
    const a = make('text', 0, 0);
    const b = make('chat', 0, 0);
    if (a.kind.type === 'text') a.kind.style = { ...DEFAULT_TEXT, font_size: 40, color: '#ff0000' };
    if (b.kind.type === 'chat') b.kind.style = { ...DEFAULT_TEXT, font_size: 22, color: '#ff0000' };
    const shape = make('shape', 0, 0);
    const m = mergeStyles(mainStyles([a, shape, b]));
    expect(m.mixed.has('font_size')).toBe(true);
    expect(m.mixed.has('color')).toBe(false);
    expect(m.style.color).toBe('#ff0000');
  });
});

describe('text edits on many layers', () => {
  it('sets toggles the same way everywhere', () => {
    const shown = { ...DEFAULT_TEXT, uppercase: false };
    expect(textPatch(shown, (s) => (s.uppercase = !s.uppercase))).toEqual({ uppercase: true });
    expect(textPatch(shown, (s) => (s.font_size = shown.font_size))).toEqual({});
  });

  it('scales credits titles and heading with the names', () => {
    const c = make('credits', 0, 0);
    if (c.kind.type !== 'credits') throw new Error('credits');
    c.kind.style.font_size = 20;
    c.kind.title_style.font_size = 30;
    c.kind.heading_style.font_size = 40;
    applyTextPatch(c.kind, { font_size: 40, color: '#00ff00' });
    expect([c.kind.style.font_size, c.kind.title_style.font_size, c.kind.heading_style.font_size]).toEqual([40, 60, 80]);
    expect([c.kind.style.color, c.kind.title_style.color, c.kind.heading_style.color]).toEqual(['#00ff00', '#00ff00', '#00ff00']);
  });

  it('leaves layers without text alone', () => {
    const s = make('shape', 0, 0);
    const before = structuredClone(s.kind);
    applyTextPatch(s.kind, { font_size: 40 });
    expect(s.kind).toEqual(before);
  });
});

describe('align and distribute', () => {
  it('lines layers up with each other', () => {
    const ls = [make('text', 10, 10), make('text', 300, 200, 50, 20)];
    alignLayers(ls, 'left');
    expect(ls.map((l) => l.x)).toEqual([10, 10]);
    alignLayers(ls, 'bottom');
    expect(ls.map((l) => l.y + l.h)).toEqual([220, 220]);
    alignLayers(ls, 'hcenter', { x: 0, y: 0, w: 1000, h: 1000 });
    expect(ls.map((l) => l.x + l.w / 2)).toEqual([500, 500]);
  });

  it('spaces three or more evenly', () => {
    const ls = [make('text', 0, 0, 100), make('text', 150, 0, 100), make('text', 500, 0, 100)];
    distributeLayers(ls, 'x');
    expect(ls.map((l) => l.x)).toEqual([0, 250, 500]);
    expect(unionRect(ls)).toEqual({ x: 0, y: 0, w: 600, h: 50 });
  });
});

describe('selecting several layers in the store', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const o = doc();
    o.layers = [make('text', 0, 0), make('chat', 200, 0), make('timer', 400, 0)];
    return new EditorStore(o, () => Promise.resolve(), 600);
  }

  it('adds, ranges and drops layers', () => {
    const s = setup();
    const [a, b, c] = s.doc.layers.map((l) => l.id) as [string, string, string];
    s.select(a);
    s.toggleSelect(c);
    expect(s.selectedIds).toEqual([a, c]);
    expect(s.multi).toBe(true);
    expect(s.selectedId).toBe(c);
    s.toggleSelect(a);
    expect(s.selectedIds).toEqual([c]);
    s.select(a);
    s.selectRange(c, [a, b, c]);
    expect(new Set(s.selectedIds)).toEqual(new Set([a, b, c]));
    s.removeMany([b]);
    expect(s.selectedIds).toEqual([a, c]);
  });

  it('changes every selected layer in one undo step', () => {
    const s = setup();
    s.selectAll();
    s.changeSelected((l) => (l.opacity = 0.5), { key: 'op' });
    expect(s.doc.layers.every((l) => l.opacity === 0.5)).toBe(true);
    s.undo();
    expect(s.doc.layers.every((l) => l.opacity === 1)).toBe(true);
    expect(s.canUndo).toBe(false);
  });

  it('nudges, duplicates, copies and pastes the selection', () => {
    const s = setup();
    const [a, b] = s.doc.layers.map((l) => l.id) as [string, string];
    s.selectMany([a, b]);
    s.nudge(5, 0);
    expect(s.doc.layers.slice(0, 2).map((l) => l.x)).toEqual([5, 205]);
    s.duplicateMany(s.selectedIds);
    expect(s.doc.layers).toHaveLength(5);
    expect(s.selectedIds).toHaveLength(2);
    expect(s.selectedIds).not.toContain(a);
    expect(s.copy()).toBe(2);
    s.paste();
    expect(s.doc.layers).toHaveLength(7);
    const pasted = s.selection;
    expect(pasted).toHaveLength(2);
    expect(new Set(s.doc.layers.map((l) => l.id)).size).toBe(7);
  });
});

describe('shortcuts', () => {
  const k = (key: string, mod = true) => shortcutFor({ key, ctrlKey: mod, metaKey: false, shiftKey: false, altKey: false });
  it('copies, pastes and selects all', () => {
    expect(k('c')).toEqual({ type: 'copy' });
    expect(k('v')).toEqual({ type: 'paste' });
    expect(k('a')).toEqual({ type: 'selectAll' });
    expect(k('c', false)).toBeNull();
  });
});
