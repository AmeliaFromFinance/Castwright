import type { ChatMode } from '$lib/bindings/ChatMode';
import type { ChatModes } from '$lib/bindings/ChatModes';

/** Scopes the mod tools need; older sign-ins may not have them. */
export const MOD_SCOPES = [
  'moderator:manage:banned_users',
  'moderator:manage:chat_messages',
  'moderator:manage:chat_settings',
  'moderator:manage:shield_mode',
  'moderator:read:followers'
] as const;

export function missingScopes(granted: readonly string[] | undefined, needed: readonly string[] = MOD_SCOPES): string[] {
  const have = new Set(granted ?? []);
  return needed.filter((s) => !have.has(s));
}

export const TIMEOUTS: Array<[number, string]> = [
  [60, '1m'],
  [600, '10m'],
  [3600, '1h'],
  [86_400, '24h']
];

export const SLOW_WAITS = [3, 5, 10, 20, 30, 60, 120];
/** Follower-only minimums in minutes. 0 = any follower. */
export const FOLLOW_TIMES: Array<[number, string]> = [
  [0, 'Any follower'],
  [10, '10 minutes'],
  [60, '1 hour'],
  [1440, '1 day'],
  [10_080, '1 week'],
  [43_200, '1 month'],
  [129_600, '3 months']
];

export const MODE_LABELS: Record<ChatMode, string> = {
  shield: 'Shield mode',
  slow: 'Slow mode',
  followers: 'Followers-only',
  subscribers: 'Subs-only',
  emotes: 'Emote-only',
  unique: 'Unique chat'
};

export const MODE_ORDER: ChatMode[] = ['shield', 'slow', 'followers', 'subscribers', 'emotes', 'unique'];

export function modeOn(m: ChatModes, mode: ChatMode): boolean {
  return m[mode];
}

/** Short state text for a mode, like "30s" for slow mode. */
export function modeDetail(m: ChatModes, mode: ChatMode): string {
  if (mode === 'slow' && m.slow) return `${m.slow_wait_s}s`;
  if (mode === 'followers' && m.followers) return m.followers_minutes ? shortSpan(m.followers_minutes * 60) : 'any';
  return '';
}

/** 90 → "1m 30s", 3600 → "1h", 86400 → "1d". */
export function shortSpan(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const units: Array<[number, string]> = [
    [86_400, 'd'],
    [3600, 'h'],
    [60, 'm'],
    [1, 's']
  ];
  const parts: string[] = [];
  let rest = s;
  for (const [n, u] of units) {
    if (rest >= n) {
      parts.push(`${Math.floor(rest / n)}${u}`);
      rest %= n;
    }
    if (parts.length === 2) break;
  }
  return parts.join(' ') || '0s';
}

/** "3 years", "5 months", "12 days", "today". */
export function age(since: number, now = Date.now()): string {
  const days = Math.floor((now - since) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 31) return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'}`;
}

export function tierName(tier: string | null): string {
  if (!tier) return '';
  const n = Number(tier) / 1000;
  return Number.isInteger(n) && n >= 1 && n <= 3 ? `Tier ${n}` : 'Subscribed';
}

/** Custom timeout: number and unit to seconds, capped at Twitch's 14 days. */
export function toSeconds(amount: number, unit: 's' | 'm' | 'h' | 'd'): number {
  const mult = { s: 1, m: 60, h: 3600, d: 86_400 }[unit];
  return Math.min(1_209_600, Math.max(1, Math.round(amount * mult)));
}
