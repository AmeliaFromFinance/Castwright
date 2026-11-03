// Timer layer state from the app: started, paused or reset. Same rules as src-tauri/src/timers.rs.
import type { TimerAction } from '$lib/bindings/TimerAction';
import type { TimerMode } from '$lib/bindings/TimerMode';
import type { TimerRun } from '$lib/bindings/TimerRun';

export const timerElapsed = (r: TimerRun, now: number): number => (r.running ? r.elapsed_ms + Math.max(0, now - r.at) : r.elapsed_ms);

/** Countdowns and stopwatches can be started and paused. */
export const controllable = (mode: TimerMode): boolean => mode === 'countdown' || mode === 'stopwatch';

/** The state after `action`. `limit` is a countdown's length in ms; null for a stopwatch. */
export function applyTimer(run: TimerRun | null | undefined, action: TimerAction, addMs: number, limit: number | null, now: number): TimerRun {
  const running = !!run?.running;
  let elapsed = run ? timerElapsed(run, now) : 0;
  if (limit !== null) elapsed = Math.min(elapsed, Math.max(0, limit));
  const at = (r: boolean, e: number): TimerRun => ({ running: r, elapsed_ms: e, at: now });
  switch (action) {
    case 'start':
      return at(true, 0);
    case 'reset':
      return at(false, 0);
    case 'pause':
      return at(false, elapsed);
    case 'resume':
      return at(true, elapsed);
    case 'toggle':
      return at(!running, elapsed);
    case 'add':
      return at(running, limit !== null ? elapsed - addMs : Math.max(0, elapsed + addMs));
  }
}

export type TimerStatus = 'idle' | 'running' | 'paused' | 'done';

/** Where a timer stands, for buttons and the status line. */
export function timerStatus(run: TimerRun | null | undefined, mode: TimerMode, durationS: number, now: number): TimerStatus {
  if (!run) return 'idle';
  if (mode === 'countdown' && timerElapsed(run, now) >= durationS * 1000) return 'done';
  if (run.running) return 'running';
  return run.elapsed_ms === 0 ? 'idle' : 'paused';
}
