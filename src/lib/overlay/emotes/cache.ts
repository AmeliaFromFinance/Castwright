// Per-chatter 7TV cosmetics: cached with a time limit, looked up in small
// batches so busy chats don't flood 7TV, and never in the way of rendering.

import type { Paint, SevenTvBadge, UserStyle } from './cosmetics';

export interface CosmeticsApi {
  styles(twitchIds: string[]): Promise<Map<string, UserStyle | null>>;
  cosmetics(paintIds: string[], badgeIds: string[]): Promise<{ paints: Map<string, Paint | null>; badges: Map<string, SevenTvBadge | null> }>;
}

export interface CacheOptions {
  api: CosmeticsApi;
  onChange: () => void;
  now?: () => number;
  /** Called once per failure streak. */
  warn?: (message: string) => void;
  ttlMs?: number;
  /** How soon to ask again after a failed lookup. */
  retryMs?: number;
  /** Wait to collect more chatters before asking. */
  batchMs?: number;
  /** Least time between two requests. */
  gapMs?: number;
  maxUsers?: number;
  maxCosmetics?: number;
}

export interface Cosmetics {
  paint: Paint | null;
  badge: SevenTvBadge | null;
}

interface Entry {
  style: UserStyle | null;
  until: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class CosmeticsCache {
  #o: Required<Omit<CacheOptions, 'warn'>> & Pick<CacheOptions, 'warn'>;
  #users = new Map<string, Entry>();
  #paints = new Map<string, Paint | null>();
  #badges = new Map<string, SevenTvBadge | null>();
  #queue = new Set<string>();
  #inFlight = new Set<string>();
  #pumping = false;
  #failing = false;
  #disposed = false;

  constructor(o: CacheOptions) {
    this.#o = {
      now: Date.now,
      ttlMs: 15 * 60_000,
      retryMs: 2 * 60_000,
      batchMs: 150,
      gapMs: 1000,
      maxUsers: 40,
      maxCosmetics: 8,
      ...o
    };
  }

  /** Looks the chatter up unless that's already cached or under way. */
  request(twitchId: string): void {
    if (!twitchId || this.#disposed) return;
    const e = this.#users.get(twitchId);
    if (e && e.until > this.#o.now()) return;
    if (this.#queue.has(twitchId) || this.#inFlight.has(twitchId)) return;
    // Bursty chats: keep the newest chatters when the queue gets long.
    if (this.#queue.size >= 500) {
      const oldest = this.#queue.values().next().value;
      if (oldest !== undefined) this.#queue.delete(oldest);
    }
    this.#queue.add(twitchId);
    void this.#pump();
  }

  get(twitchId: string): Cosmetics | undefined {
    const style = this.#users.get(twitchId)?.style;
    if (!style) return undefined;
    const paint = style.paintId ? (this.#paints.get(style.paintId) ?? null) : null;
    const badge = style.badgeId ? (this.#badges.get(style.badgeId) ?? null) : null;
    return paint || badge ? { paint, badge } : undefined;
  }

  dispose(): void {
    this.#disposed = true;
    this.#queue.clear();
  }

  async #pump(): Promise<void> {
    if (this.#pumping) return;
    this.#pumping = true;
    try {
      await sleep(this.#o.batchMs);
      while (this.#queue.size && !this.#disposed) {
        const ids = [...this.#queue].slice(0, this.#o.maxUsers);
        for (const id of ids) {
          this.#queue.delete(id);
          this.#inFlight.add(id);
        }
        await this.#lookup(ids);
        for (const id of ids) this.#inFlight.delete(id);
        if (this.#queue.size) await sleep(this.#o.gapMs);
      }
    } finally {
      this.#pumping = false;
    }
  }

  async #lookup(ids: string[]): Promise<void> {
    const { api, now } = this.#o;
    try {
      const styles = await api.styles(ids);
      const paints = new Set<string>();
      const badges = new Set<string>();
      for (const s of styles.values()) {
        if (s?.paintId && !this.#paints.has(s.paintId)) paints.add(s.paintId);
        if (s?.badgeId && !this.#badges.has(s.badgeId)) badges.add(s.badgeId);
      }
      const wanted = [...[...paints].map((id) => ['p', id] as const), ...[...badges].map((id) => ['b', id] as const)];
      for (let i = 0; i < wanted.length; i += this.#o.maxCosmetics) {
        const chunk = wanted.slice(i, i + this.#o.maxCosmetics);
        const pick = (k: 'p' | 'b') => chunk.filter(([t]) => t === k).map(([, id]) => id);
        const found = await api.cosmetics(pick('p'), pick('b'));
        for (const [id, v] of found.paints) this.#paints.set(id, v);
        for (const [id, v] of found.badges) this.#badges.set(id, v);
      }
      const until = now() + this.#o.ttlMs;
      for (const id of ids) this.#users.set(id, { style: styles.get(id) ?? null, until });
      this.#failing = false;
      this.#o.onChange();
    } catch (err) {
      const until = now() + this.#o.retryMs;
      for (const id of ids) {
        const old = this.#users.get(id);
        this.#users.set(id, { style: old?.style ?? null, until });
      }
      if (!this.#failing) this.#o.warn?.(`7TV cosmetics unavailable: ${err instanceof Error ? err.message : String(err)}`);
      this.#failing = true;
    }
  }
}
