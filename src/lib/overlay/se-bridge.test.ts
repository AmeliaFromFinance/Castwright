import { describe, expect, it } from 'vitest';
import {
  buildSrcdoc,
  fieldData,
  MAX_VALUE_BYTES,
  parseWidgetMsg,
  seChatData,
  seRecents,
  seSession,
  substituteFields,
  toSeEvent,
  widgetLoadDetail
} from './se-bridge';
import { ev } from './test/fixtures';

describe('field substitution', () => {
  const fields = { color: { type: 'colorpicker', value: '#f00' }, size: { type: 'number', value: 12 }, label: { type: 'text', value: 'x' } };
  it('uses defaults overridden by values', () => {
    expect(fieldData(fields, { label: 'Hi' })).toEqual({ color: '#f00', size: 12, label: 'Hi' });
  });
  it('turns media fields into asset links', () => {
    const media = { pic: { type: 'image-input', value: 'assets/a.png' }, web: { type: 'image-input', value: '' }, note: { type: 'text', value: 'assets/b.png' } };
    const url = (p: string) => `http://h/assets/${p.replace('assets/', '')}?key=k`;
    expect(fieldData(media, {}, url)).toEqual({ pic: 'http://h/assets/a.png?key=k', web: '', note: 'assets/b.png' });
    expect(buildSrcdoc({ html: '<img src="{pic}">', css: '', js: '', fields: media, values: {} }, url)).toContain('src="http://h/assets/a.png?key=k"');
  });
  it('replaces {{field}} and {field}, leaves unknown tokens', () => {
    const data = fieldData(fields, {});
    expect(substituteFields('a{color}b{{ size }}c{{label}}{unknown}{{nope}}', data)).toBe('a#f00b12cx{unknown}{{nope}}');
    expect(substituteFields('.x{color:red}', data)).toBe('.x{color:red}');
    expect(substituteFields('const {color} = o;', data)).toBe('const #f00 = o;');
  });
  it('stringifies non-strings and empties null', () => {
    expect(substituteFields('{a}|{b}|{c}|{d}', { a: true, b: null, c: [1, 2], d: { k: 'v' } })).toBe('true||[1,2]|{"k":"v"}');
  });
  it('inserts values as-is, without HTML escaping (StreamElements behaviour)', () => {
    expect(substituteFields('<div>{label}</div>', { label: '<b>bold</b> & "q"' })).toBe('<div><b>bold</b> & "q"</div>');
  });
});

describe('buildSrcdoc', () => {
  it('assembles html, css and js with the SE bootstrap first', () => {
    const doc = buildSrcdoc({ html: '<p>{t}</p>', css: 'p{color:{c}}', js: 'console.log("{t}")', fields: {}, values: { t: 'hey', c: 'red' } });
    expect(doc.indexOf('SE_API')).toBeLessThan(doc.indexOf('<p>hey</p>'));
    expect(doc).toContain('<style>p{color:red}</style>');
    expect(doc).toContain('console.log("hey")');
  });
  it('keeps user code from closing its own tags early', () => {
    const doc = buildSrcdoc({ html: '', css: 'a{}</style><script>x()</script>', js: 'var s="</script><b>";', fields: {}, values: {} });
    expect(doc).not.toContain('a{}</style><script>');
    expect(doc).toContain('var s="<\\/script><b>";');
    expect(doc.match(/<\/style>/g)?.length).toBe(2);
    expect(doc.endsWith('var s="<\\/script><b>";\n</script></body></html>')).toBe(true);
  });
});

describe('widget messages', () => {
  it('accepts valid messages only', () => {
    expect(parseWidgetMsg({ cw: 'castwright', type: 'ready' })).toEqual({ type: 'ready' });
    expect(parseWidgetMsg({ cw: 'castwright', type: 'store_set', key: 'k', value: { a: [1] } })).toEqual({
      type: 'store_set',
      key: 'k',
      value: { a: [1] }
    });
    expect(parseWidgetMsg({ cw: 'castwright', type: 'store_delete', key: 'k' })).toEqual({ type: 'store_delete', key: 'k' });
    expect(parseWidgetMsg({ type: 'ready' })).toBeNull();
    expect(parseWidgetMsg({ cw: 'castwright', type: 'eval', code: 'x' })).toBeNull();
    expect(parseWidgetMsg({ cw: 'castwright', type: 'store_set', key: '', value: 1 })).toBeNull();
    expect(parseWidgetMsg({ cw: 'castwright', type: 'store_set', key: 'x'.repeat(129), value: 1 })).toBeNull();
    expect(parseWidgetMsg({ cw: 'castwright', type: 'store_set', key: 'k', value: 'x'.repeat(MAX_VALUE_BYTES) })).toBeNull();
    expect(parseWidgetMsg('ready')).toBeNull();
  });
  it('turns undefined values into null', () => {
    expect(parseWidgetMsg({ cw: 'castwright', type: 'store_set', key: 'k' })).toEqual({ type: 'store_set', key: 'k', value: null });
  });
});

describe('SE event mapping', () => {
  it('maps follows, subs, cheers, raids and charity', () => {
    expect(toSeEvent(ev('follow'))).toMatchObject({ listener: 'follower-latest', event: { type: 'follower', name: 'Nova_Kat' } });
    expect(toSeEvent(ev('resub', { months: 7, tier: 2, message: 'hi' }))).toMatchObject({
      listener: 'subscriber-latest',
      event: { amount: 7, tier: '2000', message: 'hi', gifted: false }
    });
    expect(toSeEvent(ev('sub', { tier: 1, data: { is_prime: true } }))?.event.tier).toBe('prime');
    expect(toSeEvent(ev('cheer', { amount: 100, message: 'Cheer100 gg' }))).toMatchObject({
      listener: 'cheer-latest',
      event: { amount: 100, message: 'Cheer100 gg' }
    });
    expect(toSeEvent(ev('raid', { amount: 42 }))).toMatchObject({ listener: 'raid-latest', event: { amount: 42 } });
    expect(toSeEvent(ev('charity', { amount: 10, currency: 'GBP' }))).toMatchObject({
      listener: 'tip-latest',
      event: { type: 'tip', amount: 10, currency: 'GBP' }
    });
    expect(toSeEvent(ev('poll_begin'))).toBeNull();
  });
  it('maps gifts like SE', () => {
    const single = toSeEvent(ev('gift_sub', { tier: 1, recipient: { id: '2', login: 'm0ss', display_name: 'm0ss' } }));
    expect(single).toMatchObject({ listener: 'subscriber-latest', event: { name: 'm0ss', sender: 'Nova_Kat', gifted: true, isCommunityGift: false } });
    const part = toSeEvent(ev('gift_sub', { data: { community_gift_id: 'x' } }));
    expect(part?.event.isCommunityGift).toBe(true);
    const bulk = toSeEvent(ev('community_gift', { amount: 5, tier: 1 }));
    expect(bulk).toMatchObject({ event: { amount: 5, bulkGifted: true, gifted: true, sender: 'Nova_Kat', tier: '1000' } });
  });
  it('builds an SE chat payload with emote positions', () => {
    const e = ev('chat', {
      message: 'hi Kappa @bob ✨ Kappa',
      message_parts: [
        { type: 'text', text: 'hi ' },
        { type: 'emote', text: 'Kappa', id: '25' },
        { type: 'text', text: ' ' },
        { type: 'mention', text: '@bob', login: 'bob' },
        { type: 'text', text: ' ✨ ' },
        { type: 'emote', text: 'Kappa', id: '25' }
      ],
      roles: { broadcaster: false, moderator: true, vip: false, subscriber: true },
      data: { color: '#FF7F50' }
    });
    const { data, renderedText } = seChatData(e);
    expect(data).toMatchObject({
      nick: 'nova_kat',
      displayName: 'Nova_Kat',
      displayColor: '#FF7F50',
      text: 'hi Kappa @bob ✨ Kappa',
      msgId: e.id,
      userId: e.user?.id
    });
    const emotes = data.emotes as { start: number; end: number; id: string }[];
    expect(emotes.map((m) => [m.start, m.end])).toEqual([
      [3, 7],
      [16, 20]
    ]);
    expect((data.badges as { type: string }[]).map((b) => b.type)).toEqual(['moderator', 'subscriber']);
    expect((data.tags as Record<string, string>).badges).toBe('moderator/1,subscriber/1');
    expect(renderedText).toContain('<img');
    expect(toSeEvent(e)?.listener).toBe('message');
  });
  it('escapes chat text in renderedText', () => {
    const { renderedText } = seChatData(ev('chat', { message: '<script>', message_parts: [{ type: 'text', text: '<script>' }] }));
    expect(renderedText).toBe('&#60;script&#62;');
  });
});

describe('SE session data', () => {
  it('collects latest, recent and session totals', () => {
    const recent = [ev('follow', { user: { id: '1', login: 'a', display_name: 'A' } }), ev('cheer', { amount: 5 }), ev('follow', { user: { id: '2', login: 'b', display_name: 'B' } }), ev('chat')];
    const s = seSession(recent, { 'session.follows': 2, 'session.bits': '5' });
    expect((s['follower-latest'] as { name: string }).name).toBe('B');
    expect((s['follower-recent'] as { name: string }[]).map((x) => x.name)).toEqual(['B', 'A']);
    expect(s['cheer-latest']).toMatchObject({ amount: 5 });
    expect(s['raid-latest']).toEqual({ name: '', amount: 0, message: '' });
    expect(s['follower-session']).toEqual({ count: 2 });
    expect(s['cheer-session']).toEqual({ amount: 5 });
    expect(seRecents(recent).map((r) => r.type)).toEqual(['follower', 'cheer', 'follower']);
  });
  it('builds the onWidgetLoad detail', () => {
    const d = widgetLoadDetail({ fields: { a: { value: 1 } }, values: {}, recent: [], vars: { 'twitch.login': 'me' }, isEditorMode: true });
    expect(d).toMatchObject({ fieldData: { a: 1 }, channel: { username: 'me' }, overlay: { isEditorMode: true, muted: false }, recents: [] });
  });
});
