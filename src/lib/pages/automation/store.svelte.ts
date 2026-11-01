import { api, on } from '$lib/api';
import type { Action } from '$lib/bindings/Action';
import type { ActionRun } from '$lib/bindings/ActionRun';
import type { Step } from '$lib/bindings/Step';
import type { Trigger } from '$lib/bindings/Trigger';
import { Autosaver } from '$lib/editors/autosave.svelte';
import { clone } from '$lib/editors/ids';
import { app } from '$lib/state/app.svelte';
import { blocking, validateAction, type Issue } from './validate';

/** Working copy of the actions. Lives as long as the app, so edits survive page switches. */
class ActionsEditor {
  actions = $state<Action[] | null>(null);
  selectedId = $state<string | null>(null);
  search = $state('');
  /** Edits not saved because something needs fixing first. */
  held = $state(false);

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

  patchAction(id: string, patch: Partial<Action>): void {
    const a = this.#find(id);
    if (!a) return;
    Object.assign(a, patch);
    this.changed();
  }

  patchTrigger(id: string, index: number, patch: Partial<Trigger>): void {
    const t = this.#find(id)?.triggers[index];
    if (!t) return;
    Object.assign(t, patch);
    this.changed();
  }

  updateSteps(id: string, fn: (steps: Step[]) => Step[]): void {
    const a = this.#find(id);
    if (!a) return;
    a.steps = fn($state.snapshot(a.steps) as Step[]);
    this.changed();
  }

  get selected(): Action | null {
    return this.actions?.find((a) => a.id === this.selectedId) ?? null;
  }
}

export const actionsEditor = new ActionsEditor();

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
