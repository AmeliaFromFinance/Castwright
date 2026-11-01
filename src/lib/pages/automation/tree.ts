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
