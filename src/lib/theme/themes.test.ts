import { describe, expect, it } from 'vitest';
import { contrast, ensureContrast, oklchToHex, parseHex } from './color';
import { BUILT_IN, checkTheme, generateTokens, parseSpec, resolveTheme, type ThemeSpec } from './themes';

describe('colour maths', () => {
  it('converts known OKLCH values', () => {
    expect(oklchToHex({ l: 1, c: 0, h: 0 })).toBe('#ffffff');
    expect(oklchToHex({ l: 0, c: 0, h: 0 })).toBe('#000000');
    // Out-of-gamut chroma is pulled back into sRGB rather than clipped per channel.
    expect(parseHex(oklchToHex({ l: 0.7, c: 0.4, h: 140 }))).not.toBeNull();
  });
  it('computes WCAG contrast', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
    expect(contrast('#d93036', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
  it('ensureContrast reaches the target', () => {
    const fg = ensureContrast({ l: 0.4, c: 0.05, h: 260 }, '#161a21', 4.5);
    expect(contrast(fg, '#161a21')).toBeGreaterThanOrEqual(4.5);
    const dark = ensureContrast({ l: 0.9, c: 0.05, h: 260 }, '#ffffff', 4.5);
    expect(contrast(dark, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('themes', () => {
  for (const spec of BUILT_IN) {
    it(`${spec.name} passes every contrast check`, () => {
      const failed = checkTheme(generateTokens(spec)).filter((c) => !c.pass);
      expect(failed).toEqual([]);
    });
  }

  it('generated themes pass for any accent', () => {
    for (const base of ['dark', 'light'] as const) {
      for (let hue = 0; hue < 360; hue += 15) {
        for (const chroma of [0, 0.08, 0.17, 0.3]) {
          for (const tint of [0, 0.5, 1]) {
            const spec: ThemeSpec = {
              ...BUILT_IN[0]!,
              id: 'x',
              base,
              accent_hue: hue,
              accent_chroma: chroma,
              tint
            };
            const failed = checkTheme(generateTokens(spec)).filter((c) => !c.pass);
            expect(failed, `${base} hue=${hue} chroma=${chroma} tint=${tint}`).toEqual([]);
          }
        }
      }
    }
  });

  it('overrides apply and are validated', () => {
    const spec: ThemeSpec = { ...BUILT_IN[0]!, overrides: { accent: '#ff0000', text: 'nope' } };
    const t = generateTokens(spec);
    expect(t.accent).toBe('#ff0000');
    expect(t.text).not.toBe('nope');
  });

  it('parses saved themes defensively', () => {
    expect(parseSpec(null)).toBeNull();
    expect(parseSpec({ id: '' })).toBeNull();
    const s = parseSpec({ id: 'mine', name: 'Mine', base: 'light', accent_hue: 999, radius: -5, overrides: { bogus: '#fff', text: '#000' } });
    expect(s).not.toBeNull();
    expect(s!.accent_hue).toBe(360);
    expect(s!.radius).toBe(0);
    expect(s!.overrides).toEqual({ text: '#000' });
  });

  it('resolves system and missing themes', () => {
    expect(resolveTheme('system', [], true).spec.id).toBe('dark');
    expect(resolveTheme('system', [], false).spec.id).toBe('light');
    expect(resolveTheme('gone', [], true).spec.id).toBe('dark');
    const custom = { id: 'c1', name: 'C', base: 'dark', accent_hue: 20 };
    expect(resolveTheme('c1', [custom], false).spec.name).toBe('C');
  });
});
