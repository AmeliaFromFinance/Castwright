// Searchable list of triggers and steps for the add menus.
import { fuzzyScore } from '$lib/shell/fuzzy';
import { STEP_GROUPS, STEP_LABELS, TRIGGER_MENU, type StepType, type TriggerType } from './defaults';

export type Entry =
  | { kind: 'step'; type: StepType; label: string; group: string; hint?: string; keywords: string }
  | { kind: 'trigger'; type: TriggerType; label: string; group: string; hint?: string; keywords: string };

/** Other words people may type. */
const KEYWORDS: Partial<Record<StepType | TriggerType, string>> = {
  chat_send: 'say post reply message text bot',
  chat_announce: 'announce highlight message',
  shoutout: 'so shout raid',
  create_clip: 'clip record moment',
  create_marker: 'marker highlight vod',
  run_ad: 'ad commercial break',
  snooze_ad: 'ad delay later',
  set_stream_info: 'title game category',
  timeout_user: 'ban mute mod',
  delete_message: 'remove mod',
  set_chat_mode: 'slow emote followers subscribers shield',
  delay: 'wait sleep pause timer seconds',
  set_variable: 'var store save value',
  add_to_variable: 'var counter count increment plus',
  switch_scene: 'obs scene change',
  set_source_visible: 'obs show hide source',
  set_input_mute: 'obs mute audio mic',
  recording: 'obs record',
  save_replay: 'obs replay buffer',
  set_layer_visible: 'overlay show hide layer',
  play_sound: 'audio sfx',
  play_soundboard_sound: 'audio sfx',
  http_request: 'web url api fetch get post webhook',
  run_script: 'code rhai script',
  if: 'condition branch check else otherwise when',
  run_action: 'call action chain',
  stop: 'end exit halt',
  log: 'debug print',
  post_to_discord: 'webhook message',
  command: 'chat ! command',
  event: 'follow sub raid cheer bits gift',
  redemption: 'points reward',
  timer: 'interval repeat every',
  manual: 'button stream deck web'
};

export const ENTRIES: Entry[] = [
  ...STEP_GROUPS.flatMap((g) =>
    g.items.map(([type, hint]): Entry => ({ kind: 'step', type, label: STEP_LABELS[type], group: g.label, hint, keywords: KEYWORDS[type] ?? '' }))
  ),
  ...TRIGGER_MENU.flatMap((g) =>
    g.items.map((it): Entry => ({ kind: 'trigger', type: it.value, label: it.label, group: 'Triggers', hint: it.hint, keywords: KEYWORDS[it.value] ?? '' }))
  )
];

export const entryKey = (e: Pick<Entry, 'kind' | 'type'>): string => `${e.kind}:${e.type}`;

/**
 * Entries that match `query`, best first. The name counts most, then the group,
 * the extra words and the hint. `prefer` ranks that kind a little higher.
 */
export function searchEntries(entries: readonly Entry[], query: string, prefer: Entry['kind'] = 'step'): Entry[] {
  const q = query.trim();
  if (!q) return [...entries];
  const score = (e: Entry): number | null => {
    const parts = [
      [e.label, 1],
      [e.group, 0.8],
      [e.keywords, 0.7],
      [e.hint ?? '', 0.6]
    ] as const;
    const hits = parts.flatMap(([text, w]) => {
      const s = text ? fuzzyScore(q, text) : null;
      return s === null ? [] : [s * w];
    });
    if (!hits.length) return null;
    // The best field counts in full; others matching too break ties.
    const best = Math.max(...hits);
    const rest = hits.reduce((a, b) => a + b, 0) - best;
    return (best + rest * 0.1) * (e.kind === prefer ? 1 : 0.9);
  };
  return entries
    .map((e, i) => ({ e, i, s: score(e) }))
    .filter((x): x is { e: Entry; i: number; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.e);
}

export const RECENT_MAX = 5;

/** Most recent first, no repeats. */
export function addRecent(list: readonly string[], key: string, max = RECENT_MAX): string[] {
  return [key, ...list.filter((k) => k !== key)].slice(0, max);
}

/** Recent keys that are still in `entries`, as entries. */
export function recentEntries(entries: readonly Entry[], keys: readonly string[]): Entry[] {
  const by = new Map(entries.map((e) => [entryKey(e), e]));
  return keys.flatMap((k) => by.get(k) ?? []);
}
