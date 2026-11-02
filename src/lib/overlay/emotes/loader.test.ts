import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bttvGlobal from './fixtures/bttv-global.json';
import ffzGlobal from './fixtures/ffz-global.json';
import seventvGlobal from './fixtures/7tv-global.json';
import seventvUser from './fixtures/7tv-user.json';
import { EmoteLoader, type SetWatcher } from './loader';
import type { FetchFn } from './providers';

const ALL = { seventv: true, bttv: true, ffz: true };

function fakeFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  let offline = false;
  const fn: FetchFn = async (url) => {
    calls.push(url);
    if (offline) throw new TypeError('Failed to fetch');
    if (!(url in routes)) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(routes[url]), { status: 200 });
  };
  return { fn, calls, setOffline: (v: boolean) => (offline = v) };
}

const ROUTES = {
  'https://7tv.io/v3/emote-sets/global': seventvGlobal,
  'https://7tv.io/v3/users/twitch/42': seventvUser,
  'https://api.betterttv.net/3/cached/emotes/global': bttvGlobal,
  'https://api.betterttv.net/3/cached/users/twitch/42': { channelEmotes: [{ id: 'b1', code: 'EZ', imageType: 'png', animated: false }], sharedEmotes: [] },
  'https://api.frankerfacez.com/v1/set/global': ffzGlobal
};

describe('EmoteLoader', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function make() {
    const f = fakeFetch(ROUTES);
    const onChange = vi.fn();
    const warn = vi.fn();
    const watched: [string | null, string | null][] = [];
    const events: SetWatcher = { watch: (s, u) => watched.push([s, u]) };
    const loader = new EmoteLoader({ fetch: f.fn, onChange, warn, events, refreshMs: 600_000 });
    return { loader, onChange, warn, watched, ...f };
  }

  it('loads nothing without a channel', () => {
    const { loader, calls } = make();
    loader.want('', ALL);
    expect(calls).toEqual([]);
  });

  it('loads switched-on providers once and merges them', async () => {
    const { loader, calls, watched } = make();
    loader.want('42', { seventv: true, bttv: true, ffz: false });
    loader.want('42', { seventv: true, bttv: true, ffz: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(4);
    const map = loader.map(ALL);
    expect(map.get('GAMBA')?.provider).toBe('7tv');
    expect(map.get('monkaS')?.provider).toBe('bttv');
    expect(map.has('YooHoo')).toBe(false);
    expect(loader.map({ seventv: false, bttv: true, ffz: false }).has('GAMBA')).toBe(false);
    expect(watched).toEqual([[null, null], ['01FE9DRF000009TR6M9N941CYW', '01FE9DRF000009TR6M9N941CYW']]);
  });

  it('lets channel emotes beat global ones, then 7TV beat BetterTTV', async () => {
    const { loader } = make();
    loader.want('42', ALL);
    await vi.advanceTimersByTimeAsync(0);
    // EZ is a 7TV global and a BetterTTV channel emote here.
    expect(loader.map(ALL).get('EZ')?.provider).toBe('bttv');
    expect(loader.map({ seventv: true, bttv: false, ffz: true }).get('EZ')?.provider).toBe('7tv');
  });

  it('refreshes every ten minutes', async () => {
    const { loader, calls } = make();
    loader.want('42', ALL);
    await vi.advanceTimersByTimeAsync(0);
    const first = calls.length;
    await vi.advanceTimersByTimeAsync(600_000);
    expect(calls.length).toBe(first * 2);
    loader.dispose();
  });

  it('stays quiet offline: one warning per provider', async () => {
    const { loader, warn, setOffline, calls } = make();
    setOffline(true);
    loader.want('42', ALL);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(calls.length).toBe(12);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(loader.map(ALL).size).toBe(0);
    setOffline(false);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(loader.map(ALL).size).toBeGreaterThan(0);
  });

  it('drops the old channel when it changes', async () => {
    const { loader, calls } = make();
    loader.want('42', ALL);
    await vi.advanceTimersByTimeAsync(0);
    loader.want('43', ALL);
    await vi.advanceTimersByTimeAsync(0);
    expect(loader.map(ALL).has('GAMBA')).toBe(false);
    expect(calls.filter((c) => c.includes('/43'))).toHaveLength(3);
    expect(calls.filter((c) => c.includes('global'))).toHaveLength(3);
  });

  it('applies live 7TV set changes', async () => {
    const { loader, onChange } = make();
    loader.want('42', ALL);
    await vi.advanceTimersByTimeAsync(0);
    const gamba = loader.map(ALL).get('GAMBA')!;
    const before = onChange.mock.calls.length;
    loader.applySetUpdate({
      id: '01FE9DRF000009TR6M9N941CYW',
      pushed: [{ key: 'emotes', index: 5, value: { id: 'new1', name: 'catJAM', flags: 0, data: { id: 'new1', animated: true } } }],
      pulled: [{ key: 'emotes', index: 0, old_value: { id: gamba.id, name: 'GAMBA' } }],
      updated: [{ key: 'emotes', index: 1, old_value: { id: 'x', name: 'Nerd' }, value: { id: 'x', name: 'Nerdge', flags: 0 } }]
    });
    const map = loader.map(ALL);
    expect(map.get('catJAM')?.images[0]?.url).toBe('https://cdn.7tv.app/emote/new1/1x.webp');
    expect(map.has('GAMBA')).toBe(false);
    expect(onChange.mock.calls.length).toBe(before + 1);
    loader.applySetUpdate({ id: 'another-set', pushed: [{ key: 'emotes', value: { id: 'z', name: 'Nope' } }] });
    expect(loader.map(ALL).has('Nope')).toBe(false);
  });
});
