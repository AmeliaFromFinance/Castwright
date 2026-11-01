import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { insertToken } from './tokens';
import { copyName, insertItem, moveItem, removeItem, replaceItem } from './list';
import { Autosaver } from './autosave.svelte';
import { clone, newId } from './ids';

describe('insertToken', () => {
  it('inserts at the caret', () => {
    expect(insertToken('Hi !', 3, 3, 'name')).toEqual({ text: 'Hi {{name}}!', caret: 11 });
  });
  it('replaces the selection', () => {
    expect(insertToken('Hi you!', 3, 6, 'name')).toEqual({ text: 'Hi {{name}}!', caret: 11 });
  });
  it('appends without a caret and clamps', () => {
    expect(insertToken('Hi ', null, null, 'name').text).toBe('Hi {{name}}');
    expect(insertToken('ab', 9, 12, 'x')).toEqual({ text: 'ab{{x}}', caret: 7 });
    expect(insertToken('ab', 2, 0, 'x').text).toBe('ab{{x}}');
  });
});

describe('list helpers', () => {
  it('move, insert, remove, replace', () => {
    expect(moveItem([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moveItem([1, 2, 3], 2, -2)).toEqual([3, 1, 2]);
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(insertItem([1, 3], 1, 2)).toEqual([1, 2, 3]);
    expect(insertItem([1], 9, 2)).toEqual([1, 2]);
    expect(removeItem([1, 2, 3], 1)).toEqual([1, 3]);
    expect(replaceItem([1, 2, 3], 1, 9)).toEqual([1, 9, 3]);
  });
  it('copy names', () => {
    expect(copyName('A', [])).toBe('A copy');
    expect(copyName('A copy', ['A copy'])).toBe('A copy 2');
  });
  it('ids and clones', () => {
    expect(newId()).toMatch(/^[a-z0-9]{12}$/);
    const o = { a: [1] };
    expect(clone(o)).toEqual(o);
    expect(clone(o).a).not.toBe(o.a);
  });
});

describe('Autosaver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces and writes only the latest value', async () => {
    const saved: number[] = [];
    const s = new Autosaver<number>(async (v) => void saved.push(v), 600);
    s.schedule(1);
    s.schedule(2);
    expect(s.status).toBe('pending');
    expect(s.dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(599);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(saved).toEqual([2]);
    expect(s.status).toBe('saved');
    expect(s.dirty).toBe(false);
  });

  it('flush writes now; errors are kept', async () => {
    let fail = true;
    const s = new Autosaver<string>(async () => {
      if (fail) throw { code: 'user', message: 'Disk full' };
    });
    s.schedule('a');
    await s.flush();
    expect(s.status).toBe('error');
    expect(s.error).toBe('Disk full');
    fail = false;
    s.schedule('b');
    await s.flush();
    expect(s.status).toBe('saved');
    expect(s.error).toBeNull();
    await s.flush();
  });

  it('cancel drops pending writes', async () => {
    const save = vi.fn(async () => {});
    const s = new Autosaver<number>(save);
    s.schedule(1);
    s.cancel();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
  });
});

import { describeConditions } from './conditions';

describe('describeConditions', () => {
  it('summarises groups', () => {
    expect(describeConditions({ mode: 'all', conditions: [] })).toBe('Always');
    expect(
      describeConditions({
        mode: 'any',
        conditions: [
          { field: 'tier', op: 'eq', value: 3 },
          { field: 'message', op: 'contains', value: 'hi' },
          { field: 'is_gift', op: 'is_true', value: null }
        ]
      })
    ).toBe('tier is 3 or message contains "hi" or is_gift is yes');
  });
});
