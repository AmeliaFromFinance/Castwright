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
import type { Credits } from '$lib/bindings/Credits';
import type { ViewerCard } from '$lib/bindings/ViewerCard';
import type { BugReportPreview } from '$lib/bindings/BugReportPreview';
import type { Check } from '$lib/bindings/Check';
import type { CrashInfo } from '$lib/bindings/CrashInfo';
import type { HealthSnapshot } from '$lib/bindings/HealthSnapshot';
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
import type { VarRenamed } from '$lib/bindings/VarRenamed';
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
import type { AdSchedule } from '$lib/bindings/AdSchedule';
import type { AdSettings } from '$lib/bindings/AdSettings';
import type { DiscordWebhook } from '$lib/bindings/DiscordWebhook';
import type { MarkerEntry } from '$lib/bindings/MarkerEntry';
import type { MomentEvent } from '$lib/bindings/MomentEvent';
import type { RestartOutcome } from '$lib/bindings/RestartOutcome';
import type { UpdatePlan } from '$lib/bindings/UpdatePlan';
import type { UpdateProgress } from '$lib/bindings/UpdateProgress';
import type { UpdateSettings } from '$lib/bindings/UpdateSettings';
import type { ChatRules } from '$lib/bindings/ChatRules';
import type { MusicSettings } from '$lib/bindings/MusicSettings';
import type { MusicStatus } from '$lib/bindings/MusicStatus';
import type { PlayOutcome } from '$lib/bindings/PlayOutcome';
import type { SoundCue } from '$lib/bindings/SoundCue';
import type { Soundboard } from '$lib/bindings/Soundboard';
import type { SoundboardStatus } from '$lib/bindings/SoundboardStatus';
import type { Giveaway } from '$lib/bindings/Giveaway';
import type { GiveawayRecord } from '$lib/bindings/GiveawayRecord';
import type { GiveawaySettings } from '$lib/bindings/GiveawaySettings';
import type { PlayState } from '$lib/bindings/PlayState';
import type { QueueEntry } from '$lib/bindings/QueueEntry';
import type { QueueSettings } from '$lib/bindings/QueueSettings';
import type { ViewerQueue } from '$lib/bindings/ViewerQueue';
import type { TimerAction } from '$lib/bindings/TimerAction';
import type { TimerChange } from '$lib/bindings/TimerChange';
import type { TimerRun } from '$lib/bindings/TimerRun';

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
  redemption: 'cw://redemption',
  ads: 'cw://ads',
  adWarning: 'cw://ad-warning',
  moment: 'cw://moment',
  updateProgress: 'cw://update-progress',
  updateAsk: 'cw://update-ask',
  music: 'cw://music',
  sound: 'cw://sound',
  soundboard: 'cw://soundboard',
  timers: 'cw://timers'
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
  'cw://ads': AdSchedule;
  'cw://ad-warning': AdSchedule;
  'cw://moment': MomentEvent;
  'cw://update-progress': UpdateProgress;
  'cw://update-ask': Record<string, never>;
  'cw://music': MusicStatus;
  'cw://sound': SoundCue;
  'cw://soundboard': SoundboardStatus;
  'cw://play': PlayState;
  'cw://timers': TimerChange;
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
  savedVarKeys: () => call<string[]>('saved_var_keys'),
  /** Saves `project`, which already has the new name, and moves the value. Backs up first. */
  renameVar: (from: string, to: string, project: Project) => call<VarRenamed>('rename_var', { from, to, project }),
  resetSession: () => call<void>('reset_session'),

  // history
  recentEvents: (limit: number, kinds: string[] = [], search = '', includeTests = false) =>
    call<Event[]>('recent_events', { limit, kinds, search, includeTests }),
  recentChat: () => call<Event[]>('recent_chat'),
  clearHistory: () => call<void>('clear_history'),
  exportHistoryCsv: (path: string) => call<number>('export_history_csv', { path }),
  getLogs: () => call<LogEntry[]>('get_logs'),
  openLink: (url: string) => call<void>('open_link', { url }),

  // stream sessions
  listSessions: (limit = 200) => call<SessionListItem[]>('list_sessions', { limit }),
  sessionSummary: (id: number) => call<SessionSummary>('session_summary', { id }),
  deleteSession: (id: number) => call<void>('delete_session', { id }),
  /** Names for credits layers: the live stream, else the last one. */
  sessionCredits: () => call<Credits>('session_credits'),
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

  // health and bug reports
  healthSnapshot: () => call<HealthSnapshot>('health_snapshot'),
  reloadOverlay: (id: string) => call<void>('reload_overlay', { id }),
  /** The crash that ended the last run, once. */
  crashNotice: () => call<CrashInfo | null>('crash_notice'),
  /** `window`: facts only the app window knows, added to the report. */
  bugReportPreview: (includeProject: boolean, window: unknown) => call<BugReportPreview>('bug_report_preview', { includeProject, window }),
  saveBugReport: (path: string, includeProject: boolean, window: unknown) => call<void>('save_bug_report', { path, includeProject, window }),

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

  // ads
  adSchedule: () => call<AdSchedule>('twitch_ad_schedule'),
  snoozeAd: () => call<AdSchedule>('twitch_snooze_ad'),
  /** Snapped to a length Twitch allows, 30 to 180 seconds. */
  runAd: (lengthS: number) => call<void>('twitch_run_ad', { lengthS }),
  saveAdSettings: (ads: AdSettings) => call<AdSettings>('save_ad_settings', { ads }),

  // markers and clips
  addMarker: () => call<MarkerEntry>('stream_add_marker'),
  markerNote: (id: string, note: string) => call<void>('stream_marker_note', { id, note }),
  /** Returns the clip id; the link follows as a `cw://moment` event. */
  createClip: () => call<string>('stream_create_clip'),

  // updates
  updatePrepare: () => call<UpdatePlan>('update_prepare'),
  /** Progress arrives as `cw://update-progress`. */
  updateDownload: () => call<void>('update_download'),
  /** `confirmed`: restart even while live. */
  updateRestart: (confirmed = false) => call<RestartOutcome>('update_restart', { confirmed }),
  updateCancelRestart: () => call<void>('update_cancel_restart'),
  saveUpdateSettings: (settings: UpdateSettings) => call<UpdateSettings>('save_update_settings', { settings }),
  /** tauri-plugin-process */
  relaunch: () => call<void>('plugin:process|restart'),

  // discord
  /** `url`: null keeps the saved link, '' removes it. */
  saveDiscordWebhook: (webhook: DiscordWebhook, url: string | null) => call<DiscordWebhook>('save_discord_webhook', { webhook, url }),
  deleteDiscordWebhook: (id: string) => call<void>('delete_discord_webhook', { id }),
  discordSendTest: (id: string) => call<void>('discord_send_test', { id }),

  // music
  musicStatus: () => call<MusicStatus>('music_status'),
  saveMusicSettings: (music: MusicSettings) => call<MusicSettings>('save_music_settings', { music }),
  /** The app shows the song. Repeat within 90 seconds to keep it fresh. */
  musicWatch: (on: boolean) => call<void>('music_watch', { on }),
  /** Returns the Spotify page to open in the browser. */
  spotifyLogin: () => call<string>('spotify_login'),
  spotifyCancelLogin: () => call<void>('spotify_cancel_login'),
  spotifyLogout: () => call<void>('spotify_logout'),

  // soundboard
  soundboardStatus: () => call<SoundboardStatus>('soundboard_status'),
  /** The mute isn't changed here; use soundboardMute. */
  saveSoundboard: (board: Soundboard) => call<Soundboard>('save_soundboard', { board }),
  soundPlay: (id: string) => call<PlayOutcome>('sound_play', { id }),
  /** `id` null stops every sound. */
  soundStop: (id: string | null = null) => call<void>('sound_stop', { id }),
  soundboardMute: (muted: boolean) => call<SoundboardStatus>('soundboard_mute', { muted }),
  // timer layers
  timerStates: () => call<Record<string, TimerRun>>('timer_states'),
  /** `seconds` is for add; below 0 takes time off. */
  timerControl: (layerId: string, action: TimerAction, seconds = 0) => call<TimerRun>('timer_control', { layerId, action, seconds }),

  // giveaways and the viewer queue
  playState: () => call<PlayState>('play_state'),
  saveGiveawaySettings: (settings: GiveawaySettings) => call<GiveawaySettings>('save_giveaway_settings', { settings }),
  giveawayOpen: (settings: GiveawaySettings) => call<Giveaway>('giveaway_open', { settings }),
  /** Open or close entries. */
  giveawaySetOpen: (open: boolean) => call<Giveaway>('giveaway_set_open', { open }),
  giveawayDraw: (count: number) => call<Giveaway>('giveaway_draw', { count }),
  giveawayReroll: (userId: string) => call<Giveaway>('giveaway_reroll', { userId }),
  giveawayClaim: (userId: string) => call<Giveaway>('giveaway_claim', { userId }),
  giveawayRemove: (userId: string) => call<Giveaway>('giveaway_remove', { userId }),
  /** Saves it to history and clears it. */
  giveawayFinish: () => call<GiveawayRecord | null>('giveaway_finish'),
  giveawayHistory: (limit = 200) => call<GiveawayRecord[]>('giveaway_history', { limit }),
  giveawayDeleteRecord: (id: string) => call<void>('giveaway_delete_record', { id }),
  saveQueueSettings: (settings: QueueSettings) => call<QueueSettings>('save_queue_settings', { settings }),
  queueSetOpen: (open: boolean) => call<ViewerQueue>('queue_set_open', { open }),
  /** `count` 0 = the party size. */
  queueNext: (count: number, random: boolean) => call<QueueEntry[]>('queue_next', { count, random }),
  queueRemove: (userId: string) => call<ViewerQueue>('queue_remove', { userId }),
  queueClear: () => call<ViewerQueue>('queue_clear'),
  /** Moves `userId` in front of `before`, or to the end when null. */
  queueMove: (userId: string, before: string | null) => call<ViewerQueue>('queue_move', { userId, before }),
  queueNote: (userId: string, note: string) => call<ViewerQueue>('queue_note', { userId, note }),

  // chat rules
  saveChatRules: (rules: ChatRules) => call<ChatRules>('save_chat_rules', { rules }),
  saveDefaultFont: (font: string) => call<string>('save_default_font', { font }),

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
