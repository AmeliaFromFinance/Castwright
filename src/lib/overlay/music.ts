// The song playing now, read from the music.* variables.

export interface Track {
  title: string;
  artist: string;
  album: string;
  artUrl: string;
  playing: boolean;
  progressMs: number;
  durationMs: number;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** Null when no song is known. */
export function trackFromVars(vars: Record<string, unknown>): Track | null {
  const title = str(vars['music.title']).trim();
  if (!title) return null;
  return {
    title,
    artist: str(vars['music.artist']),
    album: str(vars['music.album']),
    artUrl: str(vars['music.art_url']),
    playing: vars['music.playing'] === true,
    progressMs: num(vars['music.progress_ms']),
    durationMs: num(vars['music.duration_ms'])
  };
}

/** Shown in the editor while nothing plays. */
export const SAMPLE_TRACK: Track = {
  title: 'Song title',
  artist: 'Artist name',
  album: 'Album',
  artUrl: '',
  playing: true,
  progressMs: 74_000,
  durationMs: 213_000
};

/** `3:07`, or `1:02:09` past an hour. */
export function formatTime(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** The position now. Sources report it every few seconds, so it's moved on locally while playing. */
export function progressAt(t: Pick<Track, 'playing' | 'progressMs' | 'durationMs'>, receivedAt: number, now: number): number {
  const p = t.playing ? t.progressMs + Math.max(0, now - receivedAt) : t.progressMs;
  return t.durationMs > 0 ? Math.min(p, t.durationMs) : p;
}

/** 0 to 1. */
export function progressFraction(progressMs: number, durationMs: number): number {
  if (!(durationMs > 0)) return 0;
  return Math.min(1, Math.max(0, progressMs / durationMs));
}

/** Whether a Now playing layer shows: always, or while playing and for a while after a pause. */
export function npVisible(track: Track | null, onlyPlaying: boolean, pausedSince: number | null, hideAfterS: number, now: number): boolean {
  if (!track) return false;
  if (!onlyPlaying || track.playing) return true;
  if (pausedSince === null) return false;
  return now - pausedSince < Math.max(0, hideAfterS) * 1000;
}

/** A song key, to notice changes. */
export function trackKey(t: Track | null): string {
  return t ? `${t.title}\u001f${t.artist}` : '';
}
