// In-browser stand-in for the Rust backend. Used when the UI runs outside the
// desktop app: development in a browser, end-to-end tests and documentation
// screenshots. Add `?demo=static` to the URL to turn off the simulated activity,
// `&setup` to start at first-time setup, `&ended` to have the stream just end and
// `&oldscopes` for a Twitch sign-in made before the mod tools and `&crashed` for
// the prompt shown after a crash.

import { version as DEMO_VERSION } from '../../../package.json';
import type { Backend, Unlisten } from './backend';
import { isValidVarKey } from '$lib/pages/automation/validate';
import { builtIn } from '$lib/vars/builtins';
import starter from './fixtures/starter-project.json';
import samples from './fixtures/sample-events.json';
import type { Action } from '$lib/bindings/Action';
import type { AlertConfig } from '$lib/bindings/AlertConfig';
import type { AlertPlay } from '$lib/bindings/AlertPlay';
import type { AppearanceSettings } from '$lib/bindings/AppearanceSettings';
import type { AssetInfo } from '$lib/bindings/AssetInfo';
import type { Check } from '$lib/bindings/Check';
import type { CheckFix } from '$lib/bindings/CheckFix';
import type { BackupInfo } from '$lib/bindings/BackupInfo';
import type { BackupReason } from '$lib/bindings/BackupReason';
import type { BackupSettings } from '$lib/bindings/BackupSettings';
import type { Event } from '$lib/bindings/Event';
import type { EventKind } from '$lib/bindings/EventKind';
import type { GoLiveSettings } from '$lib/bindings/GoLiveSettings';
import type { HotkeySettings } from '$lib/bindings/HotkeySettings';
import type { HotkeyStatus } from '$lib/bindings/HotkeyStatus';
import type { LogEntry } from '$lib/bindings/LogEntry';
import type { ObsSnapshot } from '$lib/bindings/ObsSnapshot';
import type { Overlay } from '$lib/bindings/Overlay';
import type { Project } from '$lib/bindings/Project';
import type { QueueState } from '$lib/bindings/QueueState';
import type { Settings } from '$lib/bindings/Settings';
import type { TwitchStatus } from '$lib/bindings/TwitchStatus';
import type { ChatMode } from '$lib/bindings/ChatMode';
import type { ChatModes } from '$lib/bindings/ChatModes';
import type { ViewerCard } from '$lib/bindings/ViewerCard';
import type { CrashInfo } from '$lib/bindings/CrashInfo';
import type { HealthIssue } from '$lib/bindings/HealthIssue';
import type { HealthSnapshot } from '$lib/bindings/HealthSnapshot';
import { worst } from '$lib/health/health';
import { zipFiles } from '$lib/health/zip';
import { evaluateGroup } from '$lib/logic/condition';
import { planRun } from '$lib/pages/automation/graph';
import { applyImport, buildPackage, parsePackage } from '$lib/pages/automation/sharing';
import type { ActionPackage } from '$lib/bindings/ActionPackage';
import type { ImportChoices } from '$lib/bindings/ImportChoices';
import { render } from '$lib/logic/template';
import { ACTION_LABELS, findConflict } from '$lib/pages/settings/hotkeys';
import { DEFAULT_SOCIAL_TEMPLATE } from '$lib/sessions/summary';
import { createInteractMock } from './mock-interact';
import { createAdsMock } from './mock-ads';
import { createMusicMock } from './mock-music';
import { defaultChatRules } from '$lib/overlay/chat-filters';
import { DEFAULT_END as DEFAULT_DISCORD_END } from '$lib/pages/settings/discord';
import { credits, demoClip, demoMarker, listItem, liveActivity, pastSessions, summarize, type DemoPerson, type DemoSession, type MakeEvent } from './mock-sessions';
import { createUpdatesMock } from './mock-updates';

type Listener = (payload: unknown) => void;

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
const uid = () => Math.random().toString(36).slice(2, 14);
const now = () => Date.now();

const VIEWERS = [
  ['nova_kat', '#C9B3FF'],
  ['pixelbyte', '#7FDBFF'],
  ['raiding_rudy', '#9EF08A'],
  ['m0ss', '#F5C451'],
  ['Tomasz', '#FF8A8A'],
  ['quietfox', '#FFB86B'],
  ['LumenLark', '#8AB4FF'],
  ['kettle_drum', '#E59BFF']
] as const;

const CHAT_LINES = [
  'that stinger transition is so clean',
  'what overlay app is this?',
  'hello from the raid!!',
  'gg on that round EZ Clap',
  'first time here, love the vibe',
  'peepoHappy the alerts are so smooth',
  'that was close monkaS',
  'can you show the settings again?',
  'how long have you been streaming today?',
  'hype hype hype FeelsDankMan RainTime'
];

const BADGE_IMAGES: Record<string, string> = {
  moderator: '3267646d-33f0-4b17-b3df-f923a41db1d0',
  vip: 'b817aba4-fad8-49e2-b88a-7cc744dfa6ec',
  subscriber: '5d9f2208-5dd8-11e7-8513-2ff4adfae661'
};

function badgeImages(names: string[]) {
  return names.map((set_id) => {
    const base = `https://static-cdn.jtvnw.net/badges/v1/${BADGE_IMAGES[set_id]}`;
    return { set_id, id: set_id === 'subscriber' ? '0' : '1', title: set_id === 'vip' ? 'VIP' : set_id[0]!.toUpperCase() + set_id.slice(1), url_1x: `${base}/1`, url_2x: `${base}/2`, url_4x: `${base}/3` };
  });
}

const DEMO_ROLES: Record<string, DemoPerson['role']> = { pixelbyte: 'mod', LumenLark: 'mod', m0ss: 'vip' };

function demoPerson(name: string): DemoPerson {
  const i = VIEWERS.findIndex(([n]) => n === name);
  return { user_id: i >= 0 ? String(1000 + i) : '', login: name.toLowerCase(), role: DEMO_ROLES[name] ?? '' };
}

function demoEvent(kind: EventKind, i: number, ago: number): Event {
  const base = clone((samples as unknown as Event[]).find((e) => e.kind === kind)!);
  const [name] = VIEWERS[i % VIEWERS.length]!;
  base.id = uid();
  base.ts = now() - ago;
  base.test = false;
  if (base.user) base.user = { id: String(1000 + (i % VIEWERS.length)), login: name.toLowerCase(), display_name: name };
  if (kind === 'redemption') base.data = { ...base.data, redemption_id: uid(), status: 'unfulfilled' };
  return base;
}

function chatEvent(i: number, ago = 0, text?: string): Event {
  const [name, color] = VIEWERS[i % VIEWERS.length]!;
  const message = text ?? CHAT_LINES[i % CHAT_LINES.length]!;
  const badges = [i % 5 === 1 && 'moderator', i % 7 === 3 && 'vip', i % 2 === 0 && 'subscriber'].filter((b): b is string => !!b);
  return {
    id: uid(),
    kind: 'chat',
    ts: now() - ago,
    user: { id: String(1000 + (i % VIEWERS.length)), login: name.toLowerCase(), display_name: name },
    amount: null,
    currency: null,
    tier: null,
    months: null,
    message,
    message_parts: [{ type: 'text', text: message }],
    roles: { broadcaster: false, moderator: i % 5 === 1, vip: i % 7 === 3, subscriber: i % 2 === 0 },
    is_gift: false,
    is_anonymous: false,
    recipient: null,
    data: { color, badges, badge_images: badgeImages(badges) },
    test: false
  };
}

function defaultSettings(): Settings {
  return {
    first_run_done: true,
    project_dir: '',
    obs: { host: '127.0.0.1', port: 4455, auto_connect: true, has_password: true },
    twitch: { client_id: '' },
    server: { port: 7470, token: 'demo0123456789abcdef0123456789ab', allow_lan: false },
    appearance: {
      theme: 'dark',
      custom_themes: [],
      window_effect: 'auto',
      ui_scale: 100,
      reduce_motion: false
    },
    alerts_muted: false,
    golive: {
      open_on_live: true,
      items: [
        { id: 'mic', label: 'Mic on and not muted' },
        { id: 'water', label: 'Water bottle filled' }
      ]
    },
    backups: { keep_daily: 14, keep_other: 5 },
    hotkeys: {
      enabled: true,
      bindings: [
        { action: { type: 'replay_last_alert' }, keys: 'Ctrl+Alt+R' },
        { action: { type: 'skip_alert' }, keys: 'Ctrl+Alt+S' },
        { action: { type: 'toggle_alert_pause' }, keys: 'Ctrl+Alt+P' }
      ]
    },
    summary: { social_template: DEFAULT_SOCIAL_TEMPLATE },
    ads: { warn: true, warn_minutes: 1 },
    updates: { auto_install: false, channel: 'stable' },
    music: { source: 'spotify', spotify_client_id: 'demo-client-id', text_file: '', text_format: '{artist} - {title}' },
    discord: {
      webhooks: [
        {
          id: 'demo-hook',
          name: '#stream-alerts',
          on_live: true,
          on_end: true,
          live_template: '{{channel}} is live with {{category}}! Come hang out.',
          end_template: DEFAULT_DISCORD_END,
          mention: '<@&112233445566778899>',
          edit_on_end: true,
          has_url: true
        }
      ]
    }
  };
}

/** Registering does nothing in the browser; the settings are still saved. */
const DEMO_HOTKEYS: HotkeyStatus = {
  available: false,
  note: 'Global hotkeys only work in the desktop app. Changes here are still saved.',
  active: 0,
  errors: []
};

function cleanHotkeys(h: HotkeySettings): HotkeySettings {
  const seen = new Set<string>();
  const bindings = h.bindings.filter((b) =>
    b.action.type === 'run_action' ? !!b.action.action_id.trim() : !seen.has(b.action.type) && !!seen.add(b.action.type)
  );
  bindings.forEach((b, i) => {
    const other = findConflict(bindings, b.keys, i);
    if (other >= 0 && other < i) {
      const label = (x: typeof b) => (x.action.type === 'run_action' ? 'Run an action' : ACTION_LABELS[x.action.type]);
      throw {
        code: 'user',
        message: `${b.keys} is set for both "${label(bindings[other]!)}" and "${label(b)}". Pick a different combination for one of them.`
      };
    }
  });
  return { enabled: h.enabled, bindings };
}

/** Same scopes the desktop app asks Twitch for. */
const BROADCASTER_SCOPES = [
  'channel:read:subscriptions',
  'bits:read',
  'moderator:read:followers',
  'moderator:manage:chat_settings',
  'moderator:manage:shield_mode',
  'channel:read:redemptions',
  'channel:manage:redemptions',
  'channel:read:hype_train',
  'channel:read:polls',
  'channel:manage:polls',
  'channel:read:predictions',
  'channel:manage:predictions',
  'user:read:chat',
  'user:write:chat',
  'channel:bot',
  'moderator:read:shoutouts',
  'moderator:manage:shoutouts',
  'moderator:manage:announcements',
  'channel:read:ads',
  'channel:manage:ads',
  'channel:edit:commercial',
  'channel:read:charity',
  'channel:manage:broadcast',
  'clips:edit',
  'moderator:manage:banned_users',
  'moderator:manage:chat_messages',
  'moderator:read:chatters'
];

function demoObs(): ObsSnapshot {
  return {
    state: 'connected',
    error: null,
    obs_version: '32.1.0',
    websocket_version: '5.6.2',
    scenes: ['Starting soon', 'Just Chatting', 'Gameplay', 'BRB', 'Ending'],
    program_scene: 'Gameplay',
    preview_scene: 'Just Chatting',
    studio_mode: true,
    scene_items: [
      { id: 6, name: 'Castwright · Gameplay HUD', kind: 'browser_source', visible: true, locked: true, is_group: false },
      { id: 5, name: 'Webcam', kind: 'v4l2_input', visible: true, locked: false, is_group: false },
      { id: 4, name: 'Game capture', kind: 'game_capture', visible: true, locked: false, is_group: false },
      { id: 3, name: 'Background music', kind: 'ffmpeg_source', visible: true, locked: false, is_group: false },
      { id: 2, name: 'Backdrop', kind: 'image_source', visible: false, locked: false, is_group: false }
    ],
    inputs: [
      { name: 'Mic', kind: 'wasapi_input_capture', volume_db: -3.5, muted: false, monitoring: false },
      { name: 'Desktop audio', kind: 'wasapi_output_capture', volume_db: -8, muted: false, monitoring: false },
      { name: 'Game', kind: 'wasapi_process_output_capture', volume_db: -11.5, muted: false, monitoring: false },
      { name: 'Background music', kind: 'ffmpeg_source', volume_db: -20, muted: false, monitoring: true }
    ],
    stream: { active: true, paused: false, duration_ms: 5_025_000 },
    record: { active: true, paused: false, duration_ms: 5_025_000 },
    replay_buffer: true,
    virtual_cam: false,
    transitions: ['Cut', 'Fade', 'Stinger', 'Move'],
    current_transition: 'Stinger',
    transition_ms: 400,
    stats: {
      cpu_percent: 7.2,
      memory_mb: 612,
      active_fps: 60,
      render_skipped_percent: 0,
      output_skipped_percent: 0,
      stream_kbps: 6020,
      stream_dropped_percent: 0
    },
    base_width: 1920,
    base_height: 1080
  };
}

function demoTwitch(): TwitchStatus {
  return {
    broadcaster: {
      id: '1337',
      login: 'castwright',
      display_name: 'Castwright',
      profile_image_url: '',
      scopes: [...BROADCASTER_SCOPES]
    },
    bot: { id: '2000', login: 'castwright_bot', display_name: 'castwright_bot', profile_image_url: '', scopes: [] },
    eventsub: 'connected',
    error: null,
    failed_subscriptions: [],
    stream: {
      live: true,
      viewers: 1284,
      title: 'Ranked grind and overlay tinkering · !commands',
      category: 'Just Chatting',
      category_id: '509658',
      tags: ['English', 'Chill'],
      started_at: now() - 5_025_000
    },
    has_client_id: true
  };
}

/** Green-ish placeholder "game footage" so previews aren't blank. */
function sceneImage(scene: string, w: number): string {
  const h = Math.round((w * 9) / 16);
  const hue = [...scene].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 1920 1080">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,28%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},40%,10%)"/></linearGradient>
<radialGradient id="r" cx="0.6" cy="0.45" r="0.6"><stop offset="0" stop-color="hsla(${(hue + 30) % 360},70%,60%,0.35)"/><stop offset="1" stop-color="transparent"/></radialGradient></defs>
<rect width="1920" height="1080" fill="url(#g)"/><rect width="1920" height="1080" fill="url(#r)"/>
<path d="M0 820 L420 620 L760 760 L1120 540 L1500 700 L1920 560 L1920 1080 L0 1080Z" fill="hsla(${hue},30%,6%,0.55)"/>
<rect x="48" y="764" width="460" height="260" rx="18" fill="#202838" stroke="#fff" stroke-width="6"/>
<circle cx="278" cy="870" r="58" fill="#3a4660"/><rect x="198" y="934" width="160" height="70" rx="35" fill="#3a4660"/>
<rect x="48" y="48" width="560" height="110" rx="14" fill="rgba(12,15,22,0.78)"/>
<rect x="72" y="118" width="512" height="14" rx="7" fill="rgba(255,255,255,0.14)"/><rect x="72" y="118" width="410" height="14" rx="7" fill="#5b8def"/>
<text x="72" y="96" font-family="Inter,Arial" font-size="28" font-weight="700" fill="#fff">Sub goal</text>
<rect x="1392" y="200" width="480" height="640" rx="14" fill="rgba(12,15,22,0.78)"/>
<text x="960" y="560" text-anchor="middle" font-family="Inter,Arial" font-size="44" font-weight="700" fill="rgba(255,255,255,0.18)">${scene.replace(/[<&>]/g, '')}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function createDemoBackend(): Backend {
  const listeners = new Map<string, Set<Listener>>();
  const emit = (name: string, payload: unknown) => {
    for (const cb of listeners.get(name) ?? []) cb(clone(payload));
  };
  const staticMode =
    typeof location !== 'undefined' && new URLSearchParams(location.search).get('demo') === 'static';

  let project = clone(starter as unknown as Project);
  project.chat_rules ??= defaultChatRules();
  let templates: Overlay[] = [];
  let settings = defaultSettings();
  const deaths = project.actions.find((a) => a.name === 'Count deaths');
  if (deaths) settings.hotkeys.bindings.push({ action: { type: 'run_action', action_id: deaths.id }, keys: 'Ctrl+Alt+D' });
  const obs = demoObs();
  const twitch = demoTwitch();
  const signedIn = { broadcaster: twitch.broadcaster, bot: twitch.bot };
  const query = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  if (query.has('setup')) {
    settings.first_run_done = false;
    twitch.broadcaster = null;
    twitch.bot = null;
  }
  // A sign-in from before the mod tools existed.
  if (query.has('oldscopes') && twitch.broadcaster) {
    twitch.broadcaster.scopes = twitch.broadcaster.scopes.filter((s) => !/chat_settings|shield_mode/.test(s));
  }
  const queue: QueueState = { paused: false, muted: settings.alerts_muted, playing: null, waiting: [], last: null };
  const logs: LogEntry[] = [
    { ts: now() - 5_100_000, level: 'info', source: 'obs', message: 'Connected to OBS 32.1.0' },
    { ts: now() - 5_095_000, level: 'info', source: 'twitch', message: 'Listening for 28 kinds of Twitch events' },
    { ts: now() - 5_094_000, level: 'warn', source: 'twitch', message: "Can't listen for channel.hype_train.begin: Castwright is missing permission to read Hype Trains. Sign out and in again." },
    { ts: now() - 5_025_000, level: 'info', source: 'twitch', message: 'Stream went live' },
    { ts: now() - 2_410_000, level: 'warn', source: 'twitch', message: 'Lost connection to Twitch events (no keepalive from Twitch). Reconnecting.' },
    { ts: now() - 2_405_000, level: 'info', source: 'twitch', message: 'Connected to Twitch events' },
    { ts: now() - 640_000, level: 'warn', source: 'automation', message: '"Count deaths" ran too many times in a row and was paused for a few seconds.' }
  ];
  const history: Event[] = [];
  const chat: Event[] = [];
  const modes: ChatModes = { shield: false, slow: false, slow_wait_s: 0, followers: false, followers_minutes: 0, subscribers: false, emotes: false, unique: false };
  /** Banned user ids, with when a timeout ends (null = permanent). */
  const banned = new Map<string, number | null>();
  const kinds: Array<[EventKind, number]> = [
    ['follow', 0],
    ['sub', 1],
    ['cheer', 2],
    ['raid', 3],
    ['resub', 4],
    ['redemption', 5],
    ['community_gift', 6],
    ['follow', 7],
    ['hype_train_begin', 0]
  ];
  kinds.forEach(([k, i], n) => history.unshift(demoEvent(k, i, (kinds.length - n) * 95_000)));
  for (let i = 0; i < 18; i++) chat.push(chatEvent(i, (18 - i) * 21_000));
  // Lines for chat filters: a bot, a command, a first-time chatter, a mention and a highlighted message.
  const extra = (name: string, color: string, text: string, ago: number, data: Record<string, unknown> = {}): Event => {
    const e = chatEvent(0, ago, text);
    e.user = { id: `9${name.length}${ago}`, login: name.toLowerCase(), display_name: name };
    e.roles = { broadcaster: false, moderator: false, vip: false, subscriber: false };
    e.data = { color, badges: [], badge_images: [], ...data };
    return e;
  };
  chat.push(
    extra('Nightbot', '#7C7CE1', 'Follow the socials! castwright.sinist3r.lol', 150_000),
    extra('glitchgoose', '#5FD3A5', '!uptime', 115_000),
    extra('tinyowl', '#FFB4A2', 'hi! first time catching a stream, the alerts are lovely', 73_000, { first_chat: true }),
    extra('river_dev', '#9AD0FF', '@Castwright what font is the chat in?', 52_000),
    extra('wren_plays', '#F5C451', 'Happy stream day everyone!', 33_000, { message_type: 'channel_points_highlighted' })
  );
  chat.sort((a, b) => a.ts - b.ts);

  const makeEvent: MakeEvent = (kind, i, ts) => ({ ...demoEvent(kind, i, 0), ts });
  const sessions: DemoSession[] = pastSessions(
    now(),
    VIEWERS.map(([name]) => name),
    makeEvent
  );
  const liveSession: DemoSession = {
    session: {
      id: sessions.length + 1,
      started_at: twitch.stream.started_at,
      ended_at: null,
      source: 'twitch',
      title: twitch.stream.title,
      categories: [twitch.stream.category],
      peak_viewers: 1342,
      avg_viewers: 1187
    },
    events: history,
    chat: [],
    firstChatters: ['quietfox', 'LumenLark'],
    alerts: 9,
    actions: 4,
    markers: [
      demoMarker(1, twitch.stream.started_at + 1_520_000, twitch.stream.started_at, 'Clutch round'),
      demoMarker(2, now() - 1_800_000, twitch.stream.started_at, ''),
      demoMarker(3, now() - 620_000, twitch.stream.started_at, 'Chat picked the next level')
    ],
    clips: [demoClip(now() - 1_790_000, 'No way that worked', 'Tonight1'), demoClip(now() - 300_000, 'Raid train arrives', 'Tonight2')],
    raidsOut: []
  };
  sessions.push(liveSession);
  const earlier = liveActivity(twitch.stream.started_at, now(), VIEWERS.map(([name]) => name), makeEvent);
  const sessionSummary = (d: DemoSession) => {
    if (d === liveSession) {
      const recent = chat.filter((c) => !c.roles.broadcaster && c.user).map((c) => ({ ts: c.ts, name: c.user!.display_name }));
      return summarize({ ...d, events: [...earlier.events, ...history], chat: [...earlier.chat, ...recent] }, now());
    }
    return summarize(d, now());
  };
  // Sent once the app listens, like the desktop app does a few seconds after the stream ends.
  let endedPending = false;
  if (query.has('ended')) {
    twitch.stream.live = false;
    twitch.stream.viewers = 0;
    obs.stream.active = false;
    liveSession.session.ended_at = now();
    endedPending = true;
  }
  const vars: Record<string, unknown> = {
    'session.follows': 38,
    'session.subs': 16,
    'session.gifts': 5,
    'session.bits': 2400,
    'session.raids': 2,
    'session.donations': 10,
    'last.follow.name': 'kettle_drum',
    'last.sub.name': 'pixelbyte',
    'last.sub.tier': 1,
    'last.cheer.name': 'raiding_rudy',
    'last.cheer.amount': 500,
    'last.raid.name': 'm0ss',
    'last.raid.viewers': 212,
    'last.event.name': 'kettle_drum',
    'last.event.kind': 'follow',
    'counter.deaths': 7,
    'stream.live': true,
    'stream.viewers': 1284,
    'stream.title': twitch.stream.title,
    'stream.category': twitch.stream.category,
    'stream.started_at': twitch.stream.started_at,
    'stream.uptime_text': '1h 23m',
    'obs.scene': obs.program_scene,
    'twitch.login': twitch.broadcaster?.login ?? '',
    'twitch.display_name': twitch.broadcaster?.display_name ?? '',
    'twitch.user_id': twitch.broadcaster?.id ?? '',
    'twitch.bot_login': twitch.bot?.login ?? ''
  };
  const assets: AssetInfo[] = [
    { name: 'fanfare.ogg', path: 'assets/fanfare.ogg', bytes: 182_331, kind: 'audio' },
    { name: 'gold-confetti.webm', path: 'assets/gold-confetti.webm', bytes: 2_411_002, kind: 'video' },
    { name: 'logo.png', path: 'assets/logo.png', bytes: 48_120, kind: 'image' },
    { name: 'stinger.webm', path: 'assets/stinger.webm', bytes: 3_920_441, kind: 'video' }
  ];
  // Backups live in memory: each keeps a copy of the project and saved variables.
  interface MockBackup {
    info: BackupInfo;
    project: Project;
    vars: Record<string, unknown>;
    key: string;
  }
  const isLive = (k: string) => /^(stream|obs|twitch|ads|music)\./.test(k);
  /** Variables set without "Keep after restart". */
  const sessionOnly = new Set<string>();
  const savedVars = () => Object.fromEntries(Object.entries(vars).filter(([k]) => !isLive(k) && !sessionOnly.has(k)));
  const contentKey = () => JSON.stringify([project, savedVars()]);
  const isDaily = (r: BackupReason) => r === 'startup' || r === 'daily';
  const backupEntry = (reason: BackupReason, ts: number, key = contentKey()): MockBackup => {
    const stamp = new Date(ts).toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-');
    return {
      info: {
        file: `${stamp}Z_${reason.replace('_', '-')}.cwbackup`,
        ts,
        reason,
        bytes: Math.round(JSON.stringify(project).length / 4),
        project: project.name
      },
      project: clone(project),
      vars: savedVars(),
      key
    };
  };
  const backups: MockBackup[] = [
    backupEntry('startup', now() - 2 * 3_600_000),
    backupEntry('daily', now() - 26 * 3_600_000, 'seed-1'),
    backupEntry('before_restore', now() - 50 * 3_600_000, 'seed-2'),
    backupEntry('daily', now() - 74 * 3_600_000, 'seed-3')
  ];
  const pruneBackups = () => {
    const { keep_daily, keep_other } = settings.backups;
    const days: number[] = [];
    let others = 0;
    for (const b of [...backups]) {
      const day = Math.floor(b.info.ts / 86_400_000);
      const keep = isDaily(b.info.reason)
        ? days.at(-1) !== day && days.length < keep_daily && days.push(day)
        : others++ < keep_other;
      if (!keep) backups.splice(backups.indexOf(b), 1);
    }
  };
  const makeBackup = (reason: BackupReason): BackupInfo | null => {
    if (backups[0]?.key === contentKey()) return null;
    const b = backupEntry(reason, Math.max(now(), (backups[0]?.info.ts ?? 0) + 1));
    backups.unshift(b);
    pruneBackups();
    return b.info;
  };
  const restoreFrom = (b: MockBackup) => {
    makeBackup('before_restore');
    project = clone(b.project);
    const changes: Record<string, unknown> = {};
    for (const k of Object.keys(vars)) {
      if (!isLive(k) && !(k in b.vars)) {
        delete vars[k];
        changes[k] = null;
      }
    }
    setVars({ ...changes, ...clone(b.vars) });
    emit('cw://project', {});
    return project;
  };
  let levelsTimer: ReturnType<typeof setInterval> | null = null;

  const setVars = (changes: Record<string, unknown>) => {
    Object.assign(vars, changes);
    emit('cw://vars', changes);
  };

  const log = (level: LogEntry['level'], source: string, message: string) => {
    const entry = { ts: now(), level, source, message };
    logs.push(entry);
    emit('cw://log', entry);
  };

  const emitQueue = () => emit('cw://queue', queue);
  let runIds = 0;

  let playing = false;
  let finish: ReturnType<typeof setTimeout> | null = null;
  const done = () => {
    finish = null;
    queue.playing = null;
    playing = false;
    emitQueue();
    setTimeout(pump, 600);
  };
  const pump = () => {
    if (playing || queue.paused || queue.waiting.length === 0) return;
    const play = queue.waiting.shift()!;
    queue.playing = play;
    queue.last = play;
    playing = true;
    emitQueue();
    finish = setTimeout(done, play.duration_ms);
  };
  const skip = () => {
    if (!finish) return;
    clearTimeout(finish);
    done();
  };

  const alertFor = (e: Event): AlertPlay | null => {
    const type = project.alerts.types.find((t) => t.kind === e.kind && t.enabled);
    const ctx = { ...vars, ...e, name: e.user?.display_name ?? (e.is_anonymous ? 'Anonymous' : ''), recipient_name: e.recipient?.display_name ?? '' };
    const v = type?.variations.find((x) => x.enabled && evaluateGroup(x.conditions, ctx));
    if (!v) return null;
    return {
      id: uid(),
      kind: e.kind,
      event: e,
      variation_id: v.id,
      priority: v.priority,
      title: render(v.title, ctx),
      message: render(v.message, ctx),
      image: v.image,
      video: v.video,
      sound: v.sound,
      volume: v.volume,
      duration_ms: v.duration_ms,
      enter: v.enter,
      exit: v.exit,
      layout: v.layout,
      title_style: v.title_style,
      message_style: v.message_style,
      accent: v.accent,
      background: v.background,
      card: v.card ?? null,
      tts: v.tts
    };
  };

  const publish = (e: Event) => {
    if (e.kind === 'chat') {
      chat.push(e);
      if (chat.length > 200) chat.shift();
    } else {
      history.unshift(e);
      const play = alertFor(e);
      if (play) {
        queue.waiting.push(play);
        queue.waiting.sort((a, b) => b.priority - a.priority);
        emitQueue();
        pump();
      }
    }
    emit('cw://event', e);
    interact.onRedemption(e);
  };
  const interact = createInteractMock({ emit, publish, uid, staticMode, viewers: VIEWERS.map(([name]) => name) });
  const ads = createAdsMock({
    emit,
    listening: (name) => (listeners.get(name)?.size ?? 0) > 0,
    setVars,
    log,
    staticMode,
    settings: () => settings,
    start: query.get('ads'),
    channel: () => ({
      channel: twitch.broadcaster?.display_name ?? 'Castwright',
      login: twitch.broadcaster?.login ?? 'castwright',
      title: twitch.stream.title,
      category: twitch.stream.category,
      image: twitch.broadcaster?.profile_image_url ?? ''
    })
  });
  ads.publish();
  const music = createMusicMock({ emit, setVars, settings: () => settings, staticMode });
  music.publish();

  if (!staticMode && typeof window !== 'undefined') {
    let n = 0;
    setInterval(() => {
      n++;
      const line = chatEvent(n + 18);
      const until = banned.get(line.user!.id);
      if (until === undefined || (until !== null && until < now())) publish(line);
      if (n % 9 === 0) {
        const pick: EventKind[] = ['follow', 'sub', 'cheer', 'follow', 'redemption'];
        publish(demoEvent(pick[(n / 9) % pick.length]!, n, 0));
      }
      obs.stream.duration_ms += 4000;
      obs.record.duration_ms += 4000;
      obs.stats.stream_kbps = 5900 + Math.round(Math.random() * 220);
      obs.stats.cpu_percent = 6 + Math.round(Math.random() * 30) / 10;
      emit('cw://obs', obs);
    }, 4000);
  }

  // A short version of src-tauri/src/golive.rs for the demo.
  const goLiveChecks = (): Check[] => {
    const c = (id: string, label: string, status: Check['status'], detail: string, fix: CheckFix | null = null): Check => ({ id, label, status, detail, fix });
    const out: Check[] = [];
    const connected = obs.state === 'connected';
    out.push(connected ? c('obs', 'OBS', 'pass', `Connected to OBS ${obs.obs_version}`) : c('obs', 'OBS', 'fail', 'Not connected.', { type: 'connect_obs' }));
    if (connected) {
      for (const item of obs.scene_items.filter((i) => i.kind === 'browser_source' && i.name.startsWith('Castwright · '))) {
        const o = project.overlays.find((x) => `Castwright · ${x.name}` === item.name);
        out.push(o ? c(`overlay:${item.name}`, `${o.name} in OBS`, 'pass', 'Loaded') : c(`overlay:${item.name}`, item.name, 'fail', 'Points at an overlay that no longer exists. Remove it in OBS.'));
      }
    } else {
      out.push(c('overlays', 'Overlays in OBS', 'warn', 'Connect OBS to check them.'));
    }
    out.push(c('server', 'Overlay server', 'pass', `Running at http://127.0.0.1:${settings.server.port}`));
    out.push(
      twitch.broadcaster
        ? c('twitch', 'Twitch', 'pass', `Signed in as ${twitch.broadcaster.display_name}`)
        : c('twitch', 'Twitch', 'fail', 'Not signed in.', { type: 'open', place: 'settings:twitch' })
    );
    if (twitch.broadcaster) {
      const { title, category } = twitch.stream;
      out.push(title.trim() ? c('title', 'Stream title', 'pass', title.trim()) : c('title', 'Stream title', 'fail', 'No title set.', { type: 'open', place: 'activity' }));
      out.push(category.trim() ? c('category', 'Category', 'pass', category.trim()) : c('category', 'Category', 'fail', 'No category set.', { type: 'open', place: 'activity' }));
    }
    out.push(queue.paused ? c('alerts_paused', 'Alerts', 'fail', 'Paused. New alerts wait in the queue.', { type: 'resume_alerts' }) : c('alerts_paused', 'Alerts', 'pass', 'Playing'));
    out.push(queue.muted ? c('alerts_muted', 'Alert sound', 'warn', 'Muted. Alerts play without sound.', { type: 'unmute_alerts' }) : c('alerts_muted', 'Alert sound', 'pass', 'On'));
    if (connected) out.push(c('disk', 'Recording space', 'pass', '412.6 GB free'));
    return out;
  };

  // A short version of src-tauri/src/diag for the demo.
  const startedAt = now() - 5_160_000;
  const overlayOpened = new Map<string, number>();
  project.overlays.forEach((o, i) => {
    if (i < 2) overlayOpened.set(o.id, startedAt + 60_000 * (i + 1));
  });
  const healthSnapshot = (): HealthSnapshot => {
    const ts = now();
    const failed = [{ kind: 'channel.hype_train.begin', reason: 'Castwright is missing permission to read Hype Trains. Sign out and in again.' }];
    const renderLag = 1.4;
    const issues: HealthIssue[] = [];
    if (obs.state === 'connected' && renderLag >= 1) {
      issues.push({ level: 'warn', area: 'obs', text: `${renderLag.toFixed(1)}% of frames rendered late. The GPU is too busy.` });
    }
    if (twitch.broadcaster) issues.push({ level: 'warn', area: 'twitch', text: `Twitch isn't sending ${failed[0]!.kind} events.` });
    return {
      ts,
      level: worst(issues.map((i) => i.level)),
      issues,
      overlays: project.overlays.map((o, i) => {
        const opened = overlayOpened.get(o.id);
        return {
          id: o.id,
          name: o.name,
          pages: opened ? [{ agent: 'OBS 32', since: opened }, ...(i === 0 ? [{ agent: 'Chrome', since: ts - 300_000 }] : [])] : [],
          last_connect: opened ?? (i === 2 ? startedAt + 30_000 : null),
          last_disconnect: i === 2 ? ts - 1_500_000 : null
        };
      }),
      obs: {
        state: obs.state,
        error: obs.error,
        version: obs.obs_version,
        websocket_version: obs.websocket_version,
        scene: obs.program_scene,
        streaming: obs.stream.active,
        recording: obs.record.active,
        stream_ms: obs.stream.duration_ms,
        record_ms: obs.record.duration_ms,
        dropped_percent: obs.stats.stream_dropped_percent,
        render_lag_percent: renderLag,
        encoder_lag_percent: obs.stats.output_skipped_percent,
        cpu_percent: obs.stats.cpu_percent,
        fps: obs.stats.active_fps
      },
      twitch: {
        has_client_id: twitch.has_client_id,
        signed_in: !!twitch.broadcaster,
        login: twitch.broadcaster?.login ?? '',
        bot_login: twitch.bot?.login ?? null,
        token_expires_at: twitch.broadcaster ? ts + 3 * 3_600_000 + 12 * 60_000 : null,
        bot_token_expires_at: twitch.bot ? ts + 9 * 3_600_000 : null,
        missing_scopes: BROADCASTER_SCOPES.filter((sc) => !twitch.broadcaster?.scopes.includes(sc)),
        eventsub: twitch.eventsub,
        subscriptions_total: 28,
        subscriptions_active: 27,
        subscriptions_ready: true,
        failed,
        last_event_at: history[0]?.ts ?? null,
        chat: twitch.broadcaster ? 'connected' : 'disconnected',
        error: twitch.error
      },
      app: {
        version: DEMO_VERSION,
        os: 'demo',
        arch: 'browser',
        portable: false,
        data_dir: '~/.local/share/castwright',
        data_bytes: 48_234_496,
        memory_bytes: 182_452_224,
        started_at: startedAt,
        uptime_ms: ts - startedAt,
        server_running: true,
        server_error: null,
        secrets_in_file: false
      },
      problems: logs.filter((l) => l.level !== 'info').reverse().slice(0, 50)
    };
  };
  let crashNotice: CrashInfo | null = query.has('crashed')
    ? { ts: now() - 3_600_000, version: DEMO_VERSION, os: 'demo', thread: 'main', message: 'demo crash', location: 'src/demo.rs:1:1', backtrace: '', log: [] }
    : null;
  const bugReportFiles = (includeProject: boolean, window: unknown) => {
    const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
    const health = { ...healthSnapshot(), window };
    const files = [
      { name: 'README.txt', what: 'What this is', data: 'Castwright bug report (demo)\nNothing was uploaded. To share it, attach this file to a GitHub issue.\n' },
      { name: 'app.json', what: 'Version and system', data: json({ version: DEMO_VERSION, os: 'demo', portable: false }) },
      { name: 'health.json', what: 'Health check', data: json(health) },
      { name: 'settings.json', what: 'Settings without secrets', data: json({ ...settings, server: { ...settings.server, token: '[removed]' } }) },
      { name: 'log.txt', what: 'Recent log', data: logs.map((l) => `${new Date(l.ts).toISOString()} ${l.level.toUpperCase()} [${l.source}] ${l.message}`).join('\n') + '\n' },
      {
        name: 'project-stats.json',
        what: 'Counts of overlays, layers and actions',
        data: json({ overlays: project.overlays.length, layers: project.overlays.reduce((n, o) => n + o.layers.length, 0), actions: project.actions.length, assets: assets.length })
      }
    ];
    if (includeProject) files.push({ name: 'project.json', what: 'Your project, without secrets', data: json(project) });
    return files;
  };
  const reportName = () => `castwright-bug-report-${DEMO_VERSION}-${new Date().toISOString().slice(0, 10)}.zip`;

  // Markers and clips, like src-tauri/src/moments.rs.
  const streaming = () => twitch.stream.live || obs.stream.active;
  const addMarker = () => {
    if (!streaming()) throw { code: 'user', message: "Markers only work while you're live." };
    const ts = now();
    const m = demoMarker(liveSession.markers.length + 1, ts, liveSession.session.started_at);
    liveSession.markers.push(m);
    emit('cw://moment', { type: 'marker', marker: m });
    return m;
  };
  let clipCount = 0;
  const createClip = () => {
    if (!streaming()) throw { code: 'user', message: "Clips only work while you're live." };
    clipCount++;
    const clip = demoClip(now(), '', `New${clipCount}`);
    liveSession.clips.push(clip);
    emit('cw://moment', { type: 'clip_started', id: clip.id });
    setTimeout(() => {
      clip.title = ['Chat called it', 'That was close', 'Perfect timing'][(clipCount - 1) % 3]!;
      emit('cw://moment', { type: 'clip_ready', clip });
    }, 1200);
    return clip.id;
  };

  const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
    ...createUpdatesMock({ emit, live: streaming, settings: () => settings, query }),
    stream_add_marker: () => addMarker(),
    stream_marker_note: ({ id, note }) => {
      const m = liveSession.markers.find((x) => x.id === id);
      if (!m) throw { code: 'user', message: "That marker wasn't found." };
      m.note = String(note).trim().slice(0, 200);
    },
    stream_create_clip: () => createClip(),
    get_project: () => project,
    save_overlay: ({ overlay }) => {
      const o = clone(overlay as Overlay);
      o.updated_at = now();
      const i = project.overlays.findIndex((x) => x.id === o.id);
      if (i >= 0) project.overlays[i] = o;
      else project.overlays.push(o);
      emit('cw://project', {});
      return o;
    },
    delete_overlay: ({ id }) => {
      project.overlays = project.overlays.filter((o) => o.id !== id);
      emit('cw://project', {});
    },
    duplicate_overlay: ({ id }) => {
      const src = project.overlays.find((o) => o.id === id);
      if (!src) throw { code: 'not_found', message: 'Not found: overlay' };
      const copy = clone(src);
      copy.id = uid();
      copy.name = `${src.name} copy`;
      copy.layers.forEach((l) => (l.id = uid()));
      project.overlays.push(copy);
      return copy;
    },
    save_alerts: ({ config }) => {
      project.alerts = clone(config as AlertConfig);
    },
    save_actions: ({ actions }) => {
      project.actions = clone(actions as Action[]);
    },
    rename_project: ({ name }) => {
      project.name = String(name);
    },
    export_overlay: () => undefined,
    list_overlay_templates: () => templates,
    save_overlay_template: ({ id, name }) => {
      const src = project.overlays.find((o) => o.id === id);
      if (!src) throw { code: 'not_found', message: 'Not found: overlay' };
      if (!String(name).trim()) throw { code: 'user', message: 'Give the template a name.' };
      const t = { ...clone(src), id: uid(), name: String(name).trim().slice(0, 80) };
      templates.push(t);
      return t;
    },
    delete_overlay_template: ({ id }) => {
      templates = templates.filter((t) => t.id !== id);
    },
    overlay_from_template: ({ id, name }) => {
      const t = templates.find((x) => x.id === id);
      if (!t) throw { code: 'not_found', message: 'Not found: template' };
      const o = clone(t);
      o.id = uid();
      o.name = String(name).trim() || t.name;
      o.layers.forEach((l) => (l.id = uid()));
      o.updated_at = now();
      project.overlays.push(o);
      emit('cw://project', {});
      return o;
    },
    import_overlay: () => {
      throw { code: 'user', message: 'Importing files needs the desktop app.' };
    },
    list_assets: () => assets,
    import_assets: () => [],
    delete_asset: ({ name }) => {
      const i = assets.findIndex((a) => a.name === name);
      if (i >= 0) assets.splice(i, 1);
    },
    list_backups: () => backups.map((b) => b.info),
    create_backup: () => makeBackup('manual'),
    restore_backup: ({ file }) => {
      const b = backups.find((x) => x.info.file === file);
      if (!b) throw { code: 'not_found', message: `Not found: ${String(file)}` };
      return restoreFrom(b);
    },
    restore_backup_file: () => {
      throw { code: 'user', message: 'Restoring from a file needs the desktop app.' };
    },
    delete_backup: ({ file }) => {
      const i = backups.findIndex((b) => b.info.file === file);
      if (i < 0) throw { code: 'not_found', message: `Not found: ${String(file)}` };
      backups.splice(i, 1);
    },
    export_backup: () => undefined,
    save_backup_settings: ({ backups: b }) => {
      const v = b as BackupSettings;
      const clamp = (n: number, max: number) => Math.min(max, Math.max(1, Math.round(Number(n) || 1)));
      settings.backups = { keep_daily: clamp(v.keep_daily, 365), keep_other: clamp(v.keep_other, 100) };
      pruneBackups();
      return settings.backups;
    },
    project_dir: () => '~/Castwright/Projects/Default',
    set_project_dir: () => undefined,
    alert_queue: () => queue,
    alert_pause: ({ paused }) => {
      queue.paused = Boolean(paused);
      emitQueue();
      pump();
    },
    alert_skip: () => skip(),
    alert_replay_last: () => {
      if (!queue.last) throw { code: 'user', message: 'No alert has played yet.' };
      queue.waiting.push({ ...clone(queue.last), id: uid() });
      emitQueue();
      pump();
    },
    alert_mute: ({ muted }) => {
      queue.muted = Boolean(muted);
      settings.alerts_muted = queue.muted;
      emitQueue();
    },
    alert_remove: ({ id }) => {
      queue.waiting = queue.waiting.filter((w) => w.id !== id);
      emitQueue();
    },
    alert_clear: () => {
      queue.waiting = [];
      emitQueue();
    },
    alert_replay: ({ eventId }) => {
      const e = history.find((h) => h.id === eventId);
      if (e) publish({ ...clone(e), id: uid() });
    },
    test_event: ({ kind }) => {
      const e = demoEvent(kind as EventKind, Math.floor(Math.random() * 8), 0);
      e.test = true;
      publish(e);
    },
    run_action: ({ id }) => {
      const a = project.actions.find((x) => x.id === id);
      if (!a) throw { code: 'user', message: 'That action no longer exists.' };
      // Walk the graph like the engine; variable and log steps really happen.
      const run = planRun(a.graph, null, (s) => evaluateGroup(s.conditions, vars), {
        onStep: (s) => {
          if (s.type === 'add_to_variable') setVars({ [s.key]: (Number(vars[s.key]) || 0) + s.amount });
          else if (s.type === 'set_variable') setVars({ [s.key]: s.value });
          else if (s.type === 'log') log('info', 'automation', render(s.message, vars));
        }
      });
      // Report each node as it starts and finishes, like the engine; Wait nodes take a while.
      const runId = ++runIds;
      let at = 200;
      let waited = 0;
      for (const st of run.steps) {
        const n = a.graph.nodes.find((x) => x.id === st.node_id);
        const step = n?.kind.type === 'step' ? n.kind.step : null;
        const p = { run_id: runId, action_id: a.id, node_id: st.node_id, via: st.via };
        if (step && step.type !== 'if') {
          const start = at;
          setTimeout(() => emit('cw://action-progress', { ...p, state: null }), start);
          if (step.type === 'delay') waited += step.ms;
          at += step.type === 'delay' ? Math.min(step.ms, 1500) : 360;
        } else at += 140;
        setTimeout(() => emit('cw://action-progress', { ...p, state: st.state }), at);
      }
      setTimeout(() => {
        emit('cw://action-run', {
          run_id: runId,
          action_id: a.id,
          name: a.name,
          trigger: 'manual',
          ok: run.errors.length === 0,
          errors: run.errors,
          duration_ms: 6 * run.steps.length + waited,
          nodes: run.nodes,
          steps: run.steps
        });
        log('info', 'automation', `Ran "${a.name}"`);
      }, at + 60);
    },
    actions_package: ({ ids }) => buildPackage(project.actions, ids as string[], project.overlays, vars),
    export_actions: () => undefined,
    read_actions_file: () => {
      throw { code: 'user', message: 'Reading files by path needs the desktop app.' };
    },
    parse_actions_package: ({ text }) => parsePackage(String(text)),
    import_actions: ({ package: pkg, choices }) => {
      const { report, vars: created } = applyImport(
        project.actions,
        project.overlays,
        assets.map((a) => a.name),
        pkg as ActionPackage,
        choices as ImportChoices
      );
      for (const [k, v] of created) {
        if (k in vars) continue;
        setVars({ [k]: v });
        report.variables++;
      }
      emit('cw://project', {});
      return report;
    },
    get_vars: () => vars,
    set_var: ({ key, value, persist }) => {
      if (persist) sessionOnly.delete(String(key));
      else sessionOnly.add(String(key));
      setVars({ [String(key)]: value });
    },
    saved_var_keys: () => Object.keys(savedVars()).sort(),
    rename_var: ({ from, to, project: next }) => {
      const [a, b] = [String(from), String(to)];
      if (builtIn(a) || isLive(a)) throw { code: 'user', message: "Built-in variables can't be renamed." };
      if (!isValidVarKey(b)) throw { code: 'user', message: 'Variable names can use letters, numbers, dots, dashes and underscores.' };
      if (a in vars && (builtIn(b) || isLive(b) || b in vars)) throw { code: 'user', message: `There's already a variable called ${b}.` };
      const made = makeBackup('before_rename');
      const backup = made?.file ?? backups[0]?.info.file ?? null;
      project = clone(next as Project);
      if (a in vars) {
        const value = vars[a];
        const kept = !sessionOnly.has(a);
        sessionOnly.delete(a);
        if (!kept) sessionOnly.add(b);
        setVars({ [a]: null, [b]: value });
        delete vars[a];
      }
      emit('cw://project', {});
      return { project, backup };
    },
    delete_var: ({ key }) => {
      sessionOnly.delete(String(key));
      delete vars[String(key)];
      emit('cw://vars', { [String(key)]: null });
    },
    reset_session: () =>
      setVars({
        'session.follows': 0,
        'session.subs': 0,
        'session.gifts': 0,
        'session.bits': 0,
        'session.raids': 0,
        'session.donations': 0
      }),
    recent_events: ({ limit, kinds: k, search, includeTests }) =>
      history
        .filter((e) => (includeTests ? true : !e.test))
        .filter((e) => !(k as string[])?.length || (k as string[]).includes(e.kind))
        .filter((e) => !search || (e.user?.display_name ?? '').toLowerCase().includes(String(search).toLowerCase()))
        .slice(0, Number(limit) || 100),
    recent_chat: () => chat,
    list_sessions: ({ limit }) =>
      [...sessions]
        .sort((a, b) => b.session.started_at - a.session.started_at)
        .slice(0, Number(limit) || 100)
        .map((d) => listItem(sessionSummary(d))),
    session_summary: ({ id }) => {
      const d = sessions.find((x) => x.session.id === id);
      if (!d) throw { code: 'not_found', message: 'Not found: stream session' };
      return sessionSummary(d);
    },
    session_credits: () => {
      const d = sessions.find((x) => x.session.ended_at === null) ?? [...sessions].sort((a, b) => b.session.started_at - a.session.started_at)[0];
      if (!d) return credits({ ...liveSession, events: [], chat: [] }, now(), demoPerson);
      if (d !== liveSession) return credits(d, now(), demoPerson);
      const recent = chat.filter((c) => !c.roles.broadcaster && c.user).map((c) => ({ ts: c.ts, name: c.user!.display_name }));
      return credits({ ...d, events: [...earlier.events, ...history], chat: [...earlier.chat, ...recent] }, now(), demoPerson);
    },
    delete_session: ({ id }) => {
      const i = sessions.findIndex((x) => x.session.id === id);
      if (i < 0) return;
      if (sessions[i]!.session.ended_at === null) throw { code: 'user', message: 'This stream is still live. Delete it after it ends.' };
      sessions.splice(i, 1);
    },
    save_summary_settings: ({ summary }) => {
      const t = String((summary as Settings['summary']).social_template ?? '');
      if (t.length > 2000) throw { code: 'user', message: 'The template can be at most 2000 characters.' };
      settings.summary = { social_template: t.trim() ? t : DEFAULT_SOCIAL_TEMPLATE };
      return settings.summary;
    },
    save_export: () => undefined,
    clear_history: () => {
      history.length = 0;
    },
    export_history_csv: () => history.length,
    get_logs: () => logs,
    server_info: () => ({
      running: true,
      port: settings.server.port,
      base_url: `http://127.0.0.1:${settings.server.port}`,
      token: settings.server.token,
      asset_key: 'demo',
      error: null
    }),
    overlay_url: ({ id }) => `http://127.0.0.1:${settings.server.port}/overlay/${id}?token=${settings.server.token}`,
    regenerate_token: () => {
      settings.server.token = Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
      return handlers.server_info!({});
    },
    restart_server: ({ port, allowLan }) => {
      settings.server.port = Number(port);
      settings.server.allow_lan = Boolean(allowLan);
      return handlers.server_info!({});
    },
    get_settings: () => settings,
    save_appearance: ({ appearance }) => {
      settings.appearance = clone(appearance as AppearanceSettings);
    },
    set_first_run_done: ({ done }) => {
      settings.first_run_done = Boolean(done);
    },
    set_twitch_client_id: ({ clientId }) => {
      settings.twitch.client_id = String(clientId);
    },
    app_info: () => ({
      version: DEMO_VERSION,
      os: 'demo',
      project_dir: '~/Castwright/Projects/Default',
      config_dir: '~/.config/castwright',
      backup_dir: '~/.local/share/castwright/backups',
      secrets_in_file: false,
      built_in_client_id: true,
      portable: false,
      app_folder: null,
      portable_blocked: 'Only available in the desktop app.'
    }),
    make_portable: () => {
      throw { code: 'user', message: 'Only available in the desktop app.' };
    },
    restart_app: () => undefined,
    save_hotkeys: ({ hotkeys }) => {
      settings.hotkeys = cleanHotkeys(clone(hotkeys as HotkeySettings));
      return { hotkeys: settings.hotkeys, status: DEMO_HOTKEYS };
    },
    hotkeys_recording: () => DEMO_HOTKEYS,
    set_window_effect: () => 'solid',
    save_golive: ({ golive }) => {
      const g = clone(golive as GoLiveSettings);
      g.items = g.items.filter((i) => i.label.trim()).map((i) => ({ id: i.id || uid(), label: i.label.trim() }));
      settings.golive = g;
      return g;
    },
    golive_check: () => goLiveChecks(),
    health_snapshot: () => healthSnapshot(),
    reload_overlay: ({ id }) => log('info', 'server', `Reloaded ${project.overlays.find((o) => o.id === id)?.name ?? 'overlay'}`),
    crash_notice: () => {
      const c = crashNotice;
      crashNotice = null;
      return c;
    },
    bug_report_preview: ({ includeProject, window }) => {
      const files = bugReportFiles(Boolean(includeProject), window);
      return { files: files.map((f) => ({ name: f.name, what: f.what, bytes: new TextEncoder().encode(f.data).length })), has_crash: false, file_name: reportName() };
    },
    save_bug_report: ({ path, includeProject, window }) => {
      const zip = zipFiles(bugReportFiles(Boolean(includeProject), window));
      const href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = href;
      a.download = String(path || reportName());
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    },
    golive_fix: ({ fix }) => {
      const f = fix as CheckFix;
      if (f.type === 'resume_alerts') handlers.alert_pause!({ paused: false });
      else if (f.type === 'unmute_alerts') handlers.alert_mute!({ muted: false });
      else if (f.type === 'connect_obs') {
        obs.state = 'connected';
        emit('cw://obs', obs);
      }
    },
    twitch_status: () => twitch,
    twitch_login: ({ role }) => {
      // Pretend the user approves the code a few seconds later.
      setTimeout(() => {
        if (role === 'bot') twitch.bot = signedIn.bot;
        else twitch.broadcaster = signedIn.broadcaster;
        emit('cw://twitch', twitch);
      }, 4000);
      return { user_code: 'WDJB-MJHT', verification_uri: 'https://www.twitch.tv/activate', expires_in_s: 1800 };
    },
    twitch_cancel_login: () => undefined,
    twitch_logout: ({ role }) => {
      if (role === 'bot') twitch.bot = null;
      else twitch.broadcaster = null;
      emit('cw://twitch', twitch);
    },
    twitch_search_categories: ({ query }) =>
      ['Just Chatting', 'Art', 'Music', 'Software and Game Development', 'Valorant', 'Minecraft', 'Celeste']
        .filter((c) => c.toLowerCase().includes(String(query).toLowerCase()))
        .map((name, i) => ({ id: String(500 + i), name, box_art_url: '' })),
    twitch_update_stream_info: ({ title, categoryId, tags }) => {
      if (String(title)) twitch.stream.title = String(title);
      if (categoryId) twitch.stream.category_id = String(categoryId);
      twitch.stream.tags = tags as string[];
      emit('cw://twitch', twitch);
    },
    twitch_send_chat: ({ message, replyTo }) => {
      const e = chatEvent(0, 0, String(message));
      e.user = { id: '1337', login: 'castwright', display_name: 'Castwright' };
      e.roles.broadcaster = true;
      e.data = { color: '#9DB8FF', badges: ['broadcaster'], sent_by_castwright: true };
      const parent = replyTo ? chat.find((c) => c.id === replyTo) : undefined;
      if (parent?.user) e.data.reply_to = parent.user.display_name;
      publish(e);
    },
    twitch_delete_message: ({ messageId }) => {
      const i = chat.findIndex((c) => c.id === messageId);
      if (i >= 0) chat.splice(i, 1);
      emit('cw://chat-delete', { message_id: String(messageId) });
    },
    twitch_ban: ({ userId, durationS, reason }) => {
      const id = String(userId);
      banned.set(id, durationS == null ? null : now() + Number(durationS) * 1000);
      for (let i = chat.length - 1; i >= 0; i--) if (chat[i]!.user?.id === id) chat.splice(i, 1);
      emit('cw://chat-delete', { user_id: id });
      const name = VIEWERS[Number(id) - 1000]?.[0] ?? id;
      log('info', 'twitch', durationS == null ? `Banned ${name}${reason ? `: ${String(reason)}` : ''}` : `Timed out ${name} for ${Number(durationS)} s`);
    },
    twitch_unban: ({ userId }) => {
      banned.delete(String(userId));
    },
    twitch_shoutout: ({ login }) => log('info', 'twitch', `Shoutout to ${String(login)}`),
    twitch_chat_modes: () => modes,
    twitch_set_chat_mode: ({ mode, on, value }) => {
      const m = mode as ChatMode;
      modes[m] = Boolean(on);
      if (m === 'slow' && on) modes.slow_wait_s = Math.min(120, Math.max(3, Number(value) || 30));
      if (m === 'followers' && on) modes.followers_minutes = Number(value) || 0;
      emit('cw://chat-modes', modes);
      return modes;
    },
    twitch_viewer: ({ userId }): ViewerCard => {
      const id = String(userId);
      const i = Number(id) - 1000;
      const v = VIEWERS[i];
      if (!v) throw { code: 'twitch', message: 'Twitch doesn\'t know this user any more.' };
      const day = 86_400_000;
      const until = banned.get(id);
      return {
        id,
        login: v[0].toLowerCase(),
        display_name: v[0],
        profile_image_url: '',
        created_at: now() - (400 + i * 290) * day,
        followed_at: i % 4 === 3 ? null : now() - (20 + i * 47) * day,
        sub_tier: i % 2 === 0 ? (i === 4 ? '2000' : '1000') : null,
        sub_gifted: i === 2,
        banned: until !== undefined && (until === null || until > now()),
        banned_until: until ?? null
      };
    },
    ...interact.handlers,
    ...ads.handlers,
    ...music.handlers,
    save_chat_rules: ({ rules }) => {
      project.chat_rules = clone(rules as Project['chat_rules']);
      emit('cw://project', {});
      return project.chat_rules;
    },
    obs_snapshot: () => obs,
    obs_connect: () => undefined,
    obs_disconnect: () => undefined,
    obs_test_connection: () => '32.1.0',
    obs_save_connection: ({ host, port, autoConnect }) => {
      settings.obs.host = String(host);
      settings.obs.port = Number(port);
      settings.obs.auto_connect = Boolean(autoConnect);
    },
    obs_set_program_scene: ({ scene }) => {
      obs.program_scene = String(scene);
      setVars({ 'obs.scene': obs.program_scene });
      emit('cw://obs', obs);
    },
    obs_set_preview_scene: ({ scene }) => {
      obs.preview_scene = String(scene);
      emit('cw://obs', obs);
    },
    obs_set_studio_mode: ({ enabled }) => {
      obs.studio_mode = Boolean(enabled);
      obs.preview_scene = obs.studio_mode ? obs.preview_scene ?? obs.program_scene : null;
      emit('cw://obs', obs);
    },
    obs_transition: () => {
      if (obs.studio_mode && obs.preview_scene) {
        const p = obs.program_scene;
        obs.program_scene = obs.preview_scene;
        obs.preview_scene = p;
        emit('cw://obs', obs);
      }
    },
    obs_set_transition: ({ name }) => {
      obs.current_transition = String(name);
      emit('cw://obs', obs);
    },
    obs_set_transition_duration: ({ ms }) => {
      obs.transition_ms = Number(ms);
      emit('cw://obs', obs);
    },
    obs_stream: ({ action }) => {
      obs.stream.active = action === 'toggle' ? !obs.stream.active : action === 'start';
      emit('cw://obs', obs);
    },
    obs_record: ({ action }) => {
      if (action === 'pause') obs.record.paused = true;
      else if (action === 'resume') obs.record.paused = false;
      else obs.record.active = action === 'toggle' ? !obs.record.active : action === 'start';
      emit('cw://obs', obs);
    },
    obs_replay: ({ action }) => {
      if (action === 'toggle') obs.replay_buffer = !obs.replay_buffer;
      else log('info', 'obs', 'Replay saved');
      emit('cw://obs', obs);
    },
    obs_virtual_cam: () => {
      obs.virtual_cam = !obs.virtual_cam;
      emit('cw://obs', obs);
    },
    obs_set_volume: ({ input, db }) => {
      const i = obs.inputs.find((x) => x.name === input);
      if (i) i.volume_db = Number(db);
      emit('cw://obs', obs);
    },
    obs_set_mute: ({ input, muted }) => {
      const i = obs.inputs.find((x) => x.name === input);
      if (i) i.muted = Boolean(muted);
      emit('cw://obs', obs);
    },
    obs_set_monitoring: ({ input, enabled }) => {
      const i = obs.inputs.find((x) => x.name === input);
      if (i) i.monitoring = Boolean(enabled);
      emit('cw://obs', obs);
    },
    obs_set_item_enabled: ({ itemId, enabled }) => {
      const it = obs.scene_items.find((x) => x.id === itemId);
      if (it) it.visible = Boolean(enabled);
      emit('cw://obs', obs);
    },
    obs_set_item_locked: ({ itemId, locked }) => {
      const it = obs.scene_items.find((x) => x.id === itemId);
      if (it) it.locked = Boolean(locked);
      emit('cw://obs', obs);
    },
    obs_levels: ({ enabled }) => {
      if (levelsTimer) clearInterval(levelsTimer);
      levelsTimer = null;
      if (enabled && !staticMode) {
        let t = 0;
        levelsTimer = setInterval(() => {
          t += 1;
          emit(
            'cw://obs-levels',
            obs.inputs.map((inp, i) => {
              const base = inp.muted ? -100 : inp.volume_db - 6 - i * 2;
              const wobble = Math.sin(t / (2 + i)) * 6 + Math.random() * 4;
              const peak = Math.max(-60, Math.min(0, base + wobble));
              return { name: inp.name, peaks_db: [peak, peak - Math.random() * 2] };
            })
          );
        }, 80);
      } else if (enabled) {
        emit(
          'cw://obs-levels',
          obs.inputs.map((inp, i) => ({ name: inp.name, peaks_db: [inp.volume_db - 10 - i * 3, inp.volume_db - 12 - i * 3] }))
        );
      }
    },
    obs_screenshot: ({ source, width }) => sceneImage(String(source), Number(width) || 640),
    obs_add_overlay: ({ scene }) => log('info', 'obs', `Added overlay to "${String(scene)}"`)
  };

  return {
    kind: 'demo',
    async invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
      const h = handlers[cmd];
      if (!h) throw { code: 'other', message: `Unknown command: ${cmd}` };
      await new Promise((r) => setTimeout(r, 0));
      return clone(await h(args)) as T;
    },
    async listen<T>(event: string, cb: (payload: T) => void): Promise<Unlisten> {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(cb as Listener);
      listeners.set(event, set);
      if (event === 'cw://session' && endedPending) {
        endedPending = false;
        setTimeout(() => emit('cw://session', { type: 'ended', session: liveSession.session }), 800);
      }
      return () => set.delete(cb as Listener);
    }
  };
}
