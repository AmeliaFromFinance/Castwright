import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILT_INS, BUILT_IN_ROOTS, isLiveKey, type BuiltInSource } from './builtins';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

/** Variable names in the tables under "Built-in variables" in the reference page. */
function documented(): string[] {
  const md = read('docs-site/src/content/docs/reference/variables.md');
  const start = md.indexOf('## Built-in variables');
  const end = md.indexOf('\n## ', start + 1);
  const section = md.slice(start, end < 0 ? undefined : end);
  return [...section.matchAll(/^\| `([a-z0-9_.]+)` \|/gm)].map((m) => m[1]!);
}

/** The Rust files that set each source's variables. */
const SOURCES: Record<string, string[]> = {
  'last.': ['src-tauri/src/vars.rs'],
  'session.': ['src-tauri/src/vars.rs'],
  'stream.': ['src-tauri/src/twitch/stream.rs'],
  'twitch.': ['src-tauri/src/core.rs'],
  'obs.': ['src-tauri/src/obs/mod.rs'],
  'ads.': ['src-tauri/src/twitch/ads.rs'],
  'music.': ['src-tauri/src/music/mod.rs']
};
const CLIP: Partial<Record<BuiltInSource, string[]>> = { 'Create clip step': ['src-tauri/src/automation/mod.rs'] };

describe('built-in variables', () => {
  it('match the reference page', () => {
    expect([...BUILT_INS.map((b) => b.key)].sort()).toEqual(documented().sort());
  });

  it('are set by the backend', () => {
    for (const b of BUILT_INS) {
      const files = CLIP[b.source] ?? Object.entries(SOURCES).find(([p]) => b.key.startsWith(p))?.[1] ?? [];
      expect(files.some((f) => read(f).includes(`"${b.key}"`)), `${b.key} in ${files.join(', ')}`).toBe(true);
    }
  });

  it('are saved unless live', () => {
    for (const b of BUILT_INS) expect(b.saved, b.key).toBe(!isLiveKey(b.key));
    expect(BUILT_INS.every((b) => BUILT_IN_ROOTS.includes(b.key.split('.')[0]!))).toBe(true);
  });

  it('match the list the backend refuses to rename', () => {
    const rust = read('src-tauri/src/vars.rs');
    const list = (name: string) => [...rust.match(new RegExp(`${name}: \\[&str; \\d+\\] = \\[([^\\]]+)\\]`))![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    const saved = BUILT_INS.filter((b) => b.saved).map((b) => b.key);
    expect([...list('LAST_KEYS'), ...list('SESSION_KEYS')].sort()).toEqual(saved.sort());
  });

  it('use the same live prefixes as the backend', () => {
    const rust = read('src-tauri/src/vars.rs').match(/LIVE_PREFIXES: \[&str; \d+\] = \[([^\]]+)\]/)![1]!;
    const prefixes = [...rust.matchAll(/"([a-z]+)\."/g)].map((m) => m[1]!);
    for (const p of prefixes) expect(isLiveKey(`${p}.x`), p).toBe(true);
    expect(isLiveKey('session.subs')).toBe(false);
  });
});
