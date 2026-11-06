import { describe, expect, it } from 'vitest';
import type { Condition } from '$lib/bindings/Condition';
import type { Variation } from '$lib/bindings/Variation';
import { evaluateGroup } from '$lib/logic/condition';
import { defaultVariation, sampleEvent } from './alerts';
import { alertContext, eventForVariation } from './variation-test';

const c = (field: string, op: Condition['op'], value: unknown = null): Condition => ({ field, op, value });
const v = (name: string, conditions: Condition[], mode: 'all' | 'any' = 'all'): Variation =>
  defaultVariation({ id: name, name, conditions: { mode, conditions } });

describe('eventForVariation', () => {
  it('meets number ranges and tiers', () => {
    const big = v('Big', [c('amount', 'gte', 1000), c('amount', 'lt', 5000)]);
    const r = eventForVariation(sampleEvent('cheer'), [big], big);
    expect(r.fits).toBe(true);
    expect(r.event.amount).toBe(1000);

    const t3 = v('Tier 3', [c('tier', 'eq', '3')]);
    expect(eventForVariation(sampleEvent('sub'), [t3], t3).event.tier).toBe(3);
  });

  it('keeps sample details that already fit', () => {
    const any = v('Any', []);
    const base = sampleEvent('raid');
    const r = eventForVariation(base, [any], any);
    expect(r.event).toEqual(base);
    expect(r.fits).toBe(true);
  });

  it('handles text, flags and missing values', () => {
    const target = v('Mix', [c('message', 'contains', 'hype'), c('is_anonymous', 'is_true'), c('data.reward_title', 'eq', 'Hydrate')]);
    const r = eventForVariation(sampleEvent('cheer'), [target], target);
    expect(r.fits).toBe(true);
    expect(r.event.message).toContain('hype');
    expect(r.event.is_anonymous).toBe(true);
    expect(r.event.data.reward_title).toBe('Hydrate');

    const quiet = v('No message', [c('message', 'not_exists')]);
    const q = eventForVariation(sampleEvent('resub'), [quiet], quiet);
    expect(q.fits).toBe(true);
    expect(q.event.message ?? '').toBe('');
  });

  it('sets the viewer name', () => {
    const target = v('Named', [c('name', 'eq', 'Tomasz')]);
    const r = eventForVariation(sampleEvent('follow'), [target], target);
    expect(r.event.user?.display_name).toBe('Tomasz');
    expect(evaluateGroup(target.conditions, alertContext(r.event))).toBe(true);
  });

  it('picks the "any" condition that an earlier variation would not catch', () => {
    const first = v('Months', [c('months', 'gte', 24)]);
    const target = v('Either', [c('months', 'gte', 36), c('tier', 'eq', 2)], 'any');
    const r = eventForVariation(sampleEvent('resub'), [first, target], target);
    expect(r.fits).toBe(true);
    expect(r.caughtBy).toBeNull();
    expect(r.event.tier).toBe(2);
  });

  it('says which earlier variation would play instead', () => {
    const first = v('Big', [c('amount', 'gte', 100)]);
    const target = v('Bigger', [c('amount', 'gte', 1000)]);
    const r = eventForVariation(sampleEvent('cheer'), [first, target], target);
    expect(r.fits).toBe(true);
    expect(r.caughtBy?.name).toBe('Big');
  });

  it("ignores disabled variations and reports conditions it can't meet", () => {
    const off = { ...v('Off', []), enabled: false };
    const target = v('Impossible', [c('tier', 'eq', 7)]);
    const r = eventForVariation(sampleEvent('sub'), [off, target], target);
    expect(r.fits).toBe(false);
    expect(r.caughtBy).toBeNull();
  });
});
