// Polls and predictions as the app and the poll layer show them, built from their events.
import type { Event } from '$lib/bindings/Event';
import type { PollSource } from '$lib/bindings/PollSource';

export interface LiveChoice {
  id: string;
  title: string;
  /** Votes for a poll, channel points for a prediction. */
  amount: number;
  /** Voters (predictions only). */
  users: number;
  /** 0 to 100. */
  pct: number;
  winner: boolean;
  color: string;
}

export interface LiveInteract {
  type: 'poll' | 'prediction';
  id: string;
  title: string;
  /** Twitch status in lower case: active, locked, completed, terminated, archived, resolved, canceled. */
  status: string;
  /** Viewers can still vote or predict. */
  open: boolean;
  /** Still waiting for an end (open, or a locked prediction). */
  running: boolean;
  /** When voting closes (ms). */
  closesAt: number | null;
  /** When it ended (ms), or the time of its last event. */
  endedAt: number | null;
  choices: LiveChoice[];
  total: number;
  pointsPerVote: number;
  /** Time of the event it was read from. */
  ts: number;
}

const POLL_KINDS = new Set(['poll_begin', 'poll_progress', 'poll_end']);
const PREDICTION_KINDS = new Set(['prediction_begin', 'prediction_progress', 'prediction_lock', 'prediction_end']);
/** A running one with no news this long after voting closed missed its end. */
const STALE_MS = 60_000;
/** Locked predictions can wait a long time for a result, but not forever. */
const LOCKED_MAX_MS = 6 * 3600_000;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const time = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null);

export function isInteractEvent(e: Pick<Event, 'kind'>): boolean {
  return POLL_KINDS.has(e.kind) || PREDICTION_KINDS.has(e.kind);
}

/** Shares rounded so they add up to 100 (largest remainder). */
export function shares(amounts: readonly number[]): number[] {
  const total = amounts.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return amounts.map(() => 0);
  const raw = amounts.map((a) => (Math.max(0, a) / total) * 100);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    out[i]!++;
    left--;
  }
  return out;
}

export function fromEvent(e: Event): LiveInteract | null {
  const d = (e.data ?? {}) as Record<string, unknown>;
  const poll = POLL_KINDS.has(e.kind);
  if (!poll && !PREDICTION_KINDS.has(e.kind)) return null;
  const list = (Array.isArray(poll ? d.choices : d.outcomes) ? (poll ? d.choices : d.outcomes) : []) as Array<Record<string, unknown>>;
  const status = str(d.status).toLowerCase() || (e.kind === 'prediction_lock' ? 'locked' : 'active');
  const amounts = list.map((c) => num(poll ? c.votes : c.channel_points));
  const pct = shares(amounts);
  const ended = !(status === 'active' || status === 'locked');
  const top = Math.max(0, ...amounts);
  const tied = amounts.filter((a) => a === top).length > 1;
  const winId = str(d.winning_outcome_id);
  const choices: LiveChoice[] = list.map((c, i) => ({
    id: str(c.id) || String(i),
    title: str(c.title),
    amount: amounts[i]!,
    users: num(c.users),
    pct: pct[i]!,
    winner: poll ? ended && status !== 'archived' && top > 0 && !tied && amounts[i] === top : !!winId && str(c.id) === winId,
    color: str(c.color).toLowerCase()
  }));
  return {
    type: poll ? 'poll' : 'prediction',
    id: str(poll ? d.poll_id : d.prediction_id),
    title: str(d.title),
    status,
    open: status === 'active',
    running: !ended,
    closesAt: time(poll ? d.ends_at : d.locks_at),
    endedAt: time(d.ended_at) ?? (ended ? e.ts : null),
    choices,
    total: amounts.reduce((a, b) => a + b, 0),
    pointsPerVote: num(d.points_per_vote),
    ts: e.ts
  };
}

/** The newest poll or prediction among `events` (any order). */
export function latest(events: readonly Event[], source: PollSource = 'both'): LiveInteract | null {
  let best: Event | null = null;
  for (const e of events) {
    if (!e) continue;
    const ok = source === 'poll' ? POLL_KINDS.has(e.kind) : source === 'prediction' ? PREDICTION_KINDS.has(e.kind) : isInteractEvent(e);
    if (ok && (!best || e.ts >= best.ts)) best = e;
  }
  return best ? fromEvent(best) : null;
}

/** What to show at `now`: running ones, and ended ones for `resultS` seconds. Null hides the layer. */
export function current(l: LiveInteract | null, now: number, resultS: number): LiveInteract | null {
  if (!l) return null;
  if (l.running) {
    if (l.open && l.closesAt !== null && now > l.closesAt + STALE_MS) {
      // Missed the end; a poll is over, a prediction is waiting for its result.
      if (l.type === 'poll') return now - l.closesAt < resultS * 1000 ? { ...l, open: false } : null;
      return { ...l, open: false, status: 'locked' };
    }
    if (!l.open && now - l.ts > LOCKED_MAX_MS) return null;
    if (l.open && l.closesAt !== null && now >= l.closesAt) return { ...l, open: false };
    return l;
  }
  if (l.status === 'archived') return null;
  const end = l.endedAt ?? l.ts;
  return now - end < Math.max(0, resultS) * 1000 ? l : null;
}

/** Seconds until voting closes, or null when it's not open. */
export function secondsLeft(l: LiveInteract, now: number): number | null {
  if (!l.open || l.closesAt === null) return null;
  return Math.max(0, Math.ceil((l.closesAt - now) / 1000));
}

export function clockText(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** One short line under the bars. */
export function statusText(l: LiveInteract, now: number): string {
  const left = secondsLeft(l, now);
  if (left !== null) return `${clockText(left)} left`;
  if (l.type === 'prediction') {
    if (l.status === 'resolved') return 'Result';
    if (l.status === 'canceled') return 'Canceled, points refunded';
    return 'Predictions closed';
  }
  if (l.running) return 'Voting closed';
  return 'Final result';
}

export function totalText(l: LiveInteract): string {
  const n = l.total.toLocaleString('en-US');
  if (l.type === 'poll') return `${n} vote${l.total === 1 ? '' : 's'}`;
  return `${n} points`;
}

/** What the editor shows while nothing is running. */
export function samplePoll(now: number): LiveInteract {
  const amounts = [42, 27, 11];
  const pct = shares(amounts);
  return {
    type: 'poll',
    id: 'sample',
    title: 'Which map next?',
    status: 'active',
    open: true,
    running: true,
    closesAt: now + 75_000,
    endedAt: null,
    choices: ['Dust', 'Mirage', 'Inferno'].map((title, i) => ({
      id: String(i),
      title,
      amount: amounts[i]!,
      users: 0,
      pct: pct[i]!,
      winner: false,
      color: ''
    })),
    total: amounts.reduce((a, b) => a + b, 0),
    pointsPerVote: 0,
    ts: now
  };
}

/** What a poll layer shows at `now`, or null to hide it. */
export function layerLive(recent: readonly Event[], source: PollSource, resultS: number, now: number): LiveInteract | null {
  return current(latest(recent, source), now, resultS);
}
