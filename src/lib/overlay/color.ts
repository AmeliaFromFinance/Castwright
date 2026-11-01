export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  transparent: '#00000000'
};

export function parseColor(input: string | null | undefined): Rgba | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  s = NAMED[s] ?? s;
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m?.[1]) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    };
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m?.[1]) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    if (p.length < 3) return null;
    const ch = (v: string) => (v.endsWith('%') ? (parseFloat(v) * 255) / 100 : parseFloat(v));
    const a = p[3] === undefined ? 1 : p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
    const out = { r: ch(p[0]!), g: ch(p[1]!), b: ch(p[2]!), a };
    return [out.r, out.g, out.b, out.a].every(Number.isFinite) ? out : null;
  }
  return null;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(c: Rgba): number {
  const f = (v: number) => {
    const x = Math.min(255, Math.max(0, v)) / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

function mix(c: Rgba, to: number, t: number): Rgba {
  return { r: c.r + (to - c.r) * t, g: c.g + (to - c.g) * t, b: c.b + (to - c.b) * t, a: 1 };
}

function hex(c: Rgba): string {
  const h = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** True when text on this background should be dark. Unknown or see-through counts as dark. */
export function isLightBackground(bg: string | null | undefined): boolean {
  const c = parseColor(bg);
  if (!c || c.a < 0.5) return false;
  return luminance(c) > 0.5;
}

/**
 * Keeps a viewer name colour readable: very dark names are lightened on dark
 * backgrounds and very light names are darkened on light ones.
 */
export function readableColor(color: string, lightBackground = false): string {
  const c = parseColor(color);
  if (!c) return color;
  let out = { ...c, a: 1 };
  if (!lightBackground) {
    for (let i = 0; i < 12 && luminance(out) < 0.18; i++) out = mix(out, 255, 0.18);
  } else {
    for (let i = 0; i < 12 && luminance(out) > 0.45; i++) out = mix(out, 0, 0.18);
  }
  return out === c || (out.r === c.r && out.g === c.g && out.b === c.b) ? color : hex(out);
}

// Twitch's default name colours, picked by name like Twitch does for users without one.
const DEFAULT_NAME_COLORS = [
  '#FF0000',
  '#0000FF',
  '#008000',
  '#B22222',
  '#FF7F50',
  '#9ACD32',
  '#FF4500',
  '#2E8B57',
  '#DAA520',
  '#D2691E',
  '#5F9EA0',
  '#1E90FF',
  '#FF69B4',
  '#8A2BE2',
  '#00FF7F'
];

export function defaultNameColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return DEFAULT_NAME_COLORS[h % DEFAULT_NAME_COLORS.length] ?? '#1E90FF';
}
