// Hype trains for the browser demo: a train that climbs a few levels and ends, with
// the same events and hype.* variables as the desktop app. `?hype` starts one right
// away; with `demo=static` it stays mid-train.
import type { Event } from '$lib/bindings/Event';
import type { EventKind } from '$lib/bindings/EventKind';

interface Hooks {
  publish: (e: Event) => void;
  setVars: (changes: Record<string, unknown>) => void;
  uid: () => string;
  viewers: readonly string[];
  staticMode: boolean;
  startNow: boolean;
}

/** Points each level needs, going up as the train climbs. */
const goalFor = (level: number) => 800 + level * 300;
const TICK_MS = 4000;

interface Train {
  id: string;
  level: number;
  progress: number;
  total: number;
  startedAt: number;
  endsAt: number;
  bits: Map<string, number>;
  subs: Map<string, number>;
}

function top(m: Map<string, number>): [string, number] | null {
  let best: [string, number] | null = null;
  for (const [name, n] of m) if (!best || n > best[1]) best = [name, n];
  return best;
}

export function createHypeMock(h: Hooks) {
  let train: Train | null = null;
  let step = 0;

  const contributions = (t: Train) =>
    [
      ...(top(t.bits) ? [{ name: top(t.bits)![0], login: top(t.bits)![0].toLowerCase(), type: 'bits', total: top(t.bits)![1] }] : []),
      ...(top(t.subs) ? [{ name: top(t.subs)![0], login: top(t.subs)![0].toLowerCase(), type: 'subscription', total: top(t.subs)![1] }] : [])
    ];

  const event = (kind: EventKind, t: Train, now: number): Event => ({
    id: h.uid(),
    kind,
    ts: now,
    user: null,
    amount: t.total,
    currency: null,
    tier: null,
    months: null,
    message: null,
    message_parts: [],
    roles: { broadcaster: false, moderator: false, vip: false, subscriber: false },
    is_gift: false,
    is_anonymous: false,
    recipient: null,
    data: {
      hype_train_id: t.id,
      level: t.level,
      total: t.total,
      ...(kind === 'hype_train_end' ? { ended_at: now } : { goal: goalFor(t.level), progress: t.progress, expires_at: t.endsAt, started_at: t.startedAt }),
      top_contributions: contributions(t),
      train_type: 'regular',
      is_golden_kappa: false,
      is_shared: false,
      shared_with: []
    },
    test: false
  });

  const vars = (t: Train) => {
    const bits = top(t.bits);
    const subs = top(t.subs);
    const goal = goalFor(t.level);
    h.setVars({
      'hype.active': true,
      'hype.id': t.id,
      'hype.level': t.level,
      'hype.progress': t.progress,
      'hype.goal': goal,
      'hype.percent': Math.floor((Math.min(t.progress, goal) * 100) / goal),
      'hype.total': t.total,
      'hype.started_at': t.startedAt,
      'hype.ends_at': t.endsAt,
      'hype.type': 'regular',
      'hype.shared': false,
      'hype.shared_with': '',
      'hype.top': contributions(t),
      'hype.top_bits_name': bits?.[0] ?? '',
      'hype.top_bits': bits?.[1] ?? 0,
      'hype.top_sub_name': subs?.[0] ?? '',
      'hype.top_subs': subs?.[1] ?? 0
    });
  };

  /** One viewer chips in: bits or a sub. A full bar moves to the next level. */
  const contribute = (t: Train) => {
    step++;
    const name = h.viewers[step % h.viewers.length]!;
    const sub = step % 3 === 0;
    const points = sub ? 500 : 100 * (1 + (step % 4));
    if (sub) t.subs.set(name, (t.subs.get(name) ?? 0) + 500);
    else t.bits.set(name, (t.bits.get(name) ?? 0) + points);
    t.total += points;
    t.progress += points;
    if (t.progress >= goalFor(t.level)) {
      t.progress -= goalFor(t.level);
      t.level++;
      t.endsAt = Math.max(t.endsAt, Date.now() + 45_000);
    }
  };

  const begin = (frozen: boolean) => {
    const now = Date.now();
    const t: Train = { id: h.uid(), level: 1, progress: 0, total: 0, startedAt: now, endsAt: now + (frozen ? 285_000 : 60_000), bits: new Map(), subs: new Map() };
    contribute(t);
    contribute(t);
    train = t;
    vars(t);
    h.publish(event('hype_train_begin', t, now));
    if (frozen) {
      // Mid-train for screenshots: level 3, a bit over half way.
      while (t.level < 3) contribute(t);
      t.progress = Math.round(goalFor(3) * 0.64);
      t.total = 4_820;
      vars(t);
    }
  };

  const end = () => {
    const t = train;
    if (!t) return;
    train = null;
    const now = Date.now();
    h.setVars({ 'hype.active': false, 'hype.last_level': t.level, 'hype.ended_at': now, 'hype.ends_at': 0, 'hype.level': t.level, 'hype.total': t.total });
    h.publish(event('hype_train_end', t, now));
  };

  const tick = () => {
    const t = train;
    if (!t) return;
    if (Date.now() >= t.endsAt) return end();
    const level = t.level;
    contribute(t);
    vars(t);
    h.publish(event('hype_train_progress', t, Date.now()));
    if (t.level > level) h.setVars({ 'hype.ends_at': t.endsAt });
  };

  if (typeof window !== 'undefined') {
    if (h.startNow) begin(h.staticMode);
    if (!h.staticMode) {
      if (!h.startNow) setTimeout(() => begin(false), 45_000);
      setInterval(() => {
        if (train) tick();
        else if (Date.now() % 300_000 < TICK_MS) begin(false);
      }, TICK_MS);
    }
  }

  return { begin: () => begin(false), end };
}
