import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '$lib/bindings/SessionSummary';
import { DEFAULT_SOCIAL_TEMPLATE, PLACEHOLDERS, bucketTimeline, durationText, socialText, templateContext, toCsv, exportName } from './summary';

const T0 = Date.UTC(2026, 10, 3, 18, 0, 0);
const MIN = 60_000;

function summary(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    session: {
      id: 1,
      started_at: T0,
      ended_at: T0 + 135 * MIN,
      source: 'twitch',
      title: 'Ranked grind',
      categories: ['Just Chatting', 'Celeste'],
      peak_viewers: 212,
      avg_viewers: 148
    },
    duration_ms: 135 * MIN,
    follows: 38,
    new_subs: 9,
    resubs: 4,
    gifted_subs: 5,
    top_gifters: [{ name: 'Gina', amount: 5 }],
    bits: 2400,
    top_cheerers: [{ name: 'raiding_rudy', amount: 1500 }],
    raids_in: [{ ts: T0 + 20 * MIN, name: 'm0ss', viewers: 42 }],
    raids_out: [{ ts: T0 + 134 * MIN, name: 'pixelbyte', viewers: 150 }],
    donation_count: 2,
    donation_totals: [{ name: 'USD', amount: 25.5 }],
    top_donors: [{ name: 'Dee', amount: 20 }],
    chat_messages: 1834,
    chatters: 97,
    top_chatters: [{ name: 'nova_kat', amount: 211 }],
    first_chatters: ['quietfox', '=cmd'],
    alerts: 61,
    actions: 14,
    markers: [{ ts: T0 + 60 * MIN, description: 'Boss down, "finally"' }],
    timeline: [],
    chat_minutes: [],
    ...over
  };
}

describe('session summary', () => {
  it('formats duration', () => {
    expect(durationText(0)).toBe('0m');
    expect(durationText(45 * MIN)).toBe('45m');
    expect(durationText(135 * MIN)).toBe('2h 15m');
  });

  it('fills the default template', () => {
    expect(socialText(DEFAULT_SOCIAL_TEMPLATE, summary())).toBe(
      'Thanks for hanging out! 2h 15m of Celeste with a peak of 212 viewers.\n38 new follows, 18 subs and 2,400 bits. Top chatter: nova_kat.'
    );
    const quiet = summary({ top_chatters: [], session: { ...summary().session, categories: [] } });
    expect(socialText(DEFAULT_SOCIAL_TEMPLATE, quiet)).toContain('of streaming with');
    expect(socialText(DEFAULT_SOCIAL_TEMPLATE, quiet)).toContain('Top chatter: nobody yet.');
  });

  it('has a value for every documented placeholder', () => {
    const ctx = templateContext(summary(), 'Castwright');
    for (const [key] of PLACEHOLDERS) expect(ctx, key).toHaveProperty(key);
    expect(Object.keys(ctx).sort()).toEqual(PLACEHOLDERS.map(([k]) => k).sort());
    expect(socialText('{{channel}} raided {{raided}}, {{donation_total}}, {{raiders}}', summary(), 'Castwright')).toBe(
      'Castwright raided pixelbyte, 25.50 USD, m0ss'
    );
  });

  it('writes CSV that spreadsheets read safely', () => {
    const csv = toCsv(summary());
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('section,name,value,time');
    expect(lines).toContain('"stats","started","2026-11-03T18:00:00Z",""');
    expect(lines).toContain('"stats","follows","38",""');
    expect(lines).toContain('"top_chatters","nova_kat","211",""');
    expect(lines).toContain('"raid_in","m0ss","42","2026-11-03T18:20:00Z"');
    expect(lines).toContain('"marker","Boss down, ""finally""","","2026-11-03T19:00:00Z"');
    expect(lines).toContain(`"first_time_chatter","'=cmd","",""`);
    expect(lines).toContain('"donation_total","USD","25.50",""');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('buckets the timeline by 10 minutes', () => {
    const s = summary({
      duration_ms: 25 * MIN,
      timeline: [
        { ts: T0 + MIN, kind: 'follow' },
        { ts: T0 + 9 * MIN, kind: 'cheer' },
        { ts: T0 + 10 * MIN, kind: 'resub' },
        { ts: T0 + 24 * MIN, kind: 'raid' },
        { ts: T0 + 26 * MIN, kind: 'redemption' }
      ],
      chat_minutes: [
        { minute: T0, count: 4 },
        { minute: T0 + 12 * MIN, count: 6 }
      ]
    });
    const b = bucketTimeline(s);
    expect(b).toHaveLength(3);
    expect(b.map((x) => x.start)).toEqual([T0, T0 + 10 * MIN, T0 + 20 * MIN]);
    expect(b[0]!.counts).toEqual({ follows: 1, subs: 0, bits: 1, raids: 0, other: 0 });
    expect(b[1]!.counts.subs).toBe(1);
    // Late events land in the last bucket.
    expect(b[2]!.counts).toMatchObject({ raids: 1, other: 1 });
    expect(b.map((x) => x.total)).toEqual([2, 1, 2]);
    expect(b.map((x) => x.chat)).toEqual([4, 6, 0]);
  });

  it('always has one bucket', () => {
    expect(bucketTimeline(summary({ duration_ms: 0 }))).toHaveLength(1);
  });

  it('names exports by day', () => {
    expect(exportName(summary())).toMatch(/^stream-2026-11-0[34]$/);
  });
});
