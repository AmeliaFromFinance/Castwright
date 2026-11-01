import { describe, expect, it } from 'vitest';
import { messageParts, roles, visibleChat, type ChatFilter } from './chat';
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
