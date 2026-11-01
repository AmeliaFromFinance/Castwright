import type { AlertPlay } from '$lib/bindings/AlertPlay';
import { durationOf } from './anim';
import type { ActiveAlert } from './state';

/** The server never holds an alert for less than this. */
export const MIN_HOLD_MS = 500;

export interface AlertTimes {
  /** Exit animation starts (ms, Date.now clock). */
  exitAt: number;
  /** Alert is gone. */
  endAt: number;
  exitMs: number;
}

/**
 * Mirrors the server's queue: it holds each alert for `duration_ms + exit.duration_ms`,
 * so the exit starts at `duration_ms` and finishes as the next alert may begin.
 * `alert_stop` moves the exit to the stop time.
 */
export function alertTimes(a: ActiveAlert): AlertTimes {
  const p: AlertPlay = a.play;
  const hold = Math.max(MIN_HOLD_MS, p.duration_ms || 0);
  const exitMs = durationOf(p.exit, 'exit');
  const serverExit = Math.max(0, p.exit?.duration_ms || 0);
  let exitAt = a.startedAt + hold;
  // Fit the exit inside the server's window when the preset uses its default length.
  const windowEnd = exitAt + serverExit;
  let endAt = Math.max(windowEnd, exitAt + exitMs);
  if (exitMs > serverExit && serverExit === 0) {
    exitAt = Math.max(a.startedAt, exitAt - exitMs);
    endAt = exitAt + exitMs;
  }
  if (a.stoppedAt !== null && a.stoppedAt < exitAt) {
    exitAt = a.stoppedAt;
    endAt = exitAt + exitMs;
  }
  return { exitAt, endAt, exitMs };
}
