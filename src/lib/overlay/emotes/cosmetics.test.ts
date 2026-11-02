import { describe, expect, it } from 'vitest';
import cosmetics from './fixtures/7tv-cosmetics.json';
import styles from './fixtures/7tv-styles.json';
import { cosmeticsQuery, paintStyle, parseCosmetics, parsePaint, parseStyles, stylesQuery, type Paint } from './cosmetics';

const PAINTS = ['01JHXJFACX42RV996VE9933TB8', '01GHA42XER0001KT343YQ6DM2E', '01HQE7KJWG0000D7GK7EKRAPN3'];
const BADGES = ['01JJJ74CRHZBRMCM8F4Y2WBN6R', '01GAF8RWW8000E8VNG1S1RMTBA'];

describe('queries', () => {
  it('asks for many chatters at once with aliases', () => {
    const q = stylesQuery(['1', '2"']);
    expect(q).toContain('u0: userByConnection(platform: TWITCH, platformId: "1")');
    expect(q).toContain('u1: userByConnection(platform: TWITCH, platformId: "2\\"")');
  });
  it('asks for paints and badges by id', () => {
    const q = cosmeticsQuery(['p'], ['b']);
    expect(q).toContain('p0: paints { paint(id: "p")');
    expect(q).toContain('b0: badges { badge(id: "b")');
  });
});

describe('parseStyles', () => {
  it('maps aliases back to Twitch ids', () => {
    const got = parseStyles(styles, ['71092938', '1', '22484632', '121059319']);
    expect(got.get('71092938')).toEqual({ paintId: '01JHXJFACX42RV996VE9933TB8', badgeId: '01JJJ74CRHZBRMCM8F4Y2WBN6R' });
    expect(got.get('1')).toBeNull();
    expect(got.get('22484632')).toEqual({ paintId: null, badgeId: null });
    expect(got.get('121059319')).toEqual({ paintId: null, badgeId: '01GAF8RWW8000E8VNG1S1RMTBA' });
  });
  it('treats errors as unknown', () => {
    expect(parseStyles({ data: null, errors: [{ message: 'Query is too complex.' }] }, ['5']).get('5')).toBeNull();
  });
});

describe('parseCosmetics', () => {
  const got = parseCosmetics(cosmetics, PAINTS, BADGES);
  it('reads image, linear and radial paints with shadows', () => {
    const image = got.paints.get(PAINTS[0]!)!;
    expect(image.name).toBe('Emerald Doppler');
    expect(image.layers[0]!.kind).toBe('image');
    const imgs = (image.layers[0] as Extract<Paint['layers'][number], { kind: 'image' }>).images;
    expect(imgs.map((i) => i.scale)).toEqual([1, 2, 3, 4]);
    expect(imgs.every((i) => /\/\dx\.webp$/.test(i.url))).toBe(true);
    expect(image.shadows).toEqual([
      { x: 0, y: 0, blur: 0.1, color: '#39D21EFF' },
      { x: 1, y: 1, blur: 0.1, color: '#005557FF' }
    ]);
    expect(got.paints.get(PAINTS[1]!)!.layers[0]).toMatchObject({ kind: 'linear', angle: 66, repeating: true });
    expect(got.paints.get(PAINTS[2]!)!.layers[0]).toMatchObject({ kind: 'radial', shape: 'circle', repeating: false });
  });
  it('reads badges, smallest first', () => {
    const b = got.badges.get(BADGES[0]!)!;
    expect(b.name).toBe('Minecraft Event Winner');
    expect(b.images.map((i) => i.width)).toEqual([18, 36, 54, 72]);
    expect(b.images[0]!.url).toMatch(/\.webp$/);
  });
  it('gives null for missing ones', () => {
    const none = parseCosmetics({ data: { p0: { paint: null } } }, ['x'], ['y']);
    expect(none.paints.get('x')).toBeNull();
    expect(none.badges.get('y')).toBeNull();
  });
  it('drops bad colours and urls', () => {
    const p = parsePaint({
      id: 'p',
      data: {
        layers: [
          { ty: { __typename: 'PaintLayerTypeLinearGradient', angle: 90, repeating: false, stops: [{ at: 0, color: { hex: 'red;}' } }, { at: 1, color: { hex: '#fff' } }] } },
          { ty: { __typename: 'PaintLayerTypeImage', images: [{ url: 'javascript:alert(1)', mime: 'image/webp', scale: 1 }] } }
        ],
        shadows: []
      }
    })!;
    expect(p.layers).toEqual([{ kind: 'linear', angle: 90, repeating: false, stops: [{ at: 1, color: '#fff' }] }]);
  });
});

describe('paintStyle', () => {
  const base: Omit<Paint, 'layers'> = { id: 'p', name: 'P', shadows: [] };
  it('draws linear gradients with repeat, angle and stops', () => {
    const css = paintStyle({ ...base, layers: [{ kind: 'linear', angle: 66, repeating: true, stops: [{ at: 0.57, color: '#CA804EFF' }, { at: 1, color: '#C89041FF' }] }] }, '#ff0000');
    expect(css).toContain('background-image:repeating-linear-gradient(66deg, #CA804EFF 57%, #C89041FF 100%)');
    expect(css).toContain('background-clip:text');
    expect(css).toContain('-webkit-text-fill-color:transparent');
    expect(css).toContain('background-color:#ff0000');
    expect(css).not.toContain('filter');
  });
  it('draws radial gradients', () => {
    const css = paintStyle({ ...base, layers: [{ kind: 'radial', shape: 'circle', repeating: false, stops: [{ at: 0, color: '#fff' }, { at: 0.25, color: '#000' }] }] }, '#fff');
    expect(css).toContain('background-image:radial-gradient(circle, #fff 0%, #000 25%)');
  });
  it('draws images at a scale that suits the font size', () => {
    const images = [1, 2, 3, 4].map((scale) => ({ url: `https://cdn.7tv.app/paint/a/${scale}x.webp`, scale }));
    const p: Paint = { ...base, layers: [{ kind: 'image', images }] };
    expect(paintStyle(p, '#fff', 13)).toContain('url("https://cdn.7tv.app/paint/a/1x.webp")');
    expect(paintStyle(p, '#fff', 28)).toContain('url("https://cdn.7tv.app/paint/a/3x.webp")');
    expect(paintStyle(p, '#fff', 28)).toContain('background-size:cover');
  });
  it('turns shadows into drop-shadow filters', () => {
    const css = paintStyle(
      { ...base, layers: [{ kind: 'color', color: '#123456' }], shadows: [{ x: 1, y: 2, blur: 0.5, color: '#000000FF' }, { x: 0, y: 0, blur: 3, color: '#fff' }] },
      '#fff'
    );
    expect(css).toContain('background-image:linear-gradient(#123456, #123456)');
    expect(css).toContain('filter:drop-shadow(1px 2px 0.5px #000000FF) drop-shadow(0px 0px 3px #fff)');
  });
  it('keeps names readable', () => {
    expect(paintStyle({ ...base, layers: [] }, '#fff')).toBe('');
    expect(paintStyle({ ...base, layers: [{ kind: 'color', color: '#fff' }] }, 'red;x:y')).toContain('background-color:currentColor');
  });
});
