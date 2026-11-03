import type { Overlay } from '$lib/bindings/Overlay';
import type { TextStyle } from '$lib/bindings/TextStyle';

const SYSTEM_FONTS = new Set(
  [
    'arial',
    'arial black',
    'helvetica',
    'helvetica neue',
    'segoe ui',
    'segoe ui emoji',
    'system-ui',
    '-apple-system',
    'blinkmacsystemfont',
    'ui-sans-serif',
    'ui-serif',
    'ui-monospace',
    'ui-rounded',
    'sans-serif',
    'serif',
    'monospace',
    'cursive',
    'fantasy',
    'emoji',
    'math',
    'inherit',
    'initial',
    'times',
    'times new roman',
    'georgia',
    'verdana',
    'tahoma',
    'trebuchet ms',
    'courier',
    'courier new',
    'impact',
    'comic sans ms',
    'consolas',
    'calibri',
    'cambria',
    'candara',
    'lucida console',
    'lucida sans unicode',
    'palatino linotype',
    'sf pro',
    'sf pro display',
    'sf pro text',
    'menlo',
    'monaco'
  ].map((s) => s.toLowerCase())
);

/** Font name that means "the project's default font". Empty means the same. */
export const DEFAULT_FONT = 'Default';
/** Default font of projects that never picked one. */
export const STARTER_FONT = 'Inter';

export function isDefaultFont(family: string | null | undefined): boolean {
  const f = primaryFamily(family ?? '');
  return !f || f.toLowerCase() === 'default';
}

/** The font to use: the given one, or the project default for `Default` and empty. */
export function resolveFont(family: string | null | undefined, projectDefault: string | null | undefined): string {
  if (!isDefaultFont(family)) return family!.trim();
  return isDefaultFont(projectDefault) ? STARTER_FONT : projectDefault!.trim();
}

/** Same rules as the backend: trimmed, no CSS punctuation, never `Default` or empty. */
export function cleanDefaultFont(font: string): string {
  const f = [...font.trim().replace(/[;{}<>"]/g, '')].slice(0, 100).join('').trim();
  return !f || f.toLowerCase() === DEFAULT_FONT.toLowerCase() ? STARTER_FONT : f;
}

export interface FontNeed {
  family: string;
  weights: Set<number>;
  italic: boolean;
}

/** First family of a CSS font list, unquoted. */
export function primaryFamily(family: string): string {
  return (family ?? '').split(',')[0]?.replace(/["']/g, '').trim() ?? '';
}

export function isSystemFont(family: string): boolean {
  return SYSTEM_FONTS.has(family.trim().toLowerCase());
}

function add(map: Map<string, FontNeed>, family: string, weight?: number, italic?: boolean) {
  const f = primaryFamily(family);
  if (!f || isSystemFont(f) || !/^[\w .+-]+$/.test(f)) return;
  const key = f.toLowerCase();
  let need = map.get(key);
  if (!need) {
    need = { family: f, weights: new Set(), italic: false };
    map.set(key, need);
  }
  if (weight !== undefined && Number.isFinite(weight)) {
    need.weights.add(Math.min(900, Math.max(100, Math.round(weight / 100) * 100)));
  }
  if (italic) need.italic = true;
}

function styles(overlay: Overlay): TextStyle[] {
  const out: TextStyle[] = [];
  for (const l of overlay.layers ?? []) {
    const k = l.kind;
    if ('style' in k && k.style) out.push(k.style);
    if (k.type === 'credits') out.push(...[k.title_style, k.heading_style].filter(Boolean));
  }
  return out;
}

/** Google Fonts to load for an overlay: the listed fonts plus every family its text uses. */
export function fontsFor(overlay: Overlay | null, extra: readonly TextStyle[] = [], defaultFont: string = STARTER_FONT): FontNeed[] {
  const map = new Map<string, FontNeed>();
  if (!overlay) return [];
  for (const f of overlay.fonts ?? []) if (!isDefaultFont(f)) add(map, f);
  for (const s of [...styles(overlay), ...extra]) add(map, resolveFont(s.font_family, defaultFont), s.font_weight, s.italic);
  return [...map.values()];
}

/** css2 URL for one family with the weights it needs (400 always included). */
export function googleFontsHref(need: FontNeed, withWeights = true): string {
  const name = encodeURIComponent(need.family).replace(/%20/g, '+');
  if (!withWeights) return `https://fonts.googleapis.com/css2?family=${name}&display=swap`;
  const weights = [...new Set([400, ...need.weights])].sort((a, b) => a - b);
  const axis = need.italic
    ? `ital,wght@${[...weights.map((w) => `0,${w}`), ...weights.map((w) => `1,${w}`)].join(';')}`
    : `wght@${weights.join(';')}`;
  return `https://fonts.googleapis.com/css2?family=${name}:${axis}&display=swap`;
}

const requested = new Set<string>();

/**
 * Adds one stylesheet link per family. Google rejects a whole request when a weight
 * doesn't exist, so a failed link retries with the family's default weights only.
 * Failures never affect rendering; text just uses the fallback font.
 */
export function ensureFonts(needs: readonly FontNeed[], doc: Document = document): void {
  for (const need of needs) {
    const href = googleFontsHref(need);
    if (requested.has(href)) continue;
    requested.add(href);
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.cwFont = need.family;
    link.onerror = () => {
      link.remove();
      const plain = googleFontsHref(need, false);
      if (requested.has(plain)) return;
      requested.add(plain);
      const retry = doc.createElement('link');
      retry.rel = 'stylesheet';
      retry.href = plain;
      retry.dataset.cwFont = need.family;
      retry.onerror = () => {
        retry.remove();
        console.warn(`[overlay] couldn't load font "${need.family}"`);
      };
      doc.head.appendChild(retry);
    };
    doc.head.appendChild(link);
  }
}
