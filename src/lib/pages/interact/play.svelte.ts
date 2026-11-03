// Giveaways and the viewer queue as the Interact page shows them, kept fresh from `cw://play`.
import { api, on } from '$lib/api';
import { errorMessage } from '$lib/api/backend';
import type { GiveawayRecord } from '$lib/bindings/GiveawayRecord';
import type { PlayState } from '$lib/bindings/PlayState';

class PlayStore {
  state = $state<PlayState | null>(null);
  history = $state<GiveawayRecord[]>([]);
  error = $state<string | null>(null);

  #unlisten: (() => void) | null = null;

  async load() {
    try {
      const [state, history] = await Promise.all([api.playState(), api.giveawayHistory()]);
      this.state = state;
      this.history = history;
      this.error = null;
    } catch (e) {
      this.error = errorMessage(e);
    }
    if (!this.#unlisten) {
      void on('cw://play', (s) => {
        const ended = this.state?.giveaway && !s.giveaway;
        this.state = s;
        if (ended) void this.loadHistory();
      }).then((un) => (this.#unlisten = un));
    }
  }

  async loadHistory() {
    try {
      this.history = await api.giveawayHistory();
    } catch {
      // The list stays as it was.
    }
  }
}

export const play = new PlayStore();
