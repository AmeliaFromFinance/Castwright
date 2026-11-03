// Editing several layers at once: shared values, text styles and alignment.
import type { BoxStyle } from '$lib/bindings/BoxStyle';
import type { Layer } from '$lib/bindings/Layer';
import type { LayerKind } from '$lib/bindings/LayerKind';
import type { TextStyle } from '$lib/bindings/TextStyle';
import { presetBox, presetCard, presetText, type BoxPreset } from '$lib/overlay/presets';
import { DEFAULT_TEXT, resolveItemCard } from '$lib/overlay/styles';
import { bounds, type Rect } from './geometry';

type TextField = 'style' | 'title_style' | 'heading_style';

/** Text styles per layer type, main one first. Credits size their titles and heading along with the names. */
export const TEXT_FIELDS: Partial<Record<LayerKind['type'], readonly TextField[]>> = {
  text: ['style'],
  chat: ['style'],
  goal: ['style'],
  counter: ['style'],
  timer: ['style'],
  event_list: ['style'],
  poll: ['style'],
  credits: ['style', 'title_style', 'heading_style'],
  ad_break: ['style'],
  now_playing: ['style'],
  hype_train: ['style'],
  giveaway: ['style'],
  queue: ['style']
};

export const hasText = (k: LayerKind): boolean => !!TEXT_FIELDS[k.type];

/** The kind's text styles, main first. Missing ones are filled in so they can be edited. */
function stylesOf(k: LayerKind): TextStyle[] {
  const rec = k as unknown as Record<TextField, TextStyle | undefined>;
  return (TEXT_FIELDS[k.type] ?? []).map((f) => (rec[f] ??= { ...DEFAULT_TEXT }));
}

/** The main text style of every layer that has one. */
export function mainStyles(layers: readonly Layer[]): TextStyle[] {
  return layers.flatMap((l) => {
    const field = TEXT_FIELDS[l.kind.type]?.[0];
    if (!field) return [];
    const s = (l.kind as unknown as Record<TextField, TextStyle | undefined>)[field];
    return [{ ...DEFAULT_TEXT, ...(s ?? {}) }];
  });
}

export interface Merged<T> {
  value: T;
  mixed: boolean;
}

/** One value for a set; the first one when they differ. */
export function merge<T>(values: readonly T[]): Merged<T | undefined> {
  const first = values[0];
  const key = JSON.stringify(first);
  return { value: first, mixed: values.some((v) => JSON.stringify(v) !== key) };
}

/** A style to show for many, plus the fields where they differ. */
export function mergeStyles(styles: readonly TextStyle[]): { style: TextStyle; mixed: Set<keyof TextStyle> } {
  const style = { ...DEFAULT_TEXT, ...(styles[0] ?? {}) };
  const mixed = new Set<keyof TextStyle>();
  for (const k of Object.keys(style) as Array<keyof TextStyle>) if (merge(styles.map((s) => s[k])).mixed) mixed.add(k);
  return { style, mixed };
}

/** What an edit changed, worked out on the shown style so toggles end up the same everywhere. */
export function textPatch(shown: TextStyle, edit: (s: TextStyle) => void): Partial<TextStyle> {
  const after = { ...shown };
  edit(after);
  const out: Partial<TextStyle> = {};
  for (const k of Object.keys(after) as Array<keyof TextStyle>) {
    if (JSON.stringify(after[k]) !== JSON.stringify(shown[k])) (out as Record<string, unknown>)[k] = after[k];
  }
  return out;
}

/** Applies a text patch to every text style of a layer kind. Other styles keep their size relative to the main one. */
export function applyTextPatch(k: LayerKind, patch: Partial<TextStyle>): void {
  const [main, ...rest] = stylesOf(k);
  if (!main) return;
  const { font_size: size, ...others } = patch;
  if (size !== undefined) {
    const ratio = main.font_size > 0 ? size / main.font_size : 1;
    main.font_size = size;
    for (const s of rest) s.font_size = Math.max(1, Math.round(s.font_size * ratio));
  }
  for (const s of [main, ...rest]) Object.assign(s, others);
}

export type AlignTo = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

const rectOf = (l: Layer): Rect => bounds({ x: l.x, y: l.y, w: l.w, h: l.h, rotation: l.rotation });

/** Bounds around every layer. */
export function unionRect(layers: readonly Layer[]): Rect | null {
  if (!layers.length) return null;
  const rs = layers.map(rectOf);
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
}

/** Lines layers up with each other (or with `area`, e.g. the canvas). Moves layers in place. */
export function alignLayers(layers: Layer[], to: AlignTo, area: Rect | null = unionRect(layers)): void {
  if (!area) return;
  for (const l of layers) {
    const r = rectOf(l);
    const dx = to === 'left' ? area.x - r.x : to === 'right' ? area.x + area.w - (r.x + r.w) : to === 'hcenter' ? area.x + area.w / 2 - (r.x + r.w / 2) : 0;
    const dy = to === 'top' ? area.y - r.y : to === 'bottom' ? area.y + area.h - (r.y + r.h) : to === 'vcenter' ? area.y + area.h / 2 - (r.y + r.h / 2) : 0;
    l.x = Math.round(l.x + dx);
    l.y = Math.round(l.y + dy);
  }
}

/** Even gaps between three or more layers, keeping the first and last in place. */
export function distributeLayers(layers: Layer[], axis: 'x' | 'y'): void {
  if (layers.length < 3) return;
  const size = (r: Rect) => (axis === 'x' ? r.w : r.h);
  const start = (r: Rect) => (axis === 'x' ? r.x : r.y);
  const sorted = layers.slice().sort((a, b) => start(rectOf(a)) - start(rectOf(b)));
  const rects = sorted.map(rectOf);
  const first = rects[0]!;
  const last = rects[rects.length - 1]!;
  const span = start(last) + size(last) - start(first);
  const gap = (span - rects.reduce((n, r) => n + size(r), 0)) / (rects.length - 1);
  let at = start(first) + size(first) + gap;
  for (let i = 1; i < sorted.length - 1; i++) {
    const r = rects[i]!;
    const shift = Math.round(at - start(r));
    if (axis === 'x') sorted[i]!.x += shift;
    else sorted[i]!.y += shift;
    at += size(r) + gap;
  }
}

const CARD_KINDS = ['chat', 'event_list', 'poll', 'ad_break', 'now_playing', 'hype_train', 'giveaway', 'queue'] as const;
export const hasCards = (k: LayerKind): boolean => (CARD_KINDS as readonly string[]).includes(k.type);

/** A card style preset on a chat, list or other card layer. Does nothing for other kinds. */
export function applyCardPreset(x: LayerKind, p: BoxPreset): void {
  if (x.type === 'chat') x.bubble = presetBox(p, 'chat');
  else if (x.type === 'event_list' || x.type === 'ad_break' || x.type === 'queue') x.item_box = presetBox(p, 'events');
  else if (x.type === 'giveaway') {
    x.item_box = presetBox(p, 'events');
    if (p.accent) x.accent_color = p.accent;
  } else if (x.type === 'poll' || x.type === 'now_playing' || x.type === 'hype_train') {
    x.item_box = presetBox(p, 'events');
    if (p.accent) x.bar_color = p.accent;
  } else return;
  x.item_card = x.type === 'ad_break' || x.type === 'now_playing' || x.type === 'hype_train' || x.type === 'giveaway' ? { ...presetCard(p), width: resolveItemCard(x.item_card).width } : presetCard(p);
  x.style = presetText(x.style, p.text);
}

/** A layer box preset. */
export const applyBoxPreset = (l: Layer, p: BoxPreset): BoxStyle => (l.box_style = presetBox(p, 'layer'));
