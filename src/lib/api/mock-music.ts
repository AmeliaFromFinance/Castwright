// Music for the browser demo: a playlist that moves on every 20 seconds, with
// covers drawn as small SVGs so the demo loads no outside images.
import type { MusicSettings } from '$lib/bindings/MusicSettings';
import type { MusicStatus } from '$lib/bindings/MusicStatus';
import type { NowPlaying } from '$lib/bindings/NowPlaying';
import type { Settings } from '$lib/bindings/Settings';

interface Hooks {
  emit: (name: string, payload: unknown) => void;
  setVars: (changes: Record<string, unknown>) => void;
  settings: () => Settings;
  staticMode: boolean;
}

const SONG_MS = 20_000;

/** A cover: two-colour gradient with a shape. */
function cover(a: string, b: string, shape: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="120" height="120" fill="url(#g)"/>${shape}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const PLAYLIST = [
  { title: 'Midnight Drive', artist: 'Neon Harbor', album: 'Night Shift', duration_ms: 213_000, art: cover('#ff5f9e', '#5b3cc4', '<circle cx="60" cy="74" r="26" fill="#ffd166"/><rect y="74" width="120" height="46" fill="#1b1036" opacity=".85"/><path d="M0 92h120M0 102h120M0 112h120" stroke="#ff5f9e" stroke-width="2"/>') },
  { title: 'Paper Lanterns', artist: 'Juniper & Moss', album: 'Slow Rivers', duration_ms: 187_000, art: cover('#f7b267', '#f25c54', '<circle cx="40" cy="44" r="14" fill="#fff4e0"/><circle cx="78" cy="58" r="10" fill="#fff4e0" opacity=".8"/><circle cx="62" cy="86" r="17" fill="#fff4e0" opacity=".9"/>') },
  { title: 'Static Bloom', artist: 'Lo Kite', album: 'Signals', duration_ms: 241_000, art: cover('#0f2027', '#2c5364', '<g fill="none" stroke="#7fdbff" stroke-width="3"><circle cx="60" cy="60" r="12"/><circle cx="60" cy="60" r="26" opacity=".7"/><circle cx="60" cy="60" r="40" opacity=".4"/></g>') },
  { title: 'Glasshouse', artist: 'Mira Sol', album: 'Greenhouse Tapes', duration_ms: 198_000, art: cover('#a8e063', '#2f7336', '<path d="M60 22 96 52v46H24V52z" fill="none" stroke="#f1ffe7" stroke-width="4"/><path d="M60 22v76M24 52h72" stroke="#f1ffe7" stroke-width="2" opacity=".7"/>') },
  { title: 'Arcade Rain', artist: 'Pixel Ferry', album: '8-Bit Weather', duration_ms: 176_000, art: cover('#3a1c71', '#d76d77', '<g fill="#ffaf7b"><rect x="22" y="30" width="8" height="16"/><rect x="46" y="20" width="8" height="16"/><rect x="70" y="36" width="8" height="16"/><rect x="92" y="24" width="8" height="16"/><rect x="34" y="70" width="8" height="16"/><rect x="60" y="80" width="8" height="16"/><rect x="84" y="66" width="8" height="16"/></g>') }
];

export function createMusicMock(h: Hooks) {
  let index = 0;
  let startedAt = Date.now();
  let playing = true;
  let signedIn = true;
  /** Where in the song the demo starts, so the bar isn't always empty. */
  const offset = (i: number) => Math.round(PLAYLIST[i % PLAYLIST.length]!.duration_ms * 0.32);

  const source = () => h.settings().music.source;
  const track = (): NowPlaying | null => {
    if (source() === 'off') return null;
    const s = PLAYLIST[index % PLAYLIST.length]!;
    const progress = Math.min(s.duration_ms, offset(index) + (playing ? Date.now() - startedAt : 0));
    return { id: `demo-${index % PLAYLIST.length}`, title: s.title, artist: s.artist, album: s.album, art_url: s.art, playing, progress_ms: progress, duration_ms: s.duration_ms };
  };

  const status = (): MusicStatus => ({
    source: source(),
    state: source() === 'off' ? 'disconnected' : 'connected',
    error: null,
    spotify_user: signedIn ? 'Demo listener' : null,
    login_pending: false,
    redirect_uri: `http://127.0.0.1:${h.settings().server.port}/spotify/callback`,
    system_supported: true,
    player: source() === 'system' ? 'Spotify' : source() === 'text_file' ? 'nowplaying.txt' : '',
    track: track()
  });

  const publish = (full: boolean) => {
    const t = track();
    if (full) h.emit('cw://music', status());
    h.setVars({
      'music.title': t?.title ?? '',
      'music.artist': t?.artist ?? '',
      'music.album': t?.album ?? '',
      'music.art_url': t?.art_url ?? '',
      'music.playing': t?.playing ?? false,
      'music.progress_ms': t?.progress_ms ?? 0,
      'music.duration_ms': t?.duration_ms ?? 0
    });
  };

  const next = () => {
    index++;
    startedAt = Date.now();
    publish(true);
  };

  if (!h.staticMode && typeof window !== 'undefined') {
    setInterval(() => {
      if (source() === 'off') return;
      if (playing && Date.now() - startedAt >= SONG_MS) next();
      else publish(false);
    }, 4000);
  }

  return {
    /** Sets the variables once at start. */
    publish: () => publish(false),
    /** Pauses or plays the demo song. */
    setPlaying(on: boolean) {
      if (on === playing) return;
      const t = track();
      playing = on;
      startedAt = Date.now() - ((t?.progress_ms ?? 0) - offset(index));
      publish(true);
    },
    next,
    handlers: {
      music_status: () => status(),
      save_music_settings: ({ music }: Record<string, unknown>) => {
        const m = music as MusicSettings;
        h.settings().music = { ...m, spotify_client_id: m.spotify_client_id.trim(), text_format: m.text_format.trim() || '{artist} - {title}' };
        publish(true);
        return h.settings().music;
      },
      music_watch: () => undefined,
      spotify_login: () => {
        signedIn = true;
        setTimeout(() => publish(true), 300);
        return '';
      },
      spotify_cancel_login: () => undefined,
      spotify_logout: () => {
        signedIn = false;
        publish(true);
      }
    }
  };
}
