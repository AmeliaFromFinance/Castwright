// Giveaway and queue layers, read from the giveaway.* and queue.* variables.
import type { Event } from '$lib/bindings/Event';
import type { UserRoles } from '$lib/bindings/UserRoles';

export type GiveawayStatus = 'idle' | 'open' | 'closed';

export interface DrawViewer {
  id: string;
  login: string;
  name: string;
  color: string;
  badges: string[];
  badge_images: unknown[];
  roles: UserRoles;
}

export interface Draw {
  /** Goes up by one per draw; a new value starts a spin. */
  seq: number;
  /** When it was drawn (ms). */
  at: number;
  /** Names to spin through, the winner last. */
  names: string[];
  winner: DrawViewer;
}

export interface GiveawayView {
  status: GiveawayStatus;
  title: string;
  entries: number;
  keyword: string;
  draw: Draw | null;
}

export interface QueueRow {
  id: string;
  login: string;
  name: string;
  color: string;
  note: string;
  sub: boolean;
  position: number | null;
}

export interface QueueView {
  open: boolean;
  size: number;
  playing: QueueRow[];
  lineup: QueueRow[];
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const NO_ROLES: UserRoles = { broadcaster: false, moderator: false, vip: false, subscriber: false };

function drawViewer(v: unknown): DrawViewer | null {
  const o = obj(v);
  const name = str(o.name) || str(o.login);
  if (!name) return null;
  const r = obj(o.roles);
  return {
    id: str(o.id),
    login: str(o.login),
    name,
    color: str(o.color),
    badges: list(o.badges).filter((b): b is string => typeof b === 'string'),
    badge_images: list(o.badge_images),
    roles: { broadcaster: r.broadcaster === true, moderator: r.moderator === true, vip: r.vip === true, subscriber: r.subscriber === true }
  };
}

export function drawFromVar(v: unknown): Draw | null {
  const o = obj(v);
  const winner = drawViewer(o.winner);
  if (!winner) return null;
  const names = list(o.names).filter((n): n is string => typeof n === 'string' && n.length > 0);
  if (names[names.length - 1] !== winner.name) names.push(winner.name);
  return { seq: num(o.seq), at: num(o.at), names, winner };
}

export function giveawayFromVars(vars: Record<string, unknown>): GiveawayView {
  const s = str(vars['giveaway.status']);
  const status: GiveawayStatus = s === 'open' || s === 'closed' ? s : 'idle';
  return {
    status,
    title: str(vars['giveaway.title']),
    entries: num(vars['giveaway.entries']),
    keyword: str(vars['giveaway.keyword']),
    draw: status === 'idle' ? null : drawFromVar(vars['giveaway.draw'])
  };
}

export const GIVEAWAY_TOKENS = [
  { token: 'keyword', label: 'Chat word to enter' },
  { token: 'entries', label: 'People who entered' },
  { token: 'title', label: 'The prize' }
];

/** Shown in the editor while no giveaway runs: landed on a winner, or spinning from `spinAt`. */
export function sampleGiveaway(now: number, spinAt = 0): GiveawayView {
  return {
    status: 'closed',
    title: 'Steam game key',
    entries: 42,
    keyword: '!join',
    draw: {
      seq: spinAt ? 2 : 1,
      at: spinAt || now - 60_000,
      names: ['pixelbyte', 'm0ss', 'quietfox', 'Tomasz', 'LumenLark', 'kettle_drum', 'raiding_rudy', 'pixelbyte', 'm0ss', 'quietfox', 'LumenLark', 'Tomasz', 'raiding_rudy', 'kettle_drum', 'pixelbyte', 'nova_kat'],
      winner: {
        id: '1000',
        login: 'nova_kat',
        name: 'nova_kat',
        color: '#C9B3FF',
        badges: ['subscriber'],
        badge_images: [],
        roles: { ...NO_ROLES, subscriber: true }
      }
    }
  };
}

export function giveawayVisible(view: GiveawayView, hideIdle: boolean): boolean {
  return view.status !== 'idle' || !hideIdle;
}

export type SpinPhase = 'spinning' | 'landed';

/** Where a draw is now. Draws older than the spin (a reloaded page) just show the winner. */
export function spinPhase(draw: Draw, now: number, spinMs: number): SpinPhase {
  return now - draw.at < spinMs && now >= draw.at - 1000 ? 'spinning' : 'landed';
}

/** Spin time, from the layer setting in seconds. */
export function spinMs(spinS: number): number {
  return Math.round(Math.min(30, Math.max(1, Number.isFinite(spinS) ? spinS : 6)) * 1000);
}

/** Ease-out: fast at first, slowing onto the winner. Matches the CSS curve closely enough for resuming. */
export function easeOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 4);
}

/** Distance in rows the strip has moved after `elapsed` of a spin over `rows` names. */
export function reelOffset(rows: number, elapsed: number, total: number): number {
  if (rows <= 1 || total <= 0) return 0;
  return easeOut(elapsed / total) * (rows - 1);
}

/** A chat-event shape for badge and name helpers. */
export function viewerEvent(v: DrawViewer): Event {
  return {
    id: `draw-${v.id}`,
    kind: 'chat',
    ts: 0,
    user: { id: v.id, login: v.login, display_name: v.name },
    amount: null,
    currency: null,
    tier: null,
    months: null,
    message: null,
    message_parts: [],
    roles: v.roles,
    is_gift: false,
    is_anonymous: false,
    recipient: null,
    data: { color: v.color, badges: v.badges, badge_images: v.badge_images },
    test: false
  };
}

function queueRow(v: unknown): QueueRow | null {
  const o = obj(v);
  const name = str(o.name) || str(o.login);
  if (!name) return null;
  return {
    id: str(o.id),
    login: str(o.login),
    name,
    color: str(o.color),
    note: str(o.note),
    sub: o.sub === true,
    position: typeof o.position === 'number' ? o.position : null
  };
}

export function queueFromVars(vars: Record<string, unknown>): QueueView {
  const rows = (v: unknown) => list(v).map(queueRow).filter((r): r is QueueRow => r !== null);
  return {
    open: vars['queue.open'] === true,
    size: num(vars['queue.size']),
    playing: rows(vars['queue.party']),
    lineup: rows(vars['queue.lineup'])
  };
}

export function sampleQueue(): QueueView {
  const row = (name: string, color: string, note: string, sub: boolean, position: number | null): QueueRow => ({
    id: name,
    login: name.toLowerCase(),
    name,
    color,
    note,
    sub,
    position
  });
  return {
    open: true,
    size: 6,
    playing: [row('nova_kat', '#C9B3FF', 'NovaKat#2231', true, null), row('raiding_rudy', '#9EF08A', 'Rudy#0042', false, null)],
    lineup: [
      row('pixelbyte', '#7FDBFF', 'pxl#7781', true, 1),
      row('m0ss', '#F5C451', '', false, 2),
      row('quietfox', '#FFB86B', 'qfox#1203', false, 3),
      row('LumenLark', '#8AB4FF', 'Lark#5550', true, 4),
      row('Tomasz', '#FF8A8A', '', false, 5),
      row('kettle_drum', '#E59BFF', 'kettle#9', false, 6)
    ]
  };
}

export function queueVisible(view: QueueView, hideEmpty: boolean, showPlaying: boolean, nextCount: number): boolean {
  if (!hideEmpty) return true;
  return (showPlaying && view.playing.length > 0) || (nextCount > 0 && view.lineup.length > 0);
}
