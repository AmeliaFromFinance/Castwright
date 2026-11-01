// In-browser stand-in for the Rust backend. Used when the UI runs outside the
// desktop app: development in a browser, end-to-end tests and documentation
// screenshots. Add `?demo=static` to the URL to turn off the simulated activity,
// and `&setup` to start at first-time setup.

import type { Backend, Unlisten } from './backend';
import starter from './fixtures/starter-project.json';
import samples from './fixtures/sample-events.json';
import type { Action } from '$lib/bindings/Action';
import type { AlertConfig } from '$lib/bindings/AlertConfig';
import type { AlertPlay } from '$lib/bindings/AlertPlay';
import type { AppearanceSettings } from '$lib/bindings/AppearanceSettings';
import type { AssetInfo } from '$lib/bindings/AssetInfo';
import type { Event } from '$lib/bindings/Event';
import type { EventKind } from '$lib/bindings/EventKind';
import type { LogEntry } from '$lib/bindings/LogEntry';
import type { ObsSnapshot } from '$lib/bindings/ObsSnapshot';
import type { Overlay } from '$lib/bindings/Overlay';
import type { Project } from '$lib/bindings/Project';
import type { QueueState } from '$lib/bindings/QueueState';
import type { Settings } from '$lib/bindings/Settings';
import type { TwitchStatus } from '$lib/bindings/TwitchStatus';
import { evaluateGroup } from '$lib/logic/condition';
import { render } from '$lib/logic/template';

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
  'gg on that round',
  'first time here, love the vibe',
  'the alerts are so smooth',
  'LUL that was close',
  'can you show the settings again?',
  'how long have you been streaming today?',
  'hype hype hype'
];

function demoEvent(kind: EventKind, i: number, ago: number): Event {
  const base = clone((samples as unknown as Event[]).find((e) => e.kind === kind)!);
  const [name] = VIEWERS[i % VIEWERS.length]!;
  base.id = uid();
  base.ts = now() - ago;
  base.test = false;
  if (base.user) base.user = { id: String(1000 + i), login: name.toLowerCase(), display_name: name };
  return base;
}

function chatEvent(i: number, ago = 0, text?: string): Event {
  const [name, color] = VIEWERS[i % VIEWERS.length]!;
  const message = text ?? CHAT_LINES[i % CHAT_LINES.length]!;
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
    data: { color, badges: i % 2 === 0 ? ['subscriber'] : [] },
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
    }
  };
}

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
      scopes: []
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
  let settings = defaultSettings();
  const obs = demoObs();
  const twitch = demoTwitch();
  const signedIn = { broadcaster: twitch.broadcaster, bot: twitch.bot };
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('setup')) {
    settings.first_run_done = false;
    twitch.broadcaster = null;
    twitch.bot = null;
  }
  const queue: QueueState = { paused: false, playing: null, waiting: [] };
  const logs: LogEntry[] = [
    { ts: now() - 5_100_000, level: 'info', source: 'obs', message: 'Connected to OBS 32.1.0' },
    { ts: now() - 5_095_000, level: 'info', source: 'twitch', message: 'Listening for 26 kinds of Twitch events' },
    { ts: now() - 5_025_000, level: 'info', source: 'twitch', message: 'Stream went live' }
  ];
  const history: Event[] = [];
  const chat: Event[] = [];
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
    'obs.scene': obs.program_scene
  };
  const assets: AssetInfo[] = [
    { name: 'fanfare.ogg', path: 'assets/fanfare.ogg', bytes: 182_331, kind: 'audio' },
    { name: 'gold-confetti.webm', path: 'assets/gold-confetti.webm', bytes: 2_411_002, kind: 'video' },
    { name: 'logo.png', path: 'assets/logo.png', bytes: 48_120, kind: 'image' },
    { name: 'stinger.webm', path: 'assets/stinger.webm', bytes: 3_920_441, kind: 'video' }
  ];
  const snapshots = [0, 1, 2].map((i) => ({
    file: `project-${now() - i * 3_600_000}.json`,
    ts: now() - i * 3_600_000,
    bytes: 18_000 + i * 120
  }));
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
  };

  if (!staticMode && typeof window !== 'undefined') {
    let n = 0;
    setInterval(() => {
      n++;
      publish(chatEvent(n + 18));
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

  const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
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
    import_overlay: () => {
      throw { code: 'user', message: 'Importing files needs the desktop app.' };
    },
    list_assets: () => assets,
    import_assets: () => [],
    delete_asset: ({ name }) => {
      const i = assets.findIndex((a) => a.name === name);
      if (i >= 0) assets.splice(i, 1);
    },
    list_snapshots: () => snapshots,
    create_snapshot: () => {
      snapshots.unshift({ file: `project-${now()}.json`, ts: now(), bytes: 18_400 });
    },
    restore_snapshot: () => project,
    project_dir: () => '~/Castwright/Projects/Default',
    set_project_dir: () => undefined,
    alert_queue: () => queue,
    alert_pause: ({ paused }) => {
      queue.paused = Boolean(paused);
      emitQueue();
      pump();
    },
    alert_skip: () => skip(),
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
      emit('cw://action-run', { action_id: a.id, name: a.name, trigger: 'manual', ok: true, errors: [], duration_ms: 12 });
      log('info', 'automation', `Ran "${a.name}"`);
    },
    get_vars: () => vars,
    set_var: ({ key, value }) => setVars({ [String(key)]: value }),
    delete_var: ({ key }) => {
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
      version: '0.1.0',
      os: 'demo',
      project_dir: '~/Castwright/Projects/Default',
      config_dir: '~/.config/castwright',
      secrets_in_file: false,
      built_in_client_id: true
    }),
    set_window_effect: () => 'solid',
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
    twitch_send_chat: ({ message }) => {
      const e = chatEvent(0, 0, String(message));
      e.user = { id: '1337', login: 'castwright', display_name: 'Castwright' };
      e.roles.broadcaster = true;
      e.data = { color: '#9DB8FF', badges: ['broadcaster'], sent_by_castwright: true };
      publish(e);
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
      return clone(h(args)) as T;
    },
    async listen<T>(event: string, cb: (payload: T) => void): Promise<Unlisten> {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(cb as Listener);
      listeners.set(event, set);
      return () => set.delete(cb as Listener);
    }
  };
}
