// Ad breaks as the status bar and the Ad break layer show them.
import type { AdSchedule } from '$lib/bindings/AdSchedule';
import { render } from '$lib/logic/template';

type Times = Pick<AdSchedule, 'next_ad_at' | 'length_s' | 'running_until' | 'running_length_s'>;

export interface AdPhase {
  phase: 'soon' | 'running';
  /** Whole seconds until the ad starts, or until it ends while running. */
  seconds: number;
  length_s: number;
}

/** 272 -> "4:32", 3725 -> "1:02:05". */
export function countdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const secondsUntil = (at: number, now: number) => Math.ceil((at - now) / 1000);

/** An ad running, one starting within `soonS` seconds, or null. */
export function adPhase(s: Times | null | undefined, now: number, soonS = Infinity): AdPhase | null {
  if (!s) return null;
  if (s.running_until > now) return { phase: 'running', seconds: secondsUntil(s.running_until, now), length_s: s.running_length_s };
  if (s.next_ad_at > now) {
    const seconds = secondsUntil(s.next_ad_at, now);
    if (seconds <= soonS) return { phase: 'soon', seconds, length_s: s.length_s };
  }
  return null;
}

/** "Ad in 4:32", "Ad running 1:12", or null when no ad is coming. */
export function adLabel(s: Times | null | undefined, now: number): string | null {
  const p = adPhase(s, now);
  if (!p) return null;
  return p.phase === 'running' ? `Ad running ${countdown(p.seconds)}` : `Ad in ${countdown(p.seconds)}`;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

/** The schedule from overlay variables (`ads.next_at` and friends). */
export function scheduleFromVars(vars: Record<string, unknown>): Times {
  return {
    next_ad_at: num(vars['ads.next_at']),
    length_s: num(vars['ads.length_s']),
    running_until: num(vars['ads.ends_at']),
    running_length_s: num(vars['ads.running_length_s'])
  };
}

/** Values the layer texts can use. */
export function adContext(p: AdPhase): Record<string, string | number> {
  return { time: countdown(p.seconds), seconds: p.seconds, length: countdown(p.length_s), length_s: p.length_s };
}

export function adText(template: string, p: AdPhase): string {
  return render(template, adContext(p)).trim();
}

/** A looping sample for the editor, so the countdown can be seen ticking. */
export function sampleAdPhase(phase: AdPhase['phase'], now: number, soonS = 30): AdPhase {
  const tick = Math.floor(now / 1000);
  if (phase === 'running') return { phase, seconds: 90 - (tick % 90), length_s: 90 };
  const span = Math.max(1, Math.min(soonS || 30, 600));
  return { phase, seconds: span - (tick % span), length_s: 90 };
}

/** Placeholders for the layer texts, for the template field chips. */
export const AD_TOKENS = [
  { token: 'time', label: 'Countdown, like 0:30' },
  { token: 'seconds', label: 'Seconds left' },
  { token: 'length', label: 'Ad length, like 1:30' }
];
