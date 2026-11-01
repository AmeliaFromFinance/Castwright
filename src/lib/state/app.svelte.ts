import { api, initBackend, on, type Vars } from '$lib/api';
import type { AppInfo } from '$lib/bindings/AppInfo';
import type { Event } from '$lib/bindings/Event';
import type { LogEntry } from '$lib/bindings/LogEntry';
import type { ObsSnapshot } from '$lib/bindings/ObsSnapshot';
import type { Project } from '$lib/bindings/Project';
import type { QueueState } from '$lib/bindings/QueueState';
import type { ServerInfo } from '$lib/bindings/ServerInfo';
import type { Settings } from '$lib/bindings/Settings';
import type { TwitchStatus } from '$lib/bindings/TwitchStatus';
import type { WindowEffect } from '$lib/bindings/WindowEffect';
import { applyTheme, watchSystemTheme } from '$lib/theme/apply';
import type { Theme } from '$lib/theme/themes';

export type Page = 'studio' | 'overlays' | 'alerts' | 'automation' | 'activity' | 'settings';

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

class AppState {
  ready = $state(false);
  fatal = $state<string | null>(null);
  page = $state<Page>('studio');
  /** Overlay open in the editor, if any. */
  editingOverlay = $state<string | null>(null);

  project = $state<Project | null>(null);
  settings = $state<Settings | null>(null);
  info = $state<AppInfo | null>(null);
  server = $state<ServerInfo | null>(null);
  obs = $state<ObsSnapshot>(emptyObs());
  levels = $state<Record<string, number[]>>({});
  twitch = $state<TwitchStatus | null>(null);
  queue = $state<QueueState>({ paused: false, playing: null, waiting: [] });
  vars = $state<Vars>({});
  chat = $state<Event[]>([]);
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
    } catch (e) {
      this.fatal = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
    }
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
        for (const [k, v] of Object.entries(changes)) {
          if (v === null) delete next[k];
          else next[k] = v;
        }
        this.vars = next;
      }),
      on('cw://log', (l) => {
        this.logs = [...this.logs.slice(-(LOG_KEEP - 1)), l];
      }),
      on('cw://obs', (s) => (this.obs = s)),
      on('cw://obs-levels', (levels) => {
        const next: Record<string, number[]> = {};
        for (const l of levels) next[l.name] = l.peaks_db;
        this.levels = next;
      }),
      on('cw://twitch', (s) => (this.twitch = s)),
      on('cw://queue', (q) => (this.queue = q)),
      on('cw://server', (s) => (this.server = s)),
      on('cw://chat-delete', (d) => {
        if (d.all) this.chat = [];
        else if (d.message_id) this.chat = this.chat.filter((c) => c.id !== d.message_id);
        else if (d.user_id) this.chat = this.chat.filter((c) => c.user?.id !== d.user_id);
      }),
      on('cw://project', async () => {
        // Overlay visibility can change from automation; refresh quietly.
        this.project = await api.getProject();
      })
    ]);
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
