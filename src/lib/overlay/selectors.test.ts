import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SELECTORS, ruleFor, selectorsFor, selectorsMarkdown, variablesFor, VARIABLES } from './selectors';

const dir = join(process.cwd(), 'src/lib/overlay');
const sources = [
  ...readdirSync(join(dir, 'layers')).map((f) => readFileSync(join(dir, 'layers', f), 'utf8')),
  readFileSync(join(dir, 'LayerView.svelte'), 'utf8'),
  ...readdirSync(join(dir, 'emotes'))
    .filter((f) => f.endsWith('.svelte'))
    .map((f) => readFileSync(join(dir, 'emotes', f), 'utf8')),
  readFileSync(join(dir, 'StyledText.svelte'), 'utf8'),
  readFileSync(join(dir, 'styles.ts'), 'utf8')
].join('\n');

// Wrappers and states that are not meant for styling.
const INTERNAL = ['cw-layer', 'cw-anim', 'cw-idle', 'cw-box', 'cw-ghost', 'cw-single', 'cw-block', 'cw-loaded', 'cw-ticker-strip', 'cw-ticker-copy', 'cw-h', 'cw-w', 'cw-editor'];

const classesIn = (s: string) => new Set([...s.matchAll(/\.(cw-[a-z0-9_-]+)/g)].map((m) => m[1]!));

describe('selector catalogue', () => {
  it('only lists classes the renderer really uses', () => {
    for (const s of SELECTORS) {
      for (const c of classesIn(s.selector)) {
        // Classes built from a value, like `cw-emote-{provider}`, count by their prefix.
        const built = c.lastIndexOf('-') > 2 && sources.includes(`${c.slice(0, c.lastIndexOf('-') + 1)}{`);
        if (!built) expect(sources, s.selector).toContain(c);
      }
    }
  });

  it('lists every class the layers use', () => {
    const used = new Set<string>();
    for (const m of sources.matchAll(/class(?::|=)"?\{?[^>]*?\b(cw-[a-z0-9-]+)/g)) used.add(m[1]!);
    for (const m of sources.matchAll(/class="([^"{]+)/g)) for (const c of m[1]!.split(/\s+/)) if (c.startsWith('cw-')) used.add(c);
    const listed = new Set(SELECTORS.flatMap((s) => [...classesIn(s.selector)]));
    const missing = [...used].filter((c) => !listed.has(c) && !INTERNAL.includes(c) && !c.endsWith('-'));
    expect(missing).toEqual([]);
  });

  it('filters by layer kind', () => {
    const chat = selectorsFor('chat').map((s) => s.selector);
    expect(chat).toEqual(expect.arrayContaining([':scope', '.cw-chat', '.cw-chat-line', '.cw-chat-badge', '.cw-chat-name', '.cw-chat-sep', '.cw-chat-msg', '.cw-emote', '.cw-mention', '.cw-cheer', '.cw-action']));
    expect(chat).not.toContain('.cw-alert');
    expect(selectorsFor('alerts').map((s) => s.selector)).toContain('.cw-alert-title');
    expect(variablesFor('chat').map((v) => v.name)).toEqual(['--cw-name', '--cw-tint', '--cw-lean']);
    expect(variablesFor('image')).toEqual([]);
    expect(selectorsFor('poll').map((s) => s.selector)).toEqual(expect.arrayContaining(['.cw-poll-choice', '.cw-poll-fill', '.cw-winner', '.cw-text']));
    expect(selectorsFor('ad_break').map((s) => s.selector)).toEqual(expect.arrayContaining(['.cw-ad', '.cw-ad-card', '.cw-ad-text', '.cw-ad-running', '.cw-text']));
    for (const v of VARIABLES) expect(sources).toContain(v.name);
  });

  it('has one entry per selector and a description for each', () => {
    const names = SELECTORS.map((s) => s.selector);
    expect(new Set(names).size).toBe(names.length);
    for (const s of SELECTORS) expect(s.description.length).toBeGreaterThan(3);
  });

  it('makes rules and Markdown', () => {
    expect(ruleFor('.cw-chat-name')).toBe('.cw-chat-name {\n  \n}\n');
    const md = selectorsMarkdown();
    expect(md).toContain('## Chat');
    expect(md).toContain('| `.cw-chat-line` | Each message card |');
    expect(md).toContain('| `--cw-accent` |');
    expect(md.split('## ').length - 1).toBe(14);
  });
});

describe('docs', () => {
  it('the Custom CSS reference page lists the same selectors', () => {
    const page = readFileSync(join(process.cwd(), 'docs-site/src/content/docs/reference/styling.md'), 'utf8');
    const tables = selectorsMarkdown().split('\n').slice(4).join('\n').trim();
    // Rebuild with: npm run docs:selectors
    expect(page).toContain(tables);
  });
});
