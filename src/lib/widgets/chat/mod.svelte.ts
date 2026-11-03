import { api } from '$lib/api';
import type { ChatMode } from '$lib/bindings/ChatMode';
import type { ChatModes } from '$lib/bindings/ChatModes';
import type { Event } from '$lib/bindings/Event';
import type { EventUser } from '$lib/bindings/EventUser';
import { app } from '$lib/state/app.svelte';
import { loadPref, savePref } from '$lib/state/persist';
import { attemptOk, toasts } from '$lib/state/toast.svelte';
import { missingScopes } from './moderation';

const NOTES = 'mod-notes';

export type ModDialog = { kind: 'timeout' | 'ban'; user: EventUser };

class ModTools {
  modes = $state<ChatModes | null>(null);
  /** Users banned or timed out from here this session. */
  banned = $state<Record<string, true>>({});
  notes = $state<Record<string, string>>(loadPref<Record<string, string>>(NOTES, {}));
  replyTo = $state<Event | null>(null);
  card = $state<{ user: EventUser; x: number; y: number } | null>(null);
  dialog = $state<ModDialog | null>(null);

  /** True when the sign-in has the mod scopes; otherwise asks to sign in again. */
  ready(needed?: readonly string[]): boolean {
    const me = app.twitch?.broadcaster;
    if (!me) {
      toasts.show('Sign in to Twitch first.', 'error');
      return false;
    }
    if (!missingScopes(me.scopes, needed).length) return true;
    toasts.show('Mod tools need new Twitch permissions. Sign out and in again to allow them.', 'error', 9000, 'mod-scopes', {
      label: 'Open Twitch settings',
      run: () => {
        app.page = 'settings';
        setTimeout(() => document.getElementById('twitch')?.scrollIntoView({ block: 'start' }), 60);
      }
    });
    return false;
  }

  /** Can this message's sender be moderated from here? */
  canModerate(m: Event): boolean {
    const me = app.twitch?.broadcaster;
    return !!me && !!m.user && m.user.id !== me.id && !m.roles.broadcaster;
  }

  get canShoutout(): boolean {
    const me = app.twitch?.broadcaster;
    return !!me?.scopes.includes('moderator:manage:shoutouts') && !!app.twitch?.stream.live;
  }

  async loadModes() {
    if (!app.twitch?.broadcaster) return;
    try {
      this.modes = await api.twitchChatModes();
    } catch {
      // Shown as unknown; using a toggle reports the problem.
    }
  }

  async setMode(mode: ChatMode, on: boolean, value: number | null = null) {
    if (!this.ready()) return;
    try {
      this.modes = await api.twitchSetChatMode(mode, on, value);
    } catch (e) {
      toasts.error(e);
    }
  }

  async remove(m: Event) {
    if (!this.ready(['moderator:manage:chat_messages'])) return;
    await attemptOk(() => api.twitchDeleteMessage(m.id));
  }

  async timeout(user: EventUser, seconds: number, reason = '') {
    if (!this.ready(['moderator:manage:banned_users'])) return;
    if (await attemptOk(() => api.twitchBan(user.id, seconds, reason), `${user.display_name} timed out`)) this.banned[user.id] = true;
  }

  async ban(user: EventUser, reason = '') {
    if (!this.ready(['moderator:manage:banned_users'])) return;
    if (await attemptOk(() => api.twitchBan(user.id, null, reason), `${user.display_name} banned`)) this.banned[user.id] = true;
  }

  async unban(user: EventUser) {
    if (!this.ready(['moderator:manage:banned_users'])) return;
    if (await attemptOk(() => api.twitchUnban(user.id), `${user.display_name} unbanned`)) delete this.banned[user.id];
  }

  async shoutout(user: EventUser) {
    await attemptOk(() => api.twitchShoutout(user.login), `Shoutout sent to ${user.display_name}`);
  }

  /** Asks first; the dialog does the timeout or ban. */
  ask(kind: ModDialog['kind'], user: EventUser) {
    if (this.ready(['moderator:manage:banned_users'])) this.dialog = { kind, user };
  }

  setNote(userId: string, text: string) {
    if (text.trim()) this.notes[userId] = text;
    else delete this.notes[userId];
    savePref(NOTES, $state.snapshot(this.notes));
  }
}

export const mod = new ModTools();
