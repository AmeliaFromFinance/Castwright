import type { SessionSummary } from '$lib/bindings/SessionSummary';
import { render } from '$lib/logic/template';

/** Same as DEFAULT_SOCIAL_TEMPLATE in src-tauri/src/model/settings.rs. */
export const DEFAULT_SOCIAL_TEMPLATE =
  'Thanks for hanging out! {{duration}} of {{category | default:"streaming"}} with a peak of {{peak_viewers | number}} viewers.\n' +
  '{{follows}} new follows, {{subs}} subs and {{bits | number}} bits. Top chatter: {{top_chatter | default:"nobody yet"}}.';

/** Placeholders for the "Copy for socials" template, in the order the docs list them. */
export const PLACEHOLDERS: Array<[string, string]> = [
  ['channel', 'Your channel name'],
  ['title', 'Stream title'],
  ['category', 'Last category'],
  ['categories', 'Every category, comma separated'],
  ['date', 'Day the stream started'],
  ['duration', 'Length, like 2h 15m'],
  ['duration_minutes', 'Length in minutes'],
  ['peak_viewers', 'Most viewers at once'],
  ['avg_viewers', 'Average viewers'],
  ['follows', 'New follows'],
  ['subs', 'New subs, resubs and gifted subs'],
  ['new_subs', 'New subs'],
  ['resubs', 'Resubs'],
  ['gifted_subs', 'Gifted subs'],
  ['top_gifter', 'Who gifted the most'],
  ['bits', 'Bits cheered'],
  ['top_cheerer', 'Who cheered the most'],
  ['raids', 'Raids in'],
  ['raiders', 'Who raided you, comma separated'],
  ['raided', 'Who you raided at the end'],
  ['donations', 'Charity donations'],
  ['donation_total', 'Donation total, like 25 USD'],
  ['chat_messages', 'Chat messages'],
  ['chatters', 'People who chatted'],
  ['first_chatters', 'First-time chatters'],
  ['top_chatter', 'Who chatted the most'],
  ['alerts', 'Alerts played'],
  ['actions', 'Actions run'],
  ['markers', 'Stream markers']
];

/** 8_100_000 -> "2h 15m", 2_700_000 -> "45m" */
export function durationText(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function totalSubs(s: SessionSummary): number {
  return s.new_subs + s.resubs + s.gifted_subs;
}

function money(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function donationText(s: SessionSummary): string {
  return s.donation_totals.map((d) => `${money(d.amount)} ${d.name}`.trim()).join(', ');
}

/** Values the social template can use. */
export function templateContext(s: SessionSummary, channel = ''): Record<string, string | number> {
  const sess = s.session;
  return {
    channel,
    title: sess.title,
    category: sess.categories.at(-1) ?? '',
    categories: sess.categories.join(', '),
    date: new Date(sess.started_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }),
    duration: durationText(s.duration_ms),
    duration_minutes: Math.round(s.duration_ms / 60_000),
    peak_viewers: sess.peak_viewers,
    avg_viewers: sess.avg_viewers,
    follows: s.follows,
    subs: totalSubs(s),
    new_subs: s.new_subs,
    resubs: s.resubs,
    gifted_subs: s.gifted_subs,
    top_gifter: s.top_gifters[0]?.name ?? '',
    bits: s.bits,
    top_cheerer: s.top_cheerers[0]?.name ?? '',
    raids: s.raids_in.length,
    raiders: s.raids_in.map((r) => r.name).join(', '),
    raided: s.raids_out.at(-1)?.name ?? '',
    donations: s.donation_count,
    donation_total: donationText(s),
    chat_messages: s.chat_messages,
    chatters: s.chatters,
    first_chatters: s.first_chatters.length,
    top_chatter: s.top_chatters[0]?.name ?? '',
    alerts: s.alerts,
    actions: s.actions,
    markers: s.markers.length
  };
}

export function socialText(template: string, s: SessionSummary, channel = ''): string {
  return render(template, templateContext(s, channel)).trim();
}

function cell(v: string | number): string {
  let s = String(v);
  // Stop spreadsheets from running a cell as a formula.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}

function iso(ts: number): string {
  return new Date(ts).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** One table: section, name, value, time. Opens in any spreadsheet app. */
export function toCsv(s: SessionSummary): string {
  const rows: Array<[string, string, string | number, string]> = [];
  const stat = (name: string, value: string | number) => rows.push(['stats', name, value, '']);
  const sess = s.session;
  stat('started', iso(sess.started_at));
  stat('ended', sess.ended_at === null ? '' : iso(sess.ended_at));
  stat('duration_minutes', Math.round(s.duration_ms / 60_000));
  stat('title', sess.title);
  stat('categories', sess.categories.join(', '));
  stat('peak_viewers', sess.peak_viewers);
  stat('avg_viewers', sess.avg_viewers);
  stat('follows', s.follows);
  stat('new_subs', s.new_subs);
  stat('resubs', s.resubs);
  stat('gifted_subs', s.gifted_subs);
  stat('bits', s.bits);
  stat('donations', s.donation_count);
  stat('chat_messages', s.chat_messages);
  stat('chatters', s.chatters);
  stat('first_time_chatters', s.first_chatters.length);
  stat('alerts', s.alerts);
  stat('actions', s.actions);
  for (const d of s.donation_totals) rows.push(['donation_total', d.name, money(d.amount), '']);
  for (const [section, list] of [
    ['top_gifters', s.top_gifters],
    ['top_cheerers', s.top_cheerers],
    ['top_donors', s.top_donors],
    ['top_chatters', s.top_chatters]
  ] as const) {
    for (const r of list) rows.push([section, r.name, money(r.amount), '']);
  }
  for (const r of s.raids_in) rows.push(['raid_in', r.name, r.viewers, iso(r.ts)]);
  for (const r of s.raids_out) rows.push(['raid_out', r.name, r.viewers, iso(r.ts)]);
  for (const m of s.markers) rows.push(['marker', m.description, '', iso(m.ts)]);
  for (const name of s.first_chatters) rows.push(['first_time_chatter', name, '', '']);
  const lines = ['section,name,value,time', ...rows.map((r) => r.map(cell).join(','))];
  return lines.join('\r\n') + '\r\n';
}

export function toJson(s: SessionSummary): string {
  return JSON.stringify(s, null, 2);
}

export type TimelineGroup = 'follows' | 'subs' | 'bits' | 'raids' | 'other';

/** Colors checked for color-blind separation, in this order, on light and dark backgrounds. */
export const TIMELINE_GROUPS: Array<{ id: TimelineGroup; label: string; light: string; dark: string }> = [
  { id: 'follows', label: 'Follows', light: '#2a78d6', dark: '#3987e5' },
  { id: 'subs', label: 'Subs', light: '#eb6834', dark: '#d95926' },
  { id: 'bits', label: 'Bits', light: '#1baf7a', dark: '#199e70' },
  { id: 'raids', label: 'Raids', light: '#eda100', dark: '#c98500' },
  { id: 'other', label: 'Other', light: '#e87ba4', dark: '#d55181' }
];

export function groupOf(kind: string): TimelineGroup {
  if (kind === 'follow') return 'follows';
  if (kind === 'sub' || kind === 'resub' || kind === 'gift_sub' || kind === 'community_gift') return 'subs';
  if (kind === 'cheer') return 'bits';
  if (kind === 'raid') return 'raids';
  return 'other';
}

export interface Bucket {
  /** ms since epoch */
  start: number;
  counts: Record<TimelineGroup, number>;
  total: number;
  chat: number;
}

export const BUCKET_MS = 10 * 60_000;

/** Events and chat per 10 minutes, from the start of the stream. */
export function bucketTimeline(s: SessionSummary, size = BUCKET_MS): Bucket[] {
  const start = s.session.started_at;
  const n = Math.max(1, Math.ceil(s.duration_ms / size));
  const buckets: Bucket[] = Array.from({ length: n }, (_, i) => ({
    start: start + i * size,
    counts: { follows: 0, subs: 0, bits: 0, raids: 0, other: 0 },
    total: 0,
    chat: 0
  }));
  const at = (ts: number) => buckets[Math.min(n - 1, Math.max(0, Math.floor((ts - start) / size)))]!;
  for (const m of s.timeline) {
    const b = at(m.ts);
    b.counts[groupOf(m.kind)]++;
    b.total++;
  }
  for (const c of s.chat_minutes) at(c.minute).chat += c.count;
  return buckets;
}

/** File name without extension, like `stream-2026-11-03`. */
export function exportName(s: SessionSummary): string {
  const d = new Date(s.session.started_at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `stream-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
