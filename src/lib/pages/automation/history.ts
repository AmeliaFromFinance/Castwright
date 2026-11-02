import type { Action } from '$lib/bindings/Action';
import { History } from '$lib/editor/history';

/** Undo history per action. Edits with the same key close together (typing in one field) are one step. */
export class ActionHistory {
  #byId = new Map<string, History<Action>>();

  constructor(
    readonly limit = 100,
    readonly windowMs = 1000
  ) {}

  #get(id: string): History<Action> {
    let h = this.#byId.get(id);
    if (!h) this.#byId.set(id, (h = new History<Action>(this.limit, this.windowMs)));
    return h;
  }

  /** Call with a copy of the action from before a change. */
  record(before: Action, key?: string | null, now = Date.now(), windowMs?: number): void {
    this.#get(before.id).record(before, key, now, windowMs);
  }

  canUndo(id: string): boolean {
    return this.#byId.get(id)?.canUndo ?? false;
  }

  canRedo(id: string): boolean {
    return this.#byId.get(id)?.canRedo ?? false;
  }

  undo(current: Action): Action | null {
    return this.#byId.get(current.id)?.undo(current) ?? null;
  }

  redo(current: Action): Action | null {
    return this.#byId.get(current.id)?.redo(current) ?? null;
  }

  seal(id: string): void {
    this.#byId.get(id)?.seal();
  }

  forget(id: string): void {
    this.#byId.delete(id);
  }
}
