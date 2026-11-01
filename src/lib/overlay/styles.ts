import type { BoxStyle } from '$lib/bindings/BoxStyle';
import type { TextStyle } from '$lib/bindings/TextStyle';

export const DEFAULT_TEXT: TextStyle = {
  font_family: 'Inter',
  font_size: 28,
  font_weight: 600,
  color: '#ffffff',
  align: 'left',
  line_height: 1.25,
  letter_spacing: 0,
  uppercase: false,
  italic: false,
  shadow: '0 2px 6px rgba(0,0,0,0.45)',
  stroke_width: 0,
  stroke_color: '#000000'
};

const FALLBACK_STACK = '"Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';

/** Values are written into style attributes, so keep them from closing the declaration. */
export function cssValue(v: unknown): string {
  return typeof v === 'string' ? v.replace(/[;{}<>]/g, '').trim() : '';
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function fontStack(family: string): string {
  const f = cssValue(family).replace(/["']/g, '').trim();
  if (!f) return FALLBACK_STACK;
  if (f.includes(',')) {
    return f
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => (/^[\w-]+$/.test(p) ? p : `"${p}"`))
      .join(', ');
  }
  return `"${f}", ${FALLBACK_STACK}`;
}

/**
 * `layer` outlines need StyledText (a stroked copy behind the text). `inline` uses
 * -webkit-text-stroke directly, for mixed content such as chat lines.
 */
export function textStyleCss(s: Partial<TextStyle> | null | undefined, strokeMode: 'layer' | 'inline' = 'layer'): string {
  const t = { ...DEFAULT_TEXT, ...(s ?? {}) };
  const size = Math.max(1, num(t.font_size, 28));
  const parts = [
    `font-family:${fontStack(t.font_family)}`,
    `font-size:${size}px`,
    `font-weight:${Math.round(num(t.font_weight, 600))}`,
    `color:${cssValue(t.color) || '#ffffff'}`,
    `text-align:${t.align === 'center' || t.align === 'right' ? t.align : 'left'}`,
    `line-height:${num(t.line_height, 1.25) > 0 ? num(t.line_height, 1.25) : 1.25}`,
    `letter-spacing:${num(t.letter_spacing, 0)}px`,
    `text-transform:${t.uppercase ? 'uppercase' : 'none'}`,
    `font-style:${t.italic ? 'italic' : 'normal'}`
  ];
  const shadow = cssValue(t.shadow) || 'none';
  const stroke = Math.max(0, num(t.stroke_width, 0));
  if (stroke > 0 && strokeMode === 'inline') {
    parts.push(
      `-webkit-text-stroke:${stroke}px ${cssValue(t.stroke_color) || '#000'}`,
      'paint-order:stroke fill',
      `text-shadow:${shadow}`
    );
  } else if (stroke > 0) {
    // The outline is drawn by a copy of the text behind the fill (see StyledText), so it
    // never eats into the glyphs. The shadow goes on that copy.
    parts.push(
      `--cw-stroke-w:${stroke * 2}px`,
      `--cw-stroke-c:${cssValue(t.stroke_color) || '#000'}`,
      `--cw-shadow:${shadow}`,
      'text-shadow:none'
    );
  } else {
    parts.push(`text-shadow:${shadow}`);
  }
  return parts.join(';');
}

export function hasStroke(s: Partial<TextStyle> | null | undefined): boolean {
  return num(s?.stroke_width, 0) > 0;
}

export function boxStyleCss(b: Partial<BoxStyle> | null | undefined): string {
  if (!b) return '';
  const parts: string[] = [];
  const bg = cssValue(b.background);
  if (bg && bg !== 'transparent') parts.push(`background:${bg}`);
  const bw = Math.max(0, num(b.border_width, 0));
  const bc = cssValue(b.border_color);
  if (bw > 0 && bc && bc !== 'transparent') parts.push(`border:${bw}px solid ${bc}`);
  const r = Math.max(0, num(b.radius, 0));
  if (r > 0) parts.push(`border-radius:${r}px`);
  const p = Math.max(0, num(b.padding, 0));
  if (p > 0) parts.push(`padding:${p}px`);
  const sh = cssValue(b.shadow);
  if (sh) parts.push(`box-shadow:${sh}`);
  const blur = Math.max(0, num(b.backdrop_blur, 0));
  if (blur > 0) parts.push(`backdrop-filter:blur(${blur}px)`, `-webkit-backdrop-filter:blur(${blur}px)`);
  return parts.join(';');
}

/** Width taken by padding and border on each side. */
export function boxInset(b: Partial<BoxStyle> | null | undefined): number {
  if (!b) return 0;
  const bc = cssValue(b.border_color);
  const bw = bc && bc !== 'transparent' ? Math.max(0, num(b.border_width, 0)) : 0;
  return Math.max(0, num(b.padding, 0)) + bw;
}

// ---- Scoped CSS ----------------------------------------------------------

/** A short class-safe hash of a layer id. */
export function scopeClass(layerId: string): string {
  let h = 2166136261;
  for (let i = 0; i < layerId.length; i++) {
    h ^= layerId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `cw-s-${(h >>> 0).toString(36)}`;
}

const ROOT_SELECTOR = /^(:scope|:host|:root|html|body)(?![\w-])/i;

function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === sep && depth === 0) {
      out.push(s.slice(last, i));
      last = i + 1;
    }
  }
  out.push(s.slice(last));
  return out;
}

function scopeSelector(sel: string, scope: string): string {
  const s = sel.trim();
  if (!s) return '';
  const root = ROOT_SELECTOR.exec(s);
  if (root) {
    let rest = s.slice(root[0].length);
    // `html body .x` and `:root body` both mean the scope root.
    rest = rest.replace(/^\s*(body)(?![\w-])/i, '');
    return `${scope}${rest}`;
  }
  return `${scope} ${s}`;
}

interface Block {
  prelude: string;
  body: string;
}

/** Split CSS into top-level `prelude { body }` blocks. Unbalanced trailing text is dropped. */
function blocks(css: string): Block[] {
  const out: Block[] = [];
  let i = 0;
  let start = 0;
  let quote = '';
  while (i < css.length) {
    const c = css[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      i++;
      continue;
    }
    if (c === ';' && css.slice(start, i).trim().startsWith('@')) {
      // Statement at-rule such as @import or @charset: dropped.
      start = i + 1;
      i++;
      continue;
    }
    if (c === '{') {
      const prelude = css.slice(start, i);
      let depth = 1;
      let j = i + 1;
      let q = '';
      for (; j < css.length && depth > 0; j++) {
        const d = css[j];
        if (q) {
          if (d === '\\') j++;
          else if (d === q) q = '';
        } else if (d === '"' || d === "'") q = d;
        else if (d === '{') depth++;
        else if (d === '}') depth--;
      }
      if (depth !== 0) break;
      out.push({ prelude: prelude.trim(), body: css.slice(i + 1, j - 1) });
      i = j;
      start = j;
      continue;
    }
    if (c === '}') {
      // Stray closing brace: skip it rather than let it close anything outside.
      start = i + 1;
    }
    i++;
  }
  return out;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?(\*\/|$)/g, '');
}

function scopeBlocks(css: string, scope: string): string {
  const list = blocks(css);
  const out: string[] = [];
  for (const b of list) {
    const p = b.prelude;
    if (!p) continue;
    if (p.startsWith('@')) {
      const name = (/^@([\w-]+)/.exec(p)?.[1] ?? '').toLowerCase();
      if (name === 'media' || name === 'supports' || name === 'layer' || name === 'container') {
        out.push(`${p}{${scopeBlocks(b.body, scope)}}`);
      } else if (name.endsWith('keyframes') || name === 'font-face' || name === 'property' || name === 'counter-style') {
        out.push(`${p}{${b.body.replace(/<\/style/gi, '')}}`);
      }
      // Anything else (@page, @import...) is dropped.
      continue;
    }
    const selectors = splitTopLevel(p, ',')
      .map((s) => scopeSelector(s, scope))
      .filter(Boolean);
    if (!selectors.length) continue;
    out.push(`${selectors.join(',')}{${b.body.replace(/[{}]/g, '').replace(/<\/style/gi, '')}}`);
  }
  return out.join('\n');
}

/**
 * Scope a layer's custom CSS under `.scope`. Selectors are prefixed, `:scope`, `:host`,
 * `:root`, `html` and `body` mean the layer itself, and plain declarations without any
 * selector apply to the layer. `@import` and other global at-rules are removed.
 */
export function scopeCss(css: string, scopeClassName: string): string {
  const scope = `.${scopeClassName}`;
  const clean = stripComments(css ?? '').trim();
  if (!clean) return '';
  if (!clean.includes('{')) {
    return `${scope}{${clean.replace(/[{}]/g, '').replace(/<\/style/gi, '')}}`;
  }
  return scopeBlocks(clean, scope);
}
