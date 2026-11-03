import { describe, expect, it } from 'vitest';
import { fit, shortBitrate, type FitItem, type Space } from './statusbar';

const items: FitItem[] = [
  { id: 'obs', priority: 100, critical: true, full: 120, compact: 50 },
  { id: 'cpu', priority: 50, full: 70, compact: 50 },
  { id: 'bitrate', priority: 60, full: 130, compact: 80 },
  { id: 'health', priority: 90, full: 30 },
  { id: 'version', priority: 10, full: 50 }
];
// Full: 400. All compact: 260.
const space = (available: number): Space => ({ available, more: 40 });
const modes = (available: number, list = items) => fit(list, space(available)).modes;

describe('status bar fitting', () => {
  it('shows everything in full when it fits', () => {
    const f = fit(items, space(400));
    expect(Object.values(f.modes).every((m) => m === 'full')).toBe(true);
    expect(f.hidden).toEqual([]);
    expect(f.level).toBe(0);
  });

  it('shortens the lowest priority first', () => {
    expect(modes(380)).toMatchObject({ cpu: 'compact', bitrate: 'full', obs: 'full' });
    expect(modes(330)).toMatchObject({ cpu: 'compact', bitrate: 'compact', obs: 'full' });
    expect(modes(260)).toMatchObject({ cpu: 'compact', bitrate: 'compact', obs: 'compact', version: 'full' });
  });

  it('hides in priority order once everything is compact, counting the More button', () => {
    // 260 - version 50 + More 40 = 250
    let f = fit(items, space(255));
    expect(f.hidden).toEqual(['version']);
    // 250 - cpu 50 = 200
    f = fit(items, space(200));
    expect(f.hidden).toEqual(['cpu', 'version']);
    expect(f.modes.bitrate).toBe('compact');
  });

  it('never hides critical items, even with no room', () => {
    const f = fit(items, space(0));
    expect(f.modes.obs).toBe('compact');
    expect(f.hidden).toEqual(['cpu', 'bitrate', 'health', 'version']);
  });

  it('shows compacted items in full again when hiding frees the room', () => {
    const two: FitItem[] = [
      { id: 'obs', priority: 100, critical: true, full: 120, compact: 50 },
      { id: 'version', priority: 10, full: 100 }
    ];
    const f = fit(two, { available: 130, more: 10 });
    expect(f.modes).toEqual({ obs: 'full', version: 'hidden' });
  });

  it('counts the extra width', () => {
    expect(fit(items, { available: 400, more: 40, extra: 10 }).modes.cpu).toBe('compact');
  });

  it('later items give way first at the same priority', () => {
    const same: FitItem[] = [
      { id: 'a', priority: 5, full: 50 },
      { id: 'b', priority: 5, full: 50 }
    ];
    expect(fit(same, space(90)).hidden).toEqual(['b']);
  });

  it('shrinks right away but only grows back with room to spare', () => {
    const a = fit(items, space(380));
    expect(a.modes.cpu).toBe('compact');
    // Exactly enough for full, but within the hysteresis margin: stay.
    expect(fit(items, space(400), a, 24).modes.cpu).toBe('compact');
    expect(fit(items, space(423), a, 24).modes.cpu).toBe('compact');
    // Clearly enough room.
    expect(fit(items, space(424), a, 24).modes.cpu).toBe('full');
    // Shrinking again ignores the margin.
    const b = fit(items, space(424), a, 24);
    expect(fit(items, space(399), b, 24).modes.cpu).toBe('compact');
  });

  it('grows back step by step within the margin', () => {
    const tight = fit(items, space(200));
    expect(tight.hidden).toEqual(['cpu', 'version']);
    // 250 would show cpu; the margin keeps it at the next step down.
    const f = fit(items, space(260), tight, 24);
    expect(f.hidden).toEqual(['cpu', 'version']);
    expect(fit(items, space(274), tight, 24).hidden).toEqual(['version']);
  });

  it('resets hysteresis when the items change', () => {
    const a = fit(items, space(380));
    const fewer = items.filter((it) => it.id !== 'version');
    expect(fit(fewer, space(400), a).modes.cpu).toBe('full');
  });
});

describe('short bitrate', () => {
  it('uses Mb/s from 1000 kb/s', () => {
    expect(shortBitrate(6020)).toBe('6.0 Mb/s');
    expect(shortBitrate(12_480)).toBe('12.5 Mb/s');
    expect(shortBitrate(850)).toBe('850 kb/s');
  });
});
