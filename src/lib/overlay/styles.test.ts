import { describe, expect, it } from 'vitest';
import {
  alertCard,
  alternator,
  boxInset,
  boxStyleCss,
  DEFAULT_BOX,
  DEFAULT_ITEM_CARD,
  fontStack,
  frameCss,
  itemCardCss,
  itemVars,
  layerFrameCss,
  parseShadow,
  resolveBox,
  scopeClass,
  scopeCss,
  textStyleCss
} from './styles';
import { BOX_PRESETS, findPreset, presetBox } from './presets';
import { kindDefaults } from '$lib/editor/layers';
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
  it('points Default and empty fonts at the stage default', () => {
    for (const f of ['Default', 'default', '', '  ']) expect(fontStack(f)).toMatch(/^var\(--cw-default-font, "Inter", /);
    expect(textStyleCss({ ...DEFAULT_TEXT, font_family: 'Default' })).toContain('font-family:var(--cw-default-font');
    expect(DEFAULT_TEXT.font_family).toBe('Default');
  });
});

describe('box frames', () => {
  const legacy = { background: '#000', border_color: '#fff', border_width: 2, radius: 12, padding: 16, shadow: '0 0 4px #000', backdrop_blur: 8 };
  const rule = (css: string, sel: string) => new RegExp(`(^|\\n)${sel.replace(/[.*()[\]:]/g, '\\$&')}\\{([^}]*)\\}`).exec(css)?.[2] ?? '';

  it('keeps boxes saved before frames looking the same', () => {
    const css = boxStyleCss(legacy);
    expect(css).toBe('background:#000;border:2px solid #fff;border-radius:12px;padding:16px;box-shadow:0 0 4px #000;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)');
    expect(boxInset(legacy)).toEqual({ x: 18, y: 18 });
    expect(resolveBox(legacy).shadow_kind).toBe('custom');
    expect(frameCss(DEFAULT_BOX, '.a')).toBe('');
    expect(frameCss({ ...legacy, background: 'transparent', border_color: 'transparent', radius: 0, padding: 0, shadow: '', backdrop_blur: 0 }, '.a')).toBe('');
  });

  it('draws plain shapes on the element', () => {
    expect(frameCss({ ...DEFAULT_BOX, shape: 'rect', radius: 10, background: '#111' }, '.a')).toBe('.a{background:#111}');
    expect(frameCss({ ...DEFAULT_BOX, shape: 'pill', background: '#111' }, '.a')).toContain('border-radius:9999px');
    expect(frameCss({ ...DEFAULT_BOX, radius: 4, corners: [1, 2, 3, 4], background: '#111' }, '.a')).toContain('border-radius:1px 2px 3px 4px');
    expect(frameCss({ ...DEFAULT_BOX, padding: 8, padding_x: 20 }, '.a')).toBe('.a{padding:8px 20px}');
    expect(boxInset({ ...DEFAULT_BOX, padding: 8, padding_x: 20, border_width: 2, border_color: '#fff' })).toEqual({ x: 22, y: 10 });
  });

  it('adds a bubble tail that shares fill and border, with a shadow that follows it', () => {
    const css = frameCss(
      { ...DEFAULT_BOX, shape: 'bubble', background: '#fff', border_width: 3, border_color: '#111', tail_side: 'left', tail_pos: 40, shadow_kind: 'hard', shadow_x: 4, shadow_y: 4, shadow_color: '#000' },
      '.a'
    );
    const own = rule(css, '.a');
    expect(own).toContain('position:relative');
    expect(own).toContain('filter:drop-shadow(4px 4px 0px #000)');
    expect(own).not.toContain('box-shadow');
    const tail = rule(css, '.a::after');
    expect(tail).toContain('background:#fff');
    expect(tail).toContain('border-bottom:3px solid #111');
    expect(tail).toContain('border-left:3px solid #111');
    expect(tail).toContain('top:calc(40% - 8px)');
    expect(tail).toContain('left:calc(-8px - 1.5px)');
    expect(tail).toContain('clip-path:polygon(');
    expect(frameCss({ ...DEFAULT_BOX, shape: 'bubble', background: '#fff', tail_side: 'none' }, '.a')).not.toContain('::after');
  });

  it('skews slanted boxes on a layer behind the content', () => {
    const css = frameCss({ ...DEFAULT_BOX, shape: 'slanted', slant: 10, background: '#000', border_width: 2, border_color: '#f00', padding: 6, padding_x: 20 }, '.a');
    expect(rule(css, '.a')).toBe('position:relative;isolation:isolate;padding:8px 22px');
    const layer = rule(css, '.a::before');
    expect(layer).toContain('transform:skewX(-10deg)');
    expect(layer).toContain('z-index:-1');
    expect(layer).toContain('background:#000');
    expect(layer).toContain('border:2px solid #f00');
  });

  it('clips cut and pixel corners with a ring for the border', () => {
    const cut = frameCss({ ...DEFAULT_BOX, shape: 'cut', cut: 10, background: '#000', border_width: 2, border_color: '#0ff', shadow_kind: 'glow', shadow_blur: 12, shadow_color: '#0ff' }, '.a');
    expect(rule(cut, '.a')).toContain('filter:drop-shadow(0px 0px 6px #0ff) drop-shadow(0px 0px 2px #0ff)');
    expect(rule(cut, '.a::before')).toContain('clip-path:polygon(evenodd, 0px 10px, 10px 0px, calc(100% - 10px) 0px, 100% 10px');
    expect(rule(cut, '.a::before')).toContain('background:#0ff');
    expect(rule(cut, '.a::after')).toContain('clip-path:polygon(2px 11.17px, 11.17px 2px');
    expect(rule(cut, '.a::after')).toContain('background:#000');
    const pixel = frameCss({ ...DEFAULT_BOX, shape: 'pixel', pixel: 4, background: '#000' }, '.a');
    expect(pixel).not.toContain('::before');
    expect(rule(pixel, '.a::after')).toContain('polygon(0px 8px, 4px 8px, 4px 4px, 8px 4px, 8px 0px, calc(100% - 8px) 0px');
  });

  it('builds gradients, fill opacity and patterns', () => {
    const g = frameCss({ ...DEFAULT_BOX, fill: 'gradient', gradient_angle: 90, gradient: [{ color: '#ff0000', at: 0 }, { color: '#0000ff', at: 100 }], fill_opacity: 0.5 }, '.a');
    expect(g).toContain('background:linear-gradient(90deg, rgba(255,0,0,0.5) 0%, rgba(0,0,255,0.5) 100%)');
    expect(frameCss({ ...DEFAULT_BOX, background: '#ffffff', fill_opacity: 0.25 }, '.a')).toBe('.a{background:rgba(255,255,255,0.25)}');
    expect(frameCss({ ...DEFAULT_BOX, background: '#fff', fill: 'none' }, '.a')).toBe('');
    const dots = frameCss({ ...DEFAULT_BOX, background: '#fff', pattern: 'halftone', pattern_color: '#000', pattern_opacity: 0.5, pattern_size: 10 }, '.a');
    expect(dots).toContain('radial-gradient(circle, rgba(0,0,0,0.5) 2px, transparent 2.7px) 0 0 / 10px 10px');
    expect(dots).toContain('5px 5px / 10px 10px');
    expect(dots.trim().endsWith('#fff}')).toBe(true);
    expect(frameCss({ ...DEFAULT_BOX, pattern: 'stripes', pattern_opacity: 1 }, '.a')).toContain('repeating-linear-gradient(45deg');
    expect(frameCss({ ...DEFAULT_BOX, pattern: 'grid', pattern_opacity: 1 }, '.a')).toContain('linear-gradient(90deg, #000000 1px, transparent 1px)');
    const noise = frameCss({ ...DEFAULT_BOX, pattern: 'noise', pattern_opacity: 1 }, '.a');
    expect(noise).toContain('url("data:image/svg+xml,');
    expect(noise).not.toMatch(/<|>/);
  });

  it('draws stripes, with the name colour on item cards', () => {
    const b = { ...DEFAULT_BOX, background: '#000', stripe: 'left' as const, stripe_width: 5, stripe_color: '#f0f', stripe_name_color: true };
    expect(frameCss(b, '.a')).toContain('linear-gradient(#f0f, #f0f) left top / 5px 100% no-repeat');
    expect(frameCss(b, '.a', { item: {} })).toContain('linear-gradient(var(--cw-name, #f0f), var(--cw-name, #f0f)) left top / 5px 100%');
    expect(frameCss({ ...b, stripe: 'bottom' }, '.a')).toContain('left bottom / 100% 5px');
  });

  it('makes shadow presets', () => {
    const base = { ...DEFAULT_BOX, background: '#000', shadow_x: 6, shadow_y: 6, shadow_blur: 20, shadow_color: '#111' };
    expect(frameCss({ ...base, shadow_kind: 'hard' }, '.a')).toContain('box-shadow:6px 6px 0px #111');
    expect(frameCss({ ...base, shadow_kind: 'soft' }, '.a')).toContain('box-shadow:6px 6px 20px #111');
    expect(frameCss({ ...base, shadow_kind: 'glow' }, '.a')).toContain('box-shadow:0px 0px 20px #111, 0px 0px 7px #111');
    expect(frameCss({ ...base, shadow_kind: 'layered' }, '.a').match(/rgba\(17,17,17,0.6\)/g)).toHaveLength(2);
    expect(frameCss({ ...base, shadow_kind: 'none', shadow: '0 0 4px red' }, '.a')).not.toContain('shadow');
    expect(frameCss({ ...base, shadow_kind: 'custom', shadow: 'inset 0 0 4px red' }, '.a')).toContain('box-shadow:inset 0 0 4px red');
    expect(parseShadow('0 2px 4px rgba(0,0,0,0.5), 1px 1px #000')).toEqual([
      { x: 0, y: 2, blur: 4, spread: 0, color: 'rgba(0,0,0,0.5)' },
      { x: 1, y: 1, blur: 0, spread: 0, color: '#000' }
    ]);
    expect(parseShadow('inset 0 1px red')).toBeNull();
  });

  it('leans cards, alternating through a variable', () => {
    expect(frameCss({ ...DEFAULT_BOX, lean: -2 }, '.a')).toBe('.a{transform:rotate(-2deg)}');
    expect(frameCss({ ...DEFAULT_BOX, lean: 3 }, '.a', { item: { alternate: true } })).toContain('transform:rotate(calc(var(--cw-lean, 1) * 3deg))');
    expect(frameCss({ ...DEFAULT_BOX, lean: 3 }, '.a', { noLean: true })).toBe('');
    const flip = alternator();
    expect([flip('a'), flip('b'), flip('a'), flip('c')]).toEqual([false, true, false, false]);
    expect(itemVars({ alternate: true }, { lean: 2 }, '#ff0000', true)).toBe('--cw-lean:-1');
    expect(itemVars({ tint: 0.25 }, {}, '#ff0000', false)).toBe('--cw-name:#ff0000;--cw-tint:rgba(255,0,0,0.25)');
    expect(itemVars({}, {}, '#ff0000', false)).toBe('');
  });

  it('builds item cards for chat and event lists', () => {
    const chat = { ...kindDefaults('chat'), bubble: { ...DEFAULT_BOX, background: '#fff', shape: 'bubble' as const }, item_card: { ...DEFAULT_ITEM_CARD, width: 'fit' as const, tint: 0.2, gap: 14 } };
    const css = itemCardCss(chat, 'cw-s-x');
    expect(css).toContain(':where(.cw-s-x) .cw-chat-line{');
    expect(css).toContain('align-self:flex-start');
    expect(css).toContain('var(--cw-tint, transparent)');
    expect(css).toContain('margin:0px 0px 15px 0px');
    expect(css).toContain(':where(.cw-s-x) .cw-chat{gap:14px}');
    expect(itemCardCss({ ...chat, item_card: { ...chat.item_card, around: 'words' } }, 'cw-s-x')).toContain(':where(.cw-s-x) .cw-chat-msg{');
    const list = { ...kindDefaults('event_list'), item_box: { ...DEFAULT_BOX, background: '#000' } };
    expect(itemCardCss(list, 'cw-s-y')).toBe(':where(.cw-s-y) .cw-event-row{background:#000}');
    expect(itemCardCss(kindDefaults('chat'), 'cw-s-x')).toBe('');
    expect(layerFrameCss({ box_style: { ...DEFAULT_BOX, background: 'red</style>' }, kind: kindDefaults('text') }, 'cw-s-z')).not.toContain('</style');
  });

  it('keeps the classic alert card unless a card is set', () => {
    expect(alertCard({ background: 'transparent' })).toBeNull();
    const classic = alertCard({ background: 'rgba(12,15,22,0.82)' })!;
    expect(frameCss(classic, '.a')).toBe(
      '.a{background:rgba(12,15,22,0.82);border-radius:20px;padding:24px 32px;box-shadow:0 18px 50px rgba(0, 0, 0, 0.35), 0 2px 8px rgba(0, 0, 0, 0.25)}'
    );
    expect(alertCard({ background: '#000', card: { ...DEFAULT_BOX, shape: 'cut' } })?.shape).toBe('cut');
  });

  it('every preset makes CSS for every target', () => {
    for (const p of BOX_PRESETS) {
      for (const t of ['layer', 'chat', 'events', 'alert'] as const) {
        const b = presetBox(p, t);
        expect(Object.keys(b).sort(), p.id).toEqual(Object.keys(DEFAULT_BOX).sort());
        expect(frameCss(b, '.a', { item: t === 'chat' ? p.card : null }), `${p.id} ${t}`).not.toBe('');
      }
    }
    expect(BOX_PRESETS.map((p) => p.id)).toEqual(expect.arrayContaining(['comic', 'speech', 'sticker', 'riot', 'neon', 'pixel', 'glass', 'paper', 'clean', 'outline', 'terminal']));
    const comic = presetBox(findPreset('comic')!, 'chat');
    expect(comic.shape).toBe('bubble');
    expect(comic.pattern).toBe('halftone');
    expect(findPreset('comic')!.text?.font_family).toBe('Bangers');
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
