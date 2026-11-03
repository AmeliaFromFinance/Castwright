import type { QueueState } from '$lib/bindings/QueueState';

export type AlertTone = 'ok' | 'paused' | 'muted';

export interface AlertSummary {
  /** Text next to the bell. */
  label: string;
  /** Playing plus waiting. */
  count: number;
  tone: AlertTone;
  /** Tooltip and screen reader text. */
  title: string;
}

export function alertSummary(q: QueueState): AlertSummary {
  const count = q.waiting.length + (q.playing ? 1 : 0);
  const state = [q.paused && 'paused', q.muted && 'muted'].filter(Boolean).join(' and ');
  const queued = count === 0 ? 'nothing queued' : count === 1 ? '1 alert queued' : `${count} alerts queued`;
  return {
    label: q.paused ? 'Paused' : q.muted ? 'Muted' : 'Alerts',
    count,
    tone: q.paused ? 'paused' : q.muted ? 'muted' : 'ok',
    title: `Alerts${state ? ` ${state}` : ''}, ${queued}`
  };
}
