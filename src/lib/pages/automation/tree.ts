import type { Step } from '$lib/bindings/Step';
import { insertItem, moveItem, removeItem, replaceItem } from '$lib/editors/list';
import { clone } from '$lib/editors/ids';

export type Branch = 'then' | 'else';

/** Where a list of steps lives: each hop is an if-step index and one of its branches. Empty = top level. */
export type ListPath = ReadonlyArray<{ index: number; branch: Branch }>;

export function getList(steps: readonly Step[], path: ListPath): readonly Step[] | null {
  let cur: readonly Step[] = steps;
  for (const hop of path) {
    const s = cur[hop.index];
    if (!s || s.type !== 'if') return null;
    cur = s[hop.branch];
  }
  return cur;
}

/** New tree with the list at `path` replaced by `fn(list)`. Bad paths leave the tree unchanged. */
export function updateList(steps: readonly Step[], path: ListPath, fn: (list: Step[]) => Step[]): Step[] {
  const [hop, ...rest] = path;
  if (!hop) return fn([...steps]);
  const s = steps[hop.index];
  if (!s || s.type !== 'if') return [...steps];
  return replaceItem(steps, hop.index, { ...s, [hop.branch]: updateList(s[hop.branch], rest, fn) });
}

export function insertStep(steps: readonly Step[], path: ListPath, index: number, step: Step): Step[] {
  return updateList(steps, path, (l) => insertItem(l, index, step));
}

export function removeStep(steps: readonly Step[], path: ListPath, index: number): Step[] {
  return updateList(steps, path, (l) => removeItem(l, index));
}

export function moveStep(steps: readonly Step[], path: ListPath, index: number, by: number): Step[] {
  return updateList(steps, path, (l) => moveItem(l, index, by));
}

export function replaceStep(steps: readonly Step[], path: ListPath, index: number, step: Step): Step[] {
  return updateList(steps, path, (l) => (index >= 0 && index < l.length ? replaceItem(l, index, step) : l));
}

export function duplicateStep(steps: readonly Step[], path: ListPath, index: number): Step[] {
  return updateList(steps, path, (l) => (l[index] ? insertItem(l, index + 1, clone(l[index]!)) : l));
}

/** Stable text key for a step, e.g. "0", "2.then.1". */
export function stepKey(path: ListPath, index: number): string {
  return [...path.map((h) => `${h.index}.${h.branch}`), String(index)].join('.');
}

export function child(path: ListPath, index: number, branch: Branch): ListPath {
  return [...path, { index, branch }];
}

/** Every step with its location, depth first. */
export function walk(steps: readonly Step[], path: ListPath = []): Array<{ step: Step; path: ListPath; index: number }> {
  const out: Array<{ step: Step; path: ListPath; index: number }> = [];
  steps.forEach((step, index) => {
    out.push({ step, path, index });
    if (step.type === 'if') {
      out.push(...walk(step.then, child(path, index, 'then')));
      out.push(...walk(step.else, child(path, index, 'else')));
    }
  });
  return out;
}

export function countSteps(steps: readonly Step[]): number {
  return walk(steps).length;
}

export function samePath(a: ListPath, b: ListPath): boolean {
  return a.length === b.length && a.every((h, i) => h.index === b[i]!.index && h.branch === b[i]!.branch);
}

function startsWith(path: ListPath, prefix: ListPath): boolean {
  return path.length >= prefix.length && samePath(path.slice(0, prefix.length), prefix);
}

/** True when list `path` is inside the step at `index` of list `owner`. */
export function isInside(path: ListPath, owner: ListPath, index: number): boolean {
  return path.length > owner.length && startsWith(path, owner) && path[owner.length]!.index === index;
}

/** Where list `path` ends up once the step at `index` of list `from` is removed. */
export function pathAfterRemove(path: ListPath, from: ListPath, index: number): ListPath {
  if (path.length <= from.length || !startsWith(path, from)) return path;
  const hop = path[from.length]!;
  if (hop.index <= index) return path;
  return [...path.slice(0, from.length), { ...hop, index: hop.index - 1 }, ...path.slice(from.length + 1)];
}

export interface StepAt {
  path: ListPath;
  index: number;
}

/**
 * Move a step to position `to.index` of list `to.path` (positions as they are before the move).
 * Returns null when the step can't go there, e.g. an if-step into its own branch.
 */
export function moveStepTo(steps: readonly Step[], from: StepAt, to: StepAt): { steps: Step[]; at: StepAt } | null {
  const step = getList(steps, from.path)?.[from.index];
  const target = getList(steps, to.path);
  if (!step || !target || isInside(to.path, from.path, from.index)) return null;
  let index = Math.max(0, Math.min(to.index, target.length));
  if (samePath(from.path, to.path) && index > from.index) index--;
  const path = pathAfterRemove(to.path, from.path, from.index);
  return { steps: insertStep(removeStep(steps, from.path, from.index), path, index, step), at: { path, index } };
}

/** "2.then.1" back to its location. */
export function parseStepKey(key: string): StepAt | null {
  const parts = key.split('.');
  if (parts.length % 2 !== 1) return null;
  const path: Array<{ index: number; branch: Branch }> = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const branch = parts[i + 1];
    if (branch !== 'then' && branch !== 'else') return null;
    path.push({ index: Number(parts[i]), branch });
  }
  const index = Number(parts[parts.length - 1]);
  return [index, ...path.map((h) => h.index)].every((n) => Number.isInteger(n) && n >= 0) ? { path, index } : null;
}

/** Every step list in the tree (main list first), with a short name for menus. */
export function allLists(steps: readonly Step[]): Array<{ path: ListPath; label: string }> {
  const out: Array<{ path: ListPath; label: string }> = [{ path: [], label: 'Main steps' }];
  const visit = (list: readonly Step[], path: ListPath, prefix: string) => {
    list.forEach((s, i) => {
      if (s.type !== 'if') return;
      const n = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      for (const branch of ['then', 'else'] as const) {
        const p = child(path, i, branch);
        out.push({ path: p, label: `${branch === 'then' ? 'Then' : 'Otherwise'} of step ${n}` });
        visit(s[branch], p, n);
      }
    });
  };
  visit(steps, [], '');
  return out;
}
