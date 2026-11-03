// The hype train, read from the hype.* variables.
import { render } from '$lib/logic/template';

export type HypeType = 'regular' | 'golden_kappa' | 'treasure';

export interface Contributor {
  name: string;
  total: number;
}

export interface HypeTrain {
  active: boolean;
  level: number;
  progress: number;
  goal: number;
  total: number;
  /** ms since the epoch; 0 when unknown. */
  endsAt: number;
  type: HypeType;
  shared: boolean;
  sharedWith: string;
  topBits: Contributor | null;
  topSub: Contributor | null;
  lastLevel: number;
  endedAt: number;
}

export type HypePhase = { phase: 'running'; train: HypeTrain } | { phase: 'ended'; train: HypeTrain };

/** Events can arrive a little after the time runs out; keep showing the train that long. */
export const LATE_MS = 10_000;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const TYPES: readonly HypeType[] = ['regular', 'golden_kappa', 'treasure'];

function contributor(name: unknown, total: unknown): Contributor | null {
  const n = str(name).trim();
  return n ? { name: n, total: num(total) } : null;
}

/** Null before any hype train was seen. */
export function hypeFromVars(vars: Record<string, unknown>): HypeTrain | null {
  if (!('hype.active' in vars)) return null;
  const type = str(vars['hype.type']) as HypeType;
  return {
    active: vars['hype.active'] === true,
    level: Math.max(1, num(vars['hype.level'])),
    progress: Math.max(0, num(vars['hype.progress'])),
    goal: Math.max(0, num(vars['hype.goal'])),
    total: Math.max(0, num(vars['hype.total'])),
    endsAt: num(vars['hype.ends_at']),
    type: TYPES.includes(type) ? type : 'regular',
    shared: vars['hype.shared'] === true,
    sharedWith: str(vars['hype.shared_with']),
    topBits: contributor(vars['hype.top_bits_name'], vars['hype.top_bits']),
    topSub: contributor(vars['hype.top_sub_name'], vars['hype.top_subs']),
    lastLevel: num(vars['hype.last_level']),
    endedAt: num(vars['hype.ended_at'])
  };
}

/** 0 to 1, toward the next level. */
export function hypeFraction(progress: number, goal: number): number {
  if (!(goal > 0) || !Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress / goal));
}

/** Whole seconds left, never below 0. */
export function secondsLeft(endsAt: number, now: number): number {
  return endsAt > 0 ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : 0;
}

/** Running, just ended (for `afterS` seconds), or nothing to show. */
export function hypePhase(t: HypeTrain | null, now: number, afterS: number): HypePhase | null {
  if (!t) return null;
  if (t.active && (t.endsAt <= 0 || now < t.endsAt + LATE_MS)) return { phase: 'running', train: t };
  if (!t.active && t.lastLevel > 0 && t.endedAt > 0 && now - t.endedAt < Math.max(0, afterS) * 1000) return { phase: 'ended', train: t };
  return null;
}

export const TYPE_LABELS: Record<HypeType, string> = {
  regular: 'Hype train',
  golden_kappa: 'Golden Kappa train',
  treasure: 'Treasure train'
};

/** "Shared hype train" and friends. */
export function trainLabel(t: Pick<HypeTrain, 'type' | 'shared'>): string {
  const label = TYPE_LABELS[t.type];
  return t.shared ? `Shared ${label.charAt(0).toLowerCase()}${label.slice(1)}` : label;
}

export function endText(template: string, t: HypeTrain): string {
  return render(template, { level: t.lastLevel || t.level, total: t.total }).trim();
}

/** True when `level` went up from `prev` on the same running train. */
export function isLevelUp(prev: number | null, level: number): boolean {
  return prev !== null && level > prev;
}

/**
 * A train for the editor while none runs. The time loops every 5 minutes and the
 * bar fills over it; `bumps` raises the level, for "Show level up".
 */
export function sampleHype(now: number, bumps = 0): HypeTrain {
  const span = 300_000;
  const into = now % span;
  return {
    active: true,
    level: 3 + bumps,
    progress: Math.round(320 + (into / span) * 480),
    goal: 1000,
    total: 4_820 + bumps * 1000,
    endsAt: now - into + span,
    type: 'regular',
    shared: false,
    sharedWith: '',
    topBits: { name: 'pixelbyte', total: 2_500 },
    topSub: { name: 'nova_kat', total: 5 },
    lastLevel: 0,
    endedAt: 0
  };
}
