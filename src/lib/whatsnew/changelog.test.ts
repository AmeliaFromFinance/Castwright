import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { findRelease, inline, parseChangelog, parseNotes, shortVersion } from './changelog';
import { RELEASES, onStart } from './whatsnew.svelte';

const SAMPLE = `# Changelog

Intro text.

## 1.1.0 (upcoming)

### New

- **Big thing.** It does stuff.
- Second line
  that wraps.

### Fixed

- A bug.

## v1.0.0 – 2026-01-02

- First release.

## Notes

- Not a version.
`;

describe('changelog parser', () => {
  it('splits versions, groups and items', () => {
    const list = parseChangelog(SAMPLE);
    expect(list.map((r) => r.version)).toEqual(['1.1.0', '1.0.0']);
    expect(list[0]!.note).toBe('upcoming');
    expect(list[1]!.note).toBe('2026-01-02');
    expect(list[0]!.groups.map((g) => g.title)).toEqual(['New', 'Fixed']);
    expect(list[0]!.groups[0]!.items).toEqual(['**Big thing.** It does stuff.', 'Second line that wraps.']);
    expect(list[1]!.groups).toEqual([{ title: '', items: ['First release.'] }]);
  });

  it('finds a version with or without v and suffixes', () => {
    const list = parseChangelog(SAMPLE);
    expect(findRelease(list, 'v1.0.0')?.version).toBe('1.0.0');
    expect(findRelease(list, '1.1.0-beta.1')?.version).toBe('1.1.0');
    expect(findRelease(list, '2.0.0')).toBeUndefined();
    expect(shortVersion('0.6.0')).toBe('0.6');
    expect(shortVersion('v1.2.3')).toBe('1.2.3');
  });

  it('reads a release body without the version line', () => {
    const r = parseNotes('### New\n\n- One\n- Two\n\nSee the [guide](https://example.com/x) for install steps.', '2.0.0');
    expect(r.groups).toEqual([{ title: 'New', items: ['One', 'Two'] }]);
  });

  it('formats bold, code and links only', () => {
    expect(inline('a **b** `c` [d](https://e.f/g) <i>')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'bold', text: 'b' },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'c' },
      { type: 'text', text: ' ' },
      { type: 'link', text: 'd', href: 'https://e.f/g' },
      { type: 'text', text: ' <i>' }
    ]);
    expect(inline('[x](javascript:alert(1))')).toEqual([{ type: 'text', text: '[x](javascript:alert(1))' }]);
  });

  it('the bundled changelog has every released version, each with notes', () => {
    const versions = RELEASES.map((r) => r.version);
    for (const v of ['0.1.0', '0.2.0', '0.3.0', '0.4.0', '0.5.0']) expect(versions).toContain(v);
    for (const r of RELEASES) expect(r.groups.flatMap((g) => g.items).length).toBeGreaterThan(0);
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(findRelease(RELEASES, pkg.version)).toBeDefined();
  });
});

describe("what's new at start-up", () => {
  it('stays quiet on a new install and remembers the version', () => {
    expect(onStart(null, '0.6.0', true, true)).toBe('remember');
  });

  it('shows after an update', () => {
    expect(onStart('0.5.0', '0.6.0', false, true)).toBe('show');
    expect(onStart('0.5.2', '0.6.0', false, true)).toBe('show');
  });

  it('shows for people updating from before it existed', () => {
    expect(onStart(null, '0.6.0', false, true)).toBe('show');
  });

  it('shows once per version and never for downgrades', () => {
    expect(onStart('0.6.0', '0.6.0', false, true)).toBe('nothing');
    expect(onStart('0.7.0', '0.6.0', false, true)).toBe('nothing');
  });

  it('remembers without showing when a version has no notes', () => {
    expect(onStart('0.5.0', '0.6.1', false, false)).toBe('remember');
    expect(onStart('0.5.0', '', false, true)).toBe('nothing');
  });
});
