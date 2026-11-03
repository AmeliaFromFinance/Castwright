// Giveaways and the viewer queue for the demo: a short version of
// src-tauri/src/play, with demo viewers who join over time.
import type { Event } from '$lib/bindings/Event';
import type { Giveaway } from '$lib/bindings/Giveaway';
import type { GiveawayRecord } from '$lib/bindings/GiveawayRecord';
import type { GiveawaySettings } from '$lib/bindings/GiveawaySettings';
import type { PlayState } from '$lib/bindings/PlayState';
import type { QueueEntry } from '$lib/bindings/QueueEntry';
import type { QueueSettings } from '$lib/bindings/QueueSettings';
import type { Viewer } from '$lib/bindings/Viewer';
import type { ViewerQueue } from '$lib/bindings/ViewerQueue';
import type { Winner } from '$lib/bindings/Winner';
import { render } from '$lib/logic/template';
import { commandRest, giveawayIssues, howToEnter, keywordClash, queueIssues } from '$lib/pages/interact/play-forms';

export interface CrowdPerson {
  id: string;
  name: string;
  color: string;
  /** 0 = not a sub. */
  tier: number;
  mod?: boolean;
  vip?: boolean;
  /** Days since they followed; null = not following. */
  followDays: number | null;
  ign: string;
}

interface Deps {
  emit: (name: string, payload: unknown) => void;
  setVars: (changes: Record<string, unknown>) => void;
  /** Publishes a chat line from a demo viewer. */
  chat: (p: CrowdPerson, text: string) => void;
  /** Posts as the app's bot. */
  say: (text: string) => void;
  recentChat: () => readonly Event[];
  log: (message: string) => void;
  uid: () => string;
  giveawaySettings: () => GiveawaySettings;
  setGiveawaySettings: (s: GiveawaySettings) => void;
  queueSettings: () => QueueSettings;
  setQueueSettings: (s: QueueSettings) => void;
  /** Lets demo viewers join on their own. Off for tests that drive chat themselves. */
  simulate: boolean;
}

const fail = (message: string): never => {
  throw { code: 'user', message };
};

const C = (id: number, name: string, color: string, tier: number, followDays: number | null, ign: string, extra: Partial<CrowdPerson> = {}): CrowdPerson => ({
  id: String(id),
  name,
  color,
  tier,
  followDays,
  ign,
  ...extra
});

/** The demo's regular viewers first (they have 7TV paints in screenshots), then more. */
export const CROWD: readonly CrowdPerson[] = [
  C(1000, 'nova_kat', '#C9B3FF', 1, 410, 'NovaKat#2231'),
  C(1002, 'raiding_rudy', '#9EF08A', 0, 120, 'Rudy#0042'),
  C(1001, 'pixelbyte', '#7FDBFF', 1, 700, 'pxl#7781', { mod: true }),
  C(1005, 'quietfox', '#FFB86B', 0, 33, 'qfox#1203'),
  C(1003, 'm0ss', '#F5C451', 0, 2, 'm0ss#88', { vip: true }),
  C(3001, 'solarflare', '#FF9E7A', 3, 260, 'Solar#3001'),
  C(1004, 'Tomasz', '#FF8A8A', 2, 95, 'Tomasz#5'),
  C(3002, 'bytebandit', '#7AE7C7', 0, null, 'bandit#11'),
  C(1006, 'LumenLark', '#8AB4FF', 1, 510, 'Lark#5550', { mod: true }),
  C(3003, 'mintleaf', '#A8F0A0', 0, 14, 'mint#404'),
  C(3004, 'cosmo_cat', '#F7A8FF', 1, 60, 'Cosmo#77'),
  C(1007, 'kettle_drum', '#E59BFF', 0, 8, 'kettle#9'),
  C(3005, 'hollowpine', '#B5D99C', 0, 300, 'Pine#12'),
  C(3006, 'zigzagzoe', '#FFD166', 2, 45, 'ZZoe#246'),
  C(3007, 'frostbyte', '#9AD0FF', 0, 1, 'frost#1'),
  C(3008, 'lilpanda', '#FFC4E1', 0, 180, 'panda#808'),
  C(3009, 'noodlenet', '#FFE08A', 1, 72, 'noodle#5'),
  C(3010, 'echo_vale', '#C2B8FF', 0, 26, 'Echo#900'),
  C(3011, 'starlit_sam', '#8FF0E0', 0, 640, 'Sam#3003'),
  C(3012, 'pebbleboi', '#D9C4A0', 0, null, 'pebble#2'),
  C(3013, 'orbit_ivy', '#B0FF9E', 1, 19, 'Ivy#1999'),
  C(3014, 'sunnydaze', '#FFCB6B', 0, 230, 'sunny#71'),
  C(3015, 'cloudberry', '#FFAFAF', 0, 5, 'berry#350'),
  C(3016, 'rustbucket', '#E0A070', 0, 400, 'rust#64')
];

const BOTS = ['nightbot', 'streamelements', 'streamlabs', 'moobot', 'fossabot'];
const DAY = 86_400_000;

/** Crypto-random number in [0, n). */
function randomBelow(n: number): number {
  if (n <= 1) return 0;
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  do crypto.getRandomValues(buf);
  while (buf[0]! >= limit);
  return buf[0]! % n;
}

export function pickWeighted(weights: readonly number[], rand: (n: number) => number = randomBelow): number | null {
  const total = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (total <= 0) return null;
  let r = rand(total);
  for (let i = 0; i < weights.length; i++) {
    const w = Math.max(0, weights[i]!);
    if (r < w) return i;
    r -= w;
  }
  return null;
}

function viewerOf(e: Event): Viewer | null {
  const u = e.user;
  if (!u) return null;
  const d = (e.data ?? {}) as Record<string, unknown>;
  const tier = typeof d.sub_tier === 'number' ? d.sub_tier : e.roles.subscriber ? 1 : 0;
  return {
    id: u.id || u.login,
    login: u.login,
    name: u.display_name || u.login,
    color: typeof d.color === 'string' ? d.color : '',
    badges: Array.isArray(d.badges) ? (d.badges as unknown[]).filter((b): b is string => typeof b === 'string') : [],
    badge_images: Array.isArray(d.badge_images) ? (d.badge_images as unknown[]) : [],
    roles: e.roles,
    sub_tier: Math.min(3, tier)
  };
}

const viewerJson = (v: Viewer) => ({ id: v.id, login: v.login, name: v.name, color: v.color, badges: v.badges, badge_images: v.badge_images, roles: v.roles });
const nameList = (names: string[], max: number) =>
  names.length <= 1 ? (names[0] ?? '') : names.length <= max ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : `${names.slice(0, max).join(', ')} and ${names.length - max} more`;

export function createPlayMock(d: Deps) {
  let giveaway: Giveaway | null = null;
  let draw: unknown = null;
  const queue: ViewerQueue = { open: false, waiting: [], playing: [], sub_turn: false };
  const t0 = Date.now();
  const history: GiveawayRecord[] = [
    { id: d.uid(), title: 'Steam game key', opened_at: t0 - 3 * DAY, ended_at: t0 - 3 * DAY + 900_000, entrants: 38, entries: 51, winners: ['quietfox'] },
    { id: d.uid(), title: 'Mouse pad', opened_at: t0 - 10 * DAY, ended_at: t0 - 10 * DAY + 1_200_000, entrants: 52, entries: 66, winners: ['solarflare', 'mintleaf'] },
    { id: d.uid(), title: 'Gift sub', opened_at: t0 - 17 * DAY, ended_at: t0 - 17 * DAY + 600_000, entrants: 24, entries: 24, winners: ['LumenLark'] }
  ];
  let timers: ReturnType<typeof setTimeout>[] = [];
  let ticker: ReturnType<typeof setInterval> | null = null;
  const batch: { pending: Array<[string, number]>; since: number | null; last: number | null } = { pending: [], since: null, last: null };

  const order = (): number[] => {
    const s = d.queueSettings();
    const all = queue.waiting.map((_, i) => i);
    if (s.sub_priority !== 'lane') return all;
    const subs = all.filter((i) => queue.waiting[i]!.sub);
    const rest = all.filter((i) => !queue.waiting[i]!.sub);
    const [a, b] = queue.sub_turn ? [subs, rest] : [rest, subs];
    const out: number[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i < a.length) out.push(a[i]!);
      if (i < b.length) out.push(b[i]!);
    }
    return out;
  };
  const position = (id: string) => {
    const p = order().findIndex((i) => queue.waiting[i]!.viewer.id === id);
    return p < 0 ? null : p + 1;
  };

  const state = (): PlayState => {
    const gs = d.giveawaySettings();
    const qs = d.queueSettings();
    return {
      giveaway,
      giveaway_settings: gs,
      queue,
      queue_settings: qs,
      queue_order: order().map((i) => queue.waiting[i]!.viewer.id),
      clash: !!giveaway && keywordClash(giveaway.settings.keyword, qs.join_word, giveaway.open)
    };
  };

  const publishVars = () => {
    const winner = giveaway ? [...giveaway.winners].reverse().find((w) => w.state === 'drawn' || w.state === 'claimed') : undefined;
    const ord = order();
    const row = (e: QueueEntry, position: number | null) => ({ id: e.viewer.id, login: e.viewer.login, name: e.viewer.name, color: e.viewer.color, note: e.note, sub: e.sub, position });
    d.setVars({
      'giveaway.title': giveaway?.settings.title ?? '',
      'giveaway.status': giveaway ? (giveaway.open ? 'open' : 'closed') : 'idle',
      'giveaway.open': giveaway?.open ?? false,
      'giveaway.entries': giveaway?.entrants.length ?? 0,
      'giveaway.keyword': giveaway?.settings.keyword ?? '',
      'giveaway.winner': winner?.viewer.name ?? '',
      'giveaway.draw': draw,
      'queue.size': queue.waiting.length,
      'queue.open': queue.open,
      'queue.next': ord.length ? queue.waiting[ord[0]!]!.viewer.name : '',
      'queue.playing': queue.playing.map((e) => e.viewer.name).join(', '),
      'queue.lineup': ord.slice(0, 20).map((i, p) => row(queue.waiting[i]!, p + 1)),
      'queue.party': queue.playing.map((e) => row(e, null))
    });
  };

  const changed = () => {
    publishVars();
    d.emit('cw://play', state());
    ensureTicker();
  };

  const ctxOf = (g: Giveaway, winner = '', previous = '') => ({
    title: g.settings.title,
    keyword: g.settings.keyword,
    reward: g.settings.reward_title,
    how: howToEnter(g.settings),
    entries: g.entrants.length,
    tickets: g.entrants.reduce((a, e) => a + e.entries, 0),
    winner,
    previous,
    claim_s: g.settings.claim_s
  });
  const say = (line: { on: boolean; text: string }, ctx: Record<string, unknown>) => {
    if (line.on && line.text.trim()) {
      const text = render(line.text, ctx).trim();
      if (text) d.say(text);
    }
  };

  const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));

  function ensureTicker() {
    if (ticker) return;
    ticker = setInterval(tick, 500);
  }

  function tick() {
    const now = Date.now();
    let dirty = false;
    if (giveaway?.open) {
      const s = giveaway.settings;
      if ((s.close_after_min > 0 && now - giveaway.opened_at >= s.close_after_min * 60_000) || (s.close_after_entries > 0 && giveaway.entrants.length >= s.close_after_entries)) {
        close(giveaway);
        dirty = true;
      }
    }
    for (const w of giveaway?.winners ?? []) {
      if (w.state === 'drawn' && w.claim_until !== null && now > w.claim_until) {
        w.state = 'missed';
        w.claim_until = null;
        d.log(`${w.viewer.name} didn't claim in time. Draw again?`);
        dirty = true;
      }
    }
    if (batch.since !== null && now - batch.since >= 5000 && batch.pending.length) {
      const names = batch.pending.map(([n]) => n);
      const ps = batch.pending.map(([, p]) => p);
      batch.pending = [];
      batch.since = null;
      batch.last = now;
      const lo = Math.min(...ps);
      const hi = Math.max(...ps);
      say(d.queueSettings().messages.joined, { name: nameList(names, 4), position: lo === hi ? lo : `${lo}–${hi}` });
    }
    if (dirty) changed();
  }

  function close(g: Giveaway) {
    if (!g.open) return;
    g.open = false;
    g.closed_at = Date.now();
    say(g.settings.messages.closed, ctxOf(g));
  }

  function entriesFor(g: Giveaway, v: Viewer): number {
    const tier = v.sub_tier || (v.roles.subscriber ? 1 : 0);
    if (!tier) return 1;
    const base = Math.min(100, Math.max(1, g.settings.rules.sub_entries));
    return g.settings.rules.tier_bonus ? base * tier : base;
  }

  function allowed(g: Giveaway, v: Viewer): boolean {
    const r = g.settings.rules;
    if (r.exclude_broadcaster && v.roles.broadcaster) return false;
    if (r.exclude_mods && v.roles.moderator && !v.roles.broadcaster) return false;
    if (r.exclude_bots && BOTS.includes(v.login.toLowerCase())) return false;
    if (r.audience === 'subscribers') return v.sub_tier > 0 || v.roles.subscriber || v.roles.broadcaster;
    if (r.audience === 'followers' && !v.roles.broadcaster) {
      const p = CROWD.find((c) => c.id === v.id);
      if (!p) return true;
      return p.followDays !== null && p.followDays >= r.min_follow_days;
    }
    return true;
  }

  function enter(v: Viewer, via: 'chat' | 'points') {
    const g = giveaway;
    if (!g?.open) return false;
    const e = g.entrants.find((x) => x.viewer.id === v.id);
    if (e) {
      if (via === 'points' && !g.settings.rules.one_entry) {
        e.entries += entriesFor(g, v);
        return true;
      }
      return false;
    }
    if (!allowed(g, v)) return false;
    g.entrants.push({ viewer: v, entries: entriesFor(g, v), joined_at: Date.now(), via });
    const s = g.settings;
    if (s.close_after_entries > 0 && g.entrants.length >= s.close_after_entries) close(g);
    return true;
  }

  function saidBefore(id: string) {
    return d
      .recentChat()
      .filter((c) => c.user?.id === id && c.data?.sent_by_castwright !== true)
      .slice(-3)
      .map((c) => ({ ts: c.ts, text: c.message ?? '' }));
  }

  function drawOne(g: Giveaway, now: number): Winner | null {
    const pool = g.entrants.filter((e) => !g.winners.some((w) => w.viewer.id === e.viewer.id));
    const i = pickWeighted(pool.map((e) => e.entries));
    if (i === null) return null;
    const e = pool[i]!;
    const w: Winner = {
      viewer: e.viewer,
      entries: e.entries,
      drawn_at: now,
      claim_until: g.settings.claim_s > 0 ? now + g.settings.claim_s * 1000 : null,
      state: 'drawn',
      said: saidBefore(e.viewer.id)
    };
    g.winners.push(w);
    return w;
  }

  function reel(g: Giveaway, winner: string): string[] {
    const names = g.entrants.map((e) => e.viewer.name).filter((n) => n !== winner);
    const out: string[] = [];
    for (let i = 0; i < 31 && names.length; i++) {
      let n = names[randomBelow(names.length)]!;
      if (names.length > 1 && out[out.length - 1] === n) n = names[randomBelow(names.length)]!;
      out.push(n);
    }
    out.push(winner);
    return out;
  }

  function setDraw(g: Giveaway, now: number) {
    const w = g.winners[g.winners.length - 1];
    draw = w ? { seq: g.draws, at: now, names: reel(g, w.viewer.name), winner: viewerJson(w.viewer) } : null;
  }

  /** Demo winners speak up after a moment, most of the time. */
  function maybeAnswer(w: Winner) {
    const p = CROWD.find((c) => c.id === w.viewer.id);
    if (!p || !d.simulate) return;
    const lines = ['wait I WON?? thank you!!', "I'm here! thanks so much", 'omg hi, here!'];
    if (randomBelow(5) < 4) later(1800 + randomBelow(1500), () => d.chat(p, lines[randomBelow(lines.length)]!));
  }

  const record = (g: Giveaway, ended: number): GiveawayRecord => ({
    id: g.id,
    title: g.settings.title,
    opened_at: g.opened_at,
    ended_at: ended,
    entrants: g.entrants.length,
    entries: g.entrants.reduce((a, e) => a + e.entries, 0),
    winners: g.winners.filter((w) => w.state === 'drawn' || w.state === 'claimed').map((w) => w.viewer.name)
  });

  function store(g: Giveaway, ended: number) {
    const r = record(g, ended);
    const i = history.findIndex((h) => h.id === r.id);
    if (i >= 0) history[i] = r;
    else history.unshift(r);
  }

  function crowdJoins(word: (p: CrowdPerson) => string, count: number, gap: (i: number) => number, still: () => boolean) {
    let at = 600;
    const people = CROWD.slice(0, count);
    people.forEach((p, i) => {
      at += gap(i);
      later(at, () => {
        if (still()) d.chat(p, word(p));
      });
    });
  }

  function stopSim() {
    for (const t of timers) clearTimeout(t);
    timers = [];
  }

  function onChat(e: Event) {
    if (e.kind !== 'chat' || e.data?.sent_by_castwright === true) return;
    const v = viewerOf(e);
    if (!v || BOTS.includes(v.login.toLowerCase())) return;
    const text = (e.message ?? '').trim();
    const now = Date.now();
    let dirty = false;
    for (const w of giveaway?.winners ?? []) {
      if (w.viewer.id !== v.id || w.state === 'rerolled') continue;
      w.said = [...w.said, { ts: now, text }].slice(-5);
      if (w.state === 'drawn' && w.claim_until !== null && now <= w.claim_until) {
        w.state = 'claimed';
        w.claim_until = null;
      }
      dirty = true;
    }
    if (giveaway?.open && giveaway.settings.keyword.trim() && commandRest(text, giveaway.settings.keyword) !== null) {
      if (enter(v, 'chat') || dirty) changed();
      return;
    }
    const qs = d.queueSettings();
    const join = commandRest(text, qs.join_word);
    if (join !== null) {
      queueJoin(v, join, now);
      return;
    }
    if (commandRest(text, qs.leave_word) !== null) {
      const before = queue.waiting.length;
      queue.waiting = queue.waiting.filter((x) => x.viewer.id !== v.id);
      if (queue.waiting.length !== before) {
        say(qs.messages.left, { name: v.name });
        dirty = true;
      }
    } else if (commandRest(text, qs.position_word) !== null) {
      const p = position(v.id);
      if (p === null) d.say(`@${v.name} you're not in the queue.`);
      else say(qs.messages.position, { name: v.name, position: p });
    }
    if (dirty) changed();
  }

  function queueJoin(v: Viewer, rest: string, now: number) {
    const qs = d.queueSettings();
    const note = qs.notes ? [...rest.trim()].slice(0, 40).join('').trim() : '';
    const have = queue.waiting.find((x) => x.viewer.id === v.id);
    if (have) {
      if (note && note !== have.note) {
        have.note = note;
        changed();
      }
      say(qs.messages.position, { name: v.name, position: position(v.id) });
      return;
    }
    if (queue.playing.some((x) => x.viewer.id === v.id) || !queue.open) return;
    if (qs.max_size > 0 && queue.waiting.length >= qs.max_size) {
      d.say(`@${v.name} the queue is full right now.`);
      return;
    }
    const sub = v.sub_tier > 0 || v.roles.subscriber;
    const entry: QueueEntry = { viewer: v, note, sub, joined_at: now };
    if (qs.sub_priority === 'first' && sub) {
      let at = 0;
      queue.waiting.forEach((x, i) => {
        if (x.sub) at = i + 1;
      });
      queue.waiting.splice(at, 0, entry);
    } else queue.waiting.push(entry);
    const pos = position(v.id) ?? queue.waiting.length;
    const quiet = batch.last === null || now - batch.last >= 3000;
    if (!batch.pending.length && quiet) {
      batch.last = now;
      say(qs.messages.joined, { name: v.name, position: pos });
    } else {
      if (!batch.pending.length) batch.since = now;
      batch.pending.push([v.name, pos]);
    }
    changed();
  }

  function take(idx: number[]): QueueEntry[] {
    const picked = idx.map((i) => queue.waiting[i]!);
    const drop = new Set(idx);
    queue.waiting = queue.waiting.filter((_, i) => !drop.has(i));
    queue.playing = picked;
    return picked;
  }

  function picked(list: QueueEntry[]) {
    if (!list.length) return;
    say(d.queueSettings().messages.up, { players: nameList(list.map((e) => `@${e.viewer.name}`), 20) });
  }

  const current = () => giveaway ?? fail('No giveaway is running.');

  const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
    play_state: () => state(),
    save_giveaway_settings: ({ settings }) => {
      d.setGiveawaySettings(settings as GiveawaySettings);
      d.emit('cw://play', state());
      return settings;
    },
    giveaway_open: ({ settings }) => {
      const s = settings as GiveawaySettings;
      const issues = Object.values(giveawayIssues(s));
      if (issues.length) fail(issues[0]!);
      if (giveaway?.open) fail('A giveaway is already taking entries. Close it first.');
      if (giveaway) store(giveaway, Date.now());
      d.setGiveawaySettings(s);
      stopSim();
      const g: Giveaway = { id: d.uid(), settings: s, open: true, opened_at: Date.now(), closed_at: null, entrants: [], winners: [], draws: 0 };
      giveaway = g;
      draw = null;
      store(g, 0);
      say(s.messages.opened, ctxOf(g));
      if (d.simulate && s.keyword.trim()) {
        crowdJoins(
          () => (randomBelow(6) === 0 ? `${s.keyword.trim()} please!` : s.keyword.trim()),
          CROWD.length,
          (i) => (i < 10 ? 380 : 900 + randomBelow(900)),
          () => giveaway === g && g.open
        );
      }
      changed();
      return g;
    },
    giveaway_set_open: ({ open }) => {
      const g = current();
      if (open && !g.open) {
        g.open = true;
        g.closed_at = null;
      } else if (!open) close(g);
      store(g, 0);
      changed();
      return g;
    },
    giveaway_draw: ({ count }) => {
      const g = current();
      if (!g.entrants.length) fail('Nobody has entered yet.');
      const now = Date.now();
      const n = Math.min(50, Math.max(1, Number(count) || 1));
      const drawn: Winner[] = [];
      for (let i = 0; i < n; i++) {
        const w = drawOne(g, now);
        if (!w) break;
        drawn.push(w);
      }
      if (!drawn.length) fail('Everyone who entered has already won.');
      g.draws++;
      close(g);
      for (const w of drawn) {
        say(g.settings.messages.winner, ctxOf(g, w.viewer.name));
        maybeAnswer(w);
      }
      setDraw(g, now);
      store(g, 0);
      changed();
      return g;
    },
    giveaway_reroll: ({ userId }) => {
      const g = current();
      const old = g.winners.find((w) => w.viewer.id === userId && w.state !== 'rerolled');
      if (!old) fail('That person isn\'t a winner.');
      old!.state = 'rerolled';
      old!.claim_until = null;
      const now = Date.now();
      const w = drawOne(g, now);
      if (!w) {
        changed();
        fail('Nobody is left to draw.');
      }
      g.draws++;
      say(g.settings.messages.reroll, ctxOf(g, w!.viewer.name, old!.viewer.name));
      maybeAnswer(w!);
      setDraw(g, now);
      store(g, 0);
      changed();
      return g;
    },
    giveaway_claim: ({ userId }) => {
      const g = current();
      const w = g.winners.find((x) => x.viewer.id === userId && x.state !== 'rerolled') ?? fail('That person isn\'t a winner.');
      w.state = 'claimed';
      w.claim_until = null;
      changed();
      return g;
    },
    giveaway_remove: ({ userId }) => {
      const g = current();
      g.entrants = g.entrants.filter((e) => e.viewer.id !== userId);
      changed();
      return g;
    },
    giveaway_finish: () => {
      if (!giveaway) return null;
      stopSim();
      const r = record(giveaway, Date.now());
      store(giveaway, r.ended_at);
      giveaway = null;
      draw = null;
      changed();
      return r;
    },
    giveaway_history: ({ limit }) => history.slice(0, Number(limit) || 200),
    giveaway_delete_record: ({ id }) => {
      if (giveaway?.id === id) fail('Finish the giveaway before deleting it.');
      const i = history.findIndex((h) => h.id === id);
      if (i >= 0) history.splice(i, 1);
    },
    save_queue_settings: ({ settings }) => {
      const s = settings as QueueSettings;
      const issues = Object.values(queueIssues(s));
      if (issues.length) fail(issues[0]!);
      d.setQueueSettings(s);
      changed();
      return s;
    },
    queue_set_open: ({ open }) => {
      queue.open = Boolean(open);
      if (queue.open && d.simulate && !queue.waiting.length) {
        const word = d.queueSettings().join_word.trim();
        const people = CROWD.length - 14;
        crowdJoins((p) => (d.queueSettings().notes && randomBelow(3) > 0 ? `${word} ${p.ign}` : word), people, (i) => (i < 4 ? 500 : 1400 + randomBelow(1200)), () => queue.open);
      }
      changed();
      return queue;
    },
    queue_next: ({ count, random }) => {
      const s = d.queueSettings();
      if (!queue.waiting.length) fail('Nobody is waiting.');
      const n = Math.min(50, Math.max(1, Number(count) || s.party_size));
      let list: QueueEntry[];
      if (random) {
        const idx = queue.waiting.map((_, i) => i);
        for (let i = idx.length - 1; i > 0; i--) {
          const j = randomBelow(i + 1);
          [idx[i], idx[j]] = [idx[j]!, idx[i]!];
        }
        list = take(idx.slice(0, n));
      } else {
        const ord = order().slice(0, n);
        if (s.sub_priority === 'lane' && ord.length) queue.sub_turn = !queue.waiting[ord[ord.length - 1]!]!.sub;
        list = take(ord);
      }
      picked(list);
      changed();
      return list;
    },
    queue_remove: ({ userId }) => {
      queue.waiting = queue.waiting.filter((e) => e.viewer.id !== userId);
      queue.playing = queue.playing.filter((e) => e.viewer.id !== userId);
      changed();
      return queue;
    },
    queue_clear: () => {
      queue.waiting = [];
      queue.playing = [];
      queue.sub_turn = false;
      changed();
      return queue;
    },
    queue_move: ({ userId, before }) => {
      const from = queue.waiting.findIndex((e) => e.viewer.id === userId);
      if (from >= 0 && before !== userId) {
        const [e] = queue.waiting.splice(from, 1);
        const at = before ? queue.waiting.findIndex((x) => x.viewer.id === before) : -1;
        queue.waiting.splice(at < 0 ? queue.waiting.length : at, 0, e!);
      }
      changed();
      return queue;
    },
    queue_note: ({ userId, note }) => {
      const e = [...queue.waiting, ...queue.playing].find((x) => x.viewer.id === userId);
      if (e) e.note = [...String(note).trim()].slice(0, 40).join('').trim();
      changed();
      return queue;
    }
  };

  publishVars();

  return {
    handlers,
    onEvent(e: Event) {
      if (e.kind === 'chat') onChat(e);
      else if (e.kind === 'redemption' && giveaway?.open && giveaway.settings.reward_id && e.data?.reward_id === giveaway.settings.reward_id) {
        const v = viewerOf(e);
        if (v && enter(v, 'points')) changed();
      }
    }
  };
}
