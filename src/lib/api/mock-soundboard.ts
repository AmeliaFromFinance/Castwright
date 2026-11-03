// The soundboard for the browser demo: a few sounds made in code, with the same
// cooldown and mute rules as src-tauri/src/soundboard.
import type { AssetInfo } from '$lib/bindings/AssetInfo';
import type { PlayOutcome } from '$lib/bindings/PlayOutcome';
import type { SoundButton } from '$lib/bindings/SoundButton';
import type { SoundCue } from '$lib/bindings/SoundCue';
import type { Soundboard } from '$lib/bindings/Soundboard';
import type { SoundboardStatus } from '$lib/bindings/SoundboardStatus';
import { defaultSoundboard, newButton } from '$lib/soundboard/board';
import { dataUrl, TONES, type ToneName } from '$lib/soundboard/tones';

interface Hooks {
  emit: (name: string, payload: unknown) => void;
  board: () => Soundboard;
  setBoard: (b: Soundboard) => void;
}

const FILES: Array<[ToneName, string]> = [
  ['airhorn', 'airhorn.wav'],
  ['drumroll', 'drum-roll.wav'],
  ['trombone', 'sad-trombone.wav'],
  ['ding', 'ding.wav'],
  ['applause', 'applause.wav'],
  ['laser', 'laser.wav']
];

/** The demo's sound files. The path is the sound itself, so it plays without a server. */
export function demoSoundAssets(): AssetInfo[] {
  return FILES.map(([tone, name]) => {
    const bytes = TONES[tone]();
    return { name, path: dataUrl(bytes), bytes: bytes.length, kind: 'audio' };
  });
}

export function demoBoard(assets: readonly AssetInfo[]): Soundboard {
  const src = (name: string) => assets.find((a) => a.name === name)?.path ?? '';
  const b = (id: string, label: string, emoji: string, file: string, patch: Partial<SoundButton> = {}) =>
    newButton({ id, label, emoji, src: src(file), ...patch });
  return {
    ...defaultSoundboard(),
    groups: ['Memes'],
    buttons: [
      b('snd-airhorn', 'Airhorn', '📯', 'airhorn.wav', { output: 'both', cooldown_s: 10, color: '#ff6b35' }),
      b('snd-drumroll', 'Drum roll', '🥁', 'drum-roll.wav', { output: 'both', color: '#f5c451' }),
      b('snd-applause', 'Applause', '👏', 'applause.wav', { output: 'both', volume: 70, color: '#5fd3a5' }),
      b('snd-ding', 'Ding', '🔔', 'ding.wav', { output: 'local', color: '#8ab4ff' }),
      b('snd-trombone', 'Sad trombone', '🎺', 'sad-trombone.wav', { group: 'Memes', aliases: ['womp'], cooldown_s: 30, color: '#c9b3ff' }),
      b('snd-laser', 'Laser', '⚡', 'laser.wav', { group: 'Memes', color: '#ff8a8a' })
    ]
  };
}

export function createSoundboardMock(h: Hooks) {
  const lastPlay = new Map<string, number>();
  let lastAny = 0;
  let plays = 0;

  const status = (): SoundboardStatus => {
    const board = h.board();
    const now = Date.now();
    const cooldowns: Record<string, number> = {};
    for (const b of board.buttons) {
      const until = (lastPlay.get(b.id) ?? 0) + b.cooldown_s * 1000;
      if (b.cooldown_s > 0 && until > now) cooldowns[b.id] = until;
    }
    const global = lastAny + board.global_cooldown_s * 1000;
    return { muted: board.muted, cooldowns, global_until: board.global_cooldown_s > 0 && global > now ? global : 0, stream_pages: 1 };
  };
  const publish = () => h.emit('cw://soundboard', status());
  const cue = (c: SoundCue) => h.emit('cw://sound', c);

  const play = (id: string): PlayOutcome => {
    const board = h.board();
    const b = board.buttons.find((x) => x.id === id);
    if (!b) return { result: 'not_found' };
    if (!b.src) return { result: 'no_file' };
    if (board.muted) return { result: 'muted' };
    const now = Date.now();
    const wait = Math.max(
      b.cooldown_s > 0 ? (lastPlay.get(id) ?? 0) + b.cooldown_s * 1000 - now : 0,
      board.global_cooldown_s > 0 ? lastAny + board.global_cooldown_s * 1000 - now : 0
    );
    if (wait > 0) return { result: 'cooldown', seconds_left: Math.ceil(wait / 1000) };
    lastPlay.set(id, now);
    lastAny = now;
    plays++;
    cue({ type: 'play', play_id: plays, sound_id: id, label: b.label, src: b.src, volume: b.volume, local: b.output !== 'stream', stream: b.output !== 'local', started_at: now });
    publish();
    return { result: 'played', play_id: plays };
  };

  const stop = (id: string | null) => cue({ type: 'stop', sound_id: id });

  return {
    handlers: {
      soundboard_status: () => status(),
      save_soundboard: ({ board }: Record<string, unknown>) => {
        const next = board as Soundboard;
        const groups = [...new Set(next.groups.map((g) => g.trim()).filter(Boolean))];
        for (const b of next.buttons) {
          b.volume = Math.min(100, Math.max(0, Math.round(b.volume)));
          b.cooldown_s = Math.min(86_400, Math.max(0, Math.round(b.cooldown_s)));
          b.group = b.group.trim();
          if (b.group && !groups.includes(b.group)) groups.push(b.group);
        }
        const saved: Soundboard = { ...next, groups, muted: h.board().muted, command: { ...next.command, name: next.command.name.trim().replace(/^!+/, '').toLowerCase() || 'sound' } };
        h.setBoard(saved);
        publish();
        return saved;
      },
      sound_play: ({ id }: Record<string, unknown>) => play(String(id)),
      sound_stop: ({ id }: Record<string, unknown>) => stop(typeof id === 'string' ? id : null),
      soundboard_mute: ({ muted }: Record<string, unknown>) => {
        h.setBoard({ ...h.board(), muted: !!muted });
        if (muted) stop(null);
        publish();
        return status();
      }
    }
  };
}
