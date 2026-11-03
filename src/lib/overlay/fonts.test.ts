import { describe, expect, it } from 'vitest';
import type { Overlay } from '$lib/bindings/Overlay';
import { cleanDefaultFont, ensureFonts, fontsFor, googleFontsHref, isSystemFont, resolveFont } from './fonts';
import { DEFAULT_TEXT } from './styles';
import { layer } from './test/fixtures';

const ov = (layers: Overlay['layers'], fonts: string[] = []): Overlay => ({ id: 'o', name: '', width: 1, height: 1, layers, fonts, updated_at: 0 });

describe('fonts', () => {
  it('collects listed fonts and text style families, skipping system fonts', () => {
    const o = ov(
      [
        layer({ type: 'text', text: '', style: { ...DEFAULT_TEXT, font_family: 'Bebas Neue', font_weight: 700 } }),
        layer({ type: 'counter', var: 'x', format: '', style: { ...DEFAULT_TEXT, font_family: 'Arial' } }),
        layer({ type: 'timer', mode: 'clock', duration_s: 0, anchor_var: '', prefix: '', style: { ...DEFAULT_TEXT, font_family: '"Inter", sans-serif', italic: true, font_weight: 500 } })
      ],
      ['Inter', 'Segoe UI']
    );
    const needs = fontsFor(o);
    expect(needs.map((n) => n.family)).toEqual(['Inter', 'Bebas Neue']);
    expect([...needs[0]!.weights]).toEqual([500]);
    expect(needs[0]!.italic).toBe(true);
    expect(isSystemFont('system-ui')).toBe(true);
  });
  it('falls back to the project default font', () => {
    expect(resolveFont('Default', 'Poppins')).toBe('Poppins');
    expect(resolveFont('', 'Poppins')).toBe('Poppins');
    expect(resolveFont(' default ', 'Poppins')).toBe('Poppins');
    expect(resolveFont('Bangers', 'Poppins')).toBe('Bangers');
    expect(resolveFont('Inter', 'Poppins')).toBe('Inter');
    expect(resolveFont('Default', '')).toBe('Inter');
    expect(resolveFont('Default', 'Default')).toBe('Inter');
    expect(resolveFont('Default', null)).toBe('Inter');
  });
  it('loads the project default for text that uses it', () => {
    const o = ov([layer({ type: 'text', text: '', style: { ...DEFAULT_TEXT, font_family: 'Default', font_weight: 800 } })], ['Default']);
    expect(fontsFor(o, [], 'Lexend').map((n) => [n.family, [...n.weights]])).toEqual([['Lexend', [800]]]);
    expect(fontsFor(o).map((n) => n.family)).toEqual(['Inter']);
  });
  it('cleans the default font like the backend', () => {
    expect(cleanDefaultFont('  Poppins ')).toBe('Poppins');
    expect(cleanDefaultFont('Default')).toBe('Inter');
    expect(cleanDefaultFont('')).toBe('Inter');
    expect(cleanDefaultFont('Bad;}<x>')).toBe('Badx');
  });
  it('builds css2 URLs', () => {
    expect(googleFontsHref({ family: 'Bebas Neue', weights: new Set([700]), italic: false })).toBe(
      'https://fonts.googleapis.com/css2?family=Bebas+Neue:wght@400;700&display=swap'
    );
    expect(googleFontsHref({ family: 'Inter', weights: new Set([600, 500]), italic: true })).toBe(
      'https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;1,400;1,500;1,600&display=swap'
    );
    expect(googleFontsHref({ family: 'Inter', weights: new Set(), italic: false }, false)).toBe(
      'https://fonts.googleapis.com/css2?family=Inter&display=swap'
    );
  });
  it('adds each link once and falls back without weights on error', () => {
    ensureFonts([{ family: 'Lobster', weights: new Set([800]), italic: false }]);
    ensureFonts([{ family: 'Lobster', weights: new Set([800]), italic: false }]);
    const links = [...document.head.querySelectorAll<HTMLLinkElement>('link[data-cw-font="Lobster"]')];
    expect(links).toHaveLength(1);
    links[0]!.dispatchEvent(new Event('error'));
    const after = [...document.head.querySelectorAll<HTMLLinkElement>('link[data-cw-font="Lobster"]')];
    expect(after.map((l) => l.href)).toEqual(['https://fonts.googleapis.com/css2?family=Lobster&display=swap']);
  });
});
