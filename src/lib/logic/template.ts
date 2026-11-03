// Mirrors src-tauri/src/template.rs. Both must pass tests/vectors/templates.json.
import { asNumber, formatNumber, parseNumber, resolve, stringify } from './condition';

/** One `{{ ... }}` in a template. Offsets are into the template string. */
export interface TemplateToken {
  /** The key, trimmed: `counter.deaths` in `{{ counter.deaths | number }}`. */
  key: string;
  /** Where the key starts and ends, without the spaces around it. */
  keyStart: number;
  keyEnd: number;
  /** The whole token, braces included. */
  start: number;
  end: number;
  /** Filter text after the key, e.g. `default:"0"`. */
  filters: string[];
}

/** The tokens `render` would fill in, by the same rules: no closing braces or empty braces are plain text. */
export function scanTemplate(template: string): TemplateToken[] {
  const out: TemplateToken[] = [];
  let pos = 0;
  for (;;) {
    const start = template.indexOf('{{', pos);
    if (start < 0) break;
    const end = template.indexOf('}}', start + 2);
    if (end < 0) break;
    const inner = template.slice(start + 2, end);
    pos = end + 2;
    if (inner.trim() === '') continue;
    const [rawKey = '', ...filters] = splitPipes(inner);
    const lead = rawKey.length - rawKey.trimStart().length;
    const key = rawKey.trim();
    const keyStart = start + 2 + lead;
    out.push({ key, keyStart, keyEnd: keyStart + key.length, start, end: pos, filters: filters.map((f) => f.trim()) });
  }
  return out;
}

export function render(template: string, ctx: unknown): string {
  let out = '';
  let pos = 0;
  for (const t of scanTemplate(template)) {
    out += template.slice(pos, t.start) + evalExpr(template.slice(t.start + 2, t.end - 2), ctx);
    pos = t.end;
  }
  return out + template.slice(pos);
}

function splitPipes(s: string): string[] {
  const out: string[] = [];
  let inQuotes = false;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === '|' && !inQuotes) {
      out.push(s.slice(last, i));
      last = i + 1;
    }
  }
  out.push(s.slice(last));
  return out;
}

function unquote(s: string): string {
  const t = s.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
}

function evalExpr(inner: string, ctx: unknown): string {
  const [key = '', ...filters] = splitPipes(inner);
  const raw = resolve(ctx, key.trim()) ?? null;
  let text = stringify(raw);
  let numeric = typeof raw === 'boolean' ? null : asNumber(raw);
  for (const f of filters) {
    const filter = f.trim();
    const colon = filter.indexOf(':');
    const name = (colon >= 0 ? filter.slice(0, colon) : filter).trim();
    const arg = colon >= 0 ? unquote(filter.slice(colon + 1)) : null;
    switch (name) {
      case 'upper':
        text = text.toUpperCase();
        break;
      case 'lower':
        text = text.toLowerCase();
        break;
      case 'number':
        if (numeric !== null) text = groupThousands(numeric);
        break;
      case 'round':
        if (numeric !== null) {
          numeric = Math.floor(numeric + 0.5);
          text = formatNumber(numeric);
        }
        break;
      case 'url':
        text = encodeURIComponent(text);
        numeric = null;
        break;
      case 'default':
        if (text === '') {
          text = arg ?? '';
          numeric = parseNumber(text);
        }
        break;
    }
  }
  return text;
}

/** 1234567.891 -> "1,234,567.89". At most two decimals, trailing zeros dropped. */
export function groupThousands(n: number): string {
  const fixed = Math.abs(n).toFixed(2);
  const [intPart = '0', fracRaw = ''] = fixed.split('.');
  const frac = fracRaw.replace(/0+$/, '');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const negative = n < 0 && (grouped !== '0' || frac !== '');
  return `${negative ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}
