import { bestText, contrast, ensureContrast, isHex, oklchToHex } from './color';

export type ThemeBase = 'dark' | 'light';
export type Density = 'compact' | 'default' | 'comfortable';

export const TOKEN_NAMES = [
  'bg-0',
  'bg-1',
  'bg-2',
  'bg-3',
  'border',
  'border-strong',
  'text',
  'text-muted',
  'text-faint',
  'accent',
  'accent-hover',
  'on-accent',
  'accent-text',
  'accent-soft',
  'live',
  'on-live',
  'ok',
  'warn',
  'danger',
  'focus'
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];
export type Tokens = Record<TokenName, string>;

/** What the theme editor saves. Tokens are generated from these, then overrides applied. */
export interface ThemeSpec {
  id: string;
  name: string;
  base: ThemeBase;
  /** 0-360 */
  accent_hue: number;
  /** 0-0.3 */
  accent_chroma: number;
  /** 0-1: how much the accent tints the surfaces */
  tint: number;
  /** px */
  radius: number;
  density: Density;
  font: 'inter' | 'system';
  overrides: Partial<Record<TokenName, string>>;
  high_contrast?: boolean;
}

export interface Theme {
  spec: ThemeSpec;
  tokens: Tokens;
}

/** Pairs every theme must pass: [foreground, background, minimum ratio, label]. */
export const CHECKS: Array<[TokenName, TokenName, number, string]> = [
  ['text', 'bg-0', 4.5, 'Text on window'],
  ['text', 'bg-1', 4.5, 'Text on panels'],
  ['text', 'bg-2', 4.5, 'Text in inputs'],
  ['text', 'bg-3', 4.5, 'Text on selected rows'],
  ['text-muted', 'bg-1', 4.5, 'Secondary text'],
  ['text-muted', 'bg-2', 4.5, 'Secondary text in inputs'],
  ['text-faint', 'bg-1', 4.5, 'Small labels'],
  ['on-accent', 'accent', 4.5, 'Text on accent buttons'],
  ['on-accent', 'accent-hover', 4.5, 'Text on hovered buttons'],
  ['accent-text', 'bg-1', 4.5, 'Links and accent text'],
  ['accent-text', 'accent-soft', 4.5, 'Accent text on tinted chips'],
  ['on-live', 'live', 4.5, 'LIVE badge'],
  ['border-strong', 'bg-1', 3, 'Input borders'],
  ['focus', 'bg-1', 3, 'Focus ring'],
  ['ok', 'bg-1', 3, 'Status: good'],
  ['warn', 'bg-1', 3, 'Status: warning'],
  ['danger', 'bg-1', 3, 'Status: problem']
];

export interface CheckResult {
  fg: TokenName;
  bg: TokenName;
  label: string;
  ratio: number;
  min: number;
  pass: boolean;
}

export function checkTheme(tokens: Tokens): CheckResult[] {
  return CHECKS.map(([fg, bg, min, label]) => {
    const ratio = contrast(tokens[fg], tokens[bg]);
    return { fg, bg, label, ratio, min, pass: ratio >= min };
  });
}

export function generateTokens(spec: ThemeSpec): Tokens {
  const t = buildBase(spec);
  for (const [k, v] of Object.entries(spec.overrides ?? {})) {
    if (v && isHex(v) && (TOKEN_NAMES as readonly string[]).includes(k)) t[k as TokenName] = v;
  }
  return t;
}

function buildBase(spec: ThemeSpec): Tokens {
  const h = spec.accent_hue;
  const ac = Math.max(0, Math.min(0.3, spec.accent_chroma));
  const tc = Math.max(0, Math.min(1, spec.tint)) * 0.035;
  const surface = (l: number) => oklchToHex({ l, c: tc, h });

  if (spec.high_contrast) {
    const bg = spec.base === 'dark' ? '#000000' : '#ffffff';
    const fg = spec.base === 'dark' ? '#ffffff' : '#000000';
    const accent = spec.base === 'dark' ? '#ffd400' : '#0033cc';
    return {
      'bg-0': bg,
      'bg-1': bg,
      'bg-2': spec.base === 'dark' ? '#0d0d0d' : '#f2f2f2',
      'bg-3': spec.base === 'dark' ? '#262626' : '#d9e4ff',
      border: spec.base === 'dark' ? '#8c8c8c' : '#595959',
      'border-strong': fg,
      text: fg,
      'text-muted': fg,
      'text-faint': spec.base === 'dark' ? '#e0e0e0' : '#1f1f1f',
      accent,
      'accent-hover': spec.base === 'dark' ? '#ffe14d' : '#002699',
      'on-accent': bestText(accent),
      'accent-text': accent,
      'accent-soft': spec.base === 'dark' ? '#332b00' : '#e6ecff',
      live: spec.base === 'dark' ? '#ff4d4d' : '#b30000',
      'on-live': spec.base === 'dark' ? '#000000' : '#ffffff',
      ok: spec.base === 'dark' ? '#4dff88' : '#006b24',
      warn: spec.base === 'dark' ? '#ffb84d' : '#8a4b00',
      danger: spec.base === 'dark' ? '#ff6666' : '#b30000',
      focus: accent
    };
  }

  if (spec.base === 'dark') {
    const bg0 = surface(0.175);
    const bg1 = surface(0.205);
    const bg2 = surface(0.235);
    const bg3 = oklchToHex({ l: 0.285, c: tc + ac * 0.12, h });
    let accentL = 0.6;
    let accent = oklchToHex({ l: accentL, c: ac, h });
    while (contrast('#ffffff', accent) < 4.6 && accentL > 0.3) {
      accentL -= 0.01;
      accent = oklchToHex({ l: accentL, c: ac, h });
    }
    const accentSoft = oklchToHex({ l: 0.29, c: Math.min(ac, 0.09), h });
    return {
      'bg-0': bg0,
      'bg-1': bg1,
      'bg-2': bg2,
      'bg-3': bg3,
      border: surface(0.31),
      'border-strong': ensureContrast({ l: 0.5, c: tc, h }, bg1, 3),
      text: ensureContrast({ l: 0.94, c: tc * 0.3, h }, bg3, 7),
      'text-muted': ensureContrast({ l: 0.79, c: tc * 0.4, h }, bg2, 4.6),
      'text-faint': ensureContrast({ l: 0.72, c: tc * 0.4, h }, bg1, 4.6),
      accent,
      'accent-hover': oklchToHex({ l: Math.max(0.25, accentL - 0.04), c: ac, h }),
      'on-accent': '#ffffff',
      'accent-text': ensureContrast({ l: 0.8, c: ac * 0.75, h }, accentSoft, 4.6),
      'accent-soft': accentSoft,
      live: '#d93036',
      'on-live': '#ffffff',
      ok: ensureContrast({ l: 0.72, c: 0.17, h: 150 }, bg1, 3.2),
      warn: ensureContrast({ l: 0.78, c: 0.15, h: 80 }, bg1, 3.2),
      danger: ensureContrast({ l: 0.68, c: 0.19, h: 25 }, bg1, 3.2),
      focus: ensureContrast({ l: 0.75, c: ac, h }, bg1, 3.2)
    };
  }

  const bg0 = surface(0.972);
  const bg1 = '#ffffff';
  const bg2 = surface(0.958);
  const bg3 = oklchToHex({ l: 0.925, c: tc + ac * 0.15, h });
  let accentL = 0.53;
  let accent = oklchToHex({ l: accentL, c: ac, h });
  while (contrast('#ffffff', accent) < 4.8 && accentL > 0.2) {
    accentL -= 0.01;
    accent = oklchToHex({ l: accentL, c: ac, h });
  }
  const accentSoft = oklchToHex({ l: 0.94, c: Math.min(ac, 0.05), h });
  return {
    'bg-0': bg0,
    'bg-1': bg1,
    'bg-2': bg2,
    'bg-3': bg3,
    border: surface(0.885),
    'border-strong': ensureContrast({ l: 0.62, c: tc, h }, bg1, 3),
    text: ensureContrast({ l: 0.22, c: tc * 0.4, h }, bg3, 7),
    'text-muted': ensureContrast({ l: 0.46, c: tc * 0.5, h }, bg2, 4.6),
    'text-faint': ensureContrast({ l: 0.52, c: tc * 0.5, h }, bg1, 4.6),
    accent,
    'accent-hover': oklchToHex({ l: Math.max(0.2, accentL - 0.05), c: ac, h }),
    'on-accent': '#ffffff',
    'accent-text': ensureContrast({ l: accentL, c: ac, h }, accentSoft, 4.6),
    'accent-soft': accentSoft,
    live: '#d93036',
    'on-live': '#ffffff',
    ok: ensureContrast({ l: 0.55, c: 0.15, h: 150 }, bg1, 3.2),
    warn: ensureContrast({ l: 0.62, c: 0.15, h: 70 }, bg1, 3.2),
    danger: ensureContrast({ l: 0.55, c: 0.2, h: 25 }, bg1, 3.2),
    focus: ensureContrast({ l: 0.55, c: ac, h }, bg1, 3.2)
  };
}

const DEFAULTS = {
  accent_hue: 262,
  accent_chroma: 0.17,
  tint: 0.25,
  radius: 8,
  density: 'default' as Density,
  font: 'inter' as const,
  overrides: {}
};

export const BUILT_IN: ThemeSpec[] = [
  { id: 'dark', name: 'Castwright Dark', base: 'dark', ...DEFAULTS },
  { id: 'light', name: 'Castwright Light', base: 'light', ...DEFAULTS },
  { id: 'high_contrast', name: 'High contrast', base: 'dark', ...DEFAULTS, radius: 6, high_contrast: true },
  { id: 'high_contrast_light', name: 'High contrast light', base: 'light', ...DEFAULTS, radius: 6, high_contrast: true }
];

export function isBuiltIn(id: string): boolean {
  return id === 'system' || BUILT_IN.some((t) => t.id === id);
}

/** Read a saved custom theme defensively; returns null when it can't be used. */
export function parseSpec(raw: unknown): ThemeSpec | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id || typeof r.name !== 'string') return null;
  const num = (v: unknown, d: number, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
  const overrides: Partial<Record<TokenName, string>> = {};
  if (typeof r.overrides === 'object' && r.overrides) {
    for (const [k, v] of Object.entries(r.overrides as Record<string, unknown>)) {
      if ((TOKEN_NAMES as readonly string[]).includes(k) && typeof v === 'string' && isHex(v)) {
        overrides[k as TokenName] = v;
      }
    }
  }
  return {
    id: r.id,
    name: r.name.slice(0, 60) || 'Untitled',
    base: r.base === 'light' ? 'light' : 'dark',
    accent_hue: num(r.accent_hue, DEFAULTS.accent_hue, 0, 360),
    accent_chroma: num(r.accent_chroma, DEFAULTS.accent_chroma, 0, 0.3),
    tint: num(r.tint, DEFAULTS.tint, 0, 1),
    radius: num(r.radius, DEFAULTS.radius, 0, 16),
    density: r.density === 'compact' || r.density === 'comfortable' ? r.density : 'default',
    font: r.font === 'system' ? 'system' : 'inter',
    overrides,
    high_contrast: r.high_contrast === true
  };
}

export function resolveTheme(id: string, custom: unknown[], prefersDark: boolean): Theme {
  const want = id === 'system' ? (prefersDark ? 'dark' : 'light') : id;
  const spec =
    BUILT_IN.find((t) => t.id === want) ??
    custom.map(parseSpec).find((s): s is ThemeSpec => s?.id === want) ??
    BUILT_IN[prefersDark ? 0 : 1]!;
  return { spec, tokens: generateTokens(spec) };
}

const ROW_HEIGHT: Record<Density, number> = { compact: 28, default: 32, comfortable: 38 };

export function cssVariables(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const k of TOKEN_NAMES) vars[`--${k}`] = theme.tokens[k];
  vars['--radius'] = `${theme.spec.radius}px`;
  vars['--radius-lg'] = `${Math.round(theme.spec.radius * 1.4)}px`;
  vars['--row-h'] = `${ROW_HEIGHT[theme.spec.density]}px`;
  vars['--font-ui'] =
    theme.spec.font === 'system'
      ? 'system-ui, -apple-system, "Segoe UI Variable Text", "Segoe UI", Cantarell, Ubuntu, sans-serif'
      : '"Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
  return vars;
}
