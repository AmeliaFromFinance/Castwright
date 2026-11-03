import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '$lib/bindings/SessionSummary';
import { cleanMention, isWebhookUrl, liveContext, mentionKind, newWebhook, previewEnd, previewLive, webhookIssues } from './discord';

const channel = { channel: 'Nova_Kat', login: 'Nova_Kat', title: 'Ranked grind', category: 'Celeste' };

function summary(): SessionSummary {
  return {
    session: { id: 1, started_at: 0, ended_at: 8_100_000, source: 'twitch', title: 'Ranked', categories: ['Celeste'], peak_viewers: 1342, avg_viewers: 1187 },
    duration_ms: 8_100_000,
    follows: 38,
    new_subs: 10,
    resubs: 4,
    gifted_subs: 2,
    top_gifters: [],
    bits: 2400,
    top_cheerers: [],
    raids_in: [],
    raids_out: [],
    donation_count: 0,
    donation_totals: [],
    top_donors: [],
    chat_messages: 900,
    chatters: 80,
    top_chatters: [{ name: 'pixelbyte', amount: 90 }],
    first_chatters: [],
    alerts: 9,
    actions: 4,
    markers: [],
    timeline: [],
    chat_minutes: []
  };
}

describe('Discord templates', () => {
  it('previews the go-live text with the mention first', () => {
    const h = { ...newWebhook(), live_template: '{{channel}} is live: {{title}} {{url}}' };
    expect(previewLive(h, channel)).toBe('Nova_Kat is live: Ranked grind https://www.twitch.tv/nova_kat');
    expect(previewLive({ ...h, mention: '123' }, channel)).toBe('<@&123> Nova_Kat is live: Ranked grind https://www.twitch.tv/nova_kat');
    expect(previewLive({ ...h, mention: '@everyone' }, channel).startsWith('@everyone ')).toBe(true);
    expect(previewLive(newWebhook(), { ...channel, category: '' })).toBe('Nova_Kat is live with a new stream!');
  });

  it('previews the end text from the summary', () => {
    const h = { ...newWebhook(), end_template: '{{duration}}, {{subs}} subs, top chatter {{top_chatter}}. {{url}}' };
    expect(previewEnd(h, summary(), channel)).toBe('2h 15m, 16 subs, top chatter pixelbyte. https://www.twitch.tv/nova_kat');
    expect(previewEnd(newWebhook(), summary(), channel)).toBe('Thanks for watching! 2h 15m of Celeste.');
  });

  it('builds a fresh preview link each time', () => {
    expect(liveContext(channel, 1_700_000_123_456).thumbnail).toBe(
      'https://static-cdn.jtvnw.net/previews-ttv/live_user_nova_kat-1280x720.jpg?t=1700000123'
    );
  });
});

describe('Discord checks', () => {
  it('accepts role mentions, @everyone, @here or nothing', () => {
    expect(cleanMention('')).toBe('');
    expect(cleanMention('@here')).toBe('@here');
    expect(cleanMention(' <@&42> ')).toBe('<@&42>');
    expect(cleanMention('&42')).toBe('<@&42>');
    expect(cleanMention('@mods')).toBeNull();
    expect(mentionKind('<@&42>')).toBe('role');
    expect(mentionKind('')).toBe('none');
  });

  it('only takes Discord webhook links', () => {
    expect(isWebhookUrl('https://discord.com/api/webhooks/123/abc-DEF_9')).toBe(true);
    expect(isWebhookUrl('https://discordapp.com/api/v10/webhooks/123/abc')).toBe(true);
    expect(isWebhookUrl('http://discord.com/api/webhooks/123/abc')).toBe(false);
    expect(isWebhookUrl('https://example.com/api/webhooks/123/abc')).toBe(false);
    expect(isWebhookUrl('not a link')).toBe(false);
  });

  it('lists what stops a save', () => {
    const h = newWebhook();
    expect(webhookIssues(h, '')).toEqual([]);
    expect(webhookIssues(h, 'https://nope.example')).toHaveLength(1);
    expect(webhookIssues({ ...h, mention: '@mods' }, '')).toHaveLength(1);
    expect(webhookIssues({ ...h, live_template: 'x'.repeat(2001) }, '')).toHaveLength(1);
  });
});
