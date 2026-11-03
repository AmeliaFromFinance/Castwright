import { describe, expect, it } from 'vitest';
import type { Event } from '$lib/bindings/Event';
import { kindDefaults } from '$lib/editor/layers';
import { checkPattern, defaultChatRules, highlightClasses, highlightColor, layerRules, makeJudge, noRules, parsePattern, resolveRules, splitList } from './chat-filters';
import { visibleChat } from './chat';
import { ev } from './test/fixtures';

const ctx = { broadcaster: ['castwright', 'Castwright'], botLogin: 'castbot' };
const msg = (message: string, login = 'nova_kat', patch: Partial<Event> = {}) =>
  ev('chat', { message, user: { id: login, login, display_name: login }, ...patch });

describe('hiding', () => {
  const judge = makeJudge(defaultChatRules(), ctx);

  it('hides known bots and the signed-in bot', () => {
    expect(judge(msg('Song request added', 'nightbot')).hidden).toBe('bot');
    expect(judge(msg('hi', 'StreamElements')).hidden).toBe('bot');
    expect(judge(msg('hello', 'castbot')).hidden).toBe('bot');
    expect(judge(msg('hello', 'nova_kat')).hidden).toBeNull();
    const off = makeJudge({ ...defaultChatRules(), hide_bots: false }, ctx);
    expect(off(msg('hi', 'nightbot')).hidden).toBeNull();
    expect(off(msg('hi', 'castbot')).hidden).toBeNull();
  });

  it('hides commands', () => {
    expect(judge(msg('!uptime')).hidden).toBe('command');
    expect(judge(msg('  !so bob')).hidden).toBe('command');
    expect(judge(msg('hey !')).hidden).toBeNull();
    expect(makeJudge({ ...defaultChatRules(), hide_commands: false }, ctx)(msg('!uptime')).hidden).toBeNull();
  });

  it('hides users and words', () => {
    const j = makeJudge({ ...defaultChatRules(), hide_users: ['@Troll'], hide_words: ['spoiler', '/b[a4]d\\s*word/i'] }, ctx);
    expect(j(msg('anything', 'troll')).hidden).toBe('user');
    expect(j(msg('no SPOILER please')).hidden).toBe('word');
    expect(j(msg('spoilers ahead')).hidden, 'whole words only').toBeNull();
    expect(j(msg('a B4D   word here')).hidden).toBe('word');
    expect(j(msg('fine message')).hidden).toBeNull();
  });

  it('works with visibleChat and fills the limit', () => {
    const chat = [msg('a'), msg('!b'), msg('c', 'nightbot'), msg('d')];
    const out = visibleChat(chat, { maxMessages: 2, hideCommands: false, hideUsers: [], fadeAfterS: 0, now: 0, hidden: (e) => judge(e).hidden !== null });
    expect(out.map((e) => e.message)).toEqual(['a', 'd']);
  });
});

describe('patterns', () => {
  it('refuses unsafe or broken regular expressions', () => {
    expect(checkPattern('/(a+)+$/')).toMatch(/Repeats inside repeats/);
    expect(checkPattern('/(\\w*)*x/')).toMatch(/Repeats inside repeats/);
    expect(checkPattern('/(a{2,})+/')).toMatch(/Repeats inside repeats/);
    expect(checkPattern('/(a)\\1/')).toMatch(/Back-references/);
    expect(checkPattern('/[unclosed/')).not.toBeNull();
    expect(checkPattern('/x/g')).toMatch(/flags/);
    expect(checkPattern('/.*/')).toMatch(/every message/);
    expect(checkPattern('x'.repeat(201))).toMatch(/Longer than/);
    expect(checkPattern('/gg+/i')).toBeNull();
    expect(checkPattern('/(foo|bar)+/')).toBeNull();
    expect(checkPattern('plain words (with brackets)')).toBeNull();
  });

  it('treats plain text as whole words, any case', () => {
    const p = parsePattern('c++');
    expect(p.ok && p.test('I love C++ a lot')).toBe(true);
    const gg = parsePattern('gg');
    expect(gg.ok && gg.test('GG wp')).toBe(true);
    expect(gg.ok && gg.test('eggs')).toBe(false);
    const accent = parsePattern('café');
    expect(accent.ok && accent.test('Un CAFÉ!')).toBe(true);
  });

  it('skips bad patterns instead of failing', () => {
    const j = makeJudge({ ...defaultChatRules(), hide_words: ['/(a+)+$/', 'ok'] }, ctx);
    expect(j(msg('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!')).hidden).toBeNull();
    expect(j(msg('ok then')).hidden).toBe('word');
  });

  it('splits lists', () => {
    expect(splitList('a, b\nb\n\n c ', true)).toEqual(['a', 'b', 'c']);
    expect(splitList('/a{1,3}/\nword')).toEqual(['/a{1,3}/', 'word']);
  });
});

describe('highlights', () => {
  const rules = { ...defaultChatRules(), highlight_keywords: ['giveaway'], highlight_users: ['m0ss'], highlight_mods: true };
  const judge = makeJudge(rules, ctx);

  it('marks first chatters, mentions, keywords, users and redeemed messages', () => {
    expect(judge(msg('hi all', 'nova_kat', { data: { first_chat: true } })).highlights).toEqual(['first']);
    expect(judge(msg('@Castwright what game is this?')).highlights).toEqual(['mention']);
    expect(judge(msg('castwright gg')).highlights).toEqual(['mention']);
    expect(judge(msg('castwrightfan here')).highlights, 'whole names only').toEqual([]);
    expect(judge(msg('is the GIVEAWAY on?')).highlights).toEqual(['keyword']);
    expect(judge(msg('hello', 'm0ss')).highlights).toEqual(['user']);
    expect(judge(msg('hello', 'pixelbyte', { roles: { broadcaster: false, moderator: true, vip: false, subscriber: false } })).highlights).toEqual(['user']);
    expect(judge(msg('look at me', 'nova_kat', { data: { message_type: 'channel_points_highlighted' } })).highlights).toEqual(['redeemed']);
    expect(judge(msg('plain')).highlights).toEqual([]);
  });

  it('never marks the broadcaster as mentioning themselves', () => {
    expect(judge(msg('castwright here', 'castwright')).highlights).toEqual([]);
  });

  it('gives classes and the first colour', () => {
    const v = judge(msg('@castwright giveaway?', 'nova_kat', { data: { first_chat: true } }));
    expect(v.highlights).toEqual(['first', 'mention', 'keyword']);
    expect(highlightClasses(v)).toBe('cw-hl cw-hl-first cw-hl-mention cw-hl-keyword');
    expect(highlightColor(rules, v)).toBe(rules.colors.first);
    expect(highlightColor({ ...rules, colors: { ...rules.colors, first: 'red;}<b>' } }, v)).toBe('redb');
  });

  it('switches off', () => {
    const j = makeJudge(noRules(), ctx);
    const v = j(msg('@castwright !hi', 'nightbot', { data: { first_chat: true } }));
    expect(v).toEqual({ hidden: null, highlights: [] });
  });
});

describe('chat layer rules', () => {
  const app = { ...defaultChatRules(), hide_words: ['spoiler'], highlight_keywords: ['hype'] };

  it('uses the app rules with the layer switches on top', () => {
    const kind = { ...kindDefaults('chat'), hide_commands: false, hide_bots: false, hide_users: ['troll'] };
    const r = layerRules(kind, app);
    expect(r.hide_words).toEqual(['spoiler']);
    expect(r.hide_commands).toBe(false);
    expect(r.hide_bots).toBe(false);
    expect(r.hide_users).toEqual(['troll']);
  });

  it('can use its own rules or none', () => {
    const own = layerRules({ ...kindDefaults('chat'), filters: 'own', own_rules: { ...defaultChatRules(), hide_words: ['mine'] } }, app);
    expect(own.hide_words).toEqual(['mine']);
    const off = layerRules({ ...kindDefaults('chat'), filters: 'off' }, app);
    expect(off.hide_words).toEqual([]);
    expect(off.highlight_first).toBe(false);
    expect(off.hide_bots).toBe(true);
    expect(off.hide_commands).toBe(true);
  });

  it('fills in rules from older projects', () => {
    const r = resolveRules({ hide_bots: false } as never);
    expect(r.hide_bots).toBe(false);
    expect(r.bots).toContain('fossabot');
    expect(r.colors.mention).toMatch(/^#/);
    expect(layerRules(kindDefaults('chat'), null).bots).toContain('nightbot');
  });
});
