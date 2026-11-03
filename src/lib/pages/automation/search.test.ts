import { describe, expect, it } from 'vitest';
import { ENTRIES, addRecent, entryKey, recentEntries, searchEntries } from './search';

const top = (q: string, n = 3) => searchEntries(ENTRIES, q).slice(0, n).map((e) => e.label);

describe('step search', () => {
  it('lists every trigger and step', () => {
    expect(ENTRIES.filter((e) => e.kind === 'trigger').length).toBeGreaterThan(10);
    expect(new Set(ENTRIES.map(entryKey)).size).toBe(ENTRIES.length);
    expect(searchEntries(ENTRIES, '  ')).toHaveLength(ENTRIES.length);
  });

  it('ranks names first, steps before triggers', () => {
    expect(top('chat')[0]).toBe('Send chat message');
    expect(top('chat')).toContain('Chat command');
    expect(searchEntries(ENTRIES, 'chat', 'trigger')[0]!.label).toBe('Chat command');
    expect(top('if', 1)).toEqual(['If']);
  });

  it('matches groups, keywords and loose spelling', () => {
    expect(top('wait', 1)).toEqual(['Wait']);
    expect(top('sleep', 1)).toEqual(['Wait']);
    expect(searchEntries(ENTRIES, 'obs').every((e, i) => i > 4 || e.group === 'OBS')).toBe(true);
    expect(top('sndcht', 1)).toEqual(['Send chat message']);
    expect(searchEntries(ENTRIES, 'zzzz')).toEqual([]);
  });

  it('keeps recent picks newest first', () => {
    let r = addRecent([], 'step:log');
    r = addRecent(r, 'step:if');
    r = addRecent(r, 'step:log');
    expect(r).toEqual(['step:log', 'step:if']);
    expect(addRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
    expect(recentEntries(ENTRIES, ['step:if', 'step:gone', 'trigger:timer']).map((e) => e.label)).toEqual(['If', 'Timer']);
  });
});
