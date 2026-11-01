import { describe, expect, it } from 'vitest';
import { boxInset, boxStyleCss, fontStack, scopeClass, scopeCss, textStyleCss } from './styles';
import { DEFAULT_TEXT } from './styles';
import { isLightBackground, parseColor, readableColor } from './color';

describe('scopeCss', () => {
  const S = 'cw-s-x';
  it('prefixes selectors and maps root selectors to the layer', () => {
    expect(scopeCss('.a, .b > p { color: red }', S)).toBe('.cw-s-x .a,.cw-s-x .b > p{ color: red }');
    expect(scopeCss(':scope{opacity:.5} body .x{a:b} html{c:d} :host(.y){e:f}', S)).toBe(
      '.cw-s-x{opacity:.5}\n.cw-s-x .x{a:b}\n.cw-s-x{c:d}\n.cw-s-x(.y){e:f}'
    );
  });
  it('treats bare declarations as rules for the layer', () => {
    expect(scopeCss('filter: drop-shadow(0 0 4px red);', S)).toBe('.cw-s-x{filter: drop-shadow(0 0 4px red);}');
  });
  it('recurses into @media and keeps @keyframes and @font-face', () => {
    const out = scopeCss('@media (max-width: 10px) { .a { x: y } } @keyframes k { from { opacity: 0 } to { opacity: 1 } } @font-face { font-family: F; src: url(a.woff2) }', S);
    expect(out).toContain('@media (max-width: 10px){.cw-s-x .a{ x: y }}');
    expect(out).toContain('@keyframes k{ from { opacity: 0 } to { opacity: 1 } }');
    expect(out).toContain('@font-face{ font-family: F; src: url(a.woff2) }');
  });
  it('drops @import and comments, survives braces in strings and stray braces', () => {
    expect(scopeCss('@import url(x.css); /* .y{} */ .a::before { content: "}{" }', S)).toBe('.cw-s-x .a::before{ content: "" }');
    expect(scopeCss('} .a{b:c} .bad{', S)).toBe('.cw-s-x .a{b:c}');
  });
  it('keeps commas inside :is() together', () => {
    expect(scopeCss(':is(.a, .b) .c{x:y}', S)).toBe('.cw-s-x :is(.a, .b) .c{x:y}');
  });
  it('cannot close the style element', () => {
    expect(scopeCss('.a{x:y}</style><script>alert(1)</script>', S)).not.toContain('</style');
  });
  it('makes stable class names', () => {
    expect(scopeClass('abc')).toBe(scopeClass('abc'));
    expect(scopeClass('abc')).not.toBe(scopeClass('abd'));
    expect(scopeClass('weird id!')).toMatch(/^cw-s-[a-z0-9]+$/);
  });
});

describe('text and box styles', () => {
  it('turns a TextStyle into CSS', () => {
    const css = textStyleCss({ ...DEFAULT_TEXT, font_family: 'Bebas Neue', uppercase: true, italic: true, align: 'center', letter_spacing: 1.5 });
    expect(css).toContain('font-family:"Bebas Neue", "Segoe UI"');
    expect(css).toContain('text-transform:uppercase');
    expect(css).toContain('font-style:italic');
    expect(css).toContain('text-align:center');
    expect(css).toContain('letter-spacing:1.5px');
    expect(css).toContain('text-shadow:0 2px 6px rgba(0,0,0,0.45)');
  });
  it('moves the shadow to the outline copy when stroked', () => {
    const css = textStyleCss({ ...DEFAULT_TEXT, stroke_width: 3, stroke_color: '#111' });
    expect(css).toContain('--cw-stroke-w:6px');
    expect(css).toContain('--cw-stroke-c:#111');
    expect(css).toContain('text-shadow:none');
    const inline = textStyleCss({ ...DEFAULT_TEXT, stroke_width: 2 }, 'inline');
    expect(inline).toContain('-webkit-text-stroke:2px #000000');
    expect(inline).toContain('paint-order:stroke fill');
  });
  it('strips characters that could break out of a style attribute', () => {
    expect(textStyleCss({ ...DEFAULT_TEXT, color: 'red;background:url(x)' })).toContain('color:redbackground:url(x)');
  });
  it('handles font lists', () => {
    expect(fontStack('Inter, sans-serif')).toBe('Inter, sans-serif');
    expect(fontStack('')).toContain('system-ui');
  });
  it('builds box styles', () => {
    const b = { background: '#000', border_color: '#fff', border_width: 2, radius: 12, padding: 16, shadow: '0 0 4px #000', backdrop_blur: 8 };
    const css = boxStyleCss(b);
    expect(css).toContain('background:#000');
    expect(css).toContain('border:2px solid #fff');
    expect(css).toContain('border-radius:12px');
    expect(css).toContain('padding:16px');
    expect(css).toContain('backdrop-filter:blur(8px)');
    expect(boxInset(b)).toBe(18);
    expect(boxStyleCss({ ...b, background: 'transparent', border_color: 'transparent', radius: 0, padding: 0, shadow: '', backdrop_blur: 0 })).toBe('');
  });
});

describe('colours', () => {
  it('parses hex and rgb', () => {
    expect(parseColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseColor('rgba(12, 15, 22, 0.78)')).toEqual({ r: 12, g: 15, b: 22, a: 0.78 });
    expect(parseColor('nonsense')).toBeNull();
  });
  it('lightens dark names on dark backgrounds only', () => {
    expect(readableColor('#0000FF')).not.toBe('#0000FF');
    expect(readableColor('#FF7F50')).toBe('#FF7F50');
    expect(readableColor('#FFFF00', true)).not.toBe('#FFFF00');
    expect(readableColor('#0000FF', true)).toBe('#0000FF');
  });
  it('detects light backgrounds', () => {
    expect(isLightBackground('#ffffff')).toBe(true);
    expect(isLightBackground('rgba(255,255,255,0.2)')).toBe(false);
    expect(isLightBackground('rgba(12,15,22,0.78)')).toBe(false);
    expect(isLightBackground('')).toBe(false);
  });
});
