import { describe, expect, it } from 'vitest';
import { messageParts, roles, twitchBadges, visibleChat, type ChatFilter } from './chat';
import { ev } from './test/fixtures';

const f: ChatFilter = { maxMessages: 10, hideCommands: true, hideUsers: [], fadeAfterS: 0, now: 0 };

describe('visibleChat', () => {
  it('keeps the newest messages, oldest first', () => {
    const chat = Array.from({ length: 5 }, (_, i) => ev('chat', { message: `m${i}` }));
    expect(visibleChat(chat, { ...f, maxMessages: 3 }).map((e) => e.message)).toEqual(['m2', 'm3', 'm4']);
  });
  it('hides commands when asked', () => {
    const chat = [ev('chat', { message: '!uptime' }), ev('chat', { message: '  !so bob' }), ev('chat', { message: 'hi !' })];
    expect(visibleChat(chat, f).map((e) => e.message)).toEqual(['hi !']);
    expect(visibleChat(chat, { ...f, hideCommands: false })).toHaveLength(3);
  });
  it('hides listed users by login or display name, case-insensitively', () => {
    const chat = [
      ev('chat', { user: { id: '1', login: 'nightbot', display_name: 'Nightbot' } }),
      ev('chat', { user: { id: '2', login: 'streamelements', display_name: 'StreamElements' } }),
      ev('chat', { user: { id: '3', login: 'nova', display_name: 'Nova' } })
    ];
    expect(visibleChat(chat, { ...f, hideUsers: ['NightBot', ' @streamelements '] }).map((e) => e.user?.login)).toEqual(['nova']);
  });
  it('drops messages older than the fade time', () => {
    const chat = [ev('chat', { ts: 1000 }), ev('chat', { ts: 9000 })];
    expect(visibleChat(chat, { ...f, fadeAfterS: 5, now: 10_000 })).toHaveLength(1);
    expect(visibleChat(chat, { ...f, fadeAfterS: 0, now: 10_000 })).toHaveLength(2);
  });
  it('leaves out messages Twitch removed', () => {
    const chat = [ev('chat', { message: 'a' }), ev('chat', { message: 'b', data: { deleted: true } }), ev('chat', { message: 'c' })];
    expect(visibleChat(chat, f).map((e) => e.message)).toEqual(['a', 'c']);
  });
  it('fills the limit after filtering', () => {
    const chat = [ev('chat', { message: 'a' }), ev('chat', { message: 'b' }), ev('chat', { message: '!c' })];
    expect(visibleChat(chat, { ...f, maxMessages: 2 }).map((e) => e.message)).toEqual(['a', 'b']);
  });
});

describe('chat helpers', () => {
  it('falls back to the plain message', () => {
    expect(messageParts(ev('chat', { message: 'hey' }))).toEqual([{ type: 'text', text: 'hey' }]);
    expect(messageParts(ev('chat'))).toEqual([]);
  });
  it('lists roles in badge order', () => {
    expect(roles(ev('chat', { roles: { broadcaster: true, moderator: false, vip: true, subscriber: true } }))).toEqual([
      'broadcaster',
      'vip',
      'subscriber'
    ]);
  });
});

describe('twitchBadges', () => {
  const img = (set_id: string, id = '1') => ({ set_id, id, title: set_id.toUpperCase(), url_1x: `https://b/${set_id}/1`, url_2x: `https://b/${set_id}/2`, url_4x: `https://b/${set_id}/3` });
  const roles = { broadcaster: false, moderator: true, vip: false, subscriber: true };

  it('uses images in badge order with sizes', () => {
    const e = ev('chat', { roles, data: { badges: ['moderator', 'subscriber'], badge_images: [img('moderator'), img('subscriber', '12')] } });
    const out = twitchBadges(e);
    expect(out.map((b) => (b.kind === 'image' ? b.setId : b.role))).toEqual(['moderator', 'subscriber']);
    expect(out[0]).toEqual({ kind: 'image', setId: 'moderator', title: 'MODERATOR', images: [{ url: 'https://b/moderator/1', width: 18 }, { url: 'https://b/moderator/2', width: 36 }, { url: 'https://b/moderator/3', width: 72 }] });
  });
  it('falls back to role icons for unknown images', () => {
    const e = ev('chat', { roles, data: { badges: ['moderator', 'founder', 'sub-gifter'], badge_images: [img('sub-gifter')] } });
    expect(twitchBadges(e).map((b) => (b.kind === 'image' ? b.setId : `role:${b.role}`))).toEqual(['role:moderator', 'role:subscriber', 'sub-gifter']);
  });
  it('uses role icons when no images are known', () => {
    const e = ev('chat', { roles, data: { badges: ['moderator', 'subscriber'] } });
    expect(twitchBadges(e)).toEqual([
      { kind: 'role', role: 'moderator' },
      { kind: 'role', role: 'subscriber' }
    ]);
  });
  it('ignores non-https urls', () => {
    const e = ev('chat', { roles: { ...roles, moderator: false, subscriber: false }, data: { badges: ['x'], badge_images: [{ ...img('x'), url_1x: 'javascript:1' }] } });
    expect(twitchBadges(e)).toEqual([]);
  });
});
