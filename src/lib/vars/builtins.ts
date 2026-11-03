// Variables Castwright keeps up to date itself. Checked against reference/variables.md
// and the Rust code that sets them by builtins.test.ts.

export type BuiltInSource = 'Twitch' | 'OBS' | 'Twitch ads' | 'Music' | 'Create clip step';

export interface BuiltIn {
  key: string;
  source: BuiltInSource;
  /** Kept after a restart. */
  saved: boolean;
}

const group = (source: BuiltInSource, saved: boolean, keys: string[]): BuiltIn[] => keys.map((key) => ({ key, source, saved }));

export const BUILT_INS: readonly BuiltIn[] = [
  ...group('Twitch', true, [
    'last.follow.name',
    'last.sub.name',
    'last.sub.tier',
    'last.sub.months',
    'last.gift.name',
    'last.gift.amount',
    'last.cheer.name',
    'last.cheer.amount',
    'last.raid.name',
    'last.raid.viewers',
    'last.redemption.name',
    'last.redemption.reward',
    'last.donation.name',
    'last.donation.amount',
    'last.event.name',
    'last.event.kind',
    'session.follows',
    'session.subs',
    'session.gifts',
    'session.bits',
    'session.raids',
    'session.donations'
  ]),
  ...group('Create clip step', true, ['last.clip.url']),
  ...group('Twitch', false, [
    'stream.live',
    'stream.viewers',
    'stream.title',
    'stream.category',
    'stream.started_at',
    'stream.uptime_text',
    'twitch.login',
    'twitch.display_name',
    'twitch.user_id',
    'twitch.bot_login'
  ]),
  ...group('OBS', false, ['obs.connected', 'obs.scene', 'obs.streaming', 'obs.recording']),
  ...group('Twitch ads', false, ['ads.next_at', 'ads.length_s', 'ads.running', 'ads.ends_at', 'ads.running_length_s', 'ads.snoozes']),
  ...group('Music', false, ['music.title', 'music.artist', 'music.album', 'music.art_url', 'music.playing', 'music.progress_ms', 'music.duration_ms'])
];

const BY_KEY = new Map(BUILT_INS.map((b) => [b.key, b]));

export const builtIn = (key: string): BuiltIn | undefined => BY_KEY.get(key);

/** Never saved, whatever a step asks. Same list as LIVE_PREFIXES in vars.rs. */
export const isLiveKey = (key: string): boolean => /^(stream|obs|twitch|ads|music)\./.test(key);

/** Built-in groups. A key in one of these reads like a variable even when nothing sets it. */
export const BUILT_IN_ROOTS = ['last', 'session', 'stream', 'obs', 'twitch', 'ads', 'music'];
