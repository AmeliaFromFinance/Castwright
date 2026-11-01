import type { Backend, Unlisten } from './backend';
import { isTauri } from './backend';
import type { AccountRole } from '$lib/bindings/AccountRole';
import type { Action } from '$lib/bindings/Action';
import type { ActionRun } from '$lib/bindings/ActionRun';
import type { AlertConfig } from '$lib/bindings/AlertConfig';
import type { AppearanceSettings } from '$lib/bindings/AppearanceSettings';
import type { AppInfo } from '$lib/bindings/AppInfo';
import type { AssetInfo } from '$lib/bindings/AssetInfo';
import type { AudioLevel } from '$lib/bindings/AudioLevel';
import type { Category } from '$lib/bindings/Category';
import type { DeviceLogin } from '$lib/bindings/DeviceLogin';
import type { Event } from '$lib/bindings/Event';
import type { EventKind } from '$lib/bindings/EventKind';
import type { LogEntry } from '$lib/bindings/LogEntry';
import type { ObsSnapshot } from '$lib/bindings/ObsSnapshot';
import type { Overlay } from '$lib/bindings/Overlay';
import type { Project } from '$lib/bindings/Project';
import type { QueueState } from '$lib/bindings/QueueState';
import type { ServerInfo } from '$lib/bindings/ServerInfo';
import type { Settings } from '$lib/bindings/Settings';
import type { SnapshotInfo } from '$lib/bindings/SnapshotInfo';
import type { TwitchStatus } from '$lib/bindings/TwitchStatus';
import type { WindowEffect } from '$lib/bindings/WindowEffect';

let backend: Backend | null = null;

export async function initBackend(): Promise<Backend> {
  if (backend) return backend;
  if (isTauri()) {
    backend = (await import('./tauri')).tauriBackend;
  } else {
    backend = (await import('./mock')).createDemoBackend();
  }
  return backend;
}

export function getBackend(): Backend {
  if (!backend) throw new Error('backend not initialised');
  return backend;
}

/** For tests. */
export function setBackend(b: Backend) {
  backend = b;
}

function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return getBackend().invoke<T>(cmd, args);
}

export type Vars = Record<string, unknown>;

/** Push events from the backend. */
export const events = {
  event: 'cw://event',
  vars: 'cw://vars',
  log: 'cw://log',
  obs: 'cw://obs',
  obsLevels: 'cw://obs-levels',
  twitch: 'cw://twitch',
  queue: 'cw://queue',
  project: 'cw://project',
  server: 'cw://server',
  chatDelete: 'cw://chat-delete',
  actionRun: 'cw://action-run'
} as const;

export interface PushPayloads {
  'cw://event': Event;
  'cw://vars': Vars;
  'cw://log': LogEntry;
  'cw://obs': ObsSnapshot;
  'cw://obs-levels': AudioLevel[];
  'cw://twitch': TwitchStatus;
  'cw://queue': QueueState;
  'cw://project': { overlay_id?: string };
  'cw://server': ServerInfo;
  'cw://chat-delete': { message_id?: string; user_id?: string; all?: boolean };
  'cw://action-run': ActionRun;
}

export function on<K extends keyof PushPayloads>(name: K, cb: (p: PushPayloads[K]) => void): Promise<Unlisten> {
  return getBackend().listen<PushPayloads[K]>(name, cb);
}

export type OutputAction = 'start' | 'stop' | 'toggle';
export type RecordAction = OutputAction | 'pause' | 'resume';

export const api = {
  // project
  getProject: () => call<Project>('get_project'),
  saveOverlay: (overlay: Overlay) => call<Overlay>('save_overlay', { overlay }),
  deleteOverlay: (id: string) => call<void>('delete_overlay', { id }),
  duplicateOverlay: (id: string) => call<Overlay>('duplicate_overlay', { id }),
  saveAlerts: (config: AlertConfig) => call<void>('save_alerts', { config }),
  saveActions: (actions: Action[]) => call<void>('save_actions', { actions }),
  renameProject: (name: string) => call<void>('rename_project', { name }),
  exportOverlay: (id: string, path: string) => call<void>('export_overlay', { id, path }),
  importOverlay: (path: string) => call<Overlay>('import_overlay', { path }),
  listAssets: () => call<AssetInfo[]>('list_assets'),
  importAssets: (paths: string[]) => call<AssetInfo[]>('import_assets', { paths }),
  deleteAsset: (name: string) => call<void>('delete_asset', { name }),
  listSnapshots: () => call<SnapshotInfo[]>('list_snapshots'),
  createSnapshot: () => call<void>('create_snapshot'),
  restoreSnapshot: (file: string) => call<Project>('restore_snapshot', { file }),
  projectDir: () => call<string>('project_dir'),
  setProjectDir: (dir: string) => call<void>('set_project_dir', { dir }),

  // alerts
  alertQueue: () => call<QueueState>('alert_queue'),
  alertPause: (paused: boolean) => call<void>('alert_pause', { paused }),
  alertSkip: () => call<void>('alert_skip'),
  alertRemove: (id: string) => call<void>('alert_remove', { id }),
  alertClear: () => call<void>('alert_clear'),
  alertReplay: (eventId: string) => call<void>('alert_replay', { eventId }),
  testEvent: (kind: EventKind) => call<void>('test_event', { kind }),

  // automation
  runAction: (id: string) => call<void>('run_action', { id }),

  // variables
  getVars: () => call<Vars>('get_vars'),
  setVar: (key: string, value: unknown, persist: boolean) => call<void>('set_var', { key, value, persist }),
  deleteVar: (key: string) => call<void>('delete_var', { key }),
  resetSession: () => call<void>('reset_session'),

  // history
  recentEvents: (limit: number, kinds: string[] = [], search = '', includeTests = false) =>
    call<Event[]>('recent_events', { limit, kinds, search, includeTests }),
  recentChat: () => call<Event[]>('recent_chat'),
  clearHistory: () => call<void>('clear_history'),
  exportHistoryCsv: (path: string) => call<number>('export_history_csv', { path }),
  getLogs: () => call<LogEntry[]>('get_logs'),

  // overlay server
  serverInfo: () => call<ServerInfo>('server_info'),
  overlayUrl: (id: string) => call<string>('overlay_url', { id }),
  regenerateToken: () => call<ServerInfo>('regenerate_token'),
  restartServer: (port: number, allowLan: boolean) => call<ServerInfo>('restart_server', { port, allowLan }),

  // settings
  getSettings: () => call<Settings>('get_settings'),
  saveAppearance: (appearance: AppearanceSettings) => call<void>('save_appearance', { appearance }),
  setFirstRunDone: (done: boolean) => call<void>('set_first_run_done', { done }),
  setTwitchClientId: (clientId: string) => call<void>('set_twitch_client_id', { clientId }),
  appInfo: () => call<AppInfo>('app_info'),
  setWindowEffect: (effect: WindowEffect, dark: boolean) => call<WindowEffect>('set_window_effect', { effect, dark }),

  // twitch
  twitchStatus: () => call<TwitchStatus>('twitch_status'),
  twitchLogin: (role: AccountRole) => call<DeviceLogin>('twitch_login', { role }),
  twitchCancelLogin: (role: AccountRole) => call<void>('twitch_cancel_login', { role }),
  twitchLogout: (role: AccountRole) => call<void>('twitch_logout', { role }),
  twitchSearchCategories: (query: string) => call<Category[]>('twitch_search_categories', { query }),
  twitchUpdateStreamInfo: (title: string, categoryId: string, tags: string[]) =>
    call<void>('twitch_update_stream_info', { title, categoryId, tags }),
  twitchSendChat: (message: string, asBot: boolean) => call<void>('twitch_send_chat', { message, asBot }),

  // obs
  obsSnapshot: () => call<ObsSnapshot>('obs_snapshot'),
  obsConnect: () => call<void>('obs_connect'),
  obsDisconnect: () => call<void>('obs_disconnect'),
  obsTestConnection: (host: string, port: number, password: string | null) =>
    call<string>('obs_test_connection', { host, port, password }),
  obsSaveConnection: (host: string, port: number, password: string | null, keepPassword: boolean, autoConnect: boolean) =>
    call<void>('obs_save_connection', { host, port, password, keepPassword, autoConnect }),
  obsSetProgramScene: (scene: string) => call<void>('obs_set_program_scene', { scene }),
  obsSetPreviewScene: (scene: string) => call<void>('obs_set_preview_scene', { scene }),
  obsSetStudioMode: (enabled: boolean) => call<void>('obs_set_studio_mode', { enabled }),
  obsTransition: () => call<void>('obs_transition'),
  obsSetTransition: (name: string) => call<void>('obs_set_transition', { name }),
  obsSetTransitionDuration: (ms: number) => call<void>('obs_set_transition_duration', { ms }),
  obsStream: (action: OutputAction) => call<void>('obs_stream', { action }),
  obsRecord: (action: RecordAction) => call<void>('obs_record', { action }),
  obsReplay: (action: 'toggle' | 'save') => call<void>('obs_replay', { action }),
  obsVirtualCam: () => call<void>('obs_virtual_cam'),
  obsSetVolume: (input: string, db: number) => call<void>('obs_set_volume', { input, db }),
  obsSetMute: (input: string, muted: boolean) => call<void>('obs_set_mute', { input, muted }),
  obsSetMonitoring: (input: string, enabled: boolean) => call<void>('obs_set_monitoring', { input, enabled }),
  obsSetItemEnabled: (scene: string, itemId: number, enabled: boolean) =>
    call<void>('obs_set_item_enabled', { scene, itemId, enabled }),
  obsSetItemLocked: (scene: string, itemId: number, locked: boolean) =>
    call<void>('obs_set_item_locked', { scene, itemId, locked }),
  obsLevels: (enabled: boolean) => call<void>('obs_levels', { enabled }),
  obsScreenshot: (source: string, width: number) => call<string>('obs_screenshot', { source, width }),
  obsAddOverlay: (overlayId: string, scene: string) => call<void>('obs_add_overlay', { overlayId, scene })
};

export type Api = typeof api;
