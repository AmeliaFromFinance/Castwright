// Channel points, polls and predictions for the browser demo: a few rewards, a
// queue of redemptions and a running poll whose votes change.
import type { Event } from '$lib/bindings/Event';
import type { EventKind } from '$lib/bindings/EventKind';
import type { PollDraft } from '$lib/bindings/PollDraft';
import type { PredictionAction } from '$lib/bindings/PredictionAction';
import type { PredictionDraft } from '$lib/bindings/PredictionDraft';
import type { Redemption } from '$lib/bindings/Redemption';
import type { RedemptionRef } from '$lib/bindings/RedemptionRef';
import type { Reward } from '$lib/bindings/Reward';
import { newReward, pollIssues, predictionIssues, rewardIssues } from '$lib/pages/interact/forms';

interface Hooks {
  emit: (name: string, payload: unknown) => void;
  publish: (e: Event) => void;
  uid: () => string;
  staticMode: boolean;
  viewers: readonly string[];
}

interface MockPoll {
  id: string;
  title: string;
  choices: Array<{ id: string; title: string; votes: number }>;
  status: string;
  started_at: number;
  ends_at: number;
  ended_at: number | null;
  points_per_vote: number;
}

interface MockPrediction {
  id: string;
  title: string;
  outcomes: Array<{ id: string; title: string; users: number; channel_points: number; color: string }>;
  status: string;
  started_at: number;
  locks_at: number;
  ended_at: number | null;
  winning_outcome_id: string;
}

const user = (err: string) => ({ code: 'user', message: err });

export const SAMPLE_REWARD_ID = 'sample-reward';

export function createInteractMock(h: Hooks) {
  const now = () => Date.now();
  const reward = (patch: Partial<Reward>): Reward => ({ ...newReward(), ...patch });
  const rewards: Reward[] = [
    reward({ id: SAMPLE_REWARD_ID, title: 'Hydrate', cost: 500, prompt: 'I take a big sip of water.', color: '#00C7AC', cooldown_s: 300 }),
    reward({ id: 'rw-song', title: 'Song request', cost: 1000, prompt: 'Name a song for the queue.', input_required: true, color: '#1E69FF', max_per_user: 2 }),
    reward({ id: 'rw-plank', title: 'Plank for 30 seconds', cost: 5000, color: '#FF6905', paused: true, max_per_stream: 3 }),
    reward({ id: 'tw-highlight', title: 'Highlight My Message', cost: 200, color: '#9147FF', manageable: false, input_required: true }),
    reward({ id: 'tw-emote', title: 'Unlock a Random Sub Emote', cost: 1200, color: '#BE0078', manageable: false })
  ];
  const redemption = (r: Reward, who: string, ago: number, input = ''): Redemption => ({
    id: h.uid(),
    reward_id: r.id,
    reward_title: r.title,
    cost: r.cost,
    user: { id: who, login: who.toLowerCase(), display_name: who },
    input,
    status: 'unfulfilled',
    redeemed_at: now() - ago
  });
  const queue: Redemption[] = [
    redemption(rewards[0]!, h.viewers[0] ?? 'nova_kat', 410_000),
    redemption(rewards[1]!, h.viewers[1] ?? 'pixelbyte', 260_000, 'Daft Punk - Veridis Quo'),
    redemption(rewards[0]!, h.viewers[4] ?? 'Tomasz', 95_000),
    redemption(rewards[1]!, h.viewers[6] ?? 'LumenLark', 30_000, 'something lofi please')
  ];

  let poll: MockPoll | null = {
    id: h.uid(),
    title: 'Which map next?',
    choices: [
      { id: 'c1', title: 'Dust', votes: 48 },
      { id: 'c2', title: 'Mirage', votes: 31 },
      { id: 'c3', title: 'Inferno', votes: 12 }
    ],
    status: 'active',
    started_at: now() - 45_000,
    ends_at: now() + 135_000,
    ended_at: null,
    points_per_vote: 0
  };
  let prediction: MockPrediction | null = {
    id: h.uid(),
    title: 'Clutch this round?',
    outcomes: [
      { id: 'o0', title: 'Easy clutch', users: 14, channel_points: 21_500, color: 'blue' },
      { id: 'o1', title: 'No chance', users: 9, channel_points: 12_250, color: 'pink' }
    ],
    status: 'locked',
    started_at: now() - 240_000,
    locks_at: now() - 60_000,
    ended_at: null,
    winning_outcome_id: ''
  };

  const base = (kind: EventKind, data: Record<string, unknown>): Event => ({
    id: h.uid(),
    kind,
    ts: now(),
    user: null,
    amount: null,
    currency: null,
    tier: null,
    months: null,
    message: null,
    message_parts: [],
    roles: { broadcaster: false, moderator: false, vip: false, subscriber: false },
    is_gift: false,
    is_anonymous: false,
    recipient: null,
    data,
    test: false
  });

  const pollEvent = (kind: EventKind, p: MockPoll) =>
    base(kind, {
      poll_id: p.id,
      title: p.title,
      status: p.status,
      choices: p.choices.map((c) => ({ ...c, bits_votes: 0, channel_points_votes: 0 })),
      started_at: p.started_at,
      ends_at: p.ends_at,
      ...(p.ended_at ? { ended_at: p.ended_at } : {}),
      points_per_vote: p.points_per_vote
    });

  const predictionEvent = (kind: EventKind, p: MockPrediction) =>
    base(kind, {
      prediction_id: p.id,
      title: p.title,
      status: p.status,
      outcomes: p.outcomes,
      started_at: p.started_at,
      locks_at: p.locks_at,
      ...(p.ended_at ? { ended_at: p.ended_at } : {}),
      ...(p.winning_outcome_id ? { winning_outcome_id: p.winning_outcome_id } : {})
    });

  const endPoll = (status: string) => {
    if (!poll || poll.status !== 'active') return null;
    poll.status = status;
    poll.ended_at = now();
    const e = pollEvent('poll_end', poll);
    h.publish(e);
    return e;
  };

  if (!h.staticMode && typeof window !== 'undefined') {
    setInterval(() => {
      if (poll?.status === 'active') {
        if (now() >= poll.ends_at) endPoll('completed');
        else {
          for (const c of poll.choices) c.votes += Math.floor(Math.random() * 3);
          h.publish(pollEvent('poll_progress', poll));
        }
      }
      if (prediction?.status === 'active') {
        if (now() >= prediction.locks_at) {
          prediction.status = 'locked';
          h.publish(predictionEvent('prediction_lock', prediction));
        } else {
          const o = prediction.outcomes[Math.floor(Math.random() * prediction.outcomes.length)]!;
          o.users += 1;
          o.channel_points += 50 * (1 + Math.floor(Math.random() * 20));
          h.publish(predictionEvent('prediction_progress', prediction));
        }
      }
    }, 3000);
  }

  /** Waiting redemptions from live events join the queue. */
  const onRedemption = (e: Event) => {
    const d = e.data as Record<string, unknown>;
    if (e.kind !== 'redemption' || typeof d.redemption_id !== 'string') return;
    const r = rewards.find((x) => x.id === d.reward_id);
    if (!r?.manageable) return;
    queue.push({ ...redemption(r, e.user?.display_name ?? 'viewer', 0, e.message ?? ''), id: d.redemption_id });
  };

  const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
    twitch_rewards: () => rewards,
    twitch_save_reward: ({ reward: raw }) => {
      const r = { ...(raw as Reward), manageable: true };
      const issues = rewardIssues(r, rewards);
      const first = Object.values(issues)[0];
      if (first) throw user(first);
      const i = rewards.findIndex((x) => x.id === r.id);
      if (i >= 0) {
        if (!rewards[i]!.manageable) throw { code: 'twitch', message: 'Twitch: This reward was made on Twitch, so only Twitch can change it.' };
        rewards[i] = r;
      } else {
        r.id = h.uid();
        rewards.unshift(r);
      }
      return r;
    },
    twitch_delete_reward: ({ id }) => {
      const i = rewards.findIndex((x) => x.id === id);
      if (i < 0) return;
      if (!rewards[i]!.manageable) throw { code: 'twitch', message: 'Twitch: This reward was made on Twitch, so only Twitch can change it.' };
      rewards.splice(i, 1);
      for (let j = queue.length - 1; j >= 0; j--) if (queue[j]!.reward_id === id) queue.splice(j, 1);
    },
    twitch_redemptions: () => queue,
    twitch_finish_redemptions: ({ items, refund }) => {
      let n = 0;
      for (const it of items as RedemptionRef[]) {
        const i = queue.findIndex((q) => q.id === it.id);
        if (i < 0) continue;
        queue.splice(i, 1);
        n++;
        h.emit('cw://redemption', { id: it.id, reward_id: it.reward_id, status: refund ? 'canceled' : 'fulfilled' });
      }
      return n;
    },
    twitch_interact_state: () => ({
      poll: poll ? pollEvent(poll.status === 'active' ? 'poll_progress' : 'poll_end', poll) : null,
      prediction: prediction
        ? predictionEvent(prediction.status === 'active' ? 'prediction_progress' : prediction.status === 'locked' ? 'prediction_lock' : 'prediction_end', prediction)
        : null
    }),
    twitch_start_poll: ({ draft }) => {
      const d = draft as PollDraft;
      const first = Object.values(pollIssues(d))[0];
      if (first) throw user(first);
      if (poll?.status === 'active') throw user('A poll is already running. End it first.');
      poll = {
        id: h.uid(),
        title: d.title.trim(),
        choices: d.choices.map((t, i) => ({ id: `c${i}`, title: t.trim(), votes: 0 })),
        status: 'active',
        started_at: now(),
        ends_at: now() + d.duration_s * 1000,
        ended_at: null,
        points_per_vote: d.points_per_vote
      };
      const e = pollEvent('poll_begin', poll);
      h.publish(e);
      return e;
    },
    twitch_end_poll: () => {
      const e = endPoll('terminated');
      if (!e) throw user('No poll is running.');
      return e;
    },
    twitch_start_prediction: ({ draft }) => {
      const d = draft as PredictionDraft;
      const first = Object.values(predictionIssues(d))[0];
      if (first) throw user(first);
      if (prediction && (prediction.status === 'active' || prediction.status === 'locked'))
        throw user('A prediction is already running. Resolve or cancel it first.');
      const colors = ['blue', 'pink'];
      prediction = {
        id: h.uid(),
        title: d.title.trim(),
        outcomes: d.outcomes.map((t, i) => ({ id: `o${i}`, title: t.trim(), users: 0, channel_points: 0, color: colors[Math.min(i, 1)]! })),
        status: 'active',
        started_at: now(),
        locks_at: now() + d.window_s * 1000,
        ended_at: null,
        winning_outcome_id: ''
      };
      const e = predictionEvent('prediction_begin', prediction);
      h.publish(e);
      return e;
    },
    twitch_end_prediction: ({ action, outcome }) => {
      const p = prediction;
      const open = p && (p.status === 'active' || p.status === 'locked');
      if (!p || !open) throw user('No prediction is running.');
      const a = action as PredictionAction;
      if (a === 'lock') {
        if (p.status === 'locked') throw user('The prediction is already locked.');
        p.status = 'locked';
        const e = predictionEvent('prediction_lock', p);
        h.publish(e);
        return e;
      }
      if (a === 'resolve') {
        if (!p.outcomes.some((o) => o.id === outcome)) throw user('Pick the winning outcome.');
        p.winning_outcome_id = String(outcome);
        p.status = 'resolved';
      } else p.status = 'canceled';
      p.ended_at = now();
      const e = predictionEvent('prediction_end', p);
      h.publish(e);
      return e;
    }
  };

  return { handlers, onRedemption };
}
