import type { Step } from '$lib/bindings/Step';
import { actionsEditor as ed } from './store.svelte';
import { duplicateStep, getList, insertStep, moveStep, removeStep, replaceStep, stepKey, type ListPath } from './tree';

/** Structural edits on the step tree, applied by the action editor. */
export interface StepOps {
  insert(path: ListPath, index: number, step: Step): void;
  remove(path: ListPath, index: number): void;
  move(path: ListPath, index: number, by: number): void;
  duplicate(path: ListPath, index: number): void;
  /** Change some fields of one step. */
  patch(path: ListPath, index: number, patch: Record<string, unknown>): void;
}

export function stepOps(id: () => string): StepOps {
  const apply = (fn: (steps: Step[]) => Step[], key?: string) => ed.updateSteps(id(), fn, key);
  return {
    insert: (path, i, s) => apply((st) => insertStep(st, path, i, s)),
    remove: (path, i) => apply((st) => removeStep(st, path, i)),
    move: (path, i, by) => apply((st) => moveStep(st, path, i, by)),
    duplicate: (path, i) => apply((st) => duplicateStep(st, path, i)),
    patch: (path, i, p) =>
      apply(
        (st) => {
          const cur = getList(st, path)?.[i];
          return cur ? replaceStep(st, path, i, { ...cur, ...p } as Step) : st;
        },
        `${stepKey(path, i)}.${Object.keys(p).join(',')}`
      )
  };
}
