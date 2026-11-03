import { api } from '$lib/api';
import { toasts } from '$lib/state/toast.svelte';

class SessionsState {
  /** Session shown in the summary dialog. */
  openId = $state<number | null>(null);
  /** Goes up when a session starts, ends or is deleted, so lists reload. */
  version = $state(0);

  show(id: number) {
    this.openId = id;
  }

  close() {
    this.openId = null;
  }

  changed() {
    this.version++;
  }

  /** Open the newest session, if there is one. */
  async showLatest() {
    try {
      const [latest] = await api.listSessions(1);
      if (latest) this.show(latest.session.id);
      else toasts.show('No streams recorded yet. A summary is made each time you go live.');
    } catch (e) {
      toasts.error(e);
    }
  }

  ended(id: number) {
    this.changed();
    toasts.show('Stream summary ready', 'success', 20_000, 'session-ended', { label: 'View', run: () => this.show(id) });
  }
}

export const sessions = new SessionsState();
