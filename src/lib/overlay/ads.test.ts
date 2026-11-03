import { describe, expect, it } from 'vitest';
import { adLabel, adPhase, adText, countdown, sampleAdPhase, scheduleFromVars } from './ads';

const NOW = 1_700_000_000_000;
const sched = (nextIn: number, runningFor = 0) => ({
  next_ad_at: nextIn ? NOW + nextIn * 1000 : 0,
  length_s: 90,
  running_until: runningFor ? NOW + runningFor * 1000 : 0,
  running_length_s: runningFor ? 90 : 0
});

describe('ad countdowns', () => {
  it('formats like a clock', () => {
    expect(countdown(0)).toBe('0:00');
    expect(countdown(30)).toBe('0:30');
    expect(countdown(272)).toBe('4:32');
    expect(countdown(3725)).toBe('1:02:05');
    expect(countdown(-4)).toBe('0:00');
    expect(countdown(59.9)).toBe('0:59');
  });

  it('labels the status bar', () => {
    expect(adLabel(sched(272), NOW)).toBe('Ad in 4:32');
    expect(adLabel(sched(272), NOW + 500)).toBe('Ad in 4:32');
    expect(adLabel(sched(900, 72), NOW)).toBe('Ad running 1:12');
    expect(adLabel(sched(0), NOW)).toBeNull();
    expect(adLabel(sched(-10), NOW)).toBeNull();
    expect(adLabel(null, NOW)).toBeNull();
  });

  it('knows the phase and the lead time', () => {
    expect(adPhase(sched(25), NOW, 30)).toEqual({ phase: 'soon', seconds: 25, length_s: 90 });
    expect(adPhase(sched(31), NOW, 30)).toBeNull();
    expect(adPhase(sched(31), NOW, 0)).toBeNull();
    expect(adPhase(sched(600, 10), NOW, 30)).toEqual({ phase: 'running', seconds: 10, length_s: 90 });
  });

  it('reads overlay variables', () => {
    const s = scheduleFromVars({ 'ads.next_at': NOW + 30_000, 'ads.length_s': 60, 'ads.ends_at': 0, 'ads.running_length_s': 0 });
    expect(adPhase(s, NOW, 30)?.seconds).toBe(30);
    expect(scheduleFromVars({})).toEqual({ next_ad_at: 0, length_s: 0, running_until: 0, running_length_s: 0 });
  });

  it('fills the layer texts', () => {
    expect(adText('Ads in {{time}}, back soon', { phase: 'soon', seconds: 30, length_s: 90 })).toBe('Ads in 0:30, back soon');
    expect(adText('Back in {{time}} ({{seconds}} s of {{length}})', { phase: 'running', seconds: 72, length_s: 90 })).toBe('Back in 1:12 (72 s of 1:30)');
  });

  it('loops a sample for the editor', () => {
    expect(sampleAdPhase('soon', 0, 30)).toEqual({ phase: 'soon', seconds: 30, length_s: 90 });
    expect(sampleAdPhase('soon', 29_000, 30).seconds).toBe(1);
    expect(sampleAdPhase('running', 1000).seconds).toBe(89);
  });
});
