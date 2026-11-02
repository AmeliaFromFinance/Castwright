// 7TV name paints and badges per chatter, from the 7TV v4 GraphQL API.

import type { FetchFn } from './providers';
import type { Image } from './types';

export const SEVENTV_GQL = 'https://7tv.io/v4/gql';

export interface GradientStop {
  at: number;
  color: string;
}

export type PaintLayer =
  | { kind: 'color'; color: string }
  | { kind: 'linear'; angle: number; repeating: boolean; stops: GradientStop[] }
  | { kind: 'radial'; shape: 'circle' | 'ellipse'; repeating: boolean; stops: GradientStop[] }
  /** Smallest scale first. */
  | { kind: 'image'; images: { url: string; scale: number }[] };

export interface PaintShadow {
  x: number;
  y: number;
  blur: number;
  color: string;
}

export interface Paint {
  id: string;
  name: string;
  layers: PaintLayer[];
  shadows: PaintShadow[];
}

export interface SevenTvBadge {
  id: string;
  name: string;
  /** Smallest first. */
  images: Image[];
}

export interface UserStyle {
  paintId: string | null;
  badgeId: string | null;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const color = (v: unknown): string => {
  const hex = str(obj(v).hex);
  return COLOR.test(hex) ? hex : '';
};

// ---- queries ----

const PAINT_FIELDS =
  'id name data { layers { opacity ty { __typename ' +
  '... on PaintLayerTypeSingleColor { color { hex } } ' +
  '... on PaintLayerTypeLinearGradient { angle repeating stops { at color { hex } } } ' +
  '... on PaintLayerTypeRadialGradient { repeating shape stops { at color { hex } } } ' +
  '... on PaintLayerTypeImage { images { url mime scale width height frameCount } } } } ' +
  'shadows { color { hex } offsetX offsetY blur } }';
const BADGE_FIELDS = 'id name images { url mime scale width height frameCount }';

/** One query for many chatters; 7TV limits how complex a query may be, so keep batches small. */
export function stylesQuery(twitchIds: readonly string[]): string {
  const users = twitchIds.map(
    (id, i) => `u${i}: userByConnection(platform: TWITCH, platformId: ${JSON.stringify(id)}) { style { activePaintId activeBadgeId } }`
  );
  return `query { users { ${users.join(' ')} } }`;
}

export function cosmeticsQuery(paintIds: readonly string[], badgeIds: readonly string[]): string {
  const parts = [
    ...paintIds.map((id, i) => `p${i}: paints { paint(id: ${JSON.stringify(id)}) { ${PAINT_FIELDS} } }`),
    ...badgeIds.map((id, i) => `b${i}: badges { badge(id: ${JSON.stringify(id)}) { ${BADGE_FIELDS} } }`)
  ];
  return `query { ${parts.join(' ')} }`;
}

// ---- parsing ----

/** Styles by Twitch id, in the order asked. Null for chatters without a 7TV account. */
export function parseStyles(raw: unknown, twitchIds: readonly string[]): Map<string, UserStyle | null> {
  const users = obj(obj(obj(raw).data).users);
  const out = new Map<string, UserStyle | null>();
  twitchIds.forEach((id, i) => {
    const u = users[`u${i}`];
    if (!u || typeof u !== 'object') {
      out.set(id, null);
      return;
    }
    const style = obj(obj(u).style);
    out.set(id, { paintId: str(style.activePaintId) || null, badgeId: str(style.activeBadgeId) || null });
  });
  return out;
}

const stops = (v: unknown): GradientStop[] =>
  arr(v)
    .map(obj)
    .map((s) => ({ at: Math.min(1, Math.max(0, num(s.at))), color: color(s.color) }))
    .filter((s) => s.color);

/** Prefers animated WebP, then static WebP, then anything. */
function bestImages(list: unknown): { url: string; width: number; scale: number }[] {
  const all = arr(list)
    .map(obj)
    .map((i) => ({ url: str(i.url), mime: str(i.mime), scale: num(i.scale), width: num(i.width), frames: num(i.frameCount) }))
    .filter((i) => i.url.startsWith('https://') && i.scale > 0);
  const animated = all.some((i) => i.frames > 1);
  const pick = (mime: string) => all.filter((i) => i.mime === mime && (i.frames > 1) === animated);
  const chosen = pick('image/webp').length ? pick('image/webp') : pick('image/png').length ? pick('image/png') : all;
  const byScale = new Map<number, (typeof all)[number]>();
  for (const i of chosen) if (!byScale.has(i.scale)) byScale.set(i.scale, i);
  return [...byScale.values()].sort((a, b) => a.scale - b.scale).map((i) => ({ url: i.url, width: i.width, scale: i.scale }));
}

export function parsePaint(raw: unknown): Paint | null {
  const p = obj(raw);
  const id = str(p.id);
  if (!id) return null;
  const data = obj(p.data);
  const layers: PaintLayer[] = [];
  for (const l of arr(data.layers).map(obj)) {
    const ty = obj(l.ty);
    switch (str(ty.__typename)) {
      case 'PaintLayerTypeSingleColor': {
        const c = color(ty.color);
        if (c) layers.push({ kind: 'color', color: c });
        break;
      }
      case 'PaintLayerTypeLinearGradient': {
        const s = stops(ty.stops);
        if (s.length) layers.push({ kind: 'linear', angle: num(ty.angle), repeating: ty.repeating === true, stops: s });
        break;
      }
      case 'PaintLayerTypeRadialGradient': {
        const s = stops(ty.stops);
        const shape = str(ty.shape).toLowerCase() === 'ellipse' ? 'ellipse' : 'circle';
        if (s.length) layers.push({ kind: 'radial', shape, repeating: ty.repeating === true, stops: s });
        break;
      }
      case 'PaintLayerTypeImage': {
        const images = bestImages(ty.images).map(({ url, scale }) => ({ url, scale }));
        if (images.length) layers.push({ kind: 'image', images });
        break;
      }
    }
  }
  const shadows = arr(data.shadows)
    .map(obj)
    .map((s) => ({ x: num(s.offsetX), y: num(s.offsetY), blur: Math.max(0, num(s.blur)), color: color(s.color) }))
    .filter((s) => s.color);
  return { id, name: str(p.name), layers, shadows };
}

export function parseBadge(raw: unknown): SevenTvBadge | null {
  const b = obj(raw);
  const id = str(b.id);
  const images = bestImages(b.images).map(({ url, width }) => ({ url, width }));
  if (!id || !images.length) return null;
  return { id, name: str(b.name), images };
}

export function parseCosmetics(
  raw: unknown,
  paintIds: readonly string[],
  badgeIds: readonly string[]
): { paints: Map<string, Paint | null>; badges: Map<string, SevenTvBadge | null> } {
  const data = obj(obj(raw).data);
  const paints = new Map<string, Paint | null>();
  const badges = new Map<string, SevenTvBadge | null>();
  paintIds.forEach((id, i) => paints.set(id, parsePaint(obj(data[`p${i}`]).paint)));
  badgeIds.forEach((id, i) => badges.set(id, parseBadge(obj(data[`b${i}`]).badge)));
  return { paints, badges };
}

// ---- CSS ----

const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\)|hsla?\([\d.,\s%deg]+\)|[a-z]+)$/i;
const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;
const cssUrl = (u: string) => `url("${encodeURI(u).replace(/"/g, '%22')}")`;

function layerCss(l: PaintLayer, fontSize: number): string {
  switch (l.kind) {
    case 'color':
      return `linear-gradient(${l.color}, ${l.color})`;
    case 'linear':
      return `${l.repeating ? 'repeating-' : ''}linear-gradient(${Math.round(l.angle)}deg, ${l.stops.map((s) => `${s.color} ${pct(s.at)}`).join(', ')})`;
    case 'radial':
      return `${l.repeating ? 'repeating-' : ''}radial-gradient(${l.shape}, ${l.stops.map((s) => `${s.color} ${pct(s.at)}`).join(', ')})`;
    case 'image': {
      // Paint images are made for small names; pick a scale that stays sharp at this size.
      const want = Math.min(4, Math.max(1, Math.round(fontSize / 10)));
      const img = l.images.find((i) => i.scale >= want) ?? l.images[l.images.length - 1]!;
      return cssUrl(img.url);
    }
  }
}

/**
 * Inline style for a painted name, like the 7TV extension draws it. `fallback`
 * (the chatter's colour) shows wherever the paint is see-through or fails to load.
 */
export function paintStyle(p: Paint, fallback: string, fontSize = 16): string {
  if (!p.layers.length) return '';
  const images = p.layers.map((l) => layerCss(l, fontSize)).join(', ');
  const sizes = p.layers.map((l) => (l.kind === 'image' ? 'cover' : 'auto')).join(', ');
  const css = [
    `background-image:${images}`,
    `background-size:${sizes}`,
    'background-position:center',
    `background-color:${SAFE_COLOR.test(fallback) ? fallback : 'currentColor'}`,
    '-webkit-background-clip:text',
    'background-clip:text',
    '-webkit-text-fill-color:transparent',
    'text-shadow:none'
  ];
  if (p.shadows.length) css.push(`filter:${p.shadows.map((s) => `drop-shadow(${s.x}px ${s.y}px ${s.blur}px ${s.color})`).join(' ')}`);
  return css.join(';');
}
