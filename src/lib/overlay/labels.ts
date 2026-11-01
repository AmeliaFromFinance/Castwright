import type { Event } from '$lib/bindings/Event';
import type { EventKind } from '$lib/bindings/EventKind';
import { groupThousands } from '$lib/logic/template';

/** Kinds the alert queue reacts to; the default set for event lists. */
export const ALERTABLE_KINDS: readonly EventKind[] = [
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
  'charity',
  'custom'
];

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
}

function plural(n: number, one: string, many: string): string {
  return `${groupThousands(n)} ${n === 1 ? one : many}`;
}

export function displayName(e: Event): string {
  if (e.is_anonymous && !e.user) return 'Anonymous';
  const u = e.user;
  if (u) return u.display_name || u.login || (e.is_anonymous ? 'Anonymous' : '');
  return e.is_anonymous ? 'Anonymous' : '';
}

export function formatMoney(amount: number, currency: string | null | undefined): string {
  const code = (currency ?? '').trim().toUpperCase();
  if (code) {
    try {
      return new Intl.NumberFormat('en', { style: 'currency', currency: code }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${code}`;
    }
  }
  return amount.toFixed(2);
}

function seconds(n: number): string {
  if (n >= 60 && n % 60 === 0) return `${n / 60} min`;
  return `${n}s`;
}

/** The amount in words: "500 bits", "212 viewers", "£10.00"... Empty when there is none. */
export function amountText(e: Event): string {
  const n = e.amount;
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  switch (e.kind) {
    case 'cheer':
    case 'power_up':
      return plural(n, 'bit', 'bits');
    case 'raid':
    case 'shoutout_received':
      return plural(n, 'viewer', 'viewers');
    case 'community_gift':
      return plural(n, 'sub', 'subs');
    case 'redemption':
      return plural(n, 'point', 'points');
    case 'charity':
      return formatMoney(n, e.currency);
    case 'ad_break':
      return seconds(n);
    default:
      return groupThousands(n);
  }
}

function tierSuffix(e: Event): string {
  if (e.data?.is_prime === true) return ' with Prime';
  if (e.tier === 2 || e.tier === 3) return ` (Tier ${e.tier})`;
  return '';
}

/** A short phrase that follows the viewer name, e.g. "cheered 500 bits". */
export function eventLabel(e: Event): string {
  const n = e.amount ?? 0;
  const d = e.data ?? {};
  switch (e.kind) {
    case 'follow':
      return 'followed';
    case 'sub':
      return `subscribed${tierSuffix(e)}`;
    case 'resub': {
      const months = e.months ?? 0;
      return months > 1 ? `resubscribed · ${months} months` : `resubscribed${tierSuffix(e)}`;
    }
    case 'gift_sub':
      return 'gifted a sub';
    case 'community_gift':
      return n === 1 || n === 0 ? 'gifted a sub' : `gifted ${groupThousands(n)} subs`;
    case 'cheer':
      return `cheered ${plural(n, 'bit', 'bits')}`;
    case 'raid':
      return `raided with ${groupThousands(n)}`;
    case 'redemption': {
      const reward = str(d.reward_title);
      return reward ? `redeemed ${reward}` : 'redeemed a reward';
    }
    case 'power_up':
      return 'used a power-up';
    case 'charity':
      return `donated ${formatMoney(n, e.currency)}`;
    case 'shoutout_received':
      return 'shouted us out';
    case 'hype_train_begin':
      return 'Hype train started';
    case 'hype_train_progress': {
      const level = str(d.level);
      return level ? `Hype train level ${level}` : 'Hype train';
    }
    case 'hype_train_end': {
      const level = str(d.level);
      return level ? `Hype train ended at level ${level}` : 'Hype train ended';
    }
    case 'poll_begin':
      return 'Poll started';
    case 'poll_progress':
      return 'Poll updated';
    case 'poll_end':
      return 'Poll ended';
    case 'prediction_begin':
      return 'Prediction started';
    case 'prediction_progress':
      return 'Prediction updated';
    case 'prediction_lock':
      return 'Prediction locked';
    case 'prediction_end':
      return 'Prediction ended';
    case 'ad_break':
      return n > 0 ? `Ad break · ${seconds(n)}` : 'Ad break';
    case 'stream_online':
      return 'went live';
    case 'stream_offline':
      return 'went offline';
    case 'channel_update':
      return 'updated the stream';
    case 'chat':
      return 'said';
    case 'custom':
      return str(d.label) || str(d.title);
  }
}

/** Template context for one event: the event itself plus `name`, `label` and `amount_text`. */
export function eventContext(e: Event): Record<string, unknown> {
  return {
    ...e,
    name: displayName(e),
    recipient_name: e.recipient?.display_name || e.recipient?.login || '',
    label: eventLabel(e),
    amount_text: amountText(e)
  };
}
