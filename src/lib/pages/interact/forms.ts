// Form defaults and checks for rewards, polls and predictions. The rules match
// src-tauri/src/model/interact.rs, so most mistakes show before Twitch sees them.
import type { Event } from '$lib/bindings/Event';
import type { PollDraft } from '$lib/bindings/PollDraft';
import type { PredictionDraft } from '$lib/bindings/PredictionDraft';
import type { Redemption } from '$lib/bindings/Redemption';
import type { Reward } from '$lib/bindings/Reward';
import type { TwitchAccount } from '$lib/bindings/TwitchAccount';

export const MAX_REWARD_TITLE = 45;
export const MAX_PROMPT = 200;
export const MAX_POLL_TITLE = 60;
export const MAX_PREDICTION_TITLE = 45;
export const MAX_CHOICE = 25;
export const MAX_COOLDOWN_S = 7 * 24 * 3600;

/** Permissions only these features need, as in src-tauri/src/twitch/auth.rs. */
export const INTERACT_SCOPES = [
  'channel:read:redemptions',
  'channel:manage:redemptions',
  'channel:read:polls',
  'channel:manage:polls',
  'channel:read:predictions',
  'channel:manage:predictions'
];

/** Twitch's own reward colours, plus a few more. */
export const REWARD_COLORS = ['#9147FF', '#00C7AC', '#1E69FF', '#FF6905', '#EB0400', '#FACD3B', '#BE0078', '#39D353'];

export const POLL_LENGTHS = [30, 60, 120, 180, 300, 600];
export const PREDICTION_WINDOWS = [30, 60, 120, 300, 600, 1200];

export type Issues = Record<string, string>;

const len = (s: string) => [...s].length;

/** True when the account was signed in before these permissions were asked for. */
export function needsNewSignIn(account: TwitchAccount | null | undefined): boolean {
  if (!account || account.scopes.length === 0) return false;
  return INTERACT_SCOPES.some((s) => !account.scopes.includes(s));
}

export function newReward(): Reward {
  return {
    id: '',
    title: '',
    cost: 100,
    prompt: '',
    input_required: false,
    color: REWARD_COLORS[0]!,
    enabled: true,
    paused: false,
    skip_queue: false,
    max_per_stream: 0,
    max_per_user: 0,
    cooldown_s: 0,
    manageable: true,
    image_url: ''
  };
}

export function rewardIssues(r: Reward, others: readonly Reward[] = []): Issues {
  const out: Issues = {};
  const title = r.title.trim();
  if (!title) out.title = 'Give the reward a title.';
  else if (len(title) > MAX_REWARD_TITLE) out.title = `Up to ${MAX_REWARD_TITLE} characters.`;
  else if (others.some((o) => o.id !== r.id && o.title.trim().toLowerCase() === title.toLowerCase()))
    out.title = 'Another reward already has this title.';
  if (!Number.isInteger(r.cost) || r.cost < 1) out.cost = 'At least 1 point.';
  if (len(r.prompt.trim()) > MAX_PROMPT) out.prompt = `Up to ${MAX_PROMPT} characters.`;
  if (r.color.trim() && !/^#[0-9a-f]{6}$/i.test(r.color.trim())) out.color = 'Use a colour like #9147FF.';
  if (r.cooldown_s < 0 || r.cooldown_s > MAX_COOLDOWN_S) out.cooldown_s = 'Up to 7 days.';
  if (r.max_per_stream < 0) out.max_per_stream = 'Use 0 for no limit.';
  if (r.max_per_user < 0) out.max_per_user = 'Use 0 for no limit.';
  return out;
}

function optionIssues(list: readonly string[], min: number, max: number, what: string, out: Issues) {
  if (list.length < min || list.length > max) out.options = `Use ${min} to ${max} ${what}s.`;
  list.forEach((c, i) => {
    if (!c.trim()) out[`option.${i}`] = `Fill in this ${what}.`;
    else if (len(c.trim()) > MAX_CHOICE) out[`option.${i}`] = `Up to ${MAX_CHOICE} characters.`;
  });
}

export function newPoll(): PollDraft {
  return { title: '', choices: ['', ''], duration_s: 120, points_per_vote: 0 };
}

export function pollIssues(d: PollDraft): Issues {
  const out: Issues = {};
  const t = d.title.trim();
  if (!t) out.title = 'Type the question.';
  else if (len(t) > MAX_POLL_TITLE) out.title = `Up to ${MAX_POLL_TITLE} characters.`;
  optionIssues(d.choices, 2, 5, 'choice', out);
  if (!(d.duration_s >= 15 && d.duration_s <= 1800)) out.duration_s = 'From 15 seconds to 30 minutes.';
  if (d.points_per_vote < 0 || d.points_per_vote > 1_000_000) out.points_per_vote = 'Up to 1,000,000 points.';
  return out;
}

export function newPrediction(): PredictionDraft {
  return { title: '', outcomes: ['', ''], window_s: 120 };
}

export function predictionIssues(d: PredictionDraft): Issues {
  const out: Issues = {};
  const t = d.title.trim();
  if (!t) out.title = 'Type the question.';
  else if (len(t) > MAX_PREDICTION_TITLE) out.title = `Up to ${MAX_PREDICTION_TITLE} characters.`;
  optionIssues(d.outcomes, 2, 10, 'outcome', out);
  if (!(d.window_s >= 30 && d.window_s <= 1800)) out.window_s = 'From 30 seconds to 30 minutes.';
  return out;
}

/** A waiting redemption from its live event. Null when it's not waiting. */
export function redemptionFromEvent(e: Event): Redemption | null {
  if (e.kind !== 'redemption' || e.test) return null;
  const d = e.data as Record<string, unknown>;
  const id = typeof d.redemption_id === 'string' ? d.redemption_id : '';
  const status = typeof d.status === 'string' ? d.status.toLowerCase() : 'unfulfilled';
  if (!id || status !== 'unfulfilled') return null;
  return {
    id,
    reward_id: String(d.reward_id ?? ''),
    reward_title: String(d.reward_title ?? ''),
    cost: e.amount ?? 0,
    user: e.user ?? { id: '', login: '', display_name: '' },
    input: e.message ?? '',
    status: 'unfulfilled',
    redeemed_at: e.ts
  };
}

/** "2 min", "1 h 30 min" and so on, for cooldowns. */
export function duration(s: number): string {
  if (s <= 0) return 'Off';
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return [h && `${h} h`, m && `${m} min`].filter(Boolean).join(' ') || `${s} s`;
}
