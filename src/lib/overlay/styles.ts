import type { BoxStyle } from '$lib/bindings/BoxStyle';
import type { ItemCard } from '$lib/bindings/ItemCard';
import type { Layer } from '$lib/bindings/Layer';
import type { LayerKind } from '$lib/bindings/LayerKind';
import type { TextStyle } from '$lib/bindings/TextStyle';
import { parseColor } from './color';
import { DEFAULT_FONT, isDefaultFont } from './fonts';

export const DEFAULT_TEXT: TextStyle = {
  font_family: DEFAULT_FONT,
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
  stroke_color: '#000000',
  overflow: 'wrap',
  scroll_speed: 60
};

const FALLBACK_STACK = '"Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';

/** Values are written into style attributes, so keep them from closing the declaration. */
export function cssValue(v: unknown): string {
  return typeof v === 'string' ? v.replace(/[;{}<>]/g, '').trim() : '';
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Set on the stage to the project's default font stack. */
export const DEFAULT_FONT_VAR = '--cw-default-font';

export function fontStack(family: string): string {
  const f = cssValue(family).replace(/["']/g, '').trim();
  if (isDefaultFont(f)) return `var(${DEFAULT_FONT_VAR}, "Inter", ${FALLBACK_STACK})`;
  if (f.includes(',')) {
    return f
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => (/^[\w-]+$/.test(p) ? p : `"${p}"`))
      .join(', ');
  }
  return `"${f}", ${FALLBACK_STACK}`;
}

/**
 * `layer` outlines need StyledText (a stroked copy behind the text). `inline` uses
 * -webkit-text-stroke directly, for mixed content such as chat lines.
 */
export function textStyleCss(s: Partial<TextStyle> | null | undefined, strokeMode: 'layer' | 'inline' = 'layer'): string {
  const t = { ...DEFAULT_TEXT, ...(s ?? {}) };
  const size = Math.max(1, num(t.font_size, 28));
  const parts = [
    `font-family:${fontStack(t.font_family)}`,
    `font-size:${size}px`,
    `font-weight:${Math.round(num(t.font_weight, 600))}`,
    `color:${cssValue(t.color) || '#ffffff'}`,
    `text-align:${t.align === 'center' || t.align === 'right' ? t.align : 'left'}`,
    `line-height:${num(t.line_height, 1.25) > 0 ? num(t.line_height, 1.25) : 1.25}`,
    `letter-spacing:${num(t.letter_spacing, 0)}px`,
    `text-transform:${t.uppercase ? 'uppercase' : 'none'}`,
    `font-style:${t.italic ? 'italic' : 'normal'}`
  ];
  const shadow = cssValue(t.shadow) || 'none';
  const stroke = Math.max(0, num(t.stroke_width, 0));
  if (stroke > 0 && strokeMode === 'inline') {
    parts.push(
      `-webkit-text-stroke:${stroke}px ${cssValue(t.stroke_color) || '#000'}`,
      'paint-order:stroke fill',
      `text-shadow:${shadow}`
    );
  } else if (stroke > 0) {
    // The outline is drawn by a copy of the text behind the fill (see StyledText), so it
    // never eats into the glyphs. The shadow goes on that copy.
    parts.push(
      `--cw-stroke-w:${stroke * 2}px`,
      `--cw-stroke-c:${cssValue(t.stroke_color) || '#000'}`,
      `--cw-shadow:${shadow}`,
      'text-shadow:none'
    );
  } else {
    parts.push(`text-shadow:${shadow}`);
  }
  return parts.join(';');
}

export function hasStroke(s: Partial<TextStyle> | null | undefined): boolean {
  return num(s?.stroke_width, 0) > 0;
}

// ---- Boxes and cards ----------------------------------------------------

export const DEFAULT_BOX: BoxStyle = {
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

export const DEFAULT_ITEM_CARD: ItemCard = { alternate: false, tint: 0, around: 'message', width: 'full', gap: 6 };

/** A full BoxStyle from a partial one (older projects lack the newer fields). */
export function resolveBox(b: Partial<BoxStyle> | null | undefined): BoxStyle {
  const out = { ...DEFAULT_BOX, ...(b ?? {}) } as BoxStyle;
  for (const k of Object.keys(DEFAULT_BOX) as (keyof BoxStyle)[]) {
    const d = DEFAULT_BOX[k];
    if (typeof d === 'number' && !(typeof out[k] === 'number' && Number.isFinite(out[k]))) (out as Record<string, unknown>)[k] = d;
  }
  if (!Array.isArray(out.gradient)) out.gradient = DEFAULT_BOX.gradient;
  return out;
}

export function resolveItemCard(c: Partial<ItemCard> | null | undefined): ItemCard {
  const out = { ...DEFAULT_ITEM_CARD, ...(c ?? {}) };
  if (!Number.isFinite(out.tint)) out.tint = 0;
  if (!Number.isFinite(out.gap)) out.gap = DEFAULT_ITEM_CARD.gap;
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const px = (v: number) => `${Math.round(v * 100) / 100}px`;

/** `color` with its alpha multiplied by `k`. Colours that can't be parsed are returned as they are. */
export function withAlpha(color: string, k: number): string {
  const c = cssValue(color);
  if (k >= 1) return c;
  const p = parseColor(c);
  if (!p) return c;
  const a = Math.round(clamp(p.a * k, 0, 1) * 1000) / 1000;
  return `rgba(${Math.round(p.r)},${Math.round(p.g)},${Math.round(p.b)},${a})`;
}

function visible(color: string): boolean {
  const c = cssValue(color);
  if (!c || c === 'transparent') return false;
  const p = parseColor(c);
  return !p || p.a > 0;
}

function borderWidth(b: BoxStyle): number {
  const w = Math.max(0, num(b.border_width, 0));
  if (!w || !visible(b.border_color)) return 0;
  return b.border_style === 'comic' ? Math.max(w, 4) : w;
}

export function boxPadding(b: Partial<BoxStyle> | null | undefined): { x: number; y: number } {
  const y = Math.max(0, num(b?.padding, 0));
  const x = b?.padding_x === null || b?.padding_x === undefined ? y : Math.max(0, num(b.padding_x, y));
  return { x, y };
}

/** Space taken by padding and border on each side. */
export function boxInset(b: Partial<BoxStyle> | null | undefined): { x: number; y: number } {
  if (!b) return { x: 0, y: 0 };
  const p = boxPadding(b);
  const bw = borderWidth(resolveBox(b));
  return { x: p.x + bw, y: p.y + bw };
}

function radii(b: BoxStyle): string {
  if (b.shape === 'rect') return '';
  if (b.shape === 'pill') return '9999px';
  const c = b.corners;
  if (Array.isArray(c) && c.length === 4 && c.some((v) => num(v, 0) > 0)) return c.map((v) => px(Math.max(0, num(v, 0)))).join(' ');
  const r = Math.max(0, num(b.radius, 0));
  return r > 0 ? px(r) : '';
}

function solidFill(b: BoxStyle): string {
  if (b.fill !== 'solid' || !visible(b.background)) return '';
  return withAlpha(b.background, clamp(num(b.fill_opacity, 1), 0, 1));
}

function gradientFill(b: BoxStyle): string {
  if (b.fill !== 'gradient') return '';
  const k = clamp(num(b.fill_opacity, 1), 0, 1);
  const stops = (b.gradient ?? [])
    .filter((s) => s && cssValue(s.color))
    .map((s) => `${withAlpha(s.color, k)} ${clamp(num(s.at, 0), 0, 100)}%`);
  if (!stops.length) return '';
  if (stops.length === 1) stops.push(stops[0]!);
  return `linear-gradient(${num(b.gradient_angle, 135)}deg, ${stops.join(', ')})`;
}

/** Fill colour used where a gradient can't be drawn (bubble tails), and to judge contrast. */
export function fillColorOf(b: Partial<BoxStyle> | null | undefined, end = false): string {
  const r = resolveBox(b);
  if (r.fill === 'none') return '';
  if (r.fill === 'gradient') {
    const g = r.gradient.filter((s) => cssValue(s?.color));
    const s = end ? g[g.length - 1] : g[0];
    return s ? withAlpha(s.color, clamp(r.fill_opacity, 0, 1)) : '';
  }
  return solidFill(r);
}

function patternLayers(b: BoxStyle): string[] {
  if (b.pattern === 'none') return [];
  const op = clamp(num(b.pattern_opacity, 0.18), 0, 1);
  if (op <= 0) return [];
  const c = withAlpha(b.pattern_color || '#000', op);
  const s = clamp(num(b.pattern_size, 8), 2, 200);
  switch (b.pattern) {
    case 'halftone': {
      const dot = `radial-gradient(circle, ${c} ${px(s * 0.2)}, transparent ${px(s * 0.2 + 0.7)})`;
      return [`${dot} 0 0 / ${px(s)} ${px(s)}`, `${dot} ${px(s / 2)} ${px(s / 2)} / ${px(s)} ${px(s)}`];
    }
    case 'stripes':
      return [`repeating-linear-gradient(45deg, ${c} 0 ${px(s * 0.35)}, transparent ${px(s * 0.35)} ${px(s)})`];
    case 'grid':
      return [
        `linear-gradient(${c} 1px, transparent 1px) 0 0 / ${px(s)} ${px(s)}`,
        `linear-gradient(90deg, ${c} 1px, transparent 1px) 0 0 / ${px(s)} ${px(s)}`
      ];
    case 'noise': {
      const p = parseColor(c) ?? { r: 0, g: 0, b: 0, a: op };
      const f = (v: number) => Math.round((v / 255) * 1000) / 1000;
      const tile = Math.round(clamp(s * 16, 64, 512));
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}">` +
        `<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="${Math.round((7 / s) * 100) / 100}" numOctaves="3" stitchTiles="stitch"/>` +
        `<feColorMatrix values="0 0 0 0 ${f(p.r)} 0 0 0 0 ${f(p.g)} 0 0 0 0 ${f(p.b)} 0 0 0 ${Math.round(p.a * 2 * 1000) / 1000} -${Math.round(p.a * 0.5 * 1000) / 1000}"/></filter>` +
        `<rect width="100%" height="100%" filter="url(#n)"/></svg>`;
      return [`url("data:image/svg+xml,${encodeURIComponent(svg)}")`];
    }
    default:
      return [];
  }
}

interface Shadow {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}

function lengthPx(t: string): number | null {
  if (t === '0') return 0;
  const m = /^(-?[\d.]+)px$/.exec(t);
  return m ? Number(m[1]) : null;
}

/** Parses simple box-shadow lists. Null when it uses anything else (inset, other units). */
export function parseShadow(css: string): Shadow[] | null {
  const out: Shadow[] = [];
  for (const part of splitTopLevel(css, ',')) {
    const toks = splitTopLevel(part.trim(), ' ').filter(Boolean);
    if (!toks.length) continue;
    const lens: number[] = [];
    const rest: string[] = [];
    for (const t of toks) {
      const v = lengthPx(t);
      if (v !== null && rest.length === 0) lens.push(v);
      else if (v !== null || t === 'inset') return null;
      else rest.push(t);
    }
    if (lens.length < 2 || lens.length > 4) return null;
    out.push({ x: lens[0]!, y: lens[1]!, blur: lens[2] ?? 0, spread: lens[3] ?? 0, color: rest.join(' ') || 'rgba(0,0,0,0.5)' });
  }
  return out;
}

function shadowsOf(b: BoxStyle): { list: Shadow[]; raw: string } {
  const c = cssValue(b.shadow_color) || 'rgba(0,0,0,0.35)';
  const x = num(b.shadow_x, 0);
  const y = num(b.shadow_y, 8);
  const blur = Math.max(0, num(b.shadow_blur, 24));
  switch (b.shadow_kind) {
    case 'none':
      return { list: [], raw: '' };
    case 'soft':
      return { list: [{ x, y, blur, spread: 0, color: c }], raw: '' };
    case 'hard':
      return { list: [{ x, y, blur: 0, spread: 0, color: c }], raw: '' };
    case 'glow':
      return {
        list: [
          { x: 0, y: 0, blur, spread: 0, color: c },
          { x: 0, y: 0, blur: Math.round(blur / 3), spread: 0, color: c }
        ],
        raw: ''
      };
    case 'layered':
      return {
        list: [
          { x: x / 8, y: y / 8, blur: blur / 12, spread: 0, color: withAlpha(c, 0.6) },
          { x: x / 3, y: y / 3, blur: blur / 3, spread: 0, color: withAlpha(c, 0.6) },
          { x, y, blur, spread: 0, color: c }
        ],
        raw: ''
      };
    default: {
      const raw = cssValue(b.shadow);
      return { list: raw ? (parseShadow(raw) ?? []) : [], raw };
    }
  }
}

function boxShadowCss(s: { list: Shadow[]; raw: string }): string {
  if (s.raw) return s.raw;
  return s.list.map((v) => `${px(v.x)} ${px(v.y)} ${px(v.blur)}${v.spread ? ` ${px(v.spread)}` : ''} ${v.color}`).join(', ');
}

/** drop-shadow() follows clipped shapes and tails. Its blur is a deviation, about half a box-shadow blur. */
function dropShadowCss(s: { list: Shadow[] }): string {
  return s.list.map((v) => `drop-shadow(${px(v.x)} ${px(v.y)} ${px(v.blur / 2)} ${v.color})`).join(' ');
}

type Pt = [x: number, y: number, fromRight: boolean, fromBottom: boolean];

function ptCss([x, y, r, b]: Pt): string {
  return `${r ? (x ? `calc(100% - ${px(x)})` : '100%') : px(x)} ${b ? (y ? `calc(100% - ${px(y)})` : '100%') : px(y)}`;
}

/** Outline points clockwise from the top left, as offsets from the nearest edges. */
function outline(b: BoxStyle, inset: number): Pt[] {
  const i = inset;
  // One corner, going clockwise, written for the top left; mirrored for the others.
  let corner: [number, number][];
  if (b.shape === 'cut') {
    const c = Math.max(0, num(b.cut, 14) - i * 0.4142);
    corner = [
      [i, i + c],
      [i + c, i]
    ];
  } else {
    const s = Math.max(1, num(b.pixel, 6));
    corner = [
      [i, i + 2 * s],
      [i + s, i + 2 * s],
      [i + s, i + s],
      [i + 2 * s, i + s],
      [i + 2 * s, i]
    ];
  }
  const tl: Pt[] = corner.map(([x, y]) => [x, y, false, false]);
  const tr: Pt[] = corner
    .slice()
    .reverse()
    .map(([x, y]) => [x, y, true, false]);
  const br: Pt[] = corner.map(([x, y]) => [x, y, true, true]);
  const bl: Pt[] = corner
    .slice()
    .reverse()
    .map(([x, y]) => [x, y, false, true]);
  return [...tl, ...tr, ...br, ...bl];
}

function polygon(pts: Pt[]): string {
  return `polygon(${pts.map(ptCss).join(', ')})`;
}

function ring(outer: Pt[], inner: Pt[]): string {
  const all = [...outer, outer[0]!, inner[0]!, ...inner.slice(1), inner[0]!, outer[0]!];
  return `polygon(evenodd, ${all.map(ptCss).join(', ')})`;
}

export interface FrameOptions {
  /** Item cards read --cw-name, --cw-tint and --cw-lean from each card's style. */
  item?: Partial<ItemCard> | null;
  /** Where a card that fits its content sits. */
  align?: 'left' | 'center' | 'right';
  /** Leave the lean out (it is applied elsewhere). */
  noLean?: boolean;
  /** Add margins so tails and hard shadows aren't cut off by the layer. */
  room?: boolean;
}

function decls(list: (string | number | false | null | undefined)[]): string {
  return list.filter(Boolean).join(';');
}

/**
 * CSS rules that draw a BoxStyle on `sel`. Plain shapes style the element itself. Slanted
 * shapes draw on a skewed ::before, cut and pixel shapes on clipped ::before (border) and
 * ::after (fill) layers, so borders and shadows follow the outline. Bubble tails use ::after.
 */
export function frameCss(box: Partial<BoxStyle> | null | undefined, sel: string, o: FrameOptions = {}): string {
  if (!box) return '';
  const b = resolveBox(box);
  const item = o.item ? resolveItemCard(o.item) : null;
  const bw = borderWidth(b);
  const bstyle = b.border_style === 'comic' ? 'solid' : b.border_style;
  const pad = boxPadding(b);
  const layers: string[] = [];
  if (b.stripe !== 'none' && b.stripe_width > 0) {
    const sc = b.stripe_name_color && item ? `var(--cw-name, ${cssValue(b.stripe_color) || '#fff'})` : cssValue(b.stripe_color);
    if (sc) {
      const w = px(b.stripe_width);
      const g = `linear-gradient(${sc}, ${sc})`;
      const at = { left: `left top / ${w} 100%`, right: `right top / ${w} 100%`, top: `left top / 100% ${w}`, bottom: `left bottom / 100% ${w}` }[b.stripe];
      layers.push(`${g} ${at} no-repeat`);
    }
  }
  if (item && item.tint > 0) layers.push('linear-gradient(var(--cw-tint, transparent), var(--cw-tint, transparent))');
  layers.push(...patternLayers(b));
  const grad = gradientFill(b);
  if (grad) layers.push(grad);
  const color = solidFill(b);
  const bg = [...layers, color].filter(Boolean).join(', ');
  const shadows = shadowsOf(b);
  const blur = Math.max(0, num(b.backdrop_blur, 0));
  const blurCss = blur > 0 && `backdrop-filter:blur(${px(blur)});-webkit-backdrop-filter:blur(${px(blur)})`;
  const lean = o.noLean ? 0 : num(b.lean, 0);
  const transform = lean ? `transform:rotate(${item?.alternate ? `calc(var(--cw-lean, 1) * ${lean}deg)` : `${lean}deg`})` : '';
  const tail = b.shape === 'bubble' && b.tail_side !== 'none' && b.tail_size > 0;
  const tailSize = Math.max(0, num(b.tail_size, 16));

  const outer: string[] = [];
  if (item?.width === 'fit') {
    outer.push(`align-self:${o.align === 'center' ? 'center' : o.align === 'right' ? 'flex-end' : 'flex-start'}`, 'max-width:100%');
  }
  if (item?.around === 'words') outer.push('display:inline-block', 'max-width:100%');
  if (o.room) {
    const m = { top: 0, right: 0, bottom: 0, left: 0 };
    if (b.shadow_kind === 'hard' || b.shadow_kind === 'soft' || b.shadow_kind === 'layered') {
      m.right = Math.max(0, shadows.list[shadows.list.length - 1]?.x ?? 0);
      m.left = Math.max(0, -(shadows.list[shadows.list.length - 1]?.x ?? 0));
      if (b.shadow_kind === 'hard') m.bottom = Math.max(0, shadows.list[0]?.y ?? 0);
    }
    if (tail) m[b.tail_side as 'top' | 'right' | 'bottom' | 'left'] += Math.ceil(tailSize * 0.9);
    if (m.top || m.right || m.bottom || m.left) outer.push(`margin:${px(m.top)} ${px(m.right)} ${px(m.bottom)} ${px(m.left)}`);
  }
  if (transform) outer.push(transform);

  const rules: string[] = [];
  const rule = (s: string, d: string) => d && rules.push(`${s}{${d}}`);
  const pseudo = 'content:"";position:absolute;inset:0;z-index:-1;pointer-events:none';

  if (b.shape === 'slanted') {
    const r = radii({ ...b, shape: 'rounded' });
    const layer = decls([
      bg && `background:${bg}`,
      bw && `border:${px(bw)} ${bstyle} ${cssValue(b.border_color)}`,
      r && `border-radius:${r}`,
      boxShadowCss(shadows) && `box-shadow:${boxShadowCss(shadows)}`,
      blurCss
    ]);
    const padX = pad.x + bw;
    rule(sel, decls([layer && 'position:relative;isolation:isolate', (pad.y || padX) && `padding:${px(pad.y + bw)} ${px(padX)}`, ...outer]));
    if (layer) rule(`${sel}::before`, `${pseudo};transform:skewX(${-num(b.slant, 12)}deg);${layer}`);
  } else if (b.shape === 'cut' || b.shape === 'pixel') {
    const outerPts = outline(b, 0);
    const innerPts = outline(b, bw);
    const drop = dropShadowCss(shadows);
    rule(
      sel,
      decls([
        'position:relative;isolation:isolate',
        (pad.y || pad.x || bw) && `padding:${px(pad.y + bw)} ${px(pad.x + bw)}`,
        drop && `filter:${drop}`,
        ...outer
      ])
    );
    if (bw) {
      const clip = ring(outerPts, innerPts);
      rule(`${sel}::before`, `${pseudo};background:${cssValue(b.border_color)};-webkit-clip-path:${clip};clip-path:${clip}`);
    }
    if (bg || blurCss) {
      const clip = polygon(innerPts);
      rule(`${sel}::after`, decls([pseudo, bg && `background:${bg}`, `-webkit-clip-path:${clip};clip-path:${clip}`, blurCss]));
    }
  } else {
    const r = radii(b);
    const shadowCss = tail ? '' : boxShadowCss(shadows);
    const drop = tail ? dropShadowCss(shadows) : '';
    rule(
      sel,
      decls([
        bg && `background:${bg}`,
        bw && `border:${px(bw)} ${bstyle} ${cssValue(b.border_color)}`,
        r && `border-radius:${r}`,
        (pad.x || pad.y) && `padding:${pad.x === pad.y ? px(pad.y) : `${px(pad.y)} ${px(pad.x)}`}`,
        shadowCss && `box-shadow:${shadowCss}`,
        drop && `filter:${drop}`,
        blurCss,
        tail && 'position:relative',
        ...outer
      ])
    );
    if (tail) rules.push(tailCss(b, sel, bw, bstyle, tailSize));
  }
  return rules.join('\n');
}

function tailCss(b: BoxStyle, sel: string, bw: number, bstyle: string, size: number): string {
  const side = b.tail_side;
  const pos = clamp(num(b.tail_pos, 20), 0, 100);
  const fill = fillColorOf(b, side === 'bottom' || side === 'right') || 'transparent';
  const s = px(size);
  const half = `calc(${-size / 2}px - ${px(bw / 2)})`;
  const along = `calc(${pos}% - ${px(size / 2)})`;
  // A rotated square with two bordered sides; only the half outside the box is kept, plus a
  // sliver that covers the box border where the tail joins.
  const edges: Record<string, [string, string]> = {
    bottom: ['right', 'bottom'],
    top: ['left', 'top'],
    right: ['top', 'right'],
    left: ['bottom', 'left']
  };
  const [e1, e2] = edges[side]!;
  const d = px(bw * 1.42 + 1.5);
  // Clip in the square's own (unrotated) space: keep the triangle at the bordered corner.
  const clips: Record<string, string> = {
    bottom: `polygon(calc(100% - ${d}) 0, 100% 0, 100% 100%, 0 100%, 0 calc(100% - ${d}))`,
    top: `polygon(0 0, 100% 0, 100% ${d}, ${d} 100%, 0 100%)`,
    right: `polygon(0 0, 100% 0, 100% 100%, calc(100% - ${d}) 100%, 0 ${d})`,
    left: `polygon(0 0, ${d} 0, 100% calc(100% - ${d}), 100% 100%, 0 100%)`
  };
  const placeAlong = side === 'top' || side === 'bottom' ? `left:${along}` : `top:${along}`;
  const border = bw ? `border-${e1}:${px(bw)} ${bstyle === 'double' ? 'solid' : bstyle} ${cssValue(b.border_color)};border-${e2}:${px(bw)} ${bstyle === 'double' ? 'solid' : bstyle} ${cssValue(b.border_color)}` : '';
  return `${sel}::after{${decls([
    'content:""',
    'position:absolute',
    `width:${s};height:${s}`,
    'box-sizing:border-box',
    placeAlong,
    `${side}:${half}`,
    `background:${fill}`,
    border,
    // Skewing stretches the tip so it reads as a speech tail rather than a notch.
    `transform:rotate(45deg) skew(${side === 'top' || side === 'bottom' ? 12 : -12}deg, ${side === 'top' || side === 'bottom' ? 12 : -12}deg)`,
    `-webkit-clip-path:${clips[side]};clip-path:${clips[side]}`,
    'pointer-events:none'
  ])}}`;
}

/** The element-level part of a plain box, as a style attribute. Older callers and tests use it. */
export function boxStyleCss(b: Partial<BoxStyle> | null | undefined): string {
  const css = frameCss(b, 'X');
  const m = /^X\{([^}]*)\}/.exec(css);
  return m?.[1] ?? '';
}

/** Per-card style for item cards: name colour, tint and lean direction. */
export function itemVars(card: Partial<ItemCard> | null | undefined, box: Partial<BoxStyle> | null | undefined, nameColor: string, flip: boolean): string {
  const c = resolveItemCard(card);
  const b = resolveBox(box);
  const out: string[] = [];
  const name = cssValue(nameColor);
  if (name && (c.tint > 0 || b.stripe_name_color)) out.push(`--cw-name:${name}`);
  if (name && c.tint > 0) out.push(`--cw-tint:${withAlpha(name, clamp(c.tint, 0, 1))}`);
  if (c.alternate && b.lean) out.push(`--cw-lean:${flip ? -1 : 1}`);
  return out.join(';');
}

/** Gives each id a stable alternating flag, so cards don't swap sides as the list scrolls. */
export function alternator(): (id: string) => boolean {
  const seen = new Map<string, boolean>();
  let next = false;
  return (id: string) => {
    let v = seen.get(id);
    if (v === undefined) {
      v = next;
      next = !next;
      seen.set(id, v);
      if (seen.size > 400) {
        const first = seen.keys().next().value;
        if (first !== undefined) seen.delete(first);
      }
    }
    return v;
  };
}

type Align = 'left' | 'center' | 'right';

/** Item cards for chat, event lists, poll choices, the ad break, the song, the hype train, the giveaway and queue rows, scoped to one layer. */
export function itemCardCss(kind: LayerKind, scope: string): string {
  const s = `:where(.${scope})`;
  if (kind.type === 'chat') {
    const card = resolveItemCard(kind.item_card);
    const sel = card.around === 'words' ? `${s} .cw-chat-msg` : `${s} .cw-chat-line`;
    const align = (kind.style?.align ?? 'left') as Align;
    const rules = [frameCss(kind.bubble, sel, { item: card, align, room: true })];
    if (card.gap !== DEFAULT_ITEM_CARD.gap) rules.push(`${s} .cw-chat{gap:${px(Math.max(0, card.gap))}}`);
    return rules.filter(Boolean).join('\n');
  }
  if (kind.type === 'event_list') {
    const card = resolveItemCard(kind.item_card);
    const align = (kind.style?.align ?? 'left') as Align;
    const rules = [frameCss(kind.item_box, `${s} .cw-event-row`, { item: { ...card, around: 'message' }, align, room: true })];
    if (card.gap !== DEFAULT_ITEM_CARD.gap) rules.push(`${s} .cw-list{gap:${px(Math.max(0, card.gap))}}`);
    return rules.filter(Boolean).join('\n');
  }
  if (kind.type === 'poll') {
    const card = resolveItemCard(kind.item_card);
    const align = (kind.style?.align ?? 'left') as Align;
    const rules = [frameCss(kind.item_box, `${s} .cw-poll-choice`, { item: { ...card, around: 'message', width: 'full' }, align, room: true })];
    if (card.gap !== DEFAULT_ITEM_CARD.gap) rules.push(`${s} .cw-poll-choices{gap:${px(Math.max(0, card.gap))}}`);
    return rules.filter(Boolean).join('\n');
  }
  if (kind.type === 'credits') return frameCss(kind.section_box, `${s} .cw-credits-section`, { room: true });
  if (kind.type === 'ad_break') {
    const card = resolveItemCard(kind.item_card);
    const align = (kind.style?.align ?? 'left') as Align;
    return frameCss(kind.item_box, `${s} .cw-ad-card`, { item: { ...card, around: 'message', alternate: false }, align, room: true });
  }
  if (kind.type === 'now_playing') {
    const card = resolveItemCard(kind.item_card);
    return frameCss(kind.item_box, `${s} .cw-np-item`, { item: { ...card, around: 'message', alternate: false, width: 'full' }, align: 'left', room: true });
  }
  if (kind.type === 'hype_train') {
    const card = resolveItemCard(kind.item_card);
    return frameCss(kind.item_box, `${s} .cw-hype-item`, { item: { ...card, around: 'message', alternate: false, width: 'full' }, align: 'left', room: true });
  }
  if (kind.type === 'giveaway') {
    const card = resolveItemCard(kind.item_card);
    const align = (kind.style?.align ?? 'left') as Align;
    return frameCss(kind.item_box, `${s} .cw-gw-card`, { item: { ...card, around: 'message', alternate: false, width: 'full' }, align, room: true });
  }
  if (kind.type === 'queue') {
    const card = resolveItemCard(kind.item_card);
    const align = (kind.style?.align ?? 'left') as Align;
    const rules = [frameCss(kind.item_box, `${s} .cw-q-item`, { item: { ...card, around: 'message' }, align, room: true })];
    if (card.gap !== DEFAULT_ITEM_CARD.gap) rules.push(`${s} .cw-q-list{gap:${px(Math.max(0, card.gap))}}`);
    return rules.filter(Boolean).join('\n');
  }
  return '';
}

/** Everything a layer's boxes need: the layer box and any item cards. */
export function layerFrameCss(layer: Pick<Layer, 'box_style' | 'kind'>, scope: string): string {
  return [frameCss(layer.box_style, `:where(.${scope})`), itemCardCss(layer.kind, scope)].filter(Boolean).join('\n').replace(/<\/style/gi, '');
}

/** The card alerts had before card styles existed. */
export function classicAlertCard(background: string): BoxStyle | null {
  if (!visible(background)) return null;
  return {
    ...DEFAULT_BOX,
    background: cssValue(background),
    radius: 20,
    padding: 24,
    padding_x: 32,
    shadow: '0 18px 50px rgba(0, 0, 0, 0.35), 0 2px 8px rgba(0, 0, 0, 0.25)'
  };
}

/** Card for an alert: its own style, or the classic one. Null means no card. */
export function alertCard(p: { card?: BoxStyle | null; background?: string }): BoxStyle | null {
  return p.card ? resolveBox(p.card) : classicAlertCard(p.background ?? '');
}

// ---- Scoped CSS ----------------------------------------------------------

/** A short class-safe hash of a layer id. */
export function scopeClass(layerId: string): string {
  let h = 2166136261;
  for (let i = 0; i < layerId.length; i++) {
    h ^= layerId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `cw-s-${(h >>> 0).toString(36)}`;
}

const ROOT_SELECTOR = /^(:scope|:host|:root|html|body)(?![\w-])/i;

function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === sep && depth === 0) {
      out.push(s.slice(last, i));
      last = i + 1;
    }
  }
  out.push(s.slice(last));
  return out;
}

function scopeSelector(sel: string, scope: string): string {
  const s = sel.trim();
  if (!s) return '';
  const root = ROOT_SELECTOR.exec(s);
  if (root) {
    let rest = s.slice(root[0].length);
    // `html body .x` and `:root body` both mean the scope root.
    rest = rest.replace(/^\s*(body)(?![\w-])/i, '');
    return `${scope}${rest}`;
  }
  return `${scope} ${s}`;
}

interface Block {
  prelude: string;
  body: string;
}

/** Split CSS into top-level `prelude { body }` blocks. Unbalanced trailing text is dropped. */
function blocks(css: string): Block[] {
  const out: Block[] = [];
  let i = 0;
  let start = 0;
  let quote = '';
  while (i < css.length) {
    const c = css[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      i++;
      continue;
    }
    if (c === ';' && css.slice(start, i).trim().startsWith('@')) {
      // Statement at-rule such as @import or @charset: dropped.
      start = i + 1;
      i++;
      continue;
    }
    if (c === '{') {
      const prelude = css.slice(start, i);
      let depth = 1;
      let j = i + 1;
      let q = '';
      for (; j < css.length && depth > 0; j++) {
        const d = css[j];
        if (q) {
          if (d === '\\') j++;
          else if (d === q) q = '';
        } else if (d === '"' || d === "'") q = d;
        else if (d === '{') depth++;
        else if (d === '}') depth--;
      }
      if (depth !== 0) break;
      out.push({ prelude: prelude.trim(), body: css.slice(i + 1, j - 1) });
      i = j;
      start = j;
      continue;
    }
    if (c === '}') {
      // Stray closing brace: skip it rather than let it close anything outside.
      start = i + 1;
    }
    i++;
  }
  return out;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?(\*\/|$)/g, '');
}

function scopeBlocks(css: string, scope: string): string {
  const list = blocks(css);
  const out: string[] = [];
  for (const b of list) {
    const p = b.prelude;
    if (!p) continue;
    if (p.startsWith('@')) {
      const name = (/^@([\w-]+)/.exec(p)?.[1] ?? '').toLowerCase();
      if (name === 'media' || name === 'supports' || name === 'layer' || name === 'container') {
        out.push(`${p}{${scopeBlocks(b.body, scope)}}`);
      } else if (name.endsWith('keyframes') || name === 'font-face' || name === 'property' || name === 'counter-style') {
        out.push(`${p}{${b.body.replace(/<\/style/gi, '')}}`);
      }
      // Anything else (@page, @import...) is dropped.
      continue;
    }
    const selectors = splitTopLevel(p, ',')
      .map((s) => scopeSelector(s, scope))
      .filter(Boolean);
    if (!selectors.length) continue;
    out.push(`${selectors.join(',')}{${b.body.replace(/[{}]/g, '').replace(/<\/style/gi, '')}}`);
  }
  return out.join('\n');
}

/**
 * Scope a layer's custom CSS under `.scope`. Selectors are prefixed, `:scope`, `:host`,
 * `:root`, `html` and `body` mean the layer itself, and plain declarations without any
 * selector apply to the layer. `@import` and other global at-rules are removed.
 */
export function scopeCss(css: string, scopeClassName: string): string {
  const scope = `.${scopeClassName}`;
  const clean = stripComments(css ?? '').trim();
  if (!clean) return '';
  if (!clean.includes('{')) {
    return `${scope}{${clean.replace(/[{}]/g, '').replace(/<\/style/gi, '')}}`;
  }
  return scopeBlocks(clean, scope);
}

/** Scrolling text: one loop moves `distance` px, after a short pause at the start. */
export function marqueeTiming(distance: number, speed: number): { duration: number; hold: number } {
  const pause = 1500;
  const move = (Math.max(1, distance) / Math.min(400, Math.max(10, num(speed, 60)))) * 1000;
  return { duration: Math.round(move + pause), hold: pause / (move + pause) };
}
