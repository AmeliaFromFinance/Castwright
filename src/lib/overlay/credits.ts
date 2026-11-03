// Credits layer: which names show, in what order, and how the roll moves.
// Names come from src-tauri/src/sessions/stats.rs (`credits`).
import type { CreditKind } from '$lib/bindings/CreditKind';
import type { CreditName } from '$lib/bindings/CreditName';
import type { Credits } from '$lib/bindings/Credits';
import type { CreditSection } from '$lib/bindings/CreditSection';

export const CREDIT_TITLES: Record<CreditKind, string> = {
  followers: 'New followers',
  subscribers: 'Subscribers',
  gifters: 'Gifted subs',
  cheerers: 'Cheers',
  raiders: 'Raids',
  moderators: 'Moderators',
  vips: 'VIPs',
  chatters: 'Top chatters'
};

export const CREDIT_KINDS = Object.keys(CREDIT_TITLES) as CreditKind[];

export function defaultCreditSections(): CreditSection[] {
  return CREDIT_KINDS.map((kind) => ({ kind, title: CREDIT_TITLES[kind], on: true }));
}

export function emptyCredits(): Credits {
  return { session_id: 0, followers: [], subscribers: [], gifters: [], cheerers: [], raiders: [], moderators: [], vips: [], chatters: [] };
}

export interface CreditRow extends CreditName {
  /** "14 months", "5 gifts", "1,000 bits"... Empty when there's nothing to add. */
  note: string;
}

export interface CreditBlock {
  kind: CreditKind;
  title: string;
  rows: CreditRow[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

export function creditNote(kind: CreditKind, amount: number): string {
  const n = Math.round(amount);
  if (!(n > 0)) return '';
  switch (kind) {
    case 'subscribers':
      return plural(n, 'month');
    case 'gifters':
      return plural(n, 'gift');
    case 'cheerers':
      return plural(n, 'bit');
    case 'raiders':
      return plural(n, 'viewer');
    case 'chatters':
      return plural(n, 'message');
    default:
      return '';
  }
}

export interface BlockOptions {
  maxChatters: number;
  showAmounts: boolean;
}

/** The sections to show, in the layer's order. Turned-off and empty sections are left out. */
export function creditBlocks(credits: Credits | null, sections: readonly CreditSection[], o: BlockOptions): CreditBlock[] {
  if (!credits) return [];
  const out: CreditBlock[] = [];
  const seen = new Set<CreditKind>();
  for (const s of sections) {
    if (!s.on || seen.has(s.kind) || !(s.kind in CREDIT_TITLES)) continue;
    seen.add(s.kind);
    let names = credits[s.kind] ?? [];
    if (s.kind === 'chatters') names = names.slice(0, Math.max(0, o.maxChatters));
    if (!names.length) continue;
    out.push({
      kind: s.kind,
      title: s.title.trim(),
      rows: names.map((n) => ({ ...n, note: o.showAmounts ? creditNote(s.kind, n.amount) : '' }))
    });
  }
  return out;
}

export interface RollPlan {
  /** translateY at the start and the end, in px. */
  from: number;
  to: number;
  ms: number;
}

/**
 * One pass of the roll. It starts just below the box. Repeating rolls end once
 * everything has left the top; others stop with the end in view (centred if it all fits).
 */
export function rollPlan(boxH: number, contentH: number, o: { speed: number; fitS: number; repeat: boolean }): RollPlan {
  const from = Math.max(0, boxH);
  const h = Math.max(0, contentH);
  const to = o.repeat ? -h : h > boxH ? boxH - h : (boxH - h) / 2;
  const distance = from - to;
  const ms = o.fitS > 0 ? o.fitS * 1000 : (distance / Math.max(1, o.speed)) * 1000;
  return { from, to, ms: Math.max(1, Math.round(ms)) };
}

/** translateY `elapsed` ms into a roll. Repeating rolls start over; others hold at the end. */
export function rollOffset(plan: RollPlan, elapsed: number, repeat: boolean): number {
  const t = Math.max(0, elapsed);
  const p = repeat ? (t % plan.ms) / plan.ms : Math.min(1, t / plan.ms);
  return plan.from + (plan.to - plan.from) * p;
}

/**
 * Pages for reduced motion: where each page starts, from the top and height of every
 * item. A page holds as many whole items as fit; an item taller than the box gets its own.
 */
export function pageStarts(items: ReadonlyArray<{ top: number; height: number }>, boxH: number): number[] {
  const sorted = items.filter((i) => i.height > 0).slice().sort((a, b) => a.top - b.top);
  if (!sorted.length) return [0];
  const out = [Math.min(0, sorted[0]!.top)];
  for (const it of sorted) {
    const start = out[out.length - 1]!;
    if (it.top > start && it.top + it.height - start > boxH) out.push(it.top);
  }
  return out;
}

const NAMES: Array<[string, string]> = [
  ['nova_kat', '1000'],
  ['pixelbyte', '1001'],
  ['raiding_rudy', '1002'],
  ['m0ss', '1003'],
  ['Tomasz', '1004'],
  ['quietfox', '1005'],
  ['LumenLark', '1006'],
  ['kettle_drum', '1007'],
  ['Saffron', ''],
  ['OrbitalOtter', ''],
  ['Juniper', ''],
  ['frostbyte', '']
];

function person(i: number, amount = 0): CreditName {
  const [name, user_id] = NAMES[i % NAMES.length]!;
  return { name, login: name.toLowerCase(), user_id, amount };
}

/** Names the editor shows while there's no stream to take them from. */
export function sampleCredits(): Credits {
  return {
    session_id: 0,
    followers: [8, 4, 9, 6, 11].map((i) => person(i)),
    subscribers: [person(5), person(0, 14), person(3, 3)],
    gifters: [person(2, 5), person(7, 1)],
    cheerers: [person(1, 1000), person(4, 250)],
    raiders: [person(2, 42)],
    moderators: [person(1)],
    vips: [person(3)],
    chatters: [person(0, 84), person(5, 61), person(1, 40), person(10, 22)]
  };
}

export function hasCreditNames(c: Credits | null | undefined): boolean {
  return !!c && CREDIT_KINDS.some((k) => (c[k]?.length ?? 0) > 0);
}
