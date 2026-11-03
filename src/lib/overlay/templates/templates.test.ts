import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import type { Layer } from '$lib/bindings/Layer';
import { baseLayer, defaultTextStyle, kindDefaults } from '$lib/editor/layers';
import { sampleChat, sampleEvent } from '$lib/editor/samples';
import OverlayStage from '../OverlayStage.svelte';
import { DEFAULT_BOX } from '../styles';
import { BUILT_IN_TEMPLATES, TEMPLATE_FILES, buildLayer, fromTemplate, merge } from './index';

/** Paths in `got` that the defaults don't have, or whose type differs. */
function shapeErrors(got: unknown, want: unknown, path = ''): string[] {
  if (want === null || want === undefined) return [];
  if (Array.isArray(want)) return Array.isArray(got) ? [] : [`${path} should be a list`];
  if (typeof want !== 'object') return typeof got === typeof want ? [] : [`${path} should be a ${typeof want}`];
  if (!got || typeof got !== 'object') return [`${path} should be an object`];
  const out: string[] = [];
  const w = want as Record<string, unknown>;
  const g = got as Record<string, unknown>;
  for (const k of Object.keys(g)) {
    if (!(k in w)) out.push(`${path}.${k} is not a known field`);
    else out.push(...shapeErrors(g[k], w[k], `${path}.${k}`));
  }
  for (const k of Object.keys(w)) if (!(k in g)) out.push(`${path}.${k} is missing`);
  return out;
}

function expected(l: Layer): unknown {
  const kind = kindDefaults(l.kind.type) as Record<string, unknown>;
  return { ...baseLayer(), kind, box_style: DEFAULT_BOX };
}

describe('built-in overlay templates', () => {
  it('has the six layouts with unique ids', () => {
    expect(TEMPLATE_FILES.map((t) => t.id)).toEqual(['just-chatting', 'gameplay', 'starting-soon', 'brb', 'ending', 'vertical']);
    const vertical = BUILT_IN_TEMPLATES.find((t) => t.id === 'vertical')!.overlay;
    expect([vertical.width, vertical.height]).toEqual([1080, 1920]);
  });

  for (const t of BUILT_IN_TEMPLATES) {
    describe(t.name, () => {
      const o = t.overlay;

      it('builds complete layers with known fields only', () => {
        expect(o.layers.length).toBeGreaterThan(3);
        expect(t.description.length).toBeGreaterThan(10);
        for (const l of o.layers) {
          expect(shapeErrors(l, expected(l), l.name)).toEqual([]);
          const style = (l.kind as { style?: unknown }).style;
          if (style) expect(shapeErrors(style, defaultTextStyle(), `${l.name}.style`)).toEqual([]);
        }
        expect(new Set(o.layers.map((l) => l.id)).size).toBe(o.layers.length);
      });

      it('keeps every layer on the canvas', () => {
        for (const l of o.layers) {
          expect(l.w, l.name).toBeGreaterThan(0);
          expect(l.h, l.name).toBeGreaterThan(0);
          // Decorative glows may hang off the edge; everything else fits.
          const inside = l.x >= 0 && l.y >= 0 && l.x + l.w <= o.width && l.y + l.h <= o.height;
          const overlaps = l.x < o.width && l.y < o.height && l.x + l.w > 0 && l.y + l.h > 0;
          expect(l.name.startsWith('Glow') ? overlaps : inside, l.name).toBe(true);
        }
      });

      it('has the layers a stream needs', () => {
        const types = new Set(o.layers.map((l) => l.kind.type));
        expect(types.has('alerts')).toBe(true);
        if (['starting-soon', 'brb'].includes(t.id)) expect(o.layers.some((l) => l.kind.type === 'timer' && l.kind.mode === 'countdown')).toBe(true);
      });

      it('renders', () => {
        const target = document.createElement('div');
        document.body.appendChild(target);
        const chat = [sampleChat('first'), sampleChat('second')];
        const recent = [sampleEvent('follow'), sampleEvent('sub')];
        const c = mount(OverlayStage, { target, props: { overlay: o, chat, recent, mode: 'editor', paused: true, muted: true } });
        flushSync();
        for (const l of o.layers) {
          const el = target.querySelector(`[data-layer-id="${l.id}"]`);
          expect(el, l.name).not.toBeNull();
          if (l.kind.type === 'text') expect(el!.textContent).toContain(l.kind.text);
          if (l.kind.type === 'timer') expect(el!.textContent).toMatch(/\d\d:\d\d/);
          if (l.kind.type === 'chat') expect(el!.textContent).toContain('second');
        }
        unmount(c);
        target.remove();
      });
    });
  }

  it('makes new overlays with fresh ids', () => {
    const src = BUILT_IN_TEMPLATES[0]!.overlay;
    const a = fromTemplate(src, '  Main  ');
    const b = fromTemplate(src, '');
    expect(a.name).toBe('Main');
    expect(b.name).toBe(src.name);
    expect(a.id).not.toBe(b.id);
    const ids = [...a.layers, ...b.layers, ...src.layers].map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(a.layers.map((l) => l.name)).toEqual(src.layers.map((l) => l.name));
  });

  it('refuses unknown presets', () => {
    expect(() => buildLayer({ kind: { type: 'text' }, box: 'nope' }, 'x')).toThrow(/nope/);
  });

  it('merges nested objects and replaces lists', () => {
    expect(merge({ a: { b: 1, c: 2 }, l: [1, 2] }, { a: { c: 3 }, l: [9] })).toEqual({ a: { b: 1, c: 3 }, l: [9] });
  });
});
