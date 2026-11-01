/**
 * Undo/redo of whole-document snapshots. Changes that share a key within a short window
 * (typing in one field, nudging with arrow keys) or during one drag become one step.
 */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private lastKey: string | null = null;
  private lastAt = 0;

  constructor(
    readonly limit = 100,
    readonly windowMs = 1000
  ) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get size(): number {
    return this.past.length;
  }

  /**
   * Call with the state from before a change. Returns false when the change was folded into
   * the previous step. Pass `windowMs: Infinity` for a drag so pauses don't split it.
   */
  record(before: T, key?: string | null, now: number = Date.now(), windowMs: number = this.windowMs): boolean {
    const merge = !!key && key === this.lastKey && now - this.lastAt <= windowMs;
    this.lastKey = key ?? null;
    this.lastAt = now;
    this.future = [];
    if (merge) return false;
    this.past.push(before);
    if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit);
    return true;
  }

  /** Ends the current run, so the next change is a new step even with the same key. */
  seal(): void {
    this.lastKey = null;
  }

  undo(current: T): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(current);
    this.seal();
    return prev;
  }

  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    this.seal();
    return next;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.seal();
  }
}
