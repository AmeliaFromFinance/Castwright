import { api, on } from '$lib/api';
import type { Action } from '$lib/bindings/Action';
import type { ActionRun } from '$lib/bindings/ActionRun';
import type { Step } from '$lib/bindings/Step';
import type { Trigger } from '$lib/bindings/Trigger';
import { Autosaver } from '$lib/editors/autosave.svelte';
import { clone } from '$lib/editors/ids';
import { app } from '$lib/state/app.svelte';
import { loadPref, savePref } from '$lib/state/persist';
import { ActionHistory } from './history';
import { blocking, validateAction, type Issue } from './validate';

/** Working copy of the actions. Lives as long as the app, so edits survive page switches. */
class ActionsEditor {
  actions = $state<Action[] | null>(null);
  selectedId = $state<string | null>(null);
  search = $state('');
  /** Edits not saved because something needs fixing first. */
  held = $state(false);

  history = new ActionHistory();
  /** Bumped on every history change, so undo buttons update. */
  #rev = $state(0);

  saver = new Autosaver<Action[]>(async (list) => {
    await api.saveActions(list);
    if (app.project) app.project.actions = clone(list);
  });

  issues = $derived.by((): Record<string, Issue[]> => {
    const list = this.actions ?? [];
    const overlays = app.project?.overlays ?? [];
    return Object.fromEntries(list.map((a) => [a.id, validateAction(a, list, overlays)]));
  });

  blockingCount = $derived(Object.values(this.issues).reduce((n, list) => n + blocking(list).length, 0));

  get dirty(): boolean {
    return this.held || this.saver.dirty;
  }

  sync(): void {
    const source = app.project?.actions;
    if (!source || this.dirty) return;
    if (!this.actions || JSON.stringify(source) !== JSON.stringify($state.snapshot(this.actions))) {
      this.actions = clone(source);
    }
  }

  changed(): void {
    if (!this.actions) return;
    if (this.blockingCount > 0) {
      this.saver.cancel();
      this.held = true;
      return;
    }
    this.held = false;
    this.saver.schedule(clone($state.snapshot(this.actions)) as Action[]);
  }

  #find(id: string): Action | undefined {
    return this.actions?.find((a) => a.id === id);
  }

  /** Keep the action as it is now for undo. Same `key` within a second merges, e.g. typing in one field. */
  #record(a: Action, key: string | null): void {
    this.history.record(clone($state.snapshot(a)) as Action, key ? `${a.id}:${key}` : null);
    this.#rev++;
  }

  patchAction(id: string, patch: Partial<Action>): void {
    const a = this.#find(id);
    if (!a) return;
    this.#record(a, `a.${Object.keys(patch).join(',')}`);
    Object.assign(a, patch);
    this.changed();
  }

  patchTrigger(id: string, index: number, patch: Partial<Trigger>): void {
    const a = this.#find(id);
    const t = a?.triggers[index];
    if (!a || !t) return;
    this.#record(a, `t.${index}.${Object.keys(patch).join(',')}`);
    Object.assign(t, patch);
    this.changed();
  }

  /** `key` merges repeated edits into one undo step; leave it out for structural changes. */
  updateSteps(id: string, fn: (steps: Step[]) => Step[], key: string | null = null): void {
    const a = this.#find(id);
    if (!a) return;
    const next = fn($state.snapshot(a.steps) as Step[]);
    if (JSON.stringify(next) === JSON.stringify($state.snapshot(a.steps))) return;
    this.#record(a, key ? `s.${key}` : null);
    a.steps = next;
    this.changed();
  }

  canUndo(id: string): boolean {
    void this.#rev;
    return this.history.canUndo(id);
  }

  canRedo(id: string): boolean {
    void this.#rev;
    return this.history.canRedo(id);
  }

  /** Undo or redo the last change to one action. Returns false when there is nothing to do. */
  step(id: string, dir: 'undo' | 'redo'): boolean {
    const a = this.#find(id);
    if (!a) return false;
    const cur = clone($state.snapshot(a)) as Action;
    const other = dir === 'undo' ? this.history.undo(cur) : this.history.redo(cur);
    this.#rev++;
    if (!other) return false;
    Object.assign(a, other, { id: a.id });
    this.changed();
    return true;
  }

  get selected(): Action | null {
    return this.actions?.find((a) => a.id === this.selectedId) ?? null;
  }
}

export const actionsEditor = new ActionsEditor();

export type View = 'flow' | 'list';

/** Flow view state. View and zoom are kept per device. */
class FlowState {
  view = $state<View>(loadPref('automation.view', 'flow'));
  zoom = $state<number>(loadPref('automation.zoom', 1));
  /** Selected node: "t.0" for a trigger, "s.1.then.0" for a step. */
  selected = $state<string | null>(null);
  inspecting = $state(false);
  /** Cut or copied step, pasted after the selected node. */
  clipboard = $state<Step | null>(null);
  /** A test run that hasn't reported back yet. */
  testing = $state<{ actionId: string; after: number } | null>(null);

  setView(v: View): void {
    this.view = v;
    savePref('automation.view', v);
  }

  setZoom(z: number): void {
    this.zoom = Math.round(Math.min(2, Math.max(0.3, z)) * 100) / 100;
    savePref('automation.zoom', this.zoom);
  }

  select(key: string | null, inspect = this.inspecting): void {
    this.selected = key;
    this.inspecting = !!key && inspect;
  }
}

export const flow = new FlowState();

export interface RunEntry extends ActionRun {
  ts: number;
  seq: number;
}

/** Results of recent action runs, newest first. */
class RunLog {
  runs = $state<RunEntry[]>([]);
  #listening = false;
  #seq = 0;

  last = $derived.by(() => {
    const out: Record<string, RunEntry> = {};
    for (const r of this.runs) if (!out[r.action_id]) out[r.action_id] = r;
    return out;
  });

  listen(): void {
    if (this.#listening) return;
    this.#listening = true;
    void on('cw://action-run', (r) => {
      this.runs = [{ ...r, ts: Date.now(), seq: ++this.#seq }, ...this.runs].slice(0, 200);
    });
  }

  clear(): void {
    this.runs = [];
  }
}

export const runLog = new RunLog();
