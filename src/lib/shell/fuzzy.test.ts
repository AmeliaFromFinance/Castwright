import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyScore } from './fuzzy';

describe('fuzzy matching', () => {
  it('matches in order only', () => {
    expect(fuzzyScore('ovr', 'Overlays')).not.toBeNull();
    expect(fuzzyScore('rvo', 'Overlays')).toBeNull();
    expect(fuzzyScore('', 'anything')).toBe(0);
  });
  it('prefers direct and word-start matches', () => {
    const items = ['Settings: Overlay server', 'Overlays', 'Test alert: Follow', 'Go to Alerts'];
    expect(fuzzyFilter(items, 'over', (s) => s)[0]).toBe('Overlays');
    expect(fuzzyFilter(items, 'alerts', (s) => s)[0]).toBe('Go to Alerts');
    expect(fuzzyFilter(items, 'taf', (s) => s)).toEqual(['Test alert: Follow']);
  });
  it('keeps the original order without a query and respects the limit', () => {
    expect(fuzzyFilter(['b', 'a', 'c'], '', (s) => s, 2)).toEqual(['b', 'a']);
  });
});
