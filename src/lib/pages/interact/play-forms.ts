// Giveaway and queue form defaults and checks. The rules match
// src-tauri/src/model/play.rs, so mistakes show before the backend sees them.
import type { GiveawayRecord } from '$lib/bindings/GiveawayRecord';
import type { GiveawaySettings } from '$lib/bindings/GiveawaySettings';
import type { QueueSettings } from '$lib/bindings/QueueSettings';
import type { Winner } from '$lib/bindings/Winner';
import type { Issues } from './forms';

export const MAX_TITLE = 80;
export const MAX_WORD = 25;
export const MAX_NOTE = 40;

const len = (s: string) => [...s].length;

export function defaultGiveawaySettings(): GiveawaySettings {
  return {
    title: '',
    keyword: '!join',
    reward_id: '',
    reward_title: '',
    rules: {
      audience: 'everyone',
      min_follow_days: 0,
      sub_entries: 1,
      tier_bonus: false,
      one_entry: true,
      exclude_mods: false,
      exclude_broadcaster: true,
      exclude_bots: true
    },
    close_after_min: 0,
    close_after_entries: 0,
    claim_s: 60,
    messages: {
      opened: { on: true, text: 'Giveaway for {{title}} is open! {{how}}' },
      closed: { on: true, text: 'Entries are closed. {{entries}} entered. Good luck!' },
      winner: { on: true, text: '@{{winner}} won {{title}}! Say hi in chat within {{claim_s}} seconds to claim it.' },
      reroll: { on: true, text: 'New draw: @{{winner}} won {{title}}!' }
    }
  };
}

export function defaultQueueSettings(): QueueSettings {
  return {
    join_word: '!join',
    leave_word: '!leave',
    position_word: '!position',
    notes: true,
    sub_priority: 'off',
    max_size: 0,
    party_size: 1,
    keep_hours: 12,
    messages: {
      joined: { on: true, text: '{{name}} joined the queue (#{{position}})' },
      left: { on: true, text: '{{name}} left the queue' },
      up: { on: true, text: "{{players}}, you're up!" },
      position: { on: true, text: "@{{name}} you're #{{position}} in the queue" }
    }
  };
}

/** Same command word, ignoring case and a leading `!`. */
export function sameWord(a: string, b: string): boolean {
  const x = a.trim().replace(/^!+/, '');
  const y = b.trim().replace(/^!+/, '');
  return x !== '' && x.toLowerCase() === y.toLowerCase();
}

/** The queue join word is the open giveaway's keyword. */
export function keywordClash(giveawayKeyword: string, queueJoin: string, giveawayOpen: boolean): boolean {
  return giveawayOpen && sameWord(giveawayKeyword, queueJoin);
}

/** The rest of a chat message after `word`, or null when it doesn't start with it. */
export function commandRest(text: string, word: string): string | null {
  const t = text.trim();
  const w = word.trim();
  if (!w) return null;
  const i = t.search(/\s/);
  const first = i < 0 ? t : t.slice(0, i);
  if (w.startsWith('!') && !first.startsWith('!')) return null;
  return sameWord(first, w) ? (i < 0 ? '' : t.slice(i).trim()) : null;
}

export function wordIssue(word: string): string | null {
  const w = word.trim();
  if (!w) return null;
  if (/\s/.test(w)) return 'Use one word, like !join.';
  if (len(w) > MAX_WORD) return `Up to ${MAX_WORD} characters.`;
  return null;
}

export function giveawayIssues(s: GiveawaySettings): Issues {
  const out: Issues = {};
  const title = s.title.trim();
  if (!title) out.title = 'Say what the prize is.';
  else if (len(title) > MAX_TITLE) out.title = `Up to ${MAX_TITLE} characters.`;
  const kw = wordIssue(s.keyword);
  if (kw) out.keyword = kw;
  if (!s.keyword.trim() && !s.reward_id.trim()) out.entry = 'Pick a chat keyword, a channel point reward or both.';
  if (!Number.isInteger(s.rules.sub_entries) || s.rules.sub_entries < 1 || s.rules.sub_entries > 100) out.sub_entries = 'From 1 to 100.';
  if (s.claim_s < 0 || s.claim_s > 3600) out.claim_s = 'Up to an hour.';
  if (s.rules.min_follow_days < 0 || s.rules.min_follow_days > 3650) out.min_follow_days = 'Up to 10 years.';
  return out;
}

export function queueIssues(s: QueueSettings): Issues {
  const out: Issues = {};
  for (const [key, w] of [
    ['join_word', s.join_word],
    ['leave_word', s.leave_word],
    ['position_word', s.position_word]
  ] as const) {
    const e = wordIssue(w);
    if (e) out[key] = e;
  }
  if (!s.join_word.trim()) out.join_word = 'Viewers need a word to join.';
  const words = [s.join_word, s.leave_word, s.position_word].filter((w) => w.trim());
  if (words.some((w, i) => words.some((o, j) => j > i && sameWord(w, o)))) out.words = 'Join, leave and position need different words.';
  if (!Number.isInteger(s.party_size) || s.party_size < 1 || s.party_size > 20) out.party_size = 'From 1 to 20.';
  if (s.max_size < 0 || s.max_size > 1000) out.max_size = 'Up to 1000. 0 means no limit.';
  if (s.keep_hours < 0 || s.keep_hours > 72) out.keep_hours = 'Up to 72 hours.';
  return out;
}

/** "Type !join to enter." and so on, as the backend's `{{how}}`. */
export function howToEnter(s: Pick<GiveawaySettings, 'keyword' | 'reward_id' | 'reward_title'>): string {
  const word = s.keyword.trim();
  const reward = s.reward_id.trim() ? s.reward_title.trim() : '';
  if (word && reward) return `Type ${word} or redeem "${reward}" to enter.`;
  if (word) return `Type ${word} to enter.`;
  if (reward) return `Redeem "${reward}" to enter.`;
  return '';
}

/** Seconds left to claim, or null when there's no timer running. */
export function claimLeft(w: Pick<Winner, 'state' | 'claim_until'>, now: number): number | null {
  if (w.state !== 'drawn' || w.claim_until === null) return null;
  return Math.max(0, Math.ceil((w.claim_until - now) / 1000));
}

function csvCell(s: string): string {
  // Spreadsheets run cells starting with these as formulas.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function historyCsv(records: readonly GiveawayRecord[]): string {
  const iso = (ms: number) => (ms > 0 ? new Date(ms).toISOString() : '');
  const rows = [['opened', 'ended', 'prize', 'people', 'entries', 'winners']];
  for (const r of records) rows.push([iso(r.opened_at), iso(r.ended_at), r.title, String(r.entrants), String(r.entries), r.winners.join(', ')]);
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
