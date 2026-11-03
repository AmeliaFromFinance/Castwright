import type { Backend, Unlisten } from './backend';
import { isTauri } from './backend';
import type { AccountRole } from '$lib/bindings/AccountRole';
import type { Action } from '$lib/bindings/Action';
import type { ActionPackage } from '$lib/bindings/ActionPackage';
import type { ImportChoices } from '$lib/bindings/ImportChoices';
import type { ImportReport } from '$lib/bindings/ImportReport';
import type { ActionRun } from '$lib/bindings/ActionRun';
import type { RunProgress } from '$lib/bindings/RunProgress';
import type { AlertConfig } from '$lib/bindings/AlertConfig';
import type { AppearanceSettings } from '$lib/bindings/AppearanceSettings';
import type { AppInfo } from '$lib/bindings/AppInfo';
import type { AssetInfo } from '$lib/bindings/AssetInfo';
import type { AudioLevel } from '$lib/bindings/AudioLevel';
import type { BackupInfo } from '$lib/bindings/BackupInfo';
import type { BackupSettings } from '$lib/bindings/BackupSettings';
import type { Category } from '$lib/bindings/Category';
import type { ChatMode } from '$lib/bindings/ChatMode';
import type { ChatModes } from '$lib/bindings/ChatModes';
import type { ViewerCard } from '$lib/bindings/ViewerCard';
import type { Check } from '$lib/bindings/Check';
import type { CheckFix } from '$lib/bindings/CheckFix';
import type { DeviceLogin } from '$lib/bindings/DeviceLogin';
import type { Event } from '$lib/bindings/Event';
import type { EventKind } from '$lib/bindings/EventKind';
import type { GoLiveSettings } from '$lib/bindings/GoLiveSettings';
import type { HotkeyReport } from '$lib/bindings/HotkeyReport';
import type { HotkeySettings } from '$lib/bindings/HotkeySettings';
import type { HotkeyStatus } from '$lib/bindings/HotkeyStatus';
import type { LogEntry } from '$lib/bindings/LogEntry';
import type { ObsSnapshot } from '$lib/bindings/ObsSnapshot';
import type { Overlay } from '$lib/bindings/Overlay';
import type { Project } from '$lib/bindings/Project';
import type { QueueState } from '$lib/bindings/QueueState';
import type { ServerInfo } from '$lib/bindings/ServerInfo';
import type { SessionChange } from '$lib/bindings/SessionChange';
import type { SessionListItem } from '$lib/bindings/SessionListItem';
import type { SessionSummary } from '$lib/bindings/SessionSummary';
import type { SummarySettings } from '$lib/bindings/SummarySettings';
import type { Settings } from '$lib/bindings/Settings';
import type { TwitchStatus } from '$lib/bindings/TwitchStatus';
import type { WindowEffect } from '$lib/bindings/WindowEffect';
import type { InteractState } from '$lib/bindings/InteractState';
import type { PollDraft } from '$lib/bindings/PollDraft';
import type { PredictionAction } from '$lib/bindings/PredictionAction';
import type { PredictionDraft } from '$lib/bindings/PredictionDraft';
import type { Redemption } from '$lib/bindings/Redemption';
import type { RedemptionRef } from '$lib/bindings/RedemptionRef';
import type { RedemptionUpdate } from '$lib/bindings/RedemptionUpdate';
import type { Reward } from '$lib/bindings/Reward';

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
  chatModes: 'cw://chat-modes',
  actionRun: 'cw://action-run',
  actionProgress: 'cw://action-progress',
  goLiveOpen: 'cw://golive-open',
  session: 'cw://session',
  redemption: 'cw://redemption'
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
  'cw://chat-modes': ChatModes;
  'cw://action-run': ActionRun;
  'cw://action-progress': RunProgress;
  'cw://golive-open': Record<string, never>;
  'cw://session': SessionChange;
  'cw://redemption': RedemptionUpdate;
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
  listOverlayTemplates: () => call<Overlay[]>('list_overlay_templates'),
  /** Saves a copy of the overlay `id` as a template called `name`. */
  saveOverlayTemplate: (id: string, name: string) => call<Overlay>('save_overlay_template', { id, name }),
  deleteOverlayTemplate: (id: string) => call<void>('delete_overlay_template', { id }),
  overlayFromTemplate: (id: string, name: string) => call<Overlay>('overlay_from_template', { id, name }),
  listAssets: () => call<AssetInfo[]>('list_assets'),
  importAssets: (paths: string[]) => call<AssetInfo[]>('import_assets', { paths }),
  deleteAsset: (name: string) => call<void>('delete_asset', { name }),

  // backups
  listBackups: () => call<BackupInfo[]>('list_backups'),
  /** Null when nothing changed since the last backup. */
  createBackup: () => call<BackupInfo | null>('create_backup'),
  restoreBackup: (file: string) => call<Project>('restore_backup', { file }),
  restoreBackupFile: (path: string) => call<Project>('restore_backup_file', { path }),
  deleteBackup: (file: string) => call<void>('delete_backup', { file }),
  exportBackup: (file: string, path: string) => call<void>('export_backup', { file, path }),
  saveBackupSettings: (backups: BackupSettings) => call<BackupSettings>('save_backup_settings', { backups }),

  projectDir: () => call<string>('project_dir'),
  setProjectDir: (dir: string) => call<void>('set_project_dir', { dir }),

  // alerts
  alertQueue: () => call<QueueState>('alert_queue'),
  alertPause: (paused: boolean) => call<void>('alert_pause', { paused }),
  alertSkip: () => call<void>('alert_skip'),
  alertRemove: (id: string) => call<void>('alert_remove', { id }),
  alertClear: () => call<void>('alert_clear'),
  alertReplay: (eventId: string) => call<void>('alert_replay', { eventId }),
  alertReplayLast: () => call<void>('alert_replay_last'),
  alertMute: (muted: boolean) => call<void>('alert_mute', { muted }),
  testEvent: (kind: EventKind) => call<void>('test_event', { kind }),

  // automation
  runAction: (id: string) => call<void>('run_action', { id }),
  actionsPackage: (ids: string[]) => call<ActionPackage>('actions_package', { ids }),
  exportActions: (ids: string[], path: string) => call<void>('export_actions', { ids, path }),
  readActionsFile: (path: string) => call<ActionPackage>('read_actions_file', { path }),
  parseActionsPackage: (text: string) => call<ActionPackage>('parse_actions_package', { text }),
  importActions: (pkg: ActionPackage, choices: ImportChoices) => call<ImportReport>('import_actions', { package: pkg, choices }),

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

  // stream sessions
  listSessions: (limit = 200) => call<SessionListItem[]>('list_sessions', { limit }),
  sessionSummary: (id: number) => call<SessionSummary>('session_summary', { id }),
  deleteSession: (id: number) => call<void>('delete_session', { id }),
  saveSummarySettings: (summary: SummarySettings) => call<SummarySettings>('save_summary_settings', { summary }),
  /** `base64` is set for images. */
  saveExport: (path: string, data: string, base64 = false) => call<void>('save_export', { path, data, base64 }),

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
  saveGoLive: (golive: GoLiveSettings) => call<GoLiveSettings>('save_golive', { golive }),
  /** Returns the data folder that was made. */
  makePortable: () => call<string>('make_portable'),
  restartApp: () => call<void>('restart_app'),

  // global hotkeys
  saveHotkeys: (hotkeys: HotkeySettings) => call<HotkeyReport>('save_hotkeys', { hotkeys }),
  /** Lets go of every hotkey while one is being recorded. */
  hotkeysRecording: (recording: boolean) => call<HotkeyStatus>('hotkeys_recording', { recording }),

  // go-live check
  goLiveCheck: () => call<Check[]>('golive_check'),
  goLiveFix: (fix: CheckFix) => call<void>('golive_fix', { fix }),

  // twitch
  twitchStatus: () => call<TwitchStatus>('twitch_status'),
  twitchLogin: (role: AccountRole) => call<DeviceLogin>('twitch_login', { role }),
  twitchCancelLogin: (role: AccountRole) => call<void>('twitch_cancel_login', { role }),
  twitchLogout: (role: AccountRole) => call<void>('twitch_logout', { role }),
  twitchSearchCategories: (query: string) => call<Category[]>('twitch_search_categories', { query }),
  twitchUpdateStreamInfo: (title: string, categoryId: string, tags: string[]) =>
    call<void>('twitch_update_stream_info', { title, categoryId, tags }),
  twitchSendChat: (message: string, asBot: boolean, replyTo: string | null = null) =>
    call<void>('twitch_send_chat', { message, asBot, replyTo }),

  // moderation
  twitchDeleteMessage: (messageId: string) => call<void>('twitch_delete_message', { messageId }),
  /** `durationS` null = permanent ban. */
  twitchBan: (userId: string, durationS: number | null, reason: string) => call<void>('twitch_ban', { userId, durationS, reason }),
  twitchUnban: (userId: string) => call<void>('twitch_unban', { userId }),
  twitchShoutout: (login: string) => call<void>('twitch_shoutout', { login }),
  twitchChatModes: () => call<ChatModes>('twitch_chat_modes'),
  /** `value`: slow mode seconds or follower-only minutes. */
  twitchSetChatMode: (mode: ChatMode, on: boolean, value: number | null = null) => call<ChatModes>('twitch_set_chat_mode', { mode, on, value }),
  twitchViewer: (userId: string) => call<ViewerCard>('twitch_viewer', { userId }),

  // channel points, polls and predictions
  rewards: () => call<Reward[]>('twitch_rewards'),
  saveReward: (reward: Reward) => call<Reward>('twitch_save_reward', { reward }),
  deleteReward: (id: string) => call<void>('twitch_delete_reward', { id }),
  redemptions: () => call<Redemption[]>('twitch_redemptions'),
  /** Returns how many changed. */
  finishRedemptions: (items: RedemptionRef[], refund: boolean) => call<number>('twitch_finish_redemptions', { items, refund }),
  interactState: () => call<InteractState>('twitch_interact_state'),
  startPoll: (draft: PollDraft) => call<Event>('twitch_start_poll', { draft }),
  endPoll: () => call<Event>('twitch_end_poll'),
  startPrediction: (draft: PredictionDraft) => call<Event>('twitch_start_prediction', { draft }),
  /** `outcome` is the winning outcome id when resolving. */
  endPrediction: (action: PredictionAction, outcome = '') => call<Event>('twitch_end_prediction', { action, outcome }),

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
