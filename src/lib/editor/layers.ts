// Layer defaults (kept in line with src-tauri/src/model/overlay.rs) and list helpers.
import type { Animation } from '$lib/bindings/Animation';
import type { BoxStyle } from '$lib/bindings/BoxStyle';
import type { Layer } from '$lib/bindings/Layer';
import type { LayerKind } from '$lib/bindings/LayerKind';
import type { Overlay } from '$lib/bindings/Overlay';
import type { TextStyle } from '$lib/bindings/TextStyle';

export type LayerType = LayerKind['type'];
export type KindOf<T extends LayerType> = Extract<LayerKind, { type: T }>;

export const LAYER_TYPES: ReadonlyArray<{ type: LayerType; label: string; hint: string }> = [
  { type: 'text', label: 'Text', hint: 'Static text or variables like {{last.follow.name}}' },
  { type: 'shape', label: 'Shape', hint: 'Rectangle, ellipse or line' },
  { type: 'image', label: 'Image', hint: 'Logo, frame or picture' },
  { type: 'video', label: 'Video', hint: 'Looping video or animation' },
  { type: 'alerts', label: 'Alerts', hint: 'Where follow, sub and cheer alerts play' },
  { type: 'chat', label: 'Chat', hint: 'Live chat messages' },
  { type: 'goal', label: 'Goal', hint: 'Progress bar towards a target' },
  { type: 'counter', label: 'Counter', hint: 'A number from a variable' },
  { type: 'timer', label: 'Timer', hint: 'Countdown, stopwatch, clock or uptime' },
  { type: 'event_list', label: 'Event list', hint: 'Recent follows, subs and more' },
  { type: 'custom', label: 'Custom widget', hint: 'Your own HTML, CSS and JavaScript' }
];

export function typeLabel(type: LayerType): string {
  return LAYER_TYPES.find((t) => t.type === type)?.label ?? type;
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Same shape as the backend's ids: 12 lowercase letters and digits. */
export function newId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function defaultTextStyle(): TextStyle {
  return {
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
  };
}

export function defaultBoxStyle(): BoxStyle {
  return {
    background: 'transparent',
    border_color: 'transparent',
    border_width: 0,
    radius: 0,
    padding: 0,
    shadow: '',
    backdrop_blur: 0
  };
}

export function defaultAnimation(): Animation {
  return { preset: 'none', duration_ms: 0, delay_ms: 0, easing: 'ease_in_out' };
}

/** The panel look used by the starter overlay. */
export function panelBox(): BoxStyle {
  return {
    background: 'rgba(12,15,22,0.78)',
    border_color: 'rgba(255,255,255,0.08)',
    border_width: 1,
    radius: 12,
    padding: 16,
    shadow: '0 12px 40px rgba(0,0,0,0.35)',
    backdrop_blur: 10
  };
}

/** What the backend fills in for a kind when fields are missing. */
export function kindDefaults<T extends LayerType>(type: T): KindOf<T> {
  const k: Record<LayerType, LayerKind> = {
    text: { type: 'text', text: '', style: defaultTextStyle() },
    shape: { type: 'shape', shape: 'rect', fill: '', stroke: '', stroke_width: 0 },
    image: { type: 'image', src: '', fit: 'contain' },
    video: { type: 'video', src: '', fit: 'contain', looped: true, muted: true, volume: 0 },
    alerts: { type: 'alerts' },
    chat: {
      type: 'chat',
      max_messages: 12,
      fade_after_s: 0,
      show_badges: true,
      hide_commands: true,
      hide_users: [],
      style: defaultTextStyle(),
      bubble: defaultBoxStyle(),
      newest_on_top: false
    },
    goal: {
      type: 'goal',
      title: '',
      current_var: '',
      target: 10,
      bar_color: '',
      track_color: '',
      style: defaultTextStyle(),
      show_numbers: true
    },
    counter: { type: 'counter', var: '', format: '', style: defaultTextStyle() },
    timer: { type: 'timer', mode: 'countdown', duration_s: 0, anchor_var: '', style: defaultTextStyle(), prefix: '' },
    event_list: { type: 'event_list', kinds: [], max_items: 5, direction: 'vertical', item_format: '', style: defaultTextStyle() },
    custom: { type: 'custom', html: '', css: '', js: '', fields: {}, values: {} }
  };
  return k[type] as KindOf<T>;
}

/** The backend's `Layer::default()`, with a fresh id. */
export function baseLayer(): Layer {
  return {
    id: newId(),
    name: 'Layer',
    kind: { type: 'text', text: 'Text', style: defaultTextStyle() },
    x: 0,
    y: 0,
    w: 400,
    h: 100,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    visible_when: { mode: 'all', conditions: [] },
    box_style: defaultBoxStyle(),
    enter: defaultAnimation(),
    exit: defaultAnimation(),
    idle: defaultAnimation(),
    css: ''
  };
}

export const CUSTOM_HTML = `<div class="card">
  <span class="dot"></span>
  <p id="message">{message}</p>
</div>`;

export const CUSTOM_CSS = `.card {
  display: flex;
  align-items: center;
  gap: 14px;
  height: 100%;
  padding: 0 24px;
  box-sizing: border-box;
  border-radius: 14px;
  background: rgba(12, 15, 22, 0.8);
  color: #fff;
  font: 600 26px/1.3 Inter, sans-serif;
}
.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: {accent};
}`;

export const CUSTOM_JS = `// Runs inside the widget. Uses the StreamElements widget events.
window.addEventListener('onEventReceived', (obj) => {
  const { listener, event } = obj.detail;
  if (listener === 'follower-latest') {
    document.getElementById('message').textContent = event.name + ' just followed!';
  }
});`;

export const CUSTOM_FIELDS: Record<string, unknown> = {
  message: { type: 'text', label: 'Message', value: 'Thanks for watching!' },
  accent: { type: 'colorpicker', label: 'Accent colour', value: '#5b8def' }
};

interface Preset {
  name: string;
  w: number;
  h: number;
  kind: LayerKind;
  box?: BoxStyle;
}

function preset(type: LayerType): Preset {
  const small = (p: Partial<TextStyle> = {}): TextStyle => ({ ...defaultTextStyle(), font_size: 22, font_weight: 500, ...p });
  switch (type) {
    case 'text':
      return {
        name: 'Text',
        w: 640,
        h: 80,
        kind: { type: 'text', text: 'Your text here', style: { ...defaultTextStyle(), font_size: 48, font_weight: 700 } }
      };
    case 'shape':
      return {
        name: 'Shape',
        w: 400,
        h: 240,
        kind: { type: 'shape', shape: 'rect', fill: 'rgba(91,141,239,0.18)', stroke: '#5b8def', stroke_width: 2 },
        box: { ...defaultBoxStyle(), radius: 16 }
      };
    case 'image':
      return { name: 'Image', w: 400, h: 400, kind: kindDefaults('image') };
    case 'video':
      return { name: 'Video', w: 640, h: 360, kind: { ...kindDefaults('video'), fit: 'cover' } };
    case 'alerts':
      return { name: 'Alerts', w: 800, h: 420, kind: kindDefaults('alerts') };
    case 'chat':
      return { name: 'Chat', w: 480, h: 640, kind: { ...kindDefaults('chat'), style: small() }, box: panelBox() };
    case 'goal':
      return {
        name: 'Goal',
        w: 560,
        h: 110,
        kind: {
          ...kindDefaults('goal'),
          title: 'Sub goal',
          current_var: 'session.subs',
          target: 20,
          bar_color: '#5b8def',
          track_color: 'rgba(255,255,255,0.14)',
          style: small()
        },
        box: panelBox()
      };
    case 'counter':
      return {
        name: 'Counter',
        w: 320,
        h: 90,
        kind: { ...kindDefaults('counter'), var: 'counter.deaths', format: 'Deaths: {{value}}', style: small({ font_size: 30, font_weight: 700 }) },
        box: panelBox()
      };
    case 'timer':
      return {
        name: 'Timer',
        w: 300,
        h: 90,
        kind: { ...kindDefaults('timer'), duration_s: 300, style: small({ font_size: 34, font_weight: 700, align: 'center' }) },
        box: panelBox()
      };
    case 'event_list':
      return {
        name: 'Event list',
        w: 420,
        h: 300,
        kind: {
          ...kindDefaults('event_list'),
          kinds: ['follow', 'sub', 'resub', 'gift_sub', 'community_gift', 'cheer', 'raid'],
          max_items: 6,
          item_format: '{{name}} · {{label}}',
          style: small()
        },
        box: panelBox()
      };
    case 'custom':
      return {
        name: 'Custom widget',
        w: 520,
        h: 120,
        kind: { type: 'custom', html: CUSTOM_HTML, css: CUSTOM_CSS, js: CUSTOM_JS, fields: structuredClone(CUSTOM_FIELDS), values: {} }
      };
  }
}

/** "Text", or "Text 2" if that's taken. */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const names = new Set(taken);
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) {
    const n = `${base} ${i}`;
    if (!names.has(n)) return n;
  }
}

/** A new layer of `type`, sized to fit and centred on the canvas. */
export function createLayer(type: LayerType, overlay: Pick<Overlay, 'width' | 'height' | 'layers'>): Layer {
  const p = preset(type);
  const fit = Math.min(1, (overlay.width * 0.8) / p.w, (overlay.height * 0.8) / p.h);
  const w = Math.round(p.w * fit);
  const h = Math.round(p.h * fit);
  return {
    ...baseLayer(),
    name: uniqueName(
      p.name,
      overlay.layers.map((l) => l.name)
    ),
    kind: p.kind,
    x: Math.round((overlay.width - w) / 2),
    y: Math.round((overlay.height - h) / 2),
    w,
    h,
    box_style: p.box ?? defaultBoxStyle()
  };
}

export function duplicateLayer(layer: Layer, taken: Iterable<string>, offset = 24): Layer {
  const copy = structuredClone(layer);
  copy.id = newId();
  copy.name = uniqueName(`${layer.name} copy`, taken);
  copy.x += offset;
  copy.y += offset;
  copy.locked = false;
  return copy;
}

/** Moves an item from one index to another, returning a new array. */
export function reorder<T>(list: readonly T[], from: number, to: number): T[] {
  const out = list.slice();
  if (from < 0 || from >= out.length) return out;
  const clamped = Math.max(0, Math.min(out.length - 1, to));
  const [item] = out.splice(from, 1);
  out.splice(clamped, 0, item as T);
  return out;
}

/** Moves a layer towards the front (+1) or back (-1) in paint order. */
export function moveLayer(layers: readonly Layer[], id: string, delta: number): Layer[] {
  const i = layers.findIndex((l) => l.id === id);
  if (i < 0) return layers.slice();
  return reorder(layers, i, i + delta);
}

/**
 * Layer panels list the front layer first. Converts a drop in that list (item at `fromRow`
 * dropped before row `beforeRow`, which may equal the length to mean "at the end") into paint order.
 */
export function reorderFromList(layers: readonly Layer[], fromRow: number, beforeRow: number): Layer[] {
  const rows = layers.slice().reverse();
  const target = beforeRow > fromRow ? beforeRow - 1 : beforeRow;
  return reorder(rows, fromRow, target).reverse();
}
