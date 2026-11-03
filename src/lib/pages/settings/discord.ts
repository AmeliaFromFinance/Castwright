// Discord webhooks in Settings: defaults, checks and message previews.
// Kept in line with src-tauri/src/discord/payload.rs.
import type { DiscordWebhook } from '$lib/bindings/DiscordWebhook';
import type { SessionSummary } from '$lib/bindings/SessionSummary';
import { newId } from '$lib/editors/ids';
import { render } from '$lib/logic/template';
import { PLACEHOLDERS, templateContext } from '$lib/sessions/summary';

export const DEFAULT_LIVE = '{{channel}} is live with {{category | default:"a new stream"}}!';
export const DEFAULT_END = 'Thanks for watching! {{duration}} of {{category | default:"streaming"}}.';
export const MAX_WEBHOOKS = 10;
export const MAX_TEMPLATE = 2000;

export const LIVE_TOKENS = [
  { token: 'channel', label: 'Your channel name' },
  { token: 'title', label: 'Stream title' },
  { token: 'category', label: 'Category' },
  { token: 'url', label: 'Link to your channel' },
  { token: 'thumbnail', label: 'Link to the live preview image' }
];

export const END_TOKENS = [{ token: 'url', label: 'Link to your channel' }, ...PLACEHOLDERS.map(([token, label]) => ({ token, label }))];

export function newWebhook(): DiscordWebhook {
  return {
    id: newId(),
    name: 'Discord',
    on_live: true,
    on_end: false,
    live_template: DEFAULT_LIVE,
    end_template: DEFAULT_END,
    mention: '',
    edit_on_end: false,
    has_url: false
  };
}

export type MentionKind = 'none' | 'everyone' | 'here' | 'role';

export function mentionKind(m: string): MentionKind {
  const t = m.trim();
  if (!t) return 'none';
  if (t === '@everyone') return 'everyone';
  if (t === '@here') return 'here';
  return 'role';
}

/** `<@&id>`, `@everyone`, `@here` or '' when fine; null when it can't be used. */
export function cleanMention(raw: string): string | null {
  const m = raw.trim();
  if (!m || m.toLowerCase() === 'none') return '';
  if (m === '@everyone' || m === '@here') return m;
  const id = m.match(/^<@&(\d+)>$/)?.[1] ?? m.match(/^&?(\d+)$/)?.[1];
  return id && id.length <= 25 ? `<@&${id}>` : null;
}

const HOSTS = new Set(['discord.com', 'discordapp.com', 'canary.discord.com', 'ptb.discord.com']);

/** A quick check before saving; the app checks again. */
export function isWebhookUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' && HOSTS.has(u.hostname) && /^\/api\/(v\d+\/)?webhooks\/\d+\/[\w-]+\/?$/.test(u.pathname);
  } catch {
    return false;
  }
}

export interface ChannelInfo {
  channel: string;
  login: string;
  title: string;
  category: string;
}

export function liveContext(c: ChannelInfo, now = Date.now()): Record<string, string> {
  const login = c.login.toLowerCase();
  return {
    channel: c.channel,
    login,
    title: c.title,
    category: c.category,
    url: `https://www.twitch.tv/${login}`,
    thumbnail: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-1280x720.jpg?t=${Math.floor(now / 1000)}`
  };
}

function withMention(mention: string, text: string): string {
  return [cleanMention(mention) ?? '', text.trim()].filter(Boolean).join(' ');
}

/** The text above the go-live embed, mention first. */
export function previewLive(h: Pick<DiscordWebhook, 'live_template' | 'mention'>, c: ChannelInfo): string {
  return withMention(h.mention, render(h.live_template, liveContext(c)));
}

/** The text above the end summary embed. */
export function previewEnd(h: Pick<DiscordWebhook, 'end_template' | 'mention'>, s: SessionSummary, c: ChannelInfo): string {
  const ctx = { ...templateContext(s, c.channel), login: c.login.toLowerCase(), url: `https://www.twitch.tv/${c.login.toLowerCase()}` };
  return withMention(h.mention, render(h.end_template, ctx));
}

/** Problems that stop a save, or an empty list. */
export function webhookIssues(h: DiscordWebhook, url: string): string[] {
  const out: string[] = [];
  if (url.trim() && !isWebhookUrl(url)) out.push("That isn't a Discord webhook link.");
  if (cleanMention(h.mention) === null) out.push('Use a role mention like <@&123456789012345678>.');
  if (h.live_template.length > MAX_TEMPLATE || h.end_template.length > MAX_TEMPLATE) out.push(`Keep each message under ${MAX_TEMPLATE} characters.`);
  return out;
}
