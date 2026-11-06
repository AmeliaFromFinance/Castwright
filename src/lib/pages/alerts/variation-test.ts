// Builds a test event that fits one variation's conditions, so "Test" on a
// variation shows that variation with believable details (tier, amount...).
import type { Condition } from '$lib/bindings/Condition';
import type { Event } from '$lib/bindings/Event';
import type { Variation } from '$lib/bindings/Variation';
import { asNumber, evaluateCondition, evaluateGroup, resolve, stringify } from '$lib/logic/condition';

type Ctx = Record<string, unknown>;

export interface VariationTest {
  event: Event;
  /** The event meets the variation's conditions. */
  fits: boolean;
  /** An earlier variation that a real event like this would play instead. */
  caughtBy: Variation | null;
}

/** The context conditions are checked against (same as the alert engine). */
export function alertContext(e: Event, vars: Ctx = {}): Ctx {
  return {
    ...vars,
    ...(e as unknown as Ctx),
    name: e.user?.display_name ?? (e.is_anonymous ? 'Anonymous' : ''),
    recipient_name: e.recipient?.display_name ?? ''
  };
}

const INTS: Record<string, [number, number]> = { tier: [1, 3], months: [0, 1_000_000] };
const NUMS = new Set(['amount']);
const BOOLS = new Set(['is_gift', 'is_anonymous', 'roles.broadcaster', 'roles.moderator', 'roles.vip', 'roles.subscriber']);
const TEXT = new Set(['name', 'recipient_name', 'message', 'currency', 'user.login']);

/** Fit a value to the field's type; null when it can't be stored there. */
function coerce(field: string, v: unknown): unknown {
  if (v === undefined) return null;
  if (field in INTS) {
    const n = asNumber(v as never);
    const [lo, hi] = INTS[field]!;
    return n !== null && Number.isInteger(n) && n >= lo && n <= hi ? n : undefined;
  }
  if (NUMS.has(field)) {
    if (v === null) return null;
    const n = asNumber(v as never);
    return n === null || n < 0 ? undefined : n;
  }
  if (BOOLS.has(field)) return typeof v === 'boolean' ? v : undefined;
  if (TEXT.has(field)) return v === null ? null : stringify(v as never);
  return v;
}

function user(name: string) {
  return { id: 'test', login: name.toLowerCase().replace(/[^a-z0-9_]/g, '') || 'viewer', display_name: name };
}

/** A copy of `e` with `field` set (null removes it). */
function withField(e: Event, field: string, value: unknown): Event {
  const out = structuredClone(e) as unknown as Ctx;
  if (field === 'name') {
    out.user = value === null || value === '' ? null : { ...((out.user as object) ?? user(String(value))), display_name: String(value) };
    if (value !== null) out.is_anonymous = String(value).toLowerCase() === 'anonymous';
  } else if (field === 'recipient_name') {
    out.recipient = value === null || value === '' ? null : { ...((out.recipient as object) ?? user(String(value))), display_name: String(value) };
  } else {
    const segs = field.split('.');
    let cur = out;
    for (const s of segs.slice(0, -1)) {
      if (typeof cur[s] !== 'object' || cur[s] === null) cur[s] = {};
      cur = cur[s] as Ctx;
    }
    const last = segs[segs.length - 1]!;
    if (value === null && !(field in INTS) && !NUMS.has(field) && !TEXT.has(field) && segs[0] === 'data') delete cur[last];
    else cur[last] = value;
    if (field === 'message') out.message_parts = [];
  }
  return out as unknown as Event;
}

/** Values worth trying to meet one condition, given what the field holds now. */
function candidates(c: Condition, current: unknown): unknown[] {
  const v = c.value ?? null;
  const n = asNumber(v as never);
  const text = stringify(v as never);
  const now = stringify((current ?? '') as never);
  switch (c.op) {
    case 'eq':
      return [n ?? v];
    case 'ne':
      return n !== null ? [n + 1, n - 1, Math.floor(n) + 1] : [now && now !== text ? now : `${text}x`, 'something else'];
    case 'gt':
      return n === null ? [] : [Math.floor(n) + 1, n + 1];
    case 'gte':
      return n === null ? [] : [n, Math.ceil(n)];
    case 'lt':
      return n === null ? [] : [Math.ceil(n) - 1, n - 1];
    case 'lte':
      return n === null ? [] : [n, Math.floor(n)];
    case 'contains':
      return [now ? `${now} ${text}` : text, text];
    case 'not_contains':
      return [''];
    case 'starts_with':
      return [now ? `${text} ${now}` : text, text];
    case 'ends_with':
      return [now ? `${now} ${text}` : text, text];
    case 'exists':
      return [now ? current : null, 1, 'test'].filter((x) => x !== null);
    case 'not_exists':
      return [null, ''];
    case 'is_true':
      return [true, 1];
    case 'is_false':
      return [false, 0];
  }
}

/** Change `e` so every condition in `conds` holds, one field at a time. */
function fitAll(e: Event, conds: Condition[], vars: Ctx): Event {
  const fields = [...new Set(conds.map((c) => c.field))];
  let out = e;
  for (const field of fields) {
    const mine = conds.filter((c) => c.field === field);
    const ok = (ev: Event) => mine.every((c) => evaluateCondition(c, alertContext(ev, vars)));
    if (ok(out)) continue;
    const current = resolve(alertContext(out, vars), field);
    for (const raw of mine.flatMap((c) => candidates(c, current))) {
      const value = coerce(field, raw);
      if (value === undefined) continue;
      const next = withField(out, field, value);
      if (ok(next)) {
        out = next;
        break;
      }
    }
  }
  return out;
}

/** A test event for `target`, starting from a sample event of the same kind. */
export function eventForVariation(base: Event, variations: Variation[], target: Variation, vars: Ctx = {}): VariationTest {
  const g = target.conditions;
  const tries: Condition[][] = g.mode === 'any' && g.conditions.length ? g.conditions.map((c) => [c]) : [g.conditions];
  const before = variations.slice(0, Math.max(0, variations.findIndex((v) => v.id === target.id))).filter((v) => v.enabled);
  const results = tries.map((conds) => {
    const event = fitAll(base, conds, vars);
    const ctx = alertContext(event, vars);
    return { event, fits: evaluateGroup(g, ctx), caughtBy: before.find((v) => evaluateGroup(v.conditions, ctx)) ?? null };
  });
  return results.find((r) => r.fits && !r.caughtBy) ?? results.find((r) => r.fits) ?? results[0]!;
}
