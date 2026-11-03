import { describe, expect, it } from 'vitest';
import { endText, hypeFraction, hypeFromVars, hypePhase, isLevelUp, LATE_MS, sampleHype, secondsLeft, trainLabel } from './hype';

const running = {
  'hype.active': true,
  'hype.level': 2,
  'hype.progress': 450,
  'hype.goal': 600,
  'hype.total': 2050,
  'hype.ends_at': 100_000,
  'hype.type': 'golden_kappa',
  'hype.shared': false,
  'hype.top_bits_name': 'pixelbyte',
  'hype.top_bits': 900,
  'hype.top_sub_name': '',
  'hype.last_level': 0,
  'hype.ended_at': 0
};

describe('hype train variables', () => {
  it('reads a running train', () => {
    const t = hypeFromVars(running)!;
    expect(t.active).toBe(true);
    expect(t.level).toBe(2);
    expect(t.type).toBe('golden_kappa');
    expect(t.topBits).toEqual({ name: 'pixelbyte', total: 900 });
    expect(t.topSub).toBeNull();
  });

  it('is null before any train and tidies odd values', () => {
    expect(hypeFromVars({})).toBeNull();
    const t = hypeFromVars({ 'hype.active': false, 'hype.level': 'x', 'hype.type': 'mystery', 'hype.goal': -5 })!;
    expect(t.level).toBe(1);
    expect(t.type).toBe('regular');
    expect(t.goal).toBe(0);
  });
});

describe('progress and time', () => {
  it('fills toward the goal and stays in range', () => {
    expect(hypeFraction(450, 600)).toBe(0.75);
    expect(hypeFraction(900, 600)).toBe(1);
    expect(hypeFraction(-1, 600)).toBe(0);
    expect(hypeFraction(10, 0)).toBe(0);
    expect(hypeFraction(Number.NaN, 10)).toBe(0);
  });

  it('counts whole seconds down to 0', () => {
    expect(secondsLeft(100_000, 40_200)).toBe(60);
    expect(secondsLeft(100_000, 99_001)).toBe(1);
    expect(secondsLeft(100_000, 120_000)).toBe(0);
    expect(secondsLeft(0, 5)).toBe(0);
  });
});

describe('when the layer shows', () => {
  const t = hypeFromVars(running)!;

  it('shows a running train until a little after its time runs out', () => {
    expect(hypePhase(t, 50_000, 10)?.phase).toBe('running');
    expect(hypePhase(t, 100_000 + LATE_MS - 1, 10)?.phase).toBe('running');
    expect(hypePhase(t, 100_000 + LATE_MS, 10)).toBeNull();
    expect(hypePhase({ ...t, endsAt: 0 }, 9e12, 10)?.phase).toBe('running');
  });

  it('shows the end text for a while after the end', () => {
    const ended = { ...t, active: false, lastLevel: 4, endedAt: 200_000 };
    expect(hypePhase(ended, 205_000, 10)?.phase).toBe('ended');
    expect(hypePhase(ended, 210_000, 10)).toBeNull();
    expect(hypePhase(ended, 200_500, 0)).toBeNull();
    expect(endText('Reached level {{level}}!', ended)).toBe('Reached level 4!');
    expect(hypePhase(null, 0, 10)).toBeNull();
  });

  it('spots level ups', () => {
    expect(isLevelUp(null, 3)).toBe(false);
    expect(isLevelUp(2, 3)).toBe(true);
    expect(isLevelUp(3, 3)).toBe(false);
    expect(isLevelUp(4, 2)).toBe(false);
  });

  it('names the kind of train', () => {
    expect(trainLabel({ type: 'regular', shared: false })).toBe('Hype train');
    expect(trainLabel({ type: 'treasure', shared: true })).toBe('Shared treasure train');
  });

  it('has a sample that loops for the editor', () => {
    const a = sampleHype(1_000_000);
    expect(a.active).toBe(true);
    expect(secondsLeft(a.endsAt, 1_000_000)).toBeGreaterThan(0);
    expect(hypeFraction(a.progress, a.goal)).toBeGreaterThan(0.3);
    expect(sampleHype(1_000_000, 2).level).toBe(a.level + 2);
  });
});
