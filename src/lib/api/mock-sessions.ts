// Stream sessions for the browser demo. Mirrors src-tauri/src/sessions/stats.rs.

import type { Event } from '$lib/bindings/Event';
import type { EventKind } from '$lib/bindings/EventKind';
import type { MarkerEntry } from '$lib/bindings/MarkerEntry';
import type { RaidEntry } from '$lib/bindings/RaidEntry';
import type { Ranked } from '$lib/bindings/Ranked';
import type { SessionListItem } from '$lib/bindings/SessionListItem';
import type { SessionSummary } from '$lib/bindings/SessionSummary';
import type { StreamSession } from '$lib/bindings/StreamSession';

const TOP = 5;
const MIN = 60_000;

export interface DemoSession {
  session: StreamSession;
  events: Event[];
  /** One entry per chat message. */
  chat: Array<{ ts: number; name: string }>;
  firstChatters: string[];
  alerts: number;
  actions: number;
  markers: MarkerEntry[];
  raidsOut: RaidEntry[];
}

export type MakeEvent = (kind: EventKind, i: number, ts: number) => Event;

const SUMMARY_KINDS: EventKind[] = ['follow', 'sub', 'resub', 'gift_sub', 'community_gift', 'cheer', 'raid', 'charity', 'redemption', 'hype_train_begin'];

function who(e: Event): string {
  return e.user?.display_name || e.user?.login || 'Anonymous';
}

function top(tally: Map<string, number>, n = TOP): Ranked[] {
  return [...tally]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name))
    .slice(0, n);
}

function add(tally: Map<string, number>, name: string, amount: number) {
  tally.set(name, (tally.get(name) ?? 0) + amount);
}

export function summarize(d: DemoSession, now: number): SessionSummary {
  const start = d.session.started_at;
  const end = Math.max(start, d.session.ended_at ?? now);
  const inRange = (ts: number) => ts >= start && ts <= end;
  const s: SessionSummary = {
    session: { ...d.session },
    duration_ms: end - start,
    follows: 0,
    new_subs: 0,
    resubs: 0,
    gifted_subs: 0,
    top_gifters: [],
    bits: 0,
    top_cheerers: [],
    raids_in: [],
    raids_out: d.raidsOut.filter((r) => inRange(r.ts)),
    donation_count: 0,
    donation_totals: [],
    top_donors: [],
    chat_messages: 0,
    chatters: 0,
    top_chatters: [],
    first_chatters: d.firstChatters,
    alerts: d.alerts,
    actions: d.actions,
    markers: d.markers.filter((m) => inRange(m.ts)),
    timeline: [],
    chat_minutes: []
  };
  const gifters = new Map<string, number>();
  const cheerers = new Map<string, number>();
  const donors = new Map<string, number>();
  const currencies = new Map<string, number>();
  const events = d.events.filter((e) => !e.test && inRange(e.ts) && SUMMARY_KINDS.includes(e.kind)).sort((a, b) => a.ts - b.ts);
  for (const e of events) {
    const amount = e.amount ?? 0;
    if (e.kind === 'follow') s.follows++;
    else if (e.kind === 'sub') s.new_subs++;
    else if (e.kind === 'resub') s.resubs++;
    else if (e.kind === 'gift_sub') {
      s.gifted_subs++;
      add(gifters, who(e), 1);
    } else if (e.kind === 'cheer') {
      s.bits += Math.max(0, Math.floor(amount));
      add(cheerers, who(e), amount);
    } else if (e.kind === 'raid') s.raids_in.push({ ts: e.ts, name: who(e), viewers: Math.max(0, Math.floor(amount)) });
    else if (e.kind === 'charity') {
      s.donation_count++;
      add(donors, who(e), amount);
      add(currencies, e.currency ?? '', amount);
    }
    if (e.kind !== 'gift_sub' || !('community_gift_id' in e.data)) s.timeline.push({ ts: e.ts, kind: e.kind });
  }
  s.top_gifters = top(gifters);
  s.top_cheerers = top(cheerers);
  s.top_donors = top(donors);
  s.donation_totals = top(currencies, Infinity);

  const chatters = new Map<string, number>();
  const minutes = new Map<number, number>();
  for (const c of d.chat.filter((c) => inRange(c.ts))) {
    add(chatters, c.name, 1);
    const m = Math.floor(c.ts / MIN) * MIN;
    minutes.set(m, (minutes.get(m) ?? 0) + 1);
  }
  s.chatters = chatters.size;
  s.chat_messages = [...chatters.values()].reduce((a, b) => a + b, 0);
  s.top_chatters = top(chatters);
  s.chat_minutes = [...minutes].sort((a, b) => a[0] - b[0]).map(([minute, count]) => ({ minute, count }));
  return s;
}

export function listItem(s: SessionSummary): SessionListItem {
  return { session: s.session, follows: s.follows, subs: s.new_subs + s.resubs + s.gifted_subs, bits: s.bits, chat_messages: s.chat_messages };
}

/** Small seeded random numbers, so screenshots look the same every run. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EXTRA_CHATTERS = ['bluejay_77', 'Saffron', 'tinycactus', 'OrbitalOtter', 'mapleleaf', 'zzzlumi', 'brickwall', 'Juniper', 'frostbyte', 'hollowpine', 'Wren', 'soda_pop'];

interface Plan {
  seed: number;
  /** Hours before `now` the stream started. */
  hoursAgo: number;
  minutes: number;
  title: string;
  categories: string[];
  peak: number;
  avg: number;
  follows: number;
  subs: number;
  resubs: number;
  gift: number;
  cheers: number[];
  raids: number[];
  raidOut: [string, number] | null;
  donations: number[];
  chatPerMin: number;
  alerts: number;
  actions: number;
  markers: string[];
}

const PLANS: Plan[] = [
  {
    seed: 7,
    hoursAgo: 26,
    minutes: 135,
    title: 'Celeste any% practice · chill vibes',
    categories: ['Just Chatting', 'Celeste'],
    peak: 212,
    avg: 148,
    follows: 38,
    subs: 9,
    resubs: 4,
    gift: 5,
    cheers: [100, 500, 250, 1000, 50, 300, 200],
    raids: [42],
    raidOut: ['pixelbyte', 151],
    donations: [10, 15.5],
    chatPerMin: 14,
    alerts: 61,
    actions: 14,
    markers: ['First summit', 'Chapter 7 clear']
  },
  {
    seed: 11,
    hoursAgo: 74,
    minutes: 100,
    title: 'Building a stream overlay from scratch',
    categories: ['Software and Game Development'],
    peak: 96,
    avg: 71,
    follows: 17,
    subs: 3,
    resubs: 2,
    gift: 0,
    cheers: [100, 200],
    raids: [],
    raidOut: null,
    donations: [],
    chatPerMin: 8,
    alerts: 24,
    actions: 6,
    markers: []
  }
];

function fromPlan(p: Plan, id: number, now: number, names: string[], make: MakeEvent): DemoSession {
  const rnd = seeded(p.seed);
  const start = now - p.hoursAgo * 3_600_000;
  const span = p.minutes * MIN;
  const end = start + span;
  // Busier in the middle of the stream.
  const when = () => start + Math.floor(span * Math.min(0.999, (rnd() + rnd() + rnd()) / 3));
  const events: Event[] = [];
  const push = (kind: EventKind, i: number, ts = when()) => {
    const e = make(kind, i, ts);
    events.push(e);
    return e;
  };
  for (let i = 0; i < p.follows; i++) push('follow', i + p.seed);
  for (let i = 0; i < p.subs; i++) push('sub', i + 3);
  for (let i = 0; i < p.resubs; i++) push('resub', i + 5);
  if (p.gift) {
    const ts = when();
    push('community_gift', 6, ts).amount = p.gift;
    for (let i = 0; i < p.gift; i++) push('gift_sub', 6, ts + i).data = { community_gift_id: `cg-${p.seed}` };
  }
  p.cheers.forEach((bits, i) => (push('cheer', [2, 0, 2, 2, 5, 1, 0][i % 7]!).amount = bits));
  p.raids.forEach((viewers, i) => (push('raid', 3 + i, start + 20 * MIN).amount = viewers));
  p.donations.forEach((usd, i) => {
    const e = push('charity', 4 + i);
    e.amount = usd;
    e.currency = 'USD';
  });
  for (let i = 0; i < 12; i++) push('redemption', i);

  const chat: DemoSession['chat'] = [];
  for (let m = 0; m < p.minutes; m++) {
    const n = Math.round(p.chatPerMin * (0.4 + rnd() * 1.2));
    for (let k = 0; k < n; k++) {
      // A few regulars do most of the talking.
      const r = rnd();
      const name = names[Math.floor(r * r * names.length)]!;
      chat.push({ ts: start + m * MIN + Math.floor(rnd() * MIN), name });
    }
  }
  const markers = p.markers.map((description, i) => ({ ts: start + Math.floor(((i + 1) * span) / (p.markers.length + 1)), description }));
  return {
    session: {
      id,
      started_at: start,
      ended_at: end,
      source: 'twitch',
      title: p.title,
      categories: p.categories,
      peak_viewers: p.peak,
      avg_viewers: p.avg
    },
    events,
    chat,
    firstChatters: names.slice(-3 - (p.seed % 3)),
    alerts: p.alerts,
    actions: p.actions,
    markers,
    raidsOut: p.raidOut ? [{ ts: end - MIN, name: p.raidOut[0], viewers: p.raidOut[1] }] : []
  };
}

/** Earlier activity for the stream that's live in the demo. */
export function liveActivity(start: number, now: number, viewers: readonly string[], make: MakeEvent): Pick<DemoSession, 'events' | 'chat'> {
  const minutes = Math.max(1, Math.floor((now - start) / MIN) - 15);
  const plan: Plan = {
    ...PLANS[0]!,
    seed: 3,
    hoursAgo: (now - start) / 3_600_000,
    minutes,
    follows: 24,
    subs: 6,
    resubs: 3,
    gift: 3,
    cheers: [100, 250, 1000, 300],
    raids: [],
    donations: [],
    chatPerMin: 11
  };
  const d = fromPlan(plan, 0, now, [...viewers, ...EXTRA_CHATTERS], make);
  return { events: d.events, chat: d.chat };
}

/** Two past streams, oldest first. */
export function pastSessions(now: number, viewers: readonly string[], make: MakeEvent): DemoSession[] {
  const names = [...viewers, ...EXTRA_CHATTERS];
  return PLANS.map((p, i) => fromPlan(p, PLANS.length - i, now, names, make)).reverse();
}
