import { describe, expect, it } from 'vitest';
import type { Event } from '$lib/bindings/Event';
import { markDeleted } from '$lib/state/app.svelte';
import { MOD_SCOPES, age, missingScopes, modeDetail, shortSpan, tierName, toSeconds } from './moderation';

const msg = (id: string, user: string): Event =>
  ({ id, kind: 'chat', ts: 0, user: { id: user, login: user, display_name: user }, data: {}, message: 'hi' }) as unknown as Event;

describe('moderation helpers', () => {
  it('finds missing scopes', () => {
    expect(missingScopes([...MOD_SCOPES])).toEqual([]);
    expect(missingScopes(['moderator:read:followers'])).toContain('moderator:manage:shield_mode');
    expect(missingScopes(undefined, ['a'])).toEqual(['a']);
  });

  it('formats spans and ages', () => {
    expect(shortSpan(30)).toBe('30s');
    expect(shortSpan(90)).toBe('1m 30s');
    expect(shortSpan(3600)).toBe('1h');
    expect(shortSpan(90_061)).toBe('1d 1h');
    const day = 86_400_000;
    expect(age(0, 0)).toBe('today');
    expect(age(0, day)).toBe('1 day');
    expect(age(0, 70 * day)).toBe('2 months');
    expect(age(0, 800 * day)).toBe('2 years');
  });

  it('custom timeouts stay within Twitch limits', () => {
    expect(toSeconds(10, 'm')).toBe(600);
    expect(toSeconds(0, 's')).toBe(1);
    expect(toSeconds(30, 'd')).toBe(1_209_600);
  });

  it('names tiers and mode details', () => {
    expect(tierName('2000')).toBe('Tier 2');
    expect(tierName(null)).toBe('');
    const m = { shield: false, slow: true, slow_wait_s: 30, followers: true, followers_minutes: 0, subscribers: false, emotes: false, unique: false };
    expect(modeDetail(m, 'slow')).toBe('30s');
    expect(modeDetail(m, 'followers')).toBe('any');
    expect(modeDetail({ ...m, followers_minutes: 60 }, 'followers')).toBe('1h');
    expect(modeDetail(m, 'emotes')).toBe('');
  });
});

describe('deleted chat', () => {
  const chat = [msg('a', 'u1'), msg('b', 'u2'), msg('c', 'u1')];
  const gone = (list: Event[]) => list.filter((c) => c.data.deleted === true).map((c) => c.id);

  it('marks one message, one user or everything', () => {
    expect(gone(markDeleted(chat, { message_id: 'b' }))).toEqual(['b']);
    expect(gone(markDeleted(chat, { user_id: 'u1' }))).toEqual(['a', 'c']);
    expect(gone(markDeleted(chat, { all: true }))).toEqual(['a', 'b', 'c']);
    expect(markDeleted(chat, { message_id: 'b' })).toHaveLength(3);
  });

  it('leaves untouched messages as they were', () => {
    const out = markDeleted(chat, { message_id: 'b' });
    expect(out[0]).toBe(chat[0]);
    expect(chat[1]!.data.deleted).toBeUndefined();
  });
});
