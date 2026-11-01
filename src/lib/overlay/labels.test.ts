import { describe, expect, it } from 'vitest';
import { amountText, displayName, eventContext, eventLabel } from './labels';
import { render } from '$lib/logic/template';
import { ev } from './test/fixtures';

describe('eventLabel', () => {
  const cases: [Parameters<typeof ev>, string][] = [
    [['follow'], 'followed'],
    [['sub', { tier: 1 }], 'subscribed'],
    [['sub', { tier: 3 }], 'subscribed (Tier 3)'],
    [['sub', { tier: 1, data: { is_prime: true } }], 'subscribed with Prime'],
    [['resub', { months: 14, tier: 1 }], 'resubscribed · 14 months'],
    [['resub', { months: 1, tier: 2 }], 'resubscribed (Tier 2)'],
    [['gift_sub'], 'gifted a sub'],
    [['community_gift', { amount: 5 }], 'gifted 5 subs'],
    [['community_gift', { amount: 1 }], 'gifted a sub'],
    [['cheer', { amount: 500 }], 'cheered 500 bits'],
    [['cheer', { amount: 1 }], 'cheered 1 bit'],
    [['cheer', { amount: 12000 }], 'cheered 12,000 bits'],
    [['raid', { amount: 212 }], 'raided with 212'],
    [['redemption', { data: { reward_title: 'Hydrate' } }], 'redeemed Hydrate'],
    [['redemption'], 'redeemed a reward'],
    [['power_up', { amount: 100 }], 'used a power-up'],
    [['charity', { amount: 10, currency: 'GBP' }], 'donated £10.00'],
    [['charity', { amount: 5.5, currency: 'usd' }], 'donated $5.50'],
    [['shoutout_received', { amount: 87 }], 'shouted us out'],
    [['hype_train_begin'], 'Hype train started'],
    [['hype_train_progress', { data: { level: 2 } }], 'Hype train level 2'],
    [['hype_train_end', { data: { level: 3 } }], 'Hype train ended at level 3'],
    [['poll_begin'], 'Poll started'],
    [['prediction_lock'], 'Prediction locked'],
    [['ad_break', { amount: 90 }], 'Ad break · 90s'],
    [['ad_break', { amount: 180 }], 'Ad break · 3 min'],
    [['stream_online'], 'went live'],
    [['channel_update'], 'updated the stream'],
    [['custom', { data: { label: 'did a thing' } }], 'did a thing']
  ];
  for (const [args, want] of cases) {
    it(`${args[0]} -> ${want}`, () => expect(eventLabel(ev(...args))).toBe(want));
  }
});

describe('amountText', () => {
  it('describes amounts per kind', () => {
    expect(amountText(ev('cheer', { amount: 500 }))).toBe('500 bits');
    expect(amountText(ev('raid', { amount: 1 }))).toBe('1 viewer');
    expect(amountText(ev('community_gift', { amount: 20 }))).toBe('20 subs');
    expect(amountText(ev('redemption', { amount: 1500 }))).toBe('1,500 points');
    expect(amountText(ev('charity', { amount: 3, currency: 'EUR' }))).toBe('€3.00');
    expect(amountText(ev('charity', { amount: 3, currency: 'NOPE1' }))).toBe('3.00 NOPE1');
    expect(amountText(ev('follow'))).toBe('');
  });
});

describe('displayName and context', () => {
  it('falls back to Anonymous', () => {
    expect(displayName(ev('gift_sub', { user: null, is_anonymous: true }))).toBe('Anonymous');
    expect(displayName(ev('follow', { user: { id: '1', login: 'abc', display_name: '' } }))).toBe('abc');
    expect(displayName(ev('hype_train_begin', { user: null }))).toBe('');
  });
  it('feeds item templates', () => {
    const e = ev('resub', { months: 14, tier: 1, recipient: null });
    expect(render('{{name}} · {{label}}', eventContext(e))).toBe('Nova_Kat · resubscribed · 14 months');
    expect(render('{{kind}} {{amount_text|default:"-"}} {{user.login}}', eventContext(ev('cheer', { amount: 50 })))).toBe(
      'cheer 50 bits nova_kat'
    );
    expect(eventContext(ev('gift_sub', { recipient: { id: '9', login: 'm0ss', display_name: 'm0ss' } })).recipient_name).toBe('m0ss');
  });
});
