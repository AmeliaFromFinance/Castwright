// Start, pause and reset for timer layers, shared by the inspector and the right-click menus.
import { api } from '$lib/api';
import type { Layer } from '$lib/bindings/Layer';
import type { TimerAction } from '$lib/bindings/TimerAction';
import type { TimerRun } from '$lib/bindings/TimerRun';
import { controllable, timerStatus, type TimerStatus } from '$lib/overlay/timer';
import { attempt, toasts } from '$lib/state/toast.svelte';
import type { EditorStore } from './store.svelte';

export interface TimerButton {
  action: TimerAction;
  label: string;
  disabled: boolean;
}

/** Null when the layer isn't a countdown or stopwatch. */
export function timerState(l: Layer, run: TimerRun | undefined, now: number): TimerStatus | null {
  const k = l.kind;
  return k.type === 'timer' && controllable(k.mode) ? timerStatus(run, k.mode, k.duration_s, now) : null;
}

/** Start, pause or resume, and reset, for the state the timer is in. */
export function timerButtons(status: TimerStatus): TimerButton[] {
  return [
    { action: 'start', label: status === 'idle' ? 'Start' : 'Restart', disabled: false },
    status === 'paused'
      ? { action: 'resume', label: 'Resume', disabled: false }
      : { action: 'pause', label: 'Pause', disabled: status !== 'running' },
    { action: 'reset', label: 'Reset', disabled: status === 'idle' }
  ];
}

/** Saves waiting edits first: the app only knows saved layers. */
export async function controlTimer(store: EditorStore, layerId: string, action: TimerAction, seconds = 0): Promise<void> {
  if (!(await store.flush())) {
    toasts.error(store.saveError ?? "Couldn't save the overlay.");
    return;
  }
  await attempt(() => api.timerControl(layerId, action, seconds));
}
