import { describe, expect, it } from 'vitest';
import { History } from './history';

describe('History', () => {
  it('undoes and redoes', () => {
    const h = new History<number>();
    h.record(0, null, 0);
    h.record(1, null, 10);
    expect(h.undo(2)).toBe(1);
    expect(h.undo(1)).toBe(0);
    expect(h.undo(0)).toBeNull();
    expect(h.redo(0)).toBe(1);
    expect(h.redo(1)).toBe(2);
    expect(h.redo(2)).toBeNull();
  });

  it('drops redo steps after a new change', () => {
    const h = new History<string>();
    h.record('a', null, 0);
    expect(h.undo('b')).toBe('a');
    expect(h.canRedo).toBe(true);
    h.record('a', null, 5);
    expect(h.canRedo).toBe(false);
  });

  it('folds rapid changes with the same key into one step', () => {
    const h = new History<string>(100, 1000);
    expect(h.record('', 'text:1', 0)).toBe(true);
    expect(h.record('H', 'text:1', 200)).toBe(false);
    expect(h.record('He', 'text:1', 900)).toBe(false);
    expect(h.size).toBe(1);
    expect(h.undo('Hey')).toBe('');
  });

  it('starts a new step after a pause or a different key', () => {
    const h = new History<string>(100, 1000);
    h.record('a', 'k', 0);
    h.record('b', 'k', 2500);
    h.record('c', 'other', 2600);
    expect(h.size).toBe(3);
  });

  it('keeps one drag together however long it takes', () => {
    const h = new History<number>(100, 1000);
    h.record(0, 'drag:1', 0, Infinity);
    h.record(5, 'drag:1', 60_000, Infinity);
    expect(h.size).toBe(1);
    h.seal();
    h.record(9, 'drag:1', 60_010, Infinity);
    expect(h.size).toBe(2);
  });

  it('does not merge a change straight after undo', () => {
    const h = new History<string>();
    h.record('a', 'k', 0);
    h.undo('b');
    h.record('a', 'k', 10);
    expect(h.size).toBe(1);
    expect(h.undo('c')).toBe('a');
  });

  it('caps the number of steps, dropping the oldest', () => {
    const h = new History<number>(3);
    for (let i = 0; i < 10; i++) h.record(i, null, i);
    expect(h.size).toBe(3);
    expect(h.undo(10)).toBe(9);
    expect(h.undo(9)).toBe(8);
    expect(h.undo(8)).toBe(7);
    expect(h.undo(7)).toBeNull();
  });

  it('clears', () => {
    const h = new History<number>();
    h.record(1);
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });
});
