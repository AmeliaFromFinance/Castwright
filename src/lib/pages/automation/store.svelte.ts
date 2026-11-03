import { api, on } from '$lib/api';
import type { Action } from '$lib/bindings/Action';
import type { ActionRun } from '$lib/bindings/ActionRun';
import type { RunProgress } from '$lib/bindings/RunProgress';
import type { Graph } from '$lib/bindings/Graph';
import { Autosaver } from '$lib/editors/autosave.svelte';
import { clone } from '$lib/editors/ids';
import { app } from '$lib/state/app.svelte';
import { loadPref, savePref } from '$lib/state/persist';
import { withExtras } from './canvas';
import { syncTriggers, type Clip } from './graph';
import { ActionHistory } from './history';
import { addToHistory, applyProgress, finishTrace, type Trace } from './trace';
import type { View } from './view';
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
    const raw = app.project?.actions;
    if (!raw || this.dirty) return;
    // Projects from before notes and frames have neither list.
    const source = raw.map((a) => ({ ...a, graph: withExtras(a.graph) }));
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

  /** Keep the action as it is now for undo. Same `key` within `windowMs` merges, e.g. typing in one field. */
  #record(a: Action, key: string | null, windowMs?: number): void {
    this.history.record(clone($state.snapshot(a)) as Action, key ? `${a.id}:${key}` : null, Date.now(), windowMs);
    this.#rev++;
  }

  patchAction(id: string, patch: Partial<Action>): void {
    const a = this.#find(id);
    if (!a) return;
    this.#record(a, `a.${Object.keys(patch).join(',')}`);
    Object.assign(a, patch);
    this.changed();
  }

  /**
   * Change the graph. `key` merges repeated edits into one undo step (a drag passes
   * `windowMs: Infinity` and seals when it ends); leave it out for structural changes.
   */
  updateGraph(id: string, fn: (g: Graph) => Graph | null, key: string | null = null, windowMs?: number): boolean {
    const a = this.#find(id);
    if (!a) return false;
    const before = $state.snapshot(a.graph) as Graph;
    const next = fn(clone(before));
    if (!next || JSON.stringify(next) === JSON.stringify(before)) return false;
    this.#record(a, key ? `g.${key}` : null, windowMs);
    a.graph = next;
    syncTriggers(a);
    this.changed();
    return true;
  }

  /** Change some fields of the trigger or step in one node. */
  patchNode(id: string, nodeId: string, patch: Record<string, unknown>): void {
    this.updateGraph(
      id,
      (g) => {
        const n = g.nodes.find((x) => x.id === nodeId);
        if (!n) return null;
        if (n.kind.type === 'trigger') n.kind.trigger = { ...n.kind.trigger, ...patch } as typeof n.kind.trigger;
        else n.kind.step = { ...n.kind.step, ...patch } as typeof n.kind.step;
        return g;
      },
      `n.${nodeId}.${Object.keys(patch).join(',')}`
    );
  }

  /** End a run of merged edits, e.g. when a drag ends. */
  seal(id: string): void {
    this.history.seal(id);
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

/** Canvas state. Snap is kept per device; the view per action while the app runs. */
class FlowState {
  snap = $state<boolean>(loadPref('automation.snap', true));
  /** Selected node ids. */
  selected = $state<string[]>([]);
  /** Selected line, when no nodes are. */
  edge = $state<string | null>(null);
  inspecting = $state(false);
  clipboard = $state<Clip | null>(null);
  /** A test run that hasn't reported back yet. */
  testing = $state<{ actionId: string; after: number } | null>(null);
  views = new Map<string, View>();

  /** The node shown in the inspector. */
  get inspected(): string | null {
    return this.inspecting && this.selected.length === 1 ? this.selected[0]! : null;
  }

  setSnap(on: boolean): void {
    this.snap = on;
    savePref('automation.snap', on);
  }

  select(ids: string[], inspect = this.inspecting): void {
    this.selected = ids;
    this.edge = null;
    this.inspecting = ids.length === 1 && inspect;
  }

  selectEdge(id: string | null): void {
    this.selected = [];
    this.inspecting = false;
    this.edge = id;
  }

  clear(): void {
    this.select([], false);
  }
}

export const flow = new FlowState();

export interface RunEntry extends ActionRun {
  ts: number;
  seq: number;
}

/** Results of recent action runs, newest first, and a trace of each action's latest runs. */
class RunLog {
  runs = $state<RunEntry[]>([]);
  /** Latest run of each action, live while it runs. */
  live = $state<Record<string, Trace<RunEntry>>>({});
  /** Finished runs of each action, newest first. */
  history = $state<Record<string, Trace<RunEntry>[]>>({});
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
    void on('cw://action-progress', (p) => this.progress(p));
    void on('cw://action-run', (r) => this.add(r));
  }

  progress(p: RunProgress): void {
    this.live[p.action_id] = applyProgress(this.live[p.action_id], p);
  }

  add(r: ActionRun): void {
    const entry: RunEntry = { ...r, ts: Date.now(), seq: ++this.#seq };
    this.runs = [entry, ...this.runs].slice(0, 200);
    const t = finishTrace(entry);
    // A newer run may already be under way.
    const cur = this.live[r.action_id];
    if (!cur || cur.runId === r.run_id || cur.run) this.live[r.action_id] = t;
    this.history[r.action_id] = addToHistory(this.history[r.action_id], t);
  }

  clear(): void {
    this.runs = [];
  }
}

export const runLog = new RunLog();
