import { describe, expect, it } from 'vitest';
import type { Layer } from '$lib/bindings/Layer';
import {
  LAYER_TYPES,
  baseLayer,
  createLayer,
  duplicateLayer,
  kindDefaults,
  moveLayer,
  newId,
  reorder,
  reorderFromList,
  uniqueName,
  type LayerType
} from './layers';
import { newOverlay, starterLayers } from './starter';

const ANIM_PRESETS = ['none', 'fade', 'slide_up', 'slide_down', 'slide_left', 'slide_right', 'zoom', 'pop', 'bounce', 'flip', 'pulse', 'float', 'shake', 'spin'];
const EASINGS = ['linear', 'ease_in', 'ease_out', 'ease_in_out', 'spring', 'back'];
const LAYER_KEYS = ['id', 'name', 'kind', 'x', 'y', 'w', 'h', 'rotation', 'opacity', 'visible', 'locked', 'visible_when', 'scenes', 'box_style', 'enter', 'exit', 'idle', 'css'].sort();
const TEXT_KEYS = ['font_family', 'font_size', 'font_weight', 'color', 'align', 'line_height', 'letter_spacing', 'uppercase', 'italic', 'shadow', 'stroke_width', 'stroke_color'].sort();
// As in BoxStyle::default() in src-tauri/src/model/overlay.rs.
const RUST_DEFAULT_BOX = {
  background: 'transparent',
  border_color: 'transparent',
  border_width: 0,
  radius: 0,
  padding: 0,
  shadow: '',
  backdrop_blur: 0,
  shape: 'rounded',
  corners: null,
  tail_side: 'bottom',
  tail_pos: 20,
  tail_size: 16,
  slant: 12,
  cut: 14,
  pixel: 6,
  fill: 'solid',
  gradient: [
    { color: '#5b8def', at: 0 },
    { color: '#c9b3ff', at: 100 }
  ],
  gradient_angle: 135,
  fill_opacity: 1,
  pattern: 'none',
  pattern_color: '#000000',
  pattern_opacity: 0.18,
  pattern_size: 8,
  border_style: 'solid',
  stripe: 'none',
  stripe_width: 4,
  stripe_color: '#9db8ff',
  stripe_name_color: false,
  shadow_kind: 'custom',
  shadow_x: 0,
  shadow_y: 8,
  shadow_blur: 24,
  shadow_color: 'rgba(0,0,0,0.35)',
  lean: 0,
  padding_x: null
};
const BOX_KEYS = Object.keys(RUST_DEFAULT_BOX).sort();

// Field names per kind, as in src-tauri/src/model/overlay.rs.
const KIND_KEYS: Record<LayerType, string[]> = {
  text: ['text', 'style'],
  shape: ['shape', 'fill', 'stroke', 'stroke_width'],
  image: ['src', 'fit'],
  video: ['src', 'fit', 'looped', 'muted', 'volume'],
  alerts: [],
  chat: [
    'max_messages',
    'fade_after_s',
    'show_badges',
    'hide_commands',
    'hide_users',
    'style',
    'bubble',
    'newest_on_top',
    'seventv_emotes',
    'bttv_emotes',
    'ffz_emotes',
    'seventv_paints',
    'seventv_badges',
    'item_card'
  ],
  goal: ['title', 'current_var', 'target', 'bar_color', 'track_color', 'style', 'show_numbers'],
  counter: ['var', 'format', 'style'],
  timer: ['mode', 'duration_s', 'anchor_var', 'style', 'prefix'],
  event_list: ['kinds', 'max_items', 'direction', 'item_format', 'style', 'item_box', 'item_card'],
  poll: ['show', 'result_s', 'show_title', 'show_timer', 'show_totals', 'bar_color', 'track_color', 'style', 'item_box', 'item_card'],
  custom: ['html', 'css', 'js', 'fields', 'values']
};

function expectValid(l: Layer) {
  expect(Object.keys(l).sort()).toEqual(LAYER_KEYS);
  expect(l.id).toMatch(/^[a-z0-9]{12}$/);
  for (const n of [l.x, l.y, l.w, l.h, l.rotation, l.opacity]) expect(Number.isFinite(n)).toBe(true);
  expect(l.w).toBeGreaterThan(0);
  expect(l.h).toBeGreaterThan(0);
  expect(l.opacity).toBeGreaterThanOrEqual(0);
  expect(l.opacity).toBeLessThanOrEqual(1);
  expect(Object.keys(l.box_style).sort()).toEqual(BOX_KEYS);
  for (const a of [l.enter, l.exit, l.idle]) {
    expect(ANIM_PRESETS).toContain(a.preset);
    expect(EASINGS).toContain(a.easing);
  }
  expect(Object.keys(l.kind).sort()).toEqual(['type', ...KIND_KEYS[l.kind.type]].sort());
  if ('style' in l.kind) expect(Object.keys(l.kind.style).sort()).toEqual(TEXT_KEYS);
  // Must survive the JSON round trip to the backend unchanged.
  expect(JSON.parse(JSON.stringify(l))).toEqual(l);
}

describe('defaults match the backend', () => {
  it('Layer::default', () => {
    const l = baseLayer();
    expectValid(l);
    expect({ ...l, id: '' }).toEqual({
      id: '',
      name: 'Layer',
      kind: {
        type: 'text',
        text: 'Text',
        style: {
          font_family: 'Inter',
          font_size: 28,
          font_weight: 600,
          color: '#ffffff',
          align: 'left',
          line_height: 1.25,
          letter_spacing: 0,
          uppercase: false,
          italic: false,
          shadow: '0 2px 6px rgba(0,0,0,0.45)',
          stroke_width: 0,
          stroke_color: '#000000'
        }
      },
      x: 0,
      y: 0,
      w: 400,
      h: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      visible_when: { mode: 'all', conditions: [] },
      // As in SceneRule::default().
      scenes: { mode: 'all', scenes: [], transition: 'fade', duration_ms: 300 },
      box_style: RUST_DEFAULT_BOX,
      enter: { preset: 'none', duration_ms: 0, delay_ms: 0, easing: 'ease_in_out' },
      exit: { preset: 'none', duration_ms: 0, delay_ms: 0, easing: 'ease_in_out' },
      idle: { preset: 'none', duration_ms: 0, delay_ms: 0, easing: 'ease_in_out' },
      css: ''
    });
  });

  it('serde defaults per kind', () => {
    expect(kindDefaults('shape')).toEqual({ type: 'shape', shape: 'rect', fill: '', stroke: '', stroke_width: 0 });
    expect(kindDefaults('video')).toMatchObject({ looped: true, muted: true, volume: 0, fit: 'contain' });
    expect(kindDefaults('chat')).toMatchObject({ max_messages: 12, show_badges: true, hide_commands: true, newest_on_top: false, fade_after_s: 0 });
    expect(kindDefaults('goal')).toMatchObject({ target: 10, show_numbers: true });
    expect(kindDefaults('timer')).toMatchObject({ mode: 'countdown', duration_s: 0 });
    expect(kindDefaults('event_list')).toMatchObject({ max_items: 5, direction: 'vertical', kinds: [], item_box: RUST_DEFAULT_BOX });
    expect(kindDefaults('chat').item_card).toEqual({ alternate: false, tint: 0, around: 'message', width: 'full', gap: 6 });
    expect(kindDefaults('alerts')).toEqual({ type: 'alerts' });
    expect(kindDefaults('custom')).toEqual({ type: 'custom', html: '', css: '', js: '', fields: {}, values: {} });
  });

  it('returns fresh objects each time', () => {
    const a = kindDefaults('chat');
    a.hide_users.push('x');
    expect(kindDefaults('chat').hide_users).toEqual([]);
  });
});

describe('createLayer', () => {
  const overlay = { width: 1920, height: 1080, layers: [] as Layer[] };

  it.each(LAYER_TYPES.map((t) => t.type))('makes a valid %s layer', (type) => {
    const l = createLayer(type, overlay);
    expectValid(l);
    expect(l.kind.type).toBe(type);
    // Only position, size, name, kind and box differ from Layer::default.
    const base = baseLayer();
    for (const k of ['rotation', 'opacity', 'visible', 'locked', 'visible_when', 'enter', 'exit', 'idle', 'css'] as const) {
      expect(l[k]).toEqual(base[k]);
    }
  });

  it('centres on the canvas', () => {
    const l = createLayer('text', overlay);
    expect(l.x + l.w / 2).toBeCloseTo(960, 0);
    expect(l.y + l.h / 2).toBeCloseTo(540, 0);
  });

  it('shrinks to fit a small canvas', () => {
    const l = createLayer('chat', { width: 400, height: 300, layers: [] });
    expect(l.w).toBeLessThanOrEqual(320);
    expect(l.h).toBeLessThanOrEqual(240);
    expect(l.x).toBeGreaterThanOrEqual(0);
  });

  it('picks a unique name', () => {
    const first = createLayer('text', overlay);
    const second = createLayer('text', { ...overlay, layers: [first] });
    expect(first.name).toBe('Text');
    expect(second.name).toBe('Text 2');
  });

  it('gives custom widgets working sample fields', () => {
    const l = createLayer('custom', overlay);
    if (l.kind.type !== 'custom') throw new Error('wrong kind');
    expect(Object.keys(l.kind.fields)).toEqual(['message', 'accent']);
    expect(l.kind.html).toContain('{message}');
  });
});

describe('helpers', () => {
  it('newId looks like a backend id', () => {
    expect(newId()).toMatch(/^[a-z0-9]{12}$/);
    expect(newId()).not.toBe(newId());
  });

  it('uniqueName', () => {
    expect(uniqueName('Chat', [])).toBe('Chat');
    expect(uniqueName('Chat', ['Chat', 'Chat 2'])).toBe('Chat 3');
  });

  it('duplicateLayer copies deeply with a new id and offset', () => {
    const l = createLayer('goal', { width: 1920, height: 1080, layers: [] });
    l.locked = true;
    const d = duplicateLayer(l, [l.name]);
    expect(d.id).not.toBe(l.id);
    expect(d.name).toBe('Goal copy');
    expect(d.x).toBe(l.x + 24);
    expect(d.locked).toBe(false);
    if (d.kind.type === 'goal') d.kind.style.color = 'red';
    expect(l.kind.type === 'goal' && l.kind.style.color).toBe('#ffffff');
  });
});

describe('reordering', () => {
  const mk = (id: string): Layer => ({ ...baseLayer(), id });
  const ids = (ls: Layer[]) => ls.map((l) => l.id);
  const layers = ['a', 'b', 'c', 'd'].map(mk);

  it('reorder moves and clamps', () => {
    expect(reorder([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
    expect(reorder([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3]);
    expect(reorder([1, 2, 3], 0, 99)).toEqual([2, 3, 1]);
    expect(reorder([1, 2, 3], 5, 0)).toEqual([1, 2, 3]);
  });

  it('moveLayer goes forward and back in paint order', () => {
    expect(ids(moveLayer(layers, 'b', 1))).toEqual(['a', 'c', 'b', 'd']);
    expect(ids(moveLayer(layers, 'b', -1))).toEqual(['b', 'a', 'c', 'd']);
    expect(ids(moveLayer(layers, 'd', 1))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(moveLayer(layers, 'a', -1))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(moveLayer(layers, 'zz', 1))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('reorderFromList maps the front-first list to paint order', () => {
    // List rows: d, c, b, a. Drag "d" (row 0) to the bottom (before row 4).
    expect(ids(reorderFromList(layers, 0, 4))).toEqual(['d', 'a', 'b', 'c']);
    // Drag "a" (row 3) to the top.
    expect(ids(reorderFromList(layers, 3, 0))).toEqual(['b', 'c', 'd', 'a']);
    // Drag "c" (row 1) to just before "a" (row 3).
    expect(ids(reorderFromList(layers, 1, 3))).toEqual(['a', 'c', 'b', 'd']);
    // Dropping onto itself changes nothing.
    expect(ids(reorderFromList(layers, 2, 2))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(reorderFromList(layers, 2, 3))).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('starter layouts', () => {
  it.each([
    [1920, 1080],
    [1280, 720],
    [1080, 1920]
  ])('%ix%i: valid layers inside the canvas', (w, h) => {
    const layers = starterLayers(w, h);
    expect(layers.length).toBeGreaterThan(3);
    for (const l of layers) {
      expectValid(l);
      expect(l.x).toBeGreaterThanOrEqual(0);
      expect(l.y).toBeGreaterThanOrEqual(0);
      expect(l.x + l.w).toBeLessThanOrEqual(w);
      expect(l.y + l.h).toBeLessThanOrEqual(h);
    }
  });

  it('newOverlay clamps size and names', () => {
    const o = newOverlay('  ', 99999, 3, false);
    expect(o.name).toBe('New overlay');
    expect(o.width).toBe(7680);
    expect(o.height).toBe(16);
    expect(o.layers).toEqual([]);
    expect(o.fonts).toEqual(['Inter']);
    expect(newOverlay('Main', 1920, 1080, true).layers.length).toBeGreaterThan(0);
  });
});
