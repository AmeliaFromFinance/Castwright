import { describe, expect, it } from 'vitest';
import type { Credits } from '$lib/bindings/Credits';
import type { Event } from '$lib/bindings/Event';
import { credits as demoCredits, type DemoSession } from '$lib/api/mock-sessions';
import { creditBlocks, creditNote, defaultCreditSections, emptyCredits, hasCreditNames, pageStarts, rollOffset, rollPlan, sampleCredits } from './credits';
import { emptyState, reduce } from './state';

const opts = { maxChatters: 10, showAmounts: true };

describe('credit sections', () => {
  it('follows the layer order and skips sections that are off or empty', () => {
    const sections = defaultCreditSections();
    sections.reverse();
    sections.find((s) => s.kind === 'cheerers')!.on = false;
    const c: Credits = { ...sampleCredits(), raiders: [] };
    const kinds = creditBlocks(c, sections, opts).map((b) => b.kind);
    expect(kinds).toEqual(['chatters', 'vips', 'moderators', 'gifters', 'subscribers', 'followers']);
  });

  it('keeps names in order and trims top chatters', () => {
    const blocks = creditBlocks(sampleCredits(), defaultCreditSections(), { ...opts, maxChatters: 2 });
    const chatters = blocks.find((b) => b.kind === 'chatters')!;
    expect(chatters.rows.map((r) => r.name)).toEqual(['nova_kat', 'quietfox']);
    expect(chatters.rows[0]!.note).toBe('84 messages');
  });

  it('uses the edited title, blank hides it, repeats are ignored', () => {
    const sections = [
      { kind: 'followers' as const, title: '  Fresh faces ', on: true },
      { kind: 'followers' as const, title: 'Again', on: true },
      { kind: 'gifters' as const, title: '', on: true }
    ];
    const blocks = creditBlocks(sampleCredits(), sections, opts);
    expect(blocks.map((b) => [b.kind, b.title])).toEqual([
      ['followers', 'Fresh faces'],
      ['gifters', '']
    ]);
  });

  it('writes amounts for each kind', () => {
    expect(creditNote('subscribers', 14)).toBe('14 months');
    expect(creditNote('subscribers', 0)).toBe('');
    expect(creditNote('gifters', 1)).toBe('1 gift');
    expect(creditNote('cheerers', 1000)).toBe('1,000 bits');
    expect(creditNote('raiders', 42)).toBe('42 viewers');
    expect(creditNote('followers', 3)).toBe('');
    const hidden = creditBlocks(sampleCredits(), defaultCreditSections(), { ...opts, showAmounts: false });
    expect(hidden.every((b) => b.rows.every((r) => r.note === ''))).toBe(true);
  });

  it('knows when there are no names', () => {
    expect(hasCreditNames(emptyCredits())).toBe(false);
    expect(hasCreditNames(null)).toBe(false);
    expect(hasCreditNames(sampleCredits())).toBe(true);
    expect(creditBlocks(null, defaultCreditSections(), opts)).toEqual([]);
  });
});

describe('roll timing', () => {
  it('scrolls from below the box until the end is in view', () => {
    const p = rollPlan(500, 2000, { speed: 100, fitS: 0, repeat: false });
    expect(p).toEqual({ from: 500, to: -1500, ms: 20_000 });
    expect(rollOffset(p, 0, false)).toBe(500);
    expect(rollOffset(p, 10_000, false)).toBe(-500);
    expect(rollOffset(p, 99_000, false)).toBe(-1500);
  });

  it('centres short credits when it stops', () => {
    expect(rollPlan(1000, 400, { speed: 50, fitS: 0, repeat: false }).to).toBe(300);
  });

  it('repeats once everything has left the top', () => {
    const p = rollPlan(500, 1500, { speed: 100, fitS: 0, repeat: true });
    expect(p).toEqual({ from: 500, to: -1500, ms: 20_000 });
    expect(rollOffset(p, 25_000, true)).toBe(0);
  });

  it('fits one pass into a set time', () => {
    expect(rollPlan(500, 1500, { speed: 100, fitS: 45, repeat: true }).ms).toBe(45_000);
  });
});

describe('pages for reduced motion', () => {
  it('starts a page at the first item that does not fit', () => {
    const items = [0, 40, 80, 120, 160, 200].map((top) => ({ top, height: 40 }));
    expect(pageStarts(items, 100)).toEqual([0, 80, 160]);
  });

  it('keeps a row of two columns together and gives tall items their own page', () => {
    const items = [
      { top: 0, height: 30 },
      { top: 30, height: 30 },
      { top: 30, height: 30 },
      { top: 60, height: 300 },
      { top: 360, height: 30 }
    ];
    expect(pageStarts(items, 100)).toEqual([0, 60, 360]);
    expect(pageStarts([], 100)).toEqual([0]);
  });
});

describe('roll messages', () => {
  it('stores the names and counts the rolls per layer', () => {
    const credits = sampleCredits();
    let s = reduce(emptyState(), { type: 'credits_roll', layer_id: 'c1', credits });
    s = reduce(s, { type: 'credits_roll', layer_id: 'c1', credits });
    expect(s.credits).toBe(credits);
    expect(s.rolls).toEqual({ c1: 2 });
  });
});

describe('demo credits', () => {
  const ev = (kind: Event['kind'], name: string, ts: number, patch: Partial<Event> = {}): Event =>
    ({
      id: `${kind}-${name}-${ts}`,
      kind,
      ts,
      user: { id: `id-${name}`, login: name.toLowerCase(), display_name: name },
      amount: null,
      currency: null,
      tier: 1,
      months: null,
      message: null,
      message_parts: [],
      roles: { broadcaster: false, moderator: false, vip: false, subscriber: false },
      is_gift: false,
      is_anonymous: false,
      recipient: null,
      data: {},
      test: false,
      ...patch
    }) as Event;

  it('matches the backend order', () => {
    const d: DemoSession = {
      session: { id: 3, started_at: 0, ended_at: 1000, source: 'twitch', title: '', categories: [], peak_viewers: 0, avg_viewers: 0 },
      events: [
        ev('follow', 'Bob', 1),
        ev('follow', 'Ann', 2),
        ev('follow', 'Bob', 3),
        ev('resub', 'Cid', 4, { months: 9 }),
        ev('sub', 'Lucky', 5, { is_gift: true }),
        ev('gift_sub', 'Hal', 6),
        ev('gift_sub', 'Gina', 7),
        ev('gift_sub', 'Gina', 8),
        ev('cheer', 'Ann', 9, { amount: 100 }),
        ev('cheer', 'Bob', 10, { amount: 300 }),
        ev('follow', 'Late', 2000)
      ],
      chat: [
        { ts: 1, name: 'Zed' },
        { ts: 2, name: 'Ann' },
        { ts: 3, name: 'Ann' }
      ],
      firstChatters: [],
      alerts: 0,
      actions: 0,
      markers: [],
      clips: [],
      raidsOut: []
    };
    const c = demoCredits(d, 5000, (name) => ({ user_id: '', login: name.toLowerCase(), role: name === 'Zed' ? 'mod' : '' }));
    expect(c.followers.map((n) => n.name)).toEqual(['Bob', 'Ann']);
    expect(c.subscribers.map((n) => [n.name, n.amount])).toEqual([['Cid', 9]]);
    expect(c.gifters.map((n) => [n.name, n.amount])).toEqual([
      ['Gina', 2],
      ['Hal', 1]
    ]);
    expect(c.cheerers.map((n) => n.name)).toEqual(['Bob', 'Ann']);
    expect(c.moderators.map((n) => n.name)).toEqual(['Zed']);
    expect(c.chatters.map((n) => [n.name, n.amount])).toEqual([
      ['Ann', 2],
      ['Zed', 1]
    ]);
  });
});
