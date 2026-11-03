import type { TimerMode } from '$lib/bindings/TimerMode';
import type { TimerRun } from '$lib/bindings/TimerRun';
import { asNumber } from '$lib/logic/condition';
import { timerElapsed } from './timer';

const pad = (n: number) => String(n).padStart(2, '0');

/** Whole seconds as `H:MM:SS`, or `MM:SS` under an hour. Negative counts as 0. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function formatClock(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface TimerInput {
  mode: TimerMode;
  durationS: number;
  /** Value of the anchor variable, if one is configured. */
  anchor: unknown;
  hasAnchor: boolean;
  /** When the overlay loaded (ms). */
  loadedAt: number;
  /** `vars['stream.started_at']` (ms). */
  streamStartedAt: unknown;
  now: number;
  /** Started, paused or reset from the app. Wins over the anchor and page load. */
  run?: TimerRun | null;
}

function timestamp(v: unknown): number | null {
  const n = asNumber(v);
  return n !== null && n > 0 ? n : null;
}

/**
 * Text for a timer layer, without the prefix. Empty means "show nothing".
 *
 * Countdown: ends `duration_s` after the anchor (or page load). With an anchor and
 * `duration_s` 0, the anchor is the end time. Shows the full length until the anchor is set.
 * Once started or paused from the app, that state is used instead.
 */
export function timerText(t: TimerInput): string {
  switch (t.mode) {
    case 'clock':
      return formatClock(new Date(t.now));
    case 'uptime': {
      const start = timestamp(t.streamStartedAt);
      return start === null ? '' : formatDuration((t.now - start) / 1000);
    }
    case 'stopwatch': {
      if (t.run) return formatDuration(timerElapsed(t.run, t.now) / 1000);
      const start = t.hasAnchor ? timestamp(t.anchor) : t.loadedAt;
      return formatDuration(start === null ? 0 : (t.now - start) / 1000);
    }
    case 'countdown': {
      const duration = Math.max(0, t.durationS) * 1000;
      if (t.run) return formatDuration(Math.ceil(Math.max(0, duration - timerElapsed(t.run, t.now)) / 1000 - 1e-6));
      let end: number;
      if (t.hasAnchor) {
        const a = timestamp(t.anchor);
        if (a === null) return formatDuration(duration / 1000);
        end = duration > 0 ? a + duration : a;
      } else {
        end = t.loadedAt + duration;
      }
      // Round up so a 10s countdown starts at 00:10 and reaches 00:00 exactly at the end.
      return formatDuration(Math.ceil(Math.max(0, end - t.now) / 1000 - 1e-6));
    }
  }
}
