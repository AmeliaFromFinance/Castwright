import { describe, expect, it } from 'vitest';
import conditions from '../../../tests/vectors/conditions.json';
import templates from '../../../tests/vectors/templates.json';
import { evaluateCondition, evaluateGroup, parseNumber } from './condition';
import { groupThousands, render } from './template';
import type { Condition } from '$lib/bindings/Condition';
import type { ConditionGroup } from '$lib/bindings/ConditionGroup';

describe('conditions (shared with Rust)', () => {
  for (const c of conditions.cases) {
    it(c.name, () => {
      expect(evaluateCondition(c.condition as Condition, conditions.context)).toBe(c.expected);
    });
  }
  for (const g of conditions.groups) {
    it(`group: ${g.name}`, () => {
      expect(evaluateGroup(g.group as ConditionGroup, conditions.context)).toBe(g.expected);
    });
  }
});

describe('templates (shared with Rust)', () => {
  for (const c of templates.cases) {
    it(c.name, () => {
      expect(render(c.template, templates.context)).toBe(c.expected);
    });
  }
});

describe('number helpers', () => {
  it('parses strictly', () => {
    expect(parseNumber(' -1.5e2 ')).toBe(-150);
    expect(parseNumber('.5')).toBe(0.5);
    for (const bad of ['', ' ', 'inf', 'Infinity', 'NaN', '0x10', '1e', '--1', '1.2.3', '12abc', '.']) {
      expect(parseNumber(bad), bad).toBeNull();
    }
  });
  it('groups thousands like Rust', () => {
    expect(groupThousands(0)).toBe('0');
    expect(groupThousands(1000)).toBe('1,000');
    expect(groupThousands(-1234.5)).toBe('-1,234.5');
    expect(groupThousands(-0.001)).toBe('0');
  });
  it('keeps unicode intact', () => {
    expect(render('✨ {{name}} ✨ {{', { name: 'ナナ' })).toBe('✨ ナナ ✨ {{');
  });
});
