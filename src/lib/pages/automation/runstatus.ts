// Which nodes a finished run went through. Runs only report error texts ("Shoutout: …"),
// so this is worked out from the step labels and the shape of the tree.
import type { Action } from '$lib/bindings/Action';
import type { ActionRun } from '$lib/bindings/ActionRun';
import type { Step } from '$lib/bindings/Step';
import type { Trigger } from '$lib/bindings/Trigger';
import { STEP_LABELS } from './defaults';
import { nodeKey, triggerKey } from './flow';
import { child, walk, type Branch, type ListPath } from './tree';
import { commandName } from './validate';

export type NodeState = 'ok' | 'failed' | 'skipped';

export interface NodeStatus {
  state: NodeState;
  errors: string[];
}

/** True when a run started by `label` came from this trigger. */
export function triggerMatches(t: Trigger, label: string): boolean {
  switch (t.type) {
    case 'command':
      return [t.name, ...t.aliases].some((n) => `!${commandName(n)}`.toLowerCase() === label.toLowerCase());
    case 'timer':
      return label === 'timer';
    case 'scene_changed':
      return label === 'scene change';
    case 'manual':
      return label === 'manual';
    case 'event':
      return label === t.kind;
    default:
      return label === t.type;
  }
}

function splitError(e: string): { label: string; message: string } {
  const i = e.indexOf(': ');
  return i > 0 ? { label: e.slice(0, i), message: e.slice(i + 2) } : { label: '', message: e };
}

type Flow = 'go' | 'stopped' | 'unknown';

export function runStatus(action: Action, run: ActionRun): Record<string, NodeStatus> {
  const out: Record<string, NodeStatus> = {};
  const all = walk(action.steps);

  // Failed steps, matched by label. A label used by one step only also tells which branches ran.
  const failed = new Map<string, string[]>();
  const taken = new Map<string, Branch>();
  for (const e of run.errors) {
    const { label, message } = splitError(e);
    const hits = all.filter((x) => STEP_LABELS[x.step.type] === label);
    for (const h of hits) {
      const k = nodeKey(h.path, h.index);
      failed.set(k, [...(failed.get(k) ?? []), message]);
    }
    if (hits.length === 1) {
      const p = hits[0]!.path;
      p.forEach((hop, i) => taken.set(nodeKey(p.slice(0, i), hop.index), hop.branch));
    }
  }

  const canStop = (list: readonly Step[]) => walk(list).some((x) => x.step.type === 'stop');

  /** `ran`: the list ran (true), didn't (false) or can't tell (null). Returns how the run carried on after it. */
  const visit = (list: readonly Step[], path: ListPath, ran: boolean | null): Flow => {
    let flow: Flow = ran === true ? 'go' : ran === false ? 'stopped' : 'unknown';
    list.forEach((step, index) => {
      const key = nodeKey(path, index);
      const errors = failed.get(key);
      if (errors) out[key] = { state: 'failed', errors };
      else if (flow === 'go') out[key] = { state: 'ok', errors: [] };
      else if (flow === 'stopped') out[key] = { state: 'skipped', errors: [] };
      const here = flow === 'go' ? true : flow === 'stopped' ? false : null;
      if (step.type === 'if') {
        const branch = here === true ? taken.get(key) : undefined;
        const lane = (b: Branch) => (here === true ? (branch ? branch === b : null) : here);
        const a = visit(step.then, child(path, index, 'then'), lane('then'));
        const b = visit(step.else, child(path, index, 'else'), lane('else'));
        if (here !== true) return;
        const after = (res: Flow, list: readonly Step[]) => (canStop(list) ? res : 'go');
        const inner =
          branch === 'then' ? a : branch === 'else' ? b : after(a, step.then) === 'go' && after(b, step.else) === 'go' ? 'go' : 'unknown';
        if (inner !== 'go') flow = inner;
      } else if (step.type === 'stop' && here === true) {
        flow = 'stopped';
      }
    });
    return flow;
  };
  visit(action.steps, [], true);

  action.triggers.forEach((t, i) => {
    if (triggerMatches(t, run.trigger)) out[triggerKey(i)] = { state: run.ok ? 'ok' : 'failed', errors: [] };
  });
  return out;
}
