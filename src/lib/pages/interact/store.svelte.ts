// Rewards, the redemption queue and the latest poll and prediction, kept fresh from live events.
import { api, on } from '$lib/api';
import { errorMessage } from '$lib/api/backend';
import type { Event } from '$lib/bindings/Event';
import type { Redemption } from '$lib/bindings/Redemption';
import type { Reward } from '$lib/bindings/Reward';
import { latest } from '$lib/overlay/interact';
import { app } from '$lib/state/app.svelte';
import { redemptionFromEvent } from './forms';

class InteractStore {
  rewards = $state<Reward[]>([]);
  queue = $state<Redemption[]>([]);
  /** From Twitch when the page opened; live events take over after. */
  pollEvent = $state<Event | null>(null);
  predictionEvent = $state<Event | null>(null);
  loading = $state(false);
  pointsError = $state<string | null>(null);
  pollsError = $state<string | null>(null);

  #seen = new Set<string>();
  #unlisten: (() => void) | null = null;

  /** Newest first, from Twitch and the live feed. */
  get poll() {
    return latest([...(this.pollEvent ? [this.pollEvent] : []), ...app.feed], 'poll');
  }

  get prediction() {
    return latest([...(this.predictionEvent ? [this.predictionEvent] : []), ...app.feed], 'prediction');
  }

  async load() {
    this.loading = true;
    for (const e of app.feed) if (e.kind === 'redemption') this.#seen.add(e.id);
    const [points, polls] = await Promise.allSettled([Promise.all([api.rewards(), api.redemptions()]), api.interactState()]);
    if (points.status === 'fulfilled') {
      [this.rewards, this.queue] = points.value;
      this.pointsError = null;
    } else this.pointsError = errorMessage(points.reason);
    if (polls.status === 'fulfilled') {
      this.pollEvent = polls.value.poll;
      this.predictionEvent = polls.value.prediction;
      this.pollsError = null;
    } else this.pollsError = errorMessage(polls.reason);
    this.loading = false;
    if (!this.#unlisten) {
      void on('cw://redemption', (u) => {
        if (u.status !== 'unfulfilled') this.queue = this.queue.filter((q) => q.id !== u.id);
      }).then((un) => (this.#unlisten = un));
    }
  }

  /** New redemption events for rewards Castwright made join the queue. */
  takeFeed(feed: readonly Event[]) {
    const mine = new Set(this.rewards.filter((r) => r.manageable).map((r) => r.id));
    const add: Redemption[] = [];
    for (const e of feed) {
      if (e.kind !== 'redemption' || this.#seen.has(e.id)) continue;
      this.#seen.add(e.id);
      const r = redemptionFromEvent(e);
      if (r && mine.has(r.reward_id) && !this.queue.some((q) => q.id === r.id)) add.push(r);
    }
    if (add.length) this.queue = [...this.queue, ...add.reverse()];
  }

  async finish(items: Redemption[], refund: boolean): Promise<number> {
    const n = await api.finishRedemptions(
      items.map((r) => ({ id: r.id, reward_id: r.reward_id })),
      refund
    );
    const ids = new Set(items.map((r) => r.id));
    this.queue = this.queue.filter((q) => !ids.has(q.id));
    return n;
  }

  async saveReward(r: Reward): Promise<Reward> {
    const saved = await api.saveReward(r);
    const i = this.rewards.findIndex((x) => x.id === saved.id);
    if (i >= 0) this.rewards[i] = saved;
    else this.rewards = [saved, ...this.rewards];
    return saved;
  }

  async deleteReward(r: Reward) {
    await api.deleteReward(r.id);
    this.rewards = this.rewards.filter((x) => x.id !== r.id);
    this.queue = this.queue.filter((q) => q.reward_id !== r.id);
  }

  setPoll(e: Event) {
    this.pollEvent = e;
  }

  setPrediction(e: Event) {
    this.predictionEvent = e;
  }
}

export const interact = new InteractStore();
