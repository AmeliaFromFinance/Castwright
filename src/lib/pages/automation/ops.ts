import type { Step } from '$lib/bindings/Step';
import type { ListPath } from './tree';

/** Structural edits on the step tree, applied by the action editor. */
export interface StepOps {
  insert(path: ListPath, index: number, step: Step): void;
  remove(path: ListPath, index: number): void;
  move(path: ListPath, index: number, by: number): void;
  duplicate(path: ListPath, index: number): void;
  /** Change some fields of one step. */
  patch(path: ListPath, index: number, patch: Record<string, unknown>): void;
}
