// Mirrors src-tauri/src/template.rs. Both must pass tests/vectors/templates.json.
import { asNumber, formatNumber, parseNumber, resolve, stringify } from './condition';

export function render(template: string, ctx: unknown): string {
  let out = '';
  let rest = template;
  for (;;) {
    const start = rest.indexOf('{{');
    if (start < 0) break;
    out += rest.slice(0, start);
    const after = rest.slice(start + 2);
    const end = after.indexOf('}}');
    if (end < 0) {
      out += rest.slice(start);
      return out;
    }
    const inner = after.slice(0, end);
    out += inner.trim() === '' ? `{{${inner}}}` : evalExpr(inner, ctx);
    rest = after.slice(end + 2);
  }
  return out + rest;
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
