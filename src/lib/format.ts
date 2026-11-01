import type { Event } from '$lib/bindings/Event';
import type { EventKind } from '$lib/bindings/EventKind';

/** 5025000 -> "1:23:45", 65000 -> "1:05" */
export function duration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "just now", "12 s ago", "3 min ago", "2 h ago", or a date. */
export function ago(ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** 1284 -> "1,284" */
export function count(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function db(v: number): string {
  if (v <= -100) return '-∞ dB';
  return `${v.toFixed(1)} dB`;
}

export const KIND_LABELS: Record<EventKind, string> = {
  follow: 'Follow',
  sub: 'Subscription',
  resub: 'Resubscription',
  gift_sub: 'Gift sub',
  community_gift: 'Community gift',
  cheer: 'Cheer (bits)',
  raid: 'Raid',
  redemption: 'Channel points',
  power_up: 'Power-up',
  hype_train_begin: 'Hype train starts',
  hype_train_progress: 'Hype train progress',
  hype_train_end: 'Hype train ends',
  poll_begin: 'Poll starts',
  poll_progress: 'Poll progress',
  poll_end: 'Poll ends',
  prediction_begin: 'Prediction starts',
  prediction_progress: 'Prediction progress',
  prediction_lock: 'Prediction locked',
  prediction_end: 'Prediction ends',
  shoutout_received: 'Shoutout received',
  ad_break: 'Ad break',
  charity: 'Charity donation',
  stream_online: 'Stream goes live',
  stream_offline: 'Stream ends',
  channel_update: 'Title or category change',
  chat: 'Chat message',
  custom: 'Custom'
};

export const ALERT_KINDS: EventKind[] = [
  'follow',
  'sub',
  'resub',
  'gift_sub',
  'community_gift',
  'cheer',
  'raid',
  'redemption',
  'power_up',
  'hype_train_begin',
  'hype_train_end',
  'shoutout_received',
  'ad_break',
  'charity'
];

function name(e: Event): string {
  return e.user?.display_name || (e.is_anonymous ? 'Anonymous' : 'Someone');
}

/** One line describing an event, for feeds and history. */
export function describe(e: Event): string {
  const n = name(e);
  const amount = e.amount ?? 0;
  switch (e.kind) {
    case 'follow':
      return `${n} followed`;
    case 'sub':
      return `${n} subscribed${e.data.is_prime ? ' with Prime' : e.tier ? ` · Tier ${e.tier}` : ''}`;
    case 'resub':
      return `${n} resubscribed${e.months ? ` · ${e.months} months` : ''}`;
    case 'gift_sub':
      return `${n} gifted a sub${e.recipient ? ` to ${e.recipient.display_name}` : ''}`;
    case 'community_gift':
      return `${n} gifted ${count(amount)} subs`;
    case 'cheer':
      return `${n} cheered ${count(amount)} bits`;
    case 'raid':
      return `${n} raided with ${count(amount)} viewers`;
    case 'redemption':
      return `${n} redeemed ${String(e.data.reward_title ?? 'a reward')}`;
    case 'power_up':
      return `${n} used a power-up`;
    case 'hype_train_begin':
      return 'Hype train started';
    case 'hype_train_progress':
      return `Hype train level ${String(e.data.level ?? '')}`.trim();
    case 'hype_train_end':
      return `Hype train ended at level ${String(e.data.level ?? '?')}`;
    case 'poll_begin':
      return `Poll started: ${String(e.data.title ?? '')}`;
    case 'poll_progress':
      return `Poll: ${String(e.data.title ?? '')}`;
    case 'poll_end':
      return `Poll ended: ${String(e.data.title ?? '')}`;
    case 'prediction_begin':
      return `Prediction started: ${String(e.data.title ?? '')}`;
    case 'prediction_progress':
      return `Prediction: ${String(e.data.title ?? '')}`;
    case 'prediction_lock':
      return `Prediction locked: ${String(e.data.title ?? '')}`;
    case 'prediction_end':
      return `Prediction ended: ${String(e.data.title ?? '')}`;
    case 'shoutout_received':
      return `${n} shouted you out`;
    case 'ad_break':
      return `Ad break · ${count(amount)} s`;
    case 'charity':
      return `${n} donated ${amount.toFixed(2)} ${e.currency ?? ''}`.trim();
    case 'stream_online':
      return 'Stream went live';
    case 'stream_offline':
      return 'Stream ended';
    case 'channel_update':
      return `Title or category changed`;
    case 'chat':
      return `${n}: ${e.message ?? ''}`;
    case 'custom':
      return 'Custom event';
  }
}

/** Badge colour family per kind (CSS variable name). */
export function kindTone(kind: EventKind): string {
  switch (kind) {
    case 'sub':
    case 'resub':
    case 'gift_sub':
    case 'community_gift':
      return '#a78bfa';
    case 'cheer':
    case 'power_up':
      return '#f5b84b';
    case 'raid':
    case 'shoutout_received':
      return '#4ade80';
    case 'follow':
      return '#60a5fa';
    case 'redemption':
      return '#22d3ee';
    case 'charity':
      return '#f472b6';
    case 'hype_train_begin':
    case 'hype_train_progress':
    case 'hype_train_end':
      return '#fb923c';
    default:
      return '#94a3b8';
  }
}
