// Fitting status bar items into the space there is. Items shorten to their
// compact form first, lowest priority first, then fold into the More button.

import type { Snippet } from 'svelte';

export type Group = 'stream' | 'app';
export type Mode = 'full' | 'compact' | 'hidden';

export interface StatusItem {
  id: string;
  group: Group;
  /** Higher stays longer. See PRIORITY. */
  priority: number;
  /** Never folds into More. Can still go compact. */
  critical?: boolean;
  full: Snippet;
  compact?: Snippet;
}

/** Hide order: lowest first. */
export const PRIORITY = {
  version: 10,
  demo: 20,
  dropped: 30,
  fps: 40,
  cpu: 50,
  bitrate: 60,
  server: 70,
  golive: 80,
  health: 90,
  alerts: 91,
  ads: 92,
  update: 93,
  critical: 100
} as const;

export interface FitItem {
  id: string;
  priority: number;
  critical?: boolean;
  /** Width of the full form, with the gap after it. */
  full: number;
  /** Width of the compact form, if there is one. */
  compact?: number;
}

export interface Space {
  /** Width of the bar. */
  available: number;
  /** The More button, with its gap. Only counted once something is hidden. */
  more: number;
  /** Fixed parts, like the separator between groups. */
  extra?: number;
}

export interface Fit {
  modes: Record<string, Mode>;
  /** Hidden ids, in item order. */
  hidden: string[];
  /** How many steps were taken. Used for hysteresis. */
  level: number;
  /** Which steps were possible. A different key resets hysteresis. */
  key: string;
}

/** Extra room needed before the bar grows back, so it doesn't flicker at the edge. */
export const HYSTERESIS = 24;

interface Step {
  id: string;
  to: 'compact' | 'hidden';
}

function steps(items: FitItem[]): Step[] {
  const byPriority = (list: FitItem[]) =>
    list
      .map((it, i) => ({ it, i }))
      // Same priority: the later item gives way first.
      .sort((a, b) => a.it.priority - b.it.priority || b.i - a.i)
      .map(({ it }) => it);
  const compact = byPriority(items.filter((it) => it.compact !== undefined && it.compact < it.full)).map((it) => ({ id: it.id, to: 'compact' as const }));
  const hide = byPriority(items.filter((it) => !it.critical)).map((it) => ({ id: it.id, to: 'hidden' as const }));
  return [...compact, ...hide];
}

function apply(items: FitItem[], list: Step[], level: number): Record<string, Mode> {
  const modes: Record<string, Mode> = {};
  for (const it of items) modes[it.id] = 'full';
  for (const s of list.slice(0, level)) modes[s.id] = s.to;
  return modes;
}

function width(items: FitItem[], modes: Record<string, Mode>, space: Space): number {
  let w = space.extra ?? 0;
  let hidden = false;
  for (const it of items) {
    const m = modes[it.id];
    if (m === 'hidden') hidden = true;
    else w += m === 'compact' ? (it.compact ?? it.full) : it.full;
  }
  return hidden ? w + space.more : w;
}

/**
 * Which items show in full, compact or not at all. Pass the last result as
 * `prev` so the bar only grows back once there's clearly room.
 */
export function fit(items: FitItem[], space: Space, prev?: Fit | null, hysteresis = HYSTERESIS): Fit {
  const list = steps(items);
  const key = list.map((s) => `${s.to[0]}:${s.id}`).join(',');
  const widths = list.map((_, k) => width(items, apply(items, list, k), space));
  widths.push(width(items, apply(items, list, list.length), space));
  const first = (available: number) => {
    const k = widths.findIndex((w) => w <= available);
    return k === -1 ? list.length : k;
  };

  let level = first(space.available);
  if (prev && prev.key === key && level < prev.level) level = Math.min(prev.level, first(space.available - hysteresis));

  const modes = apply(items, list, level);
  // Hiding can free enough room to show compacted items in full again, most important first.
  const same = prev?.key === key;
  let used = widths[level]!;
  const compacted = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => modes[it.id] === 'compact')
    .sort((a, b) => b.it.priority - a.it.priority || a.i - b.i);
  for (const { it } of compacted) {
    const grow = it.full - (it.compact ?? it.full);
    const margin = same && prev?.modes[it.id] !== 'full' ? hysteresis : 0;
    if (used + grow <= space.available - margin) {
      modes[it.id] = 'full';
      used += grow;
    }
  }
  return { modes, hidden: items.filter((it) => modes[it.id] === 'hidden').map((it) => it.id), level, key };
}

/** 6020 -> "6.0 Mb/s". Under 1000 stays in kb/s. */
export function shortBitrate(kbps: number): string {
  if (kbps < 1000) return `${Math.round(kbps)} kb/s`;
  return `${(kbps / 1000).toFixed(1)} Mb/s`;
}
