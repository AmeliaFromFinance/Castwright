import { describe, expect, it } from 'vitest';
import { timerText, type TimerInput } from './format';
import { applyTimer, timerStatus } from './timer';

const MIN = 60_000;

describe('applyTimer', () => {
  it('starts, pauses, resumes and resets', () => {
    const started = applyTimer(null, 'start', 0, 5 * MIN, 1000);
    const paused = applyTimer(started, 'pause', 0, 5 * MIN, 31_000);
    expect(paused).toEqual({ running: false, elapsed_ms: 30_000, at: 31_000 });
    const resumed = applyTimer(paused, 'resume', 0, 5 * MIN, 90_000);
    expect(applyTimer(resumed, 'reset', 0, 5 * MIN, 95_000)).toEqual({ running: false, elapsed_ms: 0, at: 95_000 });
    expect(applyTimer(resumed, 'toggle', 0, 5 * MIN, 95_000)).toEqual({ running: false, elapsed_ms: 35_000, at: 95_000 });
  });

  it('adds time from the end of a finished countdown', () => {
    const done = { running: true, elapsed_ms: 0, at: 0 };
    expect(applyTimer(done, 'add', 10_000, MIN, 10 * MIN).elapsed_ms).toBe(MIN - 10_000);
    expect(applyTimer({ running: false, elapsed_ms: 5000, at: 0 }, 'add', -9000, null, 0).elapsed_ms).toBe(0);
  });
});

describe('timer text with app state', () => {
  const base: TimerInput = { mode: 'countdown', durationS: 300, anchor: undefined, hasAnchor: false, loadedAt: 0, streamStartedAt: null, now: 100_000 };

  it('shows the time left of a paused or running countdown', () => {
    expect(timerText({ ...base, run: { running: false, elapsed_ms: 60_000, at: 0 } })).toBe('04:00');
    expect(timerText({ ...base, run: { running: true, elapsed_ms: 60_000, at: 90_000 } })).toBe('03:50');
    expect(timerText({ ...base, run: { running: true, elapsed_ms: 0, at: 0 }, now: 10 * MIN })).toBe('00:00');
    expect(timerText({ ...base, run: { running: false, elapsed_ms: -30_000, at: 0 } })).toBe('05:30');
  });

  it('counts a stopwatch up from its state', () => {
    expect(timerText({ ...base, mode: 'stopwatch', run: { running: true, elapsed_ms: 5000, at: 95_000 } })).toBe('00:10');
  });

  it('reports the status', () => {
    expect(timerStatus(null, 'countdown', 300, 0)).toBe('idle');
    expect(timerStatus({ running: true, elapsed_ms: 0, at: 0 }, 'countdown', 300, 1000)).toBe('running');
    expect(timerStatus({ running: false, elapsed_ms: 2000, at: 0 }, 'countdown', 300, 1000)).toBe('paused');
    expect(timerStatus({ running: true, elapsed_ms: 0, at: 0 }, 'countdown', 300, 301_000)).toBe('done');
    expect(timerStatus({ running: false, elapsed_ms: 0, at: 0 }, 'stopwatch', 0, 5)).toBe('idle');
  });
});
