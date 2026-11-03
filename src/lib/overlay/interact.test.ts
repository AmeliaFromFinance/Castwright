import { describe, expect, it } from 'vitest';
import type { Event } from '$lib/bindings/Event';
import { clockText, current, fromEvent, latest, secondsLeft, shares, statusText, totalText } from './interact';

const T = 1_700_000_000_000;

function ev(kind: Event['kind'], data: Record<string, unknown>, ts = T): Event {
  return {
    id: `${kind}-${ts}`,
    kind,
    ts,
    user: null,
    amount: null,
    currency: null,
    tier: null,
    months: null,
    message: null,
    message_parts: [],
    roles: { broadcaster: false, moderator: false, vip: false, subscriber: false },
    is_gift: false,
    is_anonymous: false,
    recipient: null,
    data,
    test: false
  };
}

const poll = (status: string, ts = T, extra: Record<string, unknown> = {}) =>
  ev(status === 'active' ? 'poll_progress' : 'poll_end', {
    poll_id: 'p1',
    title: 'Next map?',
    status,
    ends_at: T + 60_000,
    choices: [
      { id: 'a', title: 'Dust', votes: 3 },
      { id: 'b', title: 'Mirage', votes: 1 }
    ],
    ...extra
  }, ts);

describe('shares', () => {
  it('adds up to 100', () => {
    expect(shares([1, 1, 1])).toEqual([34, 33, 33]);
    expect(shares([0, 0])).toEqual([0, 0]);
    expect(shares([3, 1])).toEqual([75, 25]);
  });
});

describe('fromEvent', () => {
  it('reads a running poll', () => {
    const l = fromEvent(poll('active'))!;
    expect(l.type).toBe('poll');
    expect(l.open).toBe(true);
    expect(l.total).toBe(4);
    expect(l.choices.map((c) => c.pct)).toEqual([75, 25]);
    expect(l.choices.some((c) => c.winner)).toBe(false);
    expect(totalText(l)).toBe('4 votes');
  });

  it('marks the winner once it ends, but not on a tie', () => {
    expect(fromEvent(poll('completed'))!.choices[0]!.winner).toBe(true);
    const tie = poll('completed', T, { choices: [{ title: 'A', votes: 2 }, { title: 'B', votes: 2 }] });
    expect(fromEvent(tie)!.choices.some((c) => c.winner)).toBe(false);
  });

  it('reads predictions by points and winning outcome', () => {
    const p = fromEvent(
      ev('prediction_end', {
        prediction_id: 'x',
        title: 'Win?',
        status: 'resolved',
        winning_outcome_id: 'n',
        outcomes: [
          { id: 'y', title: 'Yes', users: 3, channel_points: 900, color: 'BLUE' },
          { id: 'n', title: 'No', users: 1, channel_points: 100, color: 'PINK' }
        ]
      })
    )!;
    expect(p.type).toBe('prediction');
    expect(p.choices[1]!.winner).toBe(true);
    expect(p.choices[0]!.color).toBe('blue');
    expect(totalText(p)).toBe('1,000 points');
    expect(statusText(p, T)).toBe('Result');
  });

  it('ignores other events', () => {
    expect(fromEvent(ev('follow', {}))).toBeNull();
  });
});

describe('latest and current', () => {
  it('picks the newest of either kind', () => {
    const older = poll('active', T);
    const newer = ev('prediction_begin', { title: 'Win?', outcomes: [] }, T + 1);
    expect(latest([newer, older])!.type).toBe('prediction');
    expect(latest([newer, older], 'poll')!.type).toBe('poll');
  });

  it('shows a running poll with a countdown', () => {
    const l = fromEvent(poll('active'))!;
    expect(secondsLeft(l, T + 15_500)).toBe(45);
    expect(statusText(l, T + 15_500)).toBe('0:45 left');
    expect(current(l, T + 70_000, 8)!.open).toBe(false);
  });

  it('keeps the result for a few seconds, then hides', () => {
    const l = fromEvent(poll('completed', T + 60_000, { ended_at: T + 60_000 }))!;
    expect(current(l, T + 65_000, 8)).not.toBeNull();
    expect(current(l, T + 69_000, 8)).toBeNull();
    expect(current(fromEvent(poll('archived'))!, T, 8)).toBeNull();
    expect(current(null, T, 8)).toBeNull();
  });

  it('hides a poll whose end never came', () => {
    const l = fromEvent(poll('active'))!;
    expect(current(l, T + 10 * 60_000, 8)).toBeNull();
  });

  it('formats time', () => {
    expect(clockText(65)).toBe('1:05');
  });
});
