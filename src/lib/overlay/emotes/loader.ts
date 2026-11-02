// Keeps the 7TV, BetterTTV and FrankerFaceZ emote lists for one channel.

import { loadEmotes, parse7tvEmote, type FetchFn, type Scope } from './providers';
import type { EmoteMap, EmoteOptions, Provider, ThirdPartyEmote } from './types';

export interface SetWatcher {
  /** Start or move live updates; nulls stop them. */
  watch(setId: string | null, userId: string | null): void;
}

export interface LoaderOptions {
  fetch: FetchFn;
  onChange: () => void;
  /** Called once per provider per failure streak. */
  warn?: (message: string) => void;
  refreshMs?: number;
  /** Live 7TV updates for the channel emote set. */
  events?: SetWatcher;
}

interface Entry {
  emotes: ThirdPartyEmote[];
  loading: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

const NAMES: Record<Provider, string> = { '7tv': '7TV', bttv: 'BetterTTV', ffz: 'FrankerFaceZ' };
// Lowest priority first, so later lists win when codes clash.
const ORDER: [Scope, Provider][] = [
  ['global', 'ffz'],
  ['global', 'bttv'],
  ['global', '7tv'],
  ['channel', 'ffz'],
  ['channel', 'bttv'],
  ['channel', '7tv']
];

export class EmoteLoader {
  #o: LoaderOptions & { refreshMs: number };
  #channel = '';
  #entries = new Map<string, Entry>();
  #failing = new Set<Provider>();
  #version = 0;
  #map: { key: string; map: EmoteMap } | null = null;
  #setId: string | null = null;

  constructor(o: LoaderOptions) {
    this.#o = { refreshMs: 10 * 60_000, ...o };
  }

  get channel(): string {
    return this.#channel;
  }

  /** Loads whatever is missing for this channel and these providers. Cheap to call often. */
  want(channelId: string, opts: EmoteOptions): void {
    if (channelId !== this.#channel) {
      for (const [key, e] of this.#entries) {
        if (!key.startsWith('channel:')) continue;
        if (e.timer) clearTimeout(e.timer);
        this.#entries.delete(key);
      }
      this.#channel = channelId;
      this.#watch(null, null);
      this.#changed();
    }
    if (!channelId) return;
    for (const p of ['7tv', 'bttv', 'ffz'] as const) {
      if (!enabled(opts, p)) continue;
      for (const scope of ['global', 'channel'] as const) {
        if (!this.#entries.has(`${scope}:${p}`)) void this.#load(scope, p);
      }
    }
  }

  /** All emotes for the switched-on providers; channel emotes beat global ones, 7TV beats BetterTTV beats FrankerFaceZ. */
  map(opts: EmoteOptions): EmoteMap {
    const key = `${this.#version}:${+opts.seventv}${+opts.bttv}${+opts.ffz}`;
    if (this.#map?.key === key) return this.#map.map;
    const map = new Map<string, ThirdPartyEmote>();
    for (const [scope, p] of ORDER) {
      if (!enabled(opts, p)) continue;
      for (const e of this.#entries.get(`${scope}:${p}`)?.emotes ?? []) map.set(e.code, e);
    }
    this.#map = { key, map };
    return map;
  }

  /** Applies an `emote_set.update` body from the 7TV EventAPI. */
  applySetUpdate(body: unknown): void {
    const b = (body ?? {}) as Record<string, unknown>;
    const entry = this.#entries.get('channel:7tv');
    if (!entry || b.id !== this.#setId) return;
    const list = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
    const idOf = (v: unknown) => String(((v ?? {}) as Record<string, unknown>).id ?? '');
    let emotes = entry.emotes;
    for (const c of [...list(b.pulled), ...list(b.updated)]) {
      if (c.key !== 'emotes') continue;
      const gone = idOf(c.old_value);
      if (gone) emotes = emotes.filter((e) => e.id !== gone);
    }
    for (const c of [...list(b.pushed), ...list(b.updated)]) {
      if (c.key !== 'emotes') continue;
      const e = parse7tvEmote(c.value);
      if (e) emotes = [...emotes.filter((x) => x.code !== e.code), e];
    }
    if (emotes === entry.emotes) return;
    entry.emotes = emotes;
    this.#changed();
  }

  /** Reloads the channel 7TV set, e.g. after the streamer switched sets. */
  reload7tv(): void {
    if (this.#channel && this.#entries.has('channel:7tv')) void this.#load('channel', '7tv');
  }

  dispose(): void {
    for (const e of this.#entries.values()) if (e.timer) clearTimeout(e.timer);
    this.#entries.clear();
    this.#watch(null, null);
  }

  #changed(): void {
    this.#version++;
    this.#o.onChange();
  }

  #watch(setId: string | null, userId: string | null): void {
    this.#setId = setId;
    this.#o.events?.watch(setId, userId);
  }

  async #load(scope: Scope, provider: Provider): Promise<void> {
    const key = `${scope}:${provider}`;
    const channel = this.#channel;
    let entry = this.#entries.get(key);
    if (entry?.loading) return;
    if (!entry) {
      entry = { emotes: [], loading: true, timer: null };
      this.#entries.set(key, entry);
    }
    entry.loading = true;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    try {
      const got = await loadEmotes(this.#o.fetch, provider, scope, channel);
      if (this.#entries.get(key) !== entry) return;
      entry.emotes = got.emotes;
      this.#failing.delete(provider);
      if (got.seventv && got.seventv.setId !== this.#setId) this.#watch(got.seventv.setId, got.seventv.userId);
      this.#changed();
    } catch (err) {
      if (this.#entries.get(key) !== entry) return;
      if (!this.#failing.has(provider)) {
        this.#failing.add(provider);
        this.#o.warn?.(`${NAMES[provider]} emotes unavailable: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      if (this.#entries.get(key) === entry) {
        entry.loading = false;
        entry.timer = setTimeout(() => void this.#load(scope, provider), this.#o.refreshMs);
      }
    }
  }
}

function enabled(o: EmoteOptions, p: Provider): boolean {
  return p === '7tv' ? o.seventv : p === 'bttv' ? o.bttv : o.ffz;
}
