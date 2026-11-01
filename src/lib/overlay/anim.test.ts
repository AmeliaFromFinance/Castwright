import { describe, expect, it } from 'vitest';
import type { AnimPreset } from '$lib/bindings/AnimPreset';
import type { Animation as Anim } from '$lib/bindings/Animation';
import { alertTimes } from './alert-timing';
import { animSpec, durationOf, easingCss } from './anim';
import { alertPlay } from './test/fixtures';

const a = (preset: AnimPreset, duration_ms = 400): Anim => ({ preset, duration_ms, delay_ms: 50, easing: 'back' });
const PRESETS: AnimPreset[] = ['fade', 'slide_up', 'slide_down', 'slide_left', 'slide_right', 'zoom', 'pop', 'bounce', 'flip', 'pulse', 'float', 'shake', 'spin'];

describe('animSpec', () => {
  it('returns null for none', () => {
    expect(animSpec(a('none'), 'enter')).toBeNull();
    expect(animSpec(null, 'idle')).toBeNull();
  });
  for (const p of PRESETS) {
    it(`${p}: enter starts hidden, exit ends hidden, idle loops`, () => {
      const enter = animSpec(a(p), 'enter')!;
      const exit = animSpec(a(p), 'exit')!;
      const idle = animSpec(a(p), 'idle')!;
      expect(enter.keyframes[0]?.opacity).toBe(0);
      expect(enter.keyframes.at(-1)?.opacity ?? 1).toBe(1);
      expect(exit.keyframes.at(-1)?.opacity).toBe(0);
      expect(enter.options).toMatchObject({ duration: 400, delay: 50, fill: 'both', iterations: 1 });
      expect(idle.options.iterations).toBe(Infinity);
      for (const k of [...enter.keyframes, ...exit.keyframes, ...idle.keyframes]) {
        if (k.offset !== undefined) expect(k.offset).toBeGreaterThanOrEqual(0);
      }
      const offsets = exit.keyframes.map((k) => k.offset).filter((o) => o !== undefined) as number[];
      expect(offsets).toEqual([...offsets].sort((x, y) => x - y));
    });
  }
  it('uses defaults when duration is 0', () => {
    expect(durationOf(a('fade', 0), 'enter')).toBe(450);
    expect(durationOf(a('fade', 0), 'idle')).toBe(2400);
    expect(durationOf(a('none', 900), 'enter')).toBe(0);
  });
  it('mirrors overshoot easings for exits', () => {
    expect(easingCss('back', 'enter')).toBe('cubic-bezier(0.34, 1.56, 0.64, 1)');
    expect(easingCss('back', 'exit')).toContain('-0.56');
    expect(easingCss('spring', 'enter')).toMatch(/^cubic-bezier/);
    expect(easingCss('linear', 'enter')).toBe('linear');
  });
});

describe('alertTimes', () => {
  it('starts the exit at duration_ms and ends with the server window', () => {
    const t = alertTimes({ play: alertPlay({ duration_ms: 6000 }), startedAt: 1000, stoppedAt: null });
    expect(t).toEqual({ exitAt: 7000, endAt: 7350, exitMs: 350 });
  });
  it('holds at least 500ms like the server', () => {
    expect(alertTimes({ play: alertPlay({ duration_ms: 100 }), startedAt: 0, stoppedAt: null }).exitAt).toBe(500);
  });
  it('moves the exit to the stop time', () => {
    expect(alertTimes({ play: alertPlay(), startedAt: 0, stoppedAt: 2000 })).toEqual({ exitAt: 2000, endAt: 2350, exitMs: 350 });
  });
  it('fits a default-length exit inside the window', () => {
    const p = alertPlay({ duration_ms: 3000, exit: { preset: 'fade', duration_ms: 0, delay_ms: 0, easing: 'ease_out' } });
    expect(alertTimes({ play: p, startedAt: 0, stoppedAt: null })).toEqual({ exitAt: 2650, endAt: 3000, exitMs: 350 });
  });
  it('without an exit animation it just disappears', () => {
    const p = alertPlay({ exit: { preset: 'none', duration_ms: 0, delay_ms: 0, easing: 'ease_out' } });
    expect(alertTimes({ play: p, startedAt: 0, stoppedAt: null })).toEqual({ exitAt: 6000, endAt: 6000, exitMs: 0 });
  });
});
