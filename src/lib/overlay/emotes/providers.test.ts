import { describe, expect, it, vi } from 'vitest';
import bttvGlobal from './fixtures/bttv-global.json';
import bttvUser from './fixtures/bttv-user.json';
import ffzGlobal from './fixtures/ffz-global.json';
import ffzRoom from './fixtures/ffz-room.json';
import seventvGlobal from './fixtures/7tv-global.json';
import seventvUser from './fixtures/7tv-user.json';
import { loadEmotes, parse7tvSet, parse7tvUser, parseBttvGlobal, parseBttvUser, parseFfzGlobal, parseFfzRoom, providerUrl } from './providers';

const codes = (list: { code: string }[]) => list.map((e) => e.code);

describe('7TV', () => {
  it('reads the global set with zero-width flags and WebP sizes', () => {
    const list = parse7tvSet(seventvGlobal);
    expect(codes(list)).toContain('peepoHappy');
    const rain = list.find((e) => e.code === 'RainTime')!;
    expect(rain.zeroWidth).toBe(true);
    expect(rain.animated).toBe(true);
    const happy = list.find((e) => e.code === 'peepoHappy')!;
    expect(happy.zeroWidth).toBe(false);
    expect(happy.images.map((i) => i.url)).toEqual([1, 2, 3, 4].map((n) => `https://cdn.7tv.app/emote/${happy.id}/${n}x.webp`));
    expect(happy.images[0]!.width).toBe(happy.width);
    expect(happy.images[3]!.width).toBe(happy.width * 4);
  });
  it('reads a channel with its set and 7TV user id', () => {
    const ch = parse7tvUser(seventvUser);
    expect(ch.setId).toBe('01FE9DRF000009TR6M9N941CYW');
    expect(ch.userId).toBe('01FE9DRF000009TR6M9N941CYW');
    expect(codes(ch.emotes).sort()).toEqual(['GAMBA', 'Hmm', 'Nerd', 'notL', 'xqcGoofy']);
    expect(ch.emotes.find((e) => e.code === 'notL')!.zeroWidth).toBe(true);
  });
  it('builds image urls from the id when the host is missing', () => {
    const [e] = parse7tvSet({ emotes: [{ id: 'abc', name: 'Hi', flags: 0, data: {} }] });
    expect(e!.images[1]).toEqual({ url: 'https://cdn.7tv.app/emote/abc/2x.webp', width: 64 });
  });
  it('copes with junk', () => {
    expect(parse7tvSet(null)).toEqual([]);
    expect(parse7tvUser({ emote_set: null })).toEqual({ setId: null, userId: null, emotes: [] });
  });
});

describe('BetterTTV', () => {
  it('reads global emotes, skips modifiers and marks zero-width ones', () => {
    const list = parseBttvGlobal(bttvGlobal);
    expect(codes(list)).toEqual([':tf:', 'M&Mjc', 'D:', 'FeelsGoodMan', 'SourPls', 'monkaS', 'cvMask']);
    expect(list.find((e) => e.code === 'cvMask')!.zeroWidth).toBe(true);
    const mm = list.find((e) => e.code === 'M&Mjc')!;
    expect([mm.width, mm.height]).toEqual([36, 30]);
    expect(mm.images.map((i) => i.width)).toEqual([36, 72, 108]);
    expect(mm.images[2]!.url).toBe(`https://cdn.betterttv.net/emote/${mm.id}/3x.webp`);
  });
  it('reads channel and shared emotes', () => {
    const list = parseBttvUser(bttvUser);
    expect(list).toHaveLength(6);
    expect(list.every((e) => e.provider === 'bttv')).toBe(true);
  });
});

describe('FrankerFaceZ', () => {
  it('reads only the default global sets and skips modifiers', () => {
    const list = parseFfzGlobal(ffzGlobal);
    expect(codes(list)).toContain('YooHoo');
    expect(codes(list)).not.toContain('ffzHyper');
    expect(list.every((e) => e.images.every((i) => i.url.startsWith('https://cdn.frankerfacez.com/')))).toBe(true);
  });
  it('reads a room with sizes per scale', () => {
    const list = parseFfzRoom(ffzRoom);
    const wall = list.find((e) => e.code === 'forsenWall')!;
    expect(wall.images.map((i) => i.width)).toEqual([wall.width, wall.width * 2, wall.width * 4]);
  });
  it('prefers animated images', () => {
    const [e] = parseFfzRoom({
      sets: { 1: { emoticons: [{ id: 5, name: 'Wave', width: 20, height: 20, urls: { 1: '//cdn.frankerfacez.com/emote/5/1' }, animated: { 1: 'https://cdn.frankerfacez.com/emote/5/animated/1' } }] } }
    });
    expect(e!.animated).toBe(true);
    expect(e!.images[0]!.url).toBe('https://cdn.frankerfacez.com/emote/5/animated/1');
  });
});

describe('loadEmotes', () => {
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  it('asks the right url per provider and scope', () => {
    expect(providerUrl('7tv', 'channel', '42')).toBe('https://7tv.io/v3/users/twitch/42');
    expect(providerUrl('bttv', 'global')).toBe('https://api.betterttv.net/3/cached/emotes/global');
    expect(providerUrl('ffz', 'channel', '42')).toBe('https://api.frankerfacez.com/v1/room/id/42');
  });
  it('treats 404 as no channel emotes and throws on other errors', async () => {
    const f = vi.fn(async () => reply(404, { message: 'user not found' }));
    expect(await loadEmotes(f, 'bttv', 'channel', '1')).toEqual({ emotes: [] });
    await expect(loadEmotes(async () => reply(500, {}), 'ffz', 'global')).rejects.toThrow('500');
  });
  it('returns the 7TV set for live updates', async () => {
    const got = await loadEmotes(async () => reply(200, seventvUser), '7tv', 'channel', '71092938');
    expect(got.seventv?.setId).toBe('01FE9DRF000009TR6M9N941CYW');
    expect(got.emotes).toHaveLength(5);
  });
});
