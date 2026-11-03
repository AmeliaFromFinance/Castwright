import { api, initBackend, on, type Vars } from '$lib/api';
import type { TimerRun } from '$lib/bindings/TimerRun';
import type { AppInfo } from '$lib/bindings/AppInfo';
import type { Event } from '$lib/bindings/Event';
import type { LogEntry } from '$lib/bindings/LogEntry';
import type { ObsSnapshot } from '$lib/bindings/ObsSnapshot';
import type { Project } from '$lib/bindings/Project';
import type { QueueState } from '$lib/bindings/QueueState';
import type { ServerInfo } from '$lib/bindings/ServerInfo';
import type { Settings } from '$lib/bindings/Settings';
import type { AdSchedule } from '$lib/bindings/AdSchedule';
import type { MusicStatus } from '$lib/bindings/MusicStatus';
import { countdown } from '$lib/overlay/ads';
import type { TwitchStatus } from '$lib/bindings/TwitchStatus';
import type { WindowEffect } from '$lib/bindings/WindowEffect';
import { applyTheme, watchSystemTheme } from '$lib/theme/apply';
import { toasts } from './toast.svelte';
import { loadPref, savePref } from './persist';
import { updates } from './updates.svelte';
import { moments } from './moments.svelte';
import { whatsNew } from '$lib/whatsnew/whatsnew.svelte';
import { sessions } from '$lib/sessions/store.svelte';
import type { Theme } from '$lib/theme/themes';

export type Page = 'overlays' | 'alerts' | 'automation' | 'activity' | 'interact' | 'settings';
export type ActivityTab = 'events' | 'chat' | 'sessions' | 'log';

const CHAT_KEEP = 300;
const FEED_KEEP = 200;
const LOG_KEEP = 500;

export function emptyObs(): ObsSnapshot {
  return {
    state: 'disconnected',
    error: null,
    obs_version: '',
    websocket_version: '',
    scenes: [],
    program_scene: '',
    preview_scene: null,
    studio_mode: false,
    scene_items: [],
    inputs: [],
    stream: { active: false, paused: false, duration_ms: 0 },
    record: { active: false, paused: false, duration_ms: 0 },
    replay_buffer: null,
    virtual_cam: false,
    transitions: [],
    current_transition: '',
    transition_ms: 300,
    stats: {
      cpu_percent: 0,
      memory_mb: 0,
      active_fps: 0,
      render_skipped_percent: 0,
      output_skipped_percent: 0,
      stream_kbps: 0,
      stream_dropped_percent: 0
    },
    base_width: 1920,
    base_height: 1080
  };
}

export function emptyAds(): AdSchedule {
  return {
    known: false,
    next_ad_at: 0,
    length_s: 0,
    last_ad_at: 0,
    preroll_free_s: 0,
    snoozes: 0,
    snooze_refresh_at: 0,
    running_until: 0,
    running_length_s: 0
  };
}

/** Marks chat Twitch removed (deleted, timed out, banned, cleared). The panel can still show it on request. */
export function markDeleted(chat: Event[], d: { message_id?: string; user_id?: string; all?: boolean }): Event[] {
  const hit = (c: Event) => !!d.all || (!!d.message_id && c.id === d.message_id) || (!!d.user_id && c.user?.id === d.user_id);
  return chat.map((c) => (hit(c) && c.data.deleted !== true ? { ...c, data: { ...c.data, deleted: true } } : c));
}

class AppState {
  ready = $state(false);
  fatal = $state<string | null>(null);
  page = $state<Page>('overlays');
  /** Overlay open in the editor, if any. */
  editingOverlay = $state<string | null>(null);
  /** Layer to select when the overlay editor opens. */
  focusLayer = $state<string | null>(null);
  activityTab = $state<ActivityTab>('events');

  project = $state<Project | null>(null);
  settings = $state<Settings | null>(null);
  info = $state<AppInfo | null>(null);
  server = $state<ServerInfo | null>(null);
  obs = $state<ObsSnapshot>(emptyObs());
  levels = $state<Record<string, number[]>>({});
  twitch = $state<TwitchStatus | null>(null);
  queue = $state<QueueState>({ paused: false, muted: false, playing: null, waiting: [], last: null });
  ads = $state<AdSchedule>(emptyAds());
  music = $state<MusicStatus | null>(null);
  /** Started, paused or reset timer layers, by layer id. */
  timers = $state<Record<string, TimerRun>>({});
  vars = $state<Vars>({});
  /** When each variable last changed while the app was open (ms). */
  varTimes = $state<Record<string, number>>({});
  chat = $state<Event[]>([]);
  /** Chat without removed messages. */
  liveChat = $derived(this.chat.filter((c) => c.data.deleted !== true));
  feed = $state<Event[]>([]);
  logs = $state<LogEntry[]>([]);
  theme = $state<Theme | null>(null);
  windowEffect = $state<WindowEffect>('solid');
  demo = $state(false);

  async init() {
    try {
      const backend = await initBackend();
      this.demo = backend.kind === 'demo';
      const [project, settings, info, server, obs, twitch, queue, vars, chat, feed, logs] = await Promise.all([
        api.getProject(),
        api.getSettings(),
        api.appInfo(),
        api.serverInfo(),
        api.obsSnapshot().catch(() => emptyObs()),
        api.twitchStatus().catch(() => null),
        api.alertQueue(),
        api.getVars(),
        api.recentChat(),
        api.recentEvents(FEED_KEEP),
        api.getLogs()
      ]);
      Object.assign(this, { project, settings, info, server, obs, twitch, queue, vars, chat, feed, logs });
      this.ads = await api.adSchedule().catch(() => emptyAds());
      this.music = await api.musicStatus().catch(() => null);
      this.timers = await api.timerStates().catch(() => ({}));
      this.applyAppearance();
      watchSystemTheme(() => this.applyAppearance());
      await this.subscribe();
      if (!this.demo && settings.appearance.window_effect !== 'solid') {
        this.windowEffect = await api
          .setWindowEffect(settings.appearance.window_effect, this.theme?.spec.base !== 'light')
          .catch(() => 'solid' as WindowEffect);
        this.applyAppearance();
      }
      this.ready = true;
      this.fitToScreenOnce();
      // The browser demo starts fresh each time, so it counts as a new install.
      whatsNew.start(info.version, !settings.first_run_done || (this.demo && loadPref<string | null>('whatsnew-seen', null) === null));
      updates.settings = settings.updates;
      void updates.check(info.version);
      if (server.error) toasts.show(server.error, 'error', 12_000);
    } catch (e) {
      this.fatal = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
    }
  }

  /** Large screens get a bigger interface the first time, which Ctrl + / - can change. */
  private fitToScreenOnce() {
    if (!this.settings || loadPref('screen-fit-done', false)) return;
    savePref('screen-fit-done', true);
    if (this.settings.appearance.ui_scale !== 100 || typeof screen === 'undefined') return;
    const physical = screen.width * (window.devicePixelRatio || 1);
    const pct = physical >= 3800 ? 150 : physical >= 2400 ? 125 : 100;
    if (pct === 100 || (window.devicePixelRatio || 1) >= 1.25) return;
    this.settings.appearance = { ...this.settings.appearance, ui_scale: pct };
    this.applyAppearance();
    api.saveAppearance($state.snapshot(this.settings.appearance)).catch(() => {});
    toasts.show(`Interface set to ${pct}% for your screen. Ctrl - and Ctrl + change it.`, 'info', 7000);
  }

  applyAppearance() {
    if (!this.settings) return;
    this.theme = applyTheme(this.settings.appearance, this.windowEffect);
  }

  private async subscribe() {
    await Promise.all([
      on('cw://event', (e) => {
        if (e.kind === 'chat') {
          this.chat = [...this.chat.slice(-(CHAT_KEEP - 1)), e];
        } else {
          this.feed = [e, ...this.feed.slice(0, FEED_KEEP - 1)];
        }
      }),
      on('cw://vars', (changes) => {
        const next = { ...this.vars };
        const now = Date.now();
        for (const k of Object.keys(changes)) this.varTimes[k] = now;
        for (const [k, v] of Object.entries(changes)) {
          if (v === null) delete next[k];
          else next[k] = v;
        }
        this.vars = next;
      }),
      on('cw://log', (l) => {
        this.logs = [...this.logs.slice(-(LOG_KEEP - 1)), l];
        // A deleted webhook shouldn't go unnoticed until the next stream.
        if (l.source === 'discord' && l.level === 'error') toasts.show(l.message, 'error', 12_000, 'discord');
      }),
      on('cw://ads', (s) => (this.ads = s)),
      on('cw://music', (s) => (this.music = s)),
      on('cw://timers', (c) => (this.timers = { ...this.timers, [c.layer_id]: c.run })),
      on('cw://ad-warning', (s) => this.adWarning(s)),
      on('cw://obs', (s) => (this.obs = s)),
      on('cw://obs-levels', (levels) => {
        const next: Record<string, number[]> = {};
        for (const l of levels) next[l.name] = l.peaks_db;
        this.levels = next;
      }),
      on('cw://twitch', (s) => (this.twitch = s)),
      on('cw://queue', (q) => (this.queue = q)),
      on('cw://server', (s) => (this.server = s)),
      on('cw://chat-delete', (d) => (this.chat = markDeleted(this.chat, d))),
      on('cw://session', (c) => {
        if (c.type === 'ended') sessions.ended(c.session.id);
        else sessions.changed();
      }),
      moments.listen(),
      on('cw://project', async () => {
        // Overlay visibility can change from automation; refresh quietly.
        this.project = await api.getProject();
      })
    ]);
  }

  /** The heads-up before an ad, with a Snooze button when one is left. */
  adWarning(s: AdSchedule) {
    const secs = Math.max(0, Math.ceil((s.next_ad_at - Date.now()) / 1000));
    const msg = `Ad break in ${countdown(secs)}, ${countdown(s.length_s)} long.`;
    const snooze = s.snoozes > 0 ? { label: 'Snooze', run: () => void this.snoozeAd() } : undefined;
    toasts.show(s.snoozes > 0 ? msg : `${msg} No snoozes left.`, 'info', 20_000, 'ad-warning', snooze);
  }

  async snoozeAd() {
    try {
      this.ads = await api.snoozeAd();
      toasts.success(`Snoozed. ${this.ads.snoozes} snooze${this.ads.snoozes === 1 ? '' : 's'} left.`);
    } catch (e) {
      toasts.error(e);
    }
  }

  async reloadProject() {
    this.project = await api.getProject();
  }

  async reloadSettings() {
    this.settings = await api.getSettings();
    this.applyAppearance();
  }
}

export const app = new AppState();
