// Mirrors src-tauri/src/model/condition.rs. Both must pass tests/vectors/conditions.json.
import type { Condition } from '$lib/bindings/Condition';
import type { ConditionGroup } from '$lib/bindings/ConditionGroup';

type Json = unknown;

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export function parseNumber(s: string): number | null {
  const t = s.trim();
  if (!t || !NUMBER_RE.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function asNumber(v: Json): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return parseNumber(v);
  return null;
}

export function formatNumber(n: number): string {
  if (Object.is(n, -0)) return '0';
  return String(n);
}

export function stringify(v: Json): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? formatNumber(v) : '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(stringify).join(', ');
  return '';
}

function isObject(v: Json): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Exact key first (flat variable names such as `last.sub.name`), then a dotted path. */
export function resolve(ctx: Json, field: string): Json | undefined {
  if (isObject(ctx) && Object.prototype.hasOwnProperty.call(ctx, field)) return ctx[field];
  let cur: Json = ctx;
  for (const seg of field.split('.')) {
    if (isObject(cur)) {
      if (!Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
      cur = cur[seg];
    } else if (Array.isArray(cur)) {
      if (!/^\d+$/.test(seg)) return undefined;
      const i = Number(seg);
      if (i >= cur.length) return undefined;
      cur = cur[i];
    } else {
      return undefined;
    }
  }
  return cur;
}

function looseEq(a: Json, b: Json): boolean {
  const x = asNumber(a);
  const y = asNumber(b);
  if (x !== null && y !== null) return x === y;
  return stringify(a).toLowerCase() === stringify(b).toLowerCase();
}

function truthy(v: Json | undefined): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'string') return ['true', 'yes', '1'].includes(v.trim().toLowerCase());
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function contains(actual: Json, needle: Json): boolean {
  if (Array.isArray(actual)) return actual.some((i) => looseEq(i, needle));
  return stringify(actual).toLowerCase().includes(stringify(needle).toLowerCase());
}

export function evaluateCondition(c: Condition, ctx: Json): boolean {
  const raw = resolve(ctx, c.field);
  const actual = raw === null ? undefined : raw;
  const value = c.value ?? null;
  switch (c.op) {
    case 'exists':
      return actual !== undefined;
    case 'not_exists':
      return actual === undefined;
    case 'is_true':
      return truthy(actual);
    case 'is_false':
      return !truthy(actual);
    case 'eq':
      return actual !== undefined && looseEq(actual, value);
    case 'ne':
      return !(actual !== undefined && looseEq(actual, value));
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = actual === undefined ? null : asNumber(actual);
      const b = asNumber(value);
      if (a === null || b === null) return false;
      if (c.op === 'gt') return a > b;
      if (c.op === 'gte') return a >= b;
      if (c.op === 'lt') return a < b;
      return a <= b;
    }
    case 'contains':
      return actual !== undefined && contains(actual, value);
    case 'not_contains':
      return !(actual !== undefined && contains(actual, value));
    case 'starts_with':
      return actual !== undefined && stringify(actual).toLowerCase().startsWith(stringify(value).toLowerCase());
    case 'ends_with':
      return actual !== undefined && stringify(actual).toLowerCase().endsWith(stringify(value).toLowerCase());
  }
}

export function evaluateGroup(g: ConditionGroup | null | undefined, ctx: Json): boolean {
  if (!g || g.conditions.length === 0) return true;
  return g.mode === 'any'
    ? g.conditions.some((c) => evaluateCondition(c, ctx))
    : g.conditions.every((c) => evaluateCondition(c, ctx));
}
