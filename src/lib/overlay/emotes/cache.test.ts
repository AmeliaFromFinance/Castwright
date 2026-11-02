import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CosmeticsCache, type CosmeticsApi } from './cache';
import type { Paint, SevenTvBadge, UserStyle } from './cosmetics';

const paint: Paint = { id: 'p1', name: 'P', layers: [{ kind: 'color', color: '#fff' }], shadows: [] };
const badge: SevenTvBadge = { id: 'b1', name: 'B', images: [{ url: 'https://cdn.7tv.app/badge/b1/1x.webp', width: 18 }] };

function fakeApi(styles: Record<string, UserStyle | null>) {
  const calls = { styles: [] as string[][], cosmetics: [] as [string[], string[]][] };
  let fail = false;
  const api: CosmeticsApi = {
    async styles(ids) {
      calls.styles.push(ids);
      if (fail) throw new Error('offline');
      return new Map(ids.map((id) => [id, styles[id] ?? null]));
    },
    async cosmetics(p, b) {
      calls.cosmetics.push([p, b]);
      return {
        paints: new Map(p.map((id) => [id, id === paint.id ? paint : null])),
        badges: new Map(b.map((id) => [id, id === badge.id ? badge : null]))
      };
    }
  };
  return { api, calls, setFail: (v: boolean) => (fail = v) };
}

describe('CosmeticsCache', () => {
  let now = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    now = 0;
  });
  afterEach(() => vi.useRealTimers());

  function make(styles: Record<string, UserStyle | null>, extra: Partial<ConstructorParameters<typeof CosmeticsCache>[0]> = {}) {
    const f = fakeApi(styles);
    const onChange = vi.fn();
    const warn = vi.fn();
    const cache = new CosmeticsCache({ api: f.api, onChange, warn, now: () => now, batchMs: 100, gapMs: 1000, ttlMs: 60_000, retryMs: 5_000, ...extra });
    return { cache, onChange, warn, ...f };
  }

  it('batches chatters and fetches each paint and badge once', async () => {
    const { cache, calls, onChange } = make({ a: { paintId: 'p1', badgeId: 'b1' }, b: { paintId: 'p1', badgeId: null }, c: null });
    cache.request('a');
    cache.request('b');
    cache.request('a');
    cache.request('c');
    expect(cache.get('a')).toBeUndefined();
    await vi.advanceTimersByTimeAsync(100);
    expect(calls.styles).toEqual([['a', 'b', 'c']]);
    expect(calls.cosmetics).toEqual([[['p1'], ['b1']]]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(cache.get('a')).toEqual({ paint, badge });
    expect(cache.get('b')).toEqual({ paint, badge: null });
    expect(cache.get('c')).toBeUndefined();
  });

  it('keeps results until they expire', async () => {
    const { cache, calls } = make({ a: { paintId: 'p1', badgeId: null } });
    cache.request('a');
    await vi.advanceTimersByTimeAsync(100);
    now = 59_000;
    cache.request('a');
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls.styles).toHaveLength(1);
    now = 61_000;
    cache.request('a');
    await vi.advanceTimersByTimeAsync(100);
    expect(calls.styles).toHaveLength(2);
    expect(calls.cosmetics).toHaveLength(1);
  });

  it('does not ask twice while a lookup is under way', async () => {
    const { cache, calls } = make({});
    cache.request('a');
    await vi.advanceTimersByTimeAsync(100);
    cache.request('a');
    await vi.advanceTimersByTimeAsync(100);
    expect(calls.styles).toEqual([['a']]);
  });

  it('splits bursts into spaced requests', async () => {
    const { cache, calls } = make({}, { maxUsers: 2 });
    for (const id of ['1', '2', '3', '4', '5']) cache.request(id);
    await vi.advanceTimersByTimeAsync(100);
    expect(calls.styles).toEqual([['1', '2']]);
    await vi.advanceTimersByTimeAsync(999);
    expect(calls.styles).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.styles).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls.styles).toEqual([['1', '2'], ['3', '4'], ['5']]);
  });

  it('fetches paints and badges in small groups', async () => {
    const styles: Record<string, UserStyle> = {};
    for (let i = 0; i < 5; i++) styles[`u${i}`] = { paintId: `p${i}`, badgeId: `b${i}` };
    const { cache, calls } = make(styles, { maxCosmetics: 4 });
    for (const id of Object.keys(styles)) cache.request(id);
    await vi.advanceTimersByTimeAsync(100);
    expect(calls.cosmetics.map(([p, b]) => p.length + b.length)).toEqual([4, 4, 2]);
  });

  it('warns once while failing and tries again later', async () => {
    const { cache, calls, warn, setFail, onChange } = make({ a: { paintId: 'p1', badgeId: null } });
    setFail(true);
    cache.request('a');
    await vi.advanceTimersByTimeAsync(100);
    cache.request('b');
    await vi.advanceTimersByTimeAsync(1100);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('offline');
    cache.request('a');
    await vi.advanceTimersByTimeAsync(1100);
    expect(calls.styles).toHaveLength(2);
    setFail(false);
    now = 6_000;
    cache.request('a');
    await vi.advanceTimersByTimeAsync(1100);
    expect(cache.get('a')?.paint).toEqual(paint);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
