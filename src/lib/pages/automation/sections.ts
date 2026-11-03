// Sections of the action list.
import type { Action } from '$lib/bindings/Action';
import { describeTriggers } from './describe';

export const SECTIONS = ['Chat commands', 'Stream events', 'Timers', 'Buttons and Stream Deck'] as const;

/** The action's own group, or a section picked from its first trigger when the group is left at General. */
export function sectionOf(a: Action): string {
  const g = a.group.trim();
  if (g && g !== 'General') return g;
  switch (a.triggers[0]?.type) {
    case 'command':
      return 'Chat commands';
    case 'timer':
      return 'Timers';
    case 'event':
    case 'stream_online':
    case 'stream_offline':
    case 'scene_changed':
    case 'redemption':
    case 'poll_begin':
    case 'poll_end':
    case 'prediction_begin':
    case 'prediction_end':
    case 'ad_soon':
    case 'ad_begin':
    case 'ad_end':
    case 'song_changed':
      return 'Stream events';
    default:
      return 'Buttons and Stream Deck';
  }
}

export function matches(a: Action, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [a.name, a.group, describeTriggers(a)].some((s) => s.toLowerCase().includes(q));
}

/** Built-in sections first, then the user's own groups by name. Empty sections are left out. */
export function groupActions(actions: readonly Action[], query = ''): Array<{ name: string; actions: Action[] }> {
  const map = new Map<string, Action[]>();
  for (const a of actions) {
    if (!matches(a, query)) continue;
    const s = sectionOf(a);
    map.set(s, [...(map.get(s) ?? []), a]);
  }
  const rank = (n: string) => {
    const i = (SECTIONS as readonly string[]).indexOf(n);
    return i < 0 ? SECTIONS.length : i;
  };
  return [...map.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([name, list]) => ({ name, actions: list }));
}
