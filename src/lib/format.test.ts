import { describe, expect, it } from 'vitest';
import samples from '$lib/api/fixtures/sample-events.json';
import type { Event } from '$lib/bindings/Event';
import { ago, bytes, count, describe as describeEvent, duration, KIND_LABELS } from './format';

describe('format', () => {
  it('durations', () => {
    expect(duration(0)).toBe('0:00');
    expect(duration(65_000)).toBe('1:05');
    expect(duration(5_025_000)).toBe('1:23:45');
    expect(duration(-5)).toBe('0:00');
  });
  it('relative time', () => {
    const now = 1_000_000_000;
    expect(ago(now, now)).toBe('just now');
    expect(ago(now - 12_000, now)).toBe('12 s ago');
    expect(ago(now - 180_000, now)).toBe('3 min ago');
    expect(ago(now - 7_200_000, now)).toBe('2 h ago');
  });
  it('numbers', () => {
    expect(count(1284)).toBe('1,284');
    expect(bytes(512)).toBe('512 B');
    expect(bytes(2_411_002)).toBe('2.3 MB');
  });
  it('describes every event kind without throwing', () => {
    for (const e of samples as unknown as Event[]) {
      const text = describeEvent(e);
      expect(text.length, e.kind).toBeGreaterThan(0);
      expect(text).not.toContain('undefined');
      expect(KIND_LABELS[e.kind]).toBeTruthy();
    }
  });
});
