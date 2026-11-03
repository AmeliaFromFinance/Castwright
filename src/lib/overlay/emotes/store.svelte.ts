// One shared copy of third-party emotes and 7TV cosmetics per page, used by
// overlay chat layers and the app chat panel.

import { CosmeticsCache, type Cosmetics } from './cache';
import { cosmeticsQuery, parseCosmetics, parseStyles, SEVENTV_GQL, stylesQuery } from './cosmetics';
import { SevenTvEvents } from './events';
import { EmoteLoader, type ProviderStatus } from './loader';
import type { FetchFn } from './providers';
import type { EmoteMap, EmoteOptions } from './types';

export interface ChatExtrasOptions extends EmoteOptions {
  paints: boolean;
  seventvBadges: boolean;
}

async function gql(fetchFn: FetchFn, query: string): Promise<unknown> {
  const res = await fetchFn(SEVENTV_GQL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query })
  });
  if (!res.ok) throw new Error(`${res.status} from 7tv.io`);
  return res.json();
}

const warn = (msg: string) => console.warn(`[chat] ${msg}`);

class ChatExtras {
  /** Bumped whenever emotes or cosmetics change. */
  version = $state(0);
  #loader: EmoteLoader | null = null;
  #cosmetics: CosmeticsCache | null = null;

  #bump = () => {
    this.version++;
  };

  get #emotes(): EmoteLoader {
    if (!this.#loader) {
      const fetchFn: FetchFn = (url, init) => fetch(url, init);
      const events = new SevenTvEvents({
        onSetUpdate: (body) => this.#loader?.applySetUpdate(body),
        onUserUpdate: () => this.#loader?.reload7tv()
      });
      this.#loader = new EmoteLoader({ fetch: fetchFn, onChange: this.#bump, warn, events });
    }
    return this.#loader;
  }

  get #cache(): CosmeticsCache {
    if (!this.#cosmetics) {
      const fetchFn: FetchFn = (url, init) => fetch(url, init);
      this.#cosmetics = new CosmeticsCache({
        api: {
          styles: async (ids) => parseStyles(await gql(fetchFn, stylesQuery(ids)), ids),
          cosmetics: async (p, b) => parseCosmetics(await gql(fetchFn, cosmeticsQuery(p, b)), p, b)
        },
        onChange: this.#bump,
        warn
      });
    }
    return this.#cosmetics;
  }

  /** Call from an effect: starts loading emotes for the channel. */
  want(channelId: string, o: EmoteOptions): void {
    if (!channelId || !(o.seventv || o.bttv || o.ffz)) return;
    this.#emotes.want(channelId, o);
  }

  /** Reactive. */
  emotes(o: EmoteOptions): EmoteMap {
    void this.version;
    if (!this.#loader || !(o.seventv || o.bttv || o.ffz)) return EMPTY;
    return this.#loader.map(o);
  }

  /** Reactive. Empty until chat has asked for emotes. */
  providers(): ProviderStatus[] {
    void this.version;
    return this.#loader?.status() ?? [];
  }

  /** Call from an effect: looks up 7TV paints and badges for these chatters. */
  wantCosmetics(twitchIds: Iterable<string>): void {
    for (const id of twitchIds) if (id) this.#cache.request(id);
  }

  /** Reactive. */
  cosmetics(twitchId: string | undefined): Cosmetics | undefined {
    void this.version;
    if (!twitchId || !this.#cosmetics) return undefined;
    return this.#cosmetics.get(twitchId);
  }
}

const EMPTY: EmoteMap = new Map();

export const chatExtras = new ChatExtras();
