// Ads and Discord for the browser demo: an ad schedule that counts down, snoozes,
// ads that run, and Discord posts that are logged instead of sent.
import type { AdSchedule } from '$lib/bindings/AdSchedule';
import type { AdSettings } from '$lib/bindings/AdSettings';
import type { DiscordWebhook } from '$lib/bindings/DiscordWebhook';
import type { LogEntry } from '$lib/bindings/LogEntry';
import type { Settings } from '$lib/bindings/Settings';
import { cleanMention, isWebhookUrl, liveContext } from '$lib/pages/settings/discord';
import { render } from '$lib/logic/template';

interface Hooks {
  emit: (name: string, payload: unknown) => void;
  /** Whether the app listens for this push event yet. */
  listening: (name: string) => boolean;
  setVars: (changes: Record<string, unknown>) => void;
  log: (level: LogEntry['level'], source: string, message: string) => void;
  settings: () => Settings;
  channel: () => { channel: string; login: string; title: string; category: string; image: string };
  staticMode: boolean;
  /** `running` starts with an ad on air. */
  start: string | null;
}

const LENGTHS = [30, 60, 90, 120, 150, 180];
const user = (message: string) => ({ code: 'user', message });

export function createAdsMock(h: Hooks) {
  const now = () => Date.now();
  const t0 = now();
  const s: AdSchedule = {
    known: true,
    next_ad_at: t0 + 272_000,
    length_s: 90,
    last_ad_at: t0 - 1_800_000,
    preroll_free_s: 420,
    snoozes: 2,
    snooze_refresh_at: t0 + 2_400_000,
    running_until: 0,
    running_length_s: 0
  };
  if (h.start === 'running') {
    s.running_until = t0 + 72_000;
    s.running_length_s = 90;
    s.next_ad_at = t0 + 72_000 + 1_800_000;
  } else if (h.start === 'soon') {
    s.next_ad_at = t0 + 25_000;
  }
  let warnedFor = 0;
  /** Webhook links, kept apart like the keychain does. */
  const links = new Map<string, string>();

  const publish = () => {
    h.emit('cw://ads', s);
    h.setVars({
      'ads.next_at': s.next_ad_at,
      'ads.length_s': s.length_s,
      'ads.running': s.running_until > now(),
      'ads.ends_at': s.running_until,
      'ads.running_length_s': s.running_length_s,
      'ads.snoozes': s.snoozes
    });
  };

  const begin = (length: number) => {
    s.running_until = now() + length * 1000;
    s.running_length_s = length;
    s.last_ad_at = now();
    s.next_ad_at = now() + length * 1000 + 1_800_000;
    h.log('info', 'twitch', `Ad break started (${Math.floor(length / 60)}:${String(length % 60).padStart(2, '0')})`);
    publish();
  };

  const tick = () => {
    const t = now();
    if (s.running_until > 0 && t >= s.running_until) {
      s.running_until = 0;
      s.running_length_s = 0;
      h.log('info', 'twitch', 'Ad break ended');
      publish();
    }
    if (s.running_until === 0 && s.next_ad_at > 0 && t >= s.next_ad_at) begin(s.length_s);
    const lead = h.settings().ads.warn ? h.settings().ads.warn_minutes * 60_000 : 0;
    const left = s.next_ad_at - t;
    const due = lead && left > 0 && left <= lead && s.running_until <= t;
    if (due && Math.abs(warnedFor - s.next_ad_at) > 30_000 && h.listening('cw://ad-warning')) {
      warnedFor = s.next_ad_at;
      h.emit('cw://ad-warning', s);
    }
  };

  /** What the desktop app would send to Discord, logged instead. */
  const send = (hook: DiscordWebhook, what: string, content: string) => {
    const c = h.channel();
    const ctx = liveContext(c, now());
    const mention = cleanMention(hook.mention) ?? '';
    const payload = {
      content: [what === 'test' ? 'Test post from Castwright.' : mention, content].filter(Boolean).join(' '),
      allowed_mentions: what === 'test' || !mention ? { parse: [] } : mention.startsWith('<@&') ? { parse: [], roles: [mention.slice(3, -1)] } : { parse: ['everyone'] },
      embeds: [
        {
          title: c.title,
          url: ctx.url,
          color: 0x9146ff,
          author: { name: c.channel, url: ctx.url, icon_url: c.image },
          fields: [{ name: 'Category', value: c.category, inline: true }],
          image: { url: ctx.thumbnail },
          timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
        }
      ]
    };
    console.info(`[demo] Discord payload for "${hook.name}"`, JSON.stringify(payload, null, 2));
    h.log('info', 'discord', `Sent a test post to "${hook.name}" (demo: nothing was sent)`);
    h.log('info', 'discord', JSON.stringify(payload));
  };

  if (!h.staticMode && typeof window !== 'undefined') setInterval(tick, 1000);

  const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
    twitch_ad_schedule: () => s,
    twitch_snooze_ad: () => {
      if (s.running_until > now()) throw user('An ad is running. Snooze the next one after it.');
      if (s.snoozes <= 0) throw user('No snoozes left right now. Twitch adds one back every hour.');
      s.snoozes -= 1;
      s.next_ad_at += 300_000;
      h.log('info', 'twitch', `Snoozed the next ad. ${s.snoozes} snoozes left`);
      publish();
      return s;
    },
    twitch_run_ad: ({ lengthS }) => {
      const n = Number(lengthS) || 30;
      const length = LENGTHS.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));
      setTimeout(() => begin(length), 400);
    },
    save_ad_settings: ({ ads }) => {
      const a = ads as AdSettings;
      h.settings().ads = { warn: !!a.warn, warn_minutes: Math.min(15, Math.max(1, Math.round(a.warn_minutes) || 1)) };
      return h.settings().ads;
    },
    save_discord_webhook: ({ webhook, url }) => {
      const w = structuredClone(webhook as DiscordWebhook);
      const mention = cleanMention(w.mention);
      if (mention === null) throw user('Use a role mention like <@&123456789012345678>, @everyone, @here or leave it empty.');
      w.mention = mention;
      w.name = w.name.trim().slice(0, 80) || 'Discord';
      if (typeof url === 'string') {
        if (!url.trim()) links.delete(w.id);
        else if (!isWebhookUrl(url)) throw user("That isn't a Discord webhook link.");
        else links.set(w.id, url.trim());
      }
      w.has_url = links.has(w.id);
      const list = h.settings().discord.webhooks;
      const i = list.findIndex((x) => x.id === w.id);
      if (i >= 0) list[i] = w;
      else list.push(w);
      return w;
    },
    delete_discord_webhook: ({ id }) => {
      links.delete(String(id));
      const d = h.settings().discord;
      d.webhooks = d.webhooks.filter((w) => w.id !== id);
    },
    discord_send_test: ({ id }) => {
      const hook = h.settings().discord.webhooks.find((w) => w.id === id);
      if (!hook) throw user('That Discord webhook was removed.');
      if (!links.has(hook.id) && !hook.has_url) throw user(`"${hook.name}" has no webhook link yet. Paste one in Settings → Discord.`);
      send(hook, 'test', render(hook.live_template, liveContext(h.channel(), now())));
    }
  };

  return { handlers, publish, tick, schedule: s };
}
