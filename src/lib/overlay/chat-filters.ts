// Chat hide and highlight rules, shared by the chat panel and chat layers.
import type { ChatRules } from '$lib/bindings/ChatRules';
import type { Event } from '$lib/bindings/Event';
import type { LayerKind } from '$lib/bindings/LayerKind';
import { isCommand, normLogin } from './chat';
import { cssValue } from './styles';

/** Same as KNOWN_BOTS in src-tauri/src/model/chat.rs. */
export const KNOWN_BOTS = ['nightbot', 'streamelements', 'streamlabs', 'moobot', 'fossabot', 'sery_bot', 'wizebot'];

export const MAX_PATTERN = 200;
/** Twitch messages are at most 500 characters. */
const MAX_TEXT = 500;

export type HideReason = 'bot' | 'command' | 'user' | 'word';
export type HighlightKind = 'first' | 'mention' | 'keyword' | 'user' | 'redeemed';

export const HIDE_LABELS: Record<HideReason, string> = { bot: 'bot', command: 'command', user: 'hidden user', word: 'word filter' };
export const HIGHLIGHT_LABELS: Record<HighlightKind, string> = {
  first: 'First message',
  mention: 'Mentions you',
  keyword: 'Keyword',
  user: 'Highlighted user',
  redeemed: 'Highlighted with points'
};

export function defaultChatRules(): ChatRules {
  return {
    hide_bots: true,
    bots: [...KNOWN_BOTS],
    hide_commands: true,
    hide_users: [],
    hide_words: [],
    highlight_first: true,
    highlight_mentions: true,
    highlight_keywords: [],
    highlight_users: [],
    highlight_mods: false,
    highlight_vips: false,
    highlight_redeemed: true,
    colors: { first: '#3ddc97', mention: '#ff6b6b', keyword: '#f5c451', user: '#8ab4ff', redeemed: '#c792ea' }
  };
}

/** Rules from a project, filling in anything older projects lack. */
export function resolveRules(r: Partial<ChatRules> | null | undefined): ChatRules {
  const d = defaultChatRules();
  return { ...d, ...(r ?? {}), colors: { ...d.colors, ...(r?.colors ?? {}) } };
}

/** Rules that hide and highlight nothing. */
export function noRules(): ChatRules {
  return {
    ...defaultChatRules(),
    hide_bots: false,
    hide_commands: false,
    highlight_first: false,
    highlight_mentions: false,
    highlight_redeemed: false
  };
}

const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*(?:[+*]|\{\d*,?\d*\})\)\s*(?:[+*]|\{\d*,?\d*\})/;
const BACKREF = /\\[1-9]|\\k</;

type Pattern = { ok: true; test: (text: string) => boolean } | { ok: false; error: string };

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A word or phrase (whole words, any case), or `/pattern/flags` for a regular
 * expression. Patterns that could take very long to run are refused.
 */
export function parsePattern(entry: string): Pattern {
  const s = entry.trim();
  if (!s) return { ok: false, error: 'Empty' };
  if (s.length > MAX_PATTERN) return { ok: false, error: `Longer than ${MAX_PATTERN} characters` };
  const m = /^\/(.+)\/([a-z]*)$/s.exec(s);
  if (m) {
    const [, body, flags] = m as unknown as [string, string, string];
    if (/[^imsu]/.test(flags)) return { ok: false, error: 'Only the i, m, s and u flags work here' };
    if (NESTED_QUANTIFIER.test(body)) return { ok: false, error: 'Repeats inside repeats, like (a+)+, can freeze chat' };
    if (BACKREF.test(body)) return { ok: false, error: 'Back-references like \\1 aren’t allowed' };
    try {
      const re = new RegExp(body, flags);
      if (re.test('')) return { ok: false, error: 'Matches every message' };
      return { ok: true, test: (t) => re.test(t) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message.replace(/^Invalid regular expression: /, '') : 'Not a valid pattern' };
    }
  }
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escapeRe(s)}(?:$|[^\\p{L}\\p{N}_])`, 'iu');
  return { ok: true, test: (t) => re.test(t) };
}

/** Why an entry can't be used, or null when it's fine. */
export function checkPattern(entry: string): string | null {
  const p = parsePattern(entry);
  return p.ok ? null : p.error;
}

export interface FilterContext {
  /** Broadcaster login and display name, for mentions. */
  broadcaster: readonly string[];
  /** The signed-in bot account, always treated as a bot. */
  botLogin?: string;
}

export interface Verdict {
  hidden: HideReason | null;
  highlights: HighlightKind[];
}

export interface Judge {
  (e: Event): Verdict;
  rules: ChatRules;
}

function matcher(entries: readonly string[]): (text: string) => boolean {
  const tests = entries.map(parsePattern).flatMap((p) => (p.ok ? [p.test] : []));
  if (!tests.length) return () => false;
  return (text) => tests.some((t) => t(text));
}

/** Builds a fast check from rules. Bad patterns are skipped. */
export function makeJudge(rules: ChatRules, ctx: FilterContext): Judge {
  const r = resolveRules(rules);
  const bots = new Set([...(r.hide_bots ? r.bots : []), ...(r.hide_bots && ctx.botLogin ? [ctx.botLogin] : [])].map(normLogin).filter(Boolean));
  const hideUsers = new Set(r.hide_users.map(normLogin).filter(Boolean));
  const hlUsers = new Set(r.highlight_users.map(normLogin).filter(Boolean));
  const hideWords = matcher(r.hide_words);
  const keywords = matcher(r.highlight_keywords);
  const names = ctx.broadcaster.map(normLogin).filter(Boolean);
  const mention = r.highlight_mentions && names.length ? matcher([...new Set(names)]) : () => false;

  const judge = ((e: Event): Verdict => {
    const login = normLogin(e.user?.login ?? '');
    const display = normLogin(e.user?.display_name ?? '');
    const text = (e.message ?? '').slice(0, MAX_TEXT);
    let hidden: HideReason | null = null;
    if (bots.size && (bots.has(login) || bots.has(display))) hidden = 'bot';
    else if (r.hide_commands && isCommand(e)) hidden = 'command';
    else if (hideUsers.size && (hideUsers.has(login) || hideUsers.has(display))) hidden = 'user';
    else if (text && hideWords(text)) hidden = 'word';

    const highlights: HighlightKind[] = [];
    if (r.highlight_first && e.data?.first_chat === true) highlights.push('first');
    const own = names.includes(login);
    if (!own && text && mention(text)) highlights.push('mention');
    if (text && keywords(text)) highlights.push('keyword');
    if (hlUsers.has(login) || hlUsers.has(display) || (r.highlight_mods && e.roles?.moderator) || (r.highlight_vips && e.roles?.vip)) highlights.push('user');
    if (r.highlight_redeemed && e.data?.message_type === 'channel_points_highlighted') highlights.push('redeemed');
    return { hidden, highlights };
  }) as Judge;
  judge.rules = r;
  return judge;
}

/** Colour for the first highlight, or ''. */
export function highlightColor(rules: ChatRules, v: Verdict): string {
  const k = v.highlights[0];
  return k ? cssValue(resolveRules(rules).colors[k] ?? '') : '';
}

export function highlightClasses(v: Verdict): string {
  return v.highlights.length ? ['cw-hl', ...v.highlights.map((h) => `cw-hl-${h}`)].join(' ') : '';
}

type ChatKind = Extract<LayerKind, { type: 'chat' }>;

/** The rules a chat layer uses: the app's, its own or none, plus its hide switches. */
export function layerRules(kind: ChatKind, app: ChatRules | null | undefined): ChatRules {
  const appRules = resolveRules(app);
  const source = kind.filters ?? 'app';
  const base = source === 'own' ? resolveRules(kind.own_rules) : source === 'off' ? { ...noRules(), bots: appRules.bots } : appRules;
  return {
    ...base,
    hide_commands: kind.hide_commands,
    hide_bots: kind.hide_bots !== false,
    hide_users: [...base.hide_users, ...(kind.hide_users ?? [])]
  };
}

/** One entry per line; names may also be split by commas. Patterns can hold commas, so they can't. */
export function splitList(text: string, names = false): string[] {
  return [
    ...new Set(
      text
        .split(names ? /[\n,]/ : /\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  ];
}
