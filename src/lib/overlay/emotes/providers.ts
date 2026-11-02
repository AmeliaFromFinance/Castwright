// Emote lists from 7TV, BetterTTV and FrankerFaceZ, looked up by Twitch user id.

import type { Image, Provider, ThirdPartyEmote } from './types';

type Json = Record<string, unknown>;

const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback);

function https(url: string): string {
  return url.startsWith('//') ? `https:${url}` : url;
}

// ---- 7TV ----

export const SEVENTV_API = 'https://7tv.io/v3';
const SEVENTV_CDN = 'https://cdn.7tv.app/emote';

export function parse7tvEmote(raw: unknown): ThirdPartyEmote | null {
  const e = obj(raw);
  const data = obj(e.data);
  const id = str(e.id) || str(data.id);
  const code = str(e.name) || str(data.name);
  if (!id || !code) return null;
  const host = obj(data.host);
  const base = https(str(host.url)) || `${SEVENTV_CDN}/${id}`;
  let files = arr(host.files)
    .map(obj)
    .filter((f) => str(f.format).toUpperCase() === 'WEBP' && /^\dx\.webp$/.test(str(f.name)));
  if (!files.length) files = [1, 2, 3, 4].map((n) => ({ name: `${n}x.webp`, width: 32 * n, height: 32 * n }));
  const images: Image[] = files.map((f) => ({ url: `${base}/${str(f.name)}`, width: num(f.width, 32) })).sort((a, b) => a.width - b.width);
  const first = files.find((f) => str(f.name) === '1x.webp') ?? files[0]!;
  return {
    provider: '7tv',
    id,
    code,
    width: num(first.width, 32),
    height: num(first.height, 32),
    images,
    // 1 marks a zero-width emote in a set; 256 is the emote default.
    zeroWidth: (Number(e.flags) & 1) !== 0 || (Number(data.flags) & 256) !== 0,
    animated: data.animated === true
  };
}

export function parse7tvSet(raw: unknown): ThirdPartyEmote[] {
  return arr(obj(raw).emotes)
    .map(parse7tvEmote)
    .filter((e): e is ThirdPartyEmote => !!e);
}

export interface SevenTvChannel {
  setId: string | null;
  /** 7TV's own user id. */
  userId: string | null;
  emotes: ThirdPartyEmote[];
}

/** Reads `GET /v3/users/twitch/{id}`. */
export function parse7tvUser(raw: unknown): SevenTvChannel {
  const r = obj(raw);
  const set = obj(r.emote_set);
  return {
    setId: str(set.id) || str(r.emote_set_id) || null,
    userId: str(obj(r.user).id) || null,
    emotes: parse7tvSet(set)
  };
}

// ---- BetterTTV ----

export const BTTV_API = 'https://api.betterttv.net/3';
const BTTV_CDN = 'https://cdn.betterttv.net/emote';
/** BetterTTV draws these over the emote before them. */
const BTTV_ZERO_WIDTH = new Set(['SoSnowy', 'IceCold', 'SantaHat', 'TopHat', 'ReinDeer', 'CandyCane', 'cvMask', 'cvHazmat']);

function bttvEmote(raw: unknown): ThirdPartyEmote | null {
  const e = obj(raw);
  const id = str(e.id);
  const code = str(e.code);
  // Modifiers like `w!` change other emotes and are hidden by BetterTTV.
  if (!id || !code || e.modifier === true) return null;
  const width = num(e.width, 28);
  const height = num(e.height, 28);
  return {
    provider: 'bttv',
    id,
    code,
    width,
    height,
    images: [1, 2, 3].map((n) => ({ url: `${BTTV_CDN}/${id}/${n}x.webp`, width: width * n })),
    zeroWidth: BTTV_ZERO_WIDTH.has(code),
    animated: e.animated === true
  };
}

export function parseBttvGlobal(raw: unknown): ThirdPartyEmote[] {
  return arr(raw)
    .map(bttvEmote)
    .filter((e): e is ThirdPartyEmote => !!e);
}

/** Channel and shared emotes from `GET /3/cached/users/twitch/{id}`. */
export function parseBttvUser(raw: unknown): ThirdPartyEmote[] {
  const r = obj(raw);
  return [...arr(r.channelEmotes), ...arr(r.sharedEmotes)].map(bttvEmote).filter((e): e is ThirdPartyEmote => !!e);
}

// ---- FrankerFaceZ ----

export const FFZ_API = 'https://api.frankerfacez.com/v1';

function ffzEmote(raw: unknown): ThirdPartyEmote | null {
  const e = obj(raw);
  const id = str(e.id);
  const code = str(e.name);
  // Modifier emotes change the emote before them; without FrankerFaceZ they stay text.
  if (!id || !code || e.modifier === true) return null;
  const width = num(e.width, 28);
  const height = num(e.height, 28);
  const animated = Object.keys(obj(e.animated)).length > 0;
  const urls = animated ? obj(e.animated) : obj(e.urls);
  const images: Image[] = Object.entries(urls)
    .map(([scale, url]) => ({ url: https(str(url)), width: width * Number(scale) }))
    .filter((i) => i.url && i.width > 0)
    .sort((a, b) => a.width - b.width);
  if (!images.length) return null;
  return { provider: 'ffz', id, code, width, height, images, zeroWidth: false, animated };
}

function ffzSets(sets: unknown, only?: readonly unknown[]): ThirdPartyEmote[] {
  const all = obj(sets);
  const ids = only ? only.map(str) : Object.keys(all);
  return ids.flatMap((id) => arr(obj(all[id]).emoticons).map(ffzEmote)).filter((e): e is ThirdPartyEmote => !!e);
}

/** `GET /v1/set/global`: only the sets everyone gets. */
export function parseFfzGlobal(raw: unknown): ThirdPartyEmote[] {
  const r = obj(raw);
  return ffzSets(r.sets, arr(r.default_sets));
}

/** `GET /v1/room/id/{id}`. */
export function parseFfzRoom(raw: unknown): ThirdPartyEmote[] {
  return ffzSets(obj(raw).sets);
}

// ---- loading ----

export type Scope = 'global' | 'channel';

export interface Loaded {
  emotes: ThirdPartyEmote[];
  /** 7TV channel only. */
  seventv?: SevenTvChannel;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Parsed JSON, or null when the provider doesn't know the channel. Throws on network or server errors. */
async function getJson(fetchFn: FetchFn, url: string): Promise<unknown> {
  const res = await fetchFn(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json();
}

export function providerUrl(provider: Provider, scope: Scope, channelId = ''): string {
  const id = encodeURIComponent(channelId);
  switch (provider) {
    case '7tv':
      return scope === 'global' ? `${SEVENTV_API}/emote-sets/global` : `${SEVENTV_API}/users/twitch/${id}`;
    case 'bttv':
      return scope === 'global' ? `${BTTV_API}/cached/emotes/global` : `${BTTV_API}/cached/users/twitch/${id}`;
    case 'ffz':
      return scope === 'global' ? `${FFZ_API}/set/global` : `${FFZ_API}/room/id/${id}`;
  }
}

export async function loadEmotes(fetchFn: FetchFn, provider: Provider, scope: Scope, channelId = ''): Promise<Loaded> {
  const json = await getJson(fetchFn, providerUrl(provider, scope, channelId));
  if (json === null) return { emotes: [] };
  switch (provider) {
    case '7tv': {
      if (scope === 'global') return { emotes: parse7tvSet(json) };
      const seventv = parse7tvUser(json);
      return { emotes: seventv.emotes, seventv };
    }
    case 'bttv':
      return { emotes: scope === 'global' ? parseBttvGlobal(json) : parseBttvUser(json) };
    case 'ffz':
      return { emotes: scope === 'global' ? parseFfzGlobal(json) : parseFfzRoom(json) };
  }
}
