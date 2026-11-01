// OKLCH <-> sRGB and WCAG 2 contrast. Themes are designed in OKLCH (even steps in
// perceived lightness) and written out as hex so every webview renders them the same.

export interface Oklch {
  l: number; // 0..1
  c: number; // 0..~0.37
  h: number; // degrees
}

type Rgb = [number, number, number]; // linear 0..1

function oklchToLinear({ l, c, h }: Oklch): Rgb {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S
  ];
}

function inGamut(rgb: Rgb): boolean {
  return rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
}

function encode(v: number): number {
  const c = Math.min(1, Math.max(0, v));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function decode(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** OKLCH to hex, lowering chroma until the colour fits in sRGB. */
export function oklchToHex(color: Oklch): string {
  let c = color.c;
  let rgb = oklchToLinear({ ...color, c });
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ ...color, c: mid }))) lo = mid;
      else hi = mid;
    }
    c = lo;
    rgb = oklchToLinear({ ...color, c });
  }
  return (
    '#' +
    rgb
      .map((v) =>
        Math.round(encode(v) * 255)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  );
}

export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.replace(/./g, (x) => x + x);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function isHex(s: string): boolean {
  return parseHex(s) !== null;
}

export function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => decode(v / 255)) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Move `fg` lighter or darker (keeping hue and chroma) until it reaches `min`
 * contrast against `bg`. Returns the closest colour that passes.
 */
export function ensureContrast(fg: Oklch, bg: string, min: number): string {
  const start = oklchToHex(fg);
  if (contrast(start, bg) >= min) return start;
  const lighter = luminance(bg) < 0.18;
  let l = fg.l;
  for (let i = 0; i < 100; i++) {
    l = lighter ? Math.min(1, l + 0.01) : Math.max(0, l - 0.01);
    const hex = oklchToHex({ ...fg, l });
    if (contrast(hex, bg) >= min) return hex;
    if (l <= 0 || l >= 1) break;
  }
  return lighter ? '#ffffff' : '#000000';
}

/** Black or white, whichever reads better on `bg`. */
export function bestText(bg: string): string {
  return contrast('#ffffff', bg) >= contrast('#000000', bg) ? '#ffffff' : '#000000';
}
