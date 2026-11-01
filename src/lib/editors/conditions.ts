import type { ConditionGroup } from '$lib/bindings/ConditionGroup';
import type { Op } from '$lib/bindings/Op';
import { stringify } from '$lib/logic/condition';

const OP_TEXT: Record<Op, string> = {
  eq: 'is',
  ne: 'is not',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  contains: 'contains',
  not_contains: "doesn't contain",
  starts_with: 'starts with',
  ends_with: 'ends with',
  exists: 'has a value',
  not_exists: 'is empty',
  is_true: 'is yes',
  is_false: 'is no'
};

const NO_VALUE: Op[] = ['exists', 'not_exists', 'is_true', 'is_false'];

/** Short summary such as `tier is 3 and months ≥ 12`. Empty group gives `fallback`. */
export function describeConditions(g: ConditionGroup, fallback = 'Always'): string {
  if (!g.conditions.length) return fallback;
  return g.conditions
    .map((c) => {
      const field = c.field || '?';
      if (NO_VALUE.includes(c.op)) return `${field} ${OP_TEXT[c.op]}`;
      const v = stringify(c.value);
      return `${field} ${OP_TEXT[c.op]} ${typeof c.value === 'string' ? `"${v}"` : v}`;
    })
    .join(g.mode === 'all' ? ' and ' : ' or ');
}
