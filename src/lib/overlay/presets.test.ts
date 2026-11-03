import { describe, expect, it } from 'vitest';
import type { TextStyle } from '$lib/bindings/TextStyle';
import { BOX_PRESETS, presetText } from './presets';
import { DEFAULT_TEXT } from './styles';

const base: TextStyle = { ...DEFAULT_TEXT, font_size: 44, align: 'center', line_height: 1.4 };
const pairs = BOX_PRESETS.flatMap((a) => BOX_PRESETS.filter((b) => b !== a).map((b) => [a, b] as const));

describe('presetText', () => {
  it('never sets a size', () => {
    for (const p of BOX_PRESETS) for (const t of [p.text, p.title, p.message]) expect(t?.font_size).toBeUndefined();
  });

  it('gives the same result as one pick, whatever was picked before', () => {
    for (const [a, b] of pairs) {
      const once = presetText(base, a.text);
      expect(presetText(presetText(presetText(base, a.text), b.text), a.text)).toEqual(once);
      expect(presetText(presetText(presetText(base, a.title), b.title), a.title)).toEqual(presetText(base, a.title));
    }
  });

  it('keeps the size, alignment and line height', () => {
    for (const [a, b] of pairs) {
      const out = presetText(presetText(base, a.text), b.text);
      expect([out.font_size, out.align, out.line_height]).toEqual([44, 'center', 1.4]);
    }
  });

  it('keeps a font the user picked, and swaps fonts that came from a preset', () => {
    const comic = BOX_PRESETS.find((p) => p.id === 'comic')!;
    const clean = BOX_PRESETS.find((p) => p.id === 'clean')!;
    expect(presetText(base, comic.text).font_family).toBe('Bangers');
    expect(presetText(presetText(base, comic.text), clean.text).font_family).toBe(clean.text!.font_family);
    const own = { ...base, font_family: 'Lobster' };
    expect(presetText(own, comic.text).font_family).toBe('Lobster');
    expect(presetText(presetText(own, comic.text), clean.text).font_family).toBe('Lobster');
  });

  it('leaves the style alone without a text patch', () => {
    expect(presetText(base, undefined)).toEqual(base);
  });
});
