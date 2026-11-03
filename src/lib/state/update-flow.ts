// The steps of installing an update, from "a new version is out" to the restart.

export type UpdatePhase =
  | { kind: 'idle' }
  /** `canInstall` false: only "Download from GitHub", for `reason`. */
  | { kind: 'available'; canInstall: boolean; reason: string | null }
  | { kind: 'downloading'; downloaded: number; total: number | null }
  | { kind: 'ready' }
  /** Restart is held back until the stream ends. */
  | { kind: 'waiting' }
  /** The stream ended; asking again. */
  | { kind: 'ask' }
  | { kind: 'restarting' }
  | { kind: 'error'; message: string };

export type UpdateEvent =
  | { type: 'found'; canInstall: boolean; reason: string | null }
  | { type: 'download' }
  | { type: 'progress'; downloaded: number; total: number | null }
  | { type: 'downloaded' }
  | { type: 'restart'; outcome: 'restarting' | 'after_stream' }
  | { type: 'stream_ended' }
  | { type: 'cancel' }
  | { type: 'failed'; message: string }
  | { type: 'reset' };

export const IDLE: UpdatePhase = { kind: 'idle' };

export function step(s: UpdatePhase, e: UpdateEvent): UpdatePhase {
  switch (e.type) {
    case 'reset':
      return IDLE;
    case 'found':
      // A new check doesn't interrupt a download or a ready update.
      if (s.kind === 'idle' || s.kind === 'available' || s.kind === 'error') return { kind: 'available', canInstall: e.canInstall, reason: e.reason };
      return s;
    case 'download':
      if ((s.kind === 'available' && s.canInstall) || s.kind === 'error') return { kind: 'downloading', downloaded: 0, total: null };
      return s;
    case 'progress':
      if (s.kind !== 'downloading') return s;
      return { kind: 'downloading', downloaded: Math.max(s.downloaded, e.downloaded), total: e.total ?? s.total };
    case 'downloaded':
      return s.kind === 'downloading' ? { kind: 'ready' } : s;
    case 'restart':
      if (s.kind !== 'ready' && s.kind !== 'ask' && s.kind !== 'waiting') return s;
      return e.outcome === 'after_stream' ? { kind: 'waiting' } : { kind: 'restarting' };
    case 'stream_ended':
      return s.kind === 'waiting' ? { kind: 'ask' } : s;
    case 'cancel':
      return s.kind === 'waiting' || s.kind === 'ask' ? { kind: 'ready' } : s;
    case 'failed':
      return { kind: 'error', message: e.message };
  }
}

/** 850 -> "850 B", 48_234_496 -> "46.0 MB" */
export function bytesText(n: number): string {
  if (n < 1024) return `${Math.max(0, Math.round(n))} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Whole percent, 0 to 100, or null when the size isn't known. */
export function percent(downloaded: number, total: number | null): number | null {
  if (!total || total <= 0) return null;
  return Math.min(100, Math.max(0, Math.floor((downloaded / total) * 100)));
}

/** "12.3 MB of 45.6 MB · 27%", or "12.3 MB" when the size isn't known. */
export function progressText(downloaded: number, total: number | null): string {
  const p = percent(downloaded, total);
  if (p === null) return bytesText(downloaded);
  return `${bytesText(downloaded)} of ${bytesText(total!)} · ${p}%`;
}
