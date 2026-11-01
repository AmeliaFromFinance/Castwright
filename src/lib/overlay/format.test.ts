import { describe, expect, it } from 'vitest';
import { formatClock, formatDuration, timerText, type TimerInput } from './format';

const T0 = 1_700_000_000_000;
const base: TimerInput = { mode: 'countdown', durationS: 300, anchor: undefined, hasAnchor: false, loadedAt: T0, streamStartedAt: 0, now: T0 };

describe('formatDuration', () => {
  it('uses MM:SS under an hour and H:MM:SS above', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(59.9)).toBe('00:59');
    expect(formatDuration(61)).toBe('01:01');
    expect(formatDuration(3599)).toBe('59:59');
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(36_000 + 62)).toBe('10:01:02');
  });
  it('treats negative and bad input as zero', () => {
    expect(formatDuration(-5)).toBe('00:00');
    expect(formatDuration(Number.NaN)).toBe('00:00');
  });
});

describe('timerText', () => {
  it('counts down from load and clamps at zero', () => {
    expect(timerText(base)).toBe('05:00');
    expect(timerText({ ...base, now: T0 + 400 })).toBe('05:00');
    expect(timerText({ ...base, now: T0 + 1000 })).toBe('04:59');
    expect(timerText({ ...base, now: T0 + 299_001 })).toBe('00:01');
    expect(timerText({ ...base, now: T0 + 300_000 })).toBe('00:00');
    expect(timerText({ ...base, now: T0 + 900_000 })).toBe('00:00');
  });
  it('counts down from an anchor', () => {
    const a = { ...base, hasAnchor: true, anchor: T0 - 60_000 };
    expect(timerText(a)).toBe('04:00');
    expect(timerText({ ...a, anchor: String(T0 - 60_000) })).toBe('04:00');
    // duration 0: the anchor is the end time
    expect(timerText({ ...a, durationS: 0, anchor: T0 + 90_000 })).toBe('01:30');
    // anchor not set yet: show the full length
    expect(timerText({ ...a, anchor: null })).toBe('05:00');
  });
  it('runs a stopwatch', () => {
    const s = { ...base, mode: 'stopwatch' as const };
    expect(timerText({ ...s, now: T0 + 65_900 })).toBe('01:05');
    expect(timerText({ ...s, hasAnchor: true, anchor: T0 - 3_600_000 })).toBe('1:00:00');
    expect(timerText({ ...s, hasAnchor: true, anchor: 0 })).toBe('00:00');
  });
  it('shows uptime only while live', () => {
    const u = { ...base, mode: 'uptime' as const };
    expect(timerText(u)).toBe('');
    expect(timerText({ ...u, streamStartedAt: T0 - 7_384_000 })).toBe('2:03:04');
  });
  it('shows a local clock', () => {
    const d = new Date(2024, 0, 2, 7, 5, 9);
    expect(formatClock(d)).toBe('07:05');
    expect(timerText({ ...base, mode: 'clock', now: d.getTime() })).toBe('07:05');
  });
});
