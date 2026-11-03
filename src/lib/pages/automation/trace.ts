// Following a run node by node, live while it runs or afterwards from the history.
import type { ActionRun } from '$lib/bindings/ActionRun';
import type { RunProgress } from '$lib/bindings/RunProgress';
import type { NodeStatus } from './runstatus';

/** Finished runs kept per action. */
export const HISTORY_KEEP = 10;

export interface TraceStep {
  node: string;
  /** Line taken to get here; null where the run started. */
  via: string | null;
  state: 'running' | 'ok' | 'failed';
}

export interface Trace<R extends ActionRun = ActionRun> {
  runId: number;
  actionId: string;
  steps: TraceStep[];
  /** The finished run, once it reports back. */
  run: R | null;
}

const stateOf = (s: string): TraceStep['state'] => (s === 'error' ? 'failed' : 'ok');

/** Add one progress message. A message for another run starts a new trace. */
export function applyProgress<R extends ActionRun>(t: Trace<R> | undefined, p: RunProgress): Trace<R> {
  const cur: Trace<R> = t && t.runId === p.run_id ? t : { runId: p.run_id, actionId: p.action_id, steps: [], run: null };
  const steps = [...cur.steps];
  if (p.state === null) {
    steps.push({ node: p.node_id, via: p.via, state: 'running' });
  } else {
    let i = steps.length - 1;
    while (i >= 0 && !(steps[i]!.node === p.node_id && steps[i]!.state === 'running')) i--;
    if (i >= 0) steps[i] = { ...steps[i]!, state: stateOf(p.state) };
    else steps.push({ node: p.node_id, via: p.via, state: stateOf(p.state) });
  }
  return { ...cur, steps };
}

/** The finished run. Its own list of steps wins over what arrived live. */
export function finishTrace<R extends ActionRun>(run: R): Trace<R> {
  return {
    runId: run.run_id,
    actionId: run.action_id,
    steps: (run.steps ?? []).map((s) => ({ node: s.node_id, via: s.via, state: stateOf(s.state) })),
    run
  };
}

/** Newest first, at most `keep`. A run already in the list is replaced. */
export function addToHistory<T extends Trace>(list: T[] | undefined, t: T, keep = HISTORY_KEEP): T[] {
  return [t, ...(list ?? []).filter((x) => x.runId !== t.runId)].slice(0, keep);
}

export type TraceState = NodeStatus['state'] | 'running';

export interface TraceView {
  /** Status of each node reached so far. */
  nodes: Map<string, { state: TraceState; errors: string[] }>;
  /** Lines taken so far. */
  edges: Set<string>;
  /** Line taken by the latest step. */
  latest: string | null;
  /** Node of the step being looked at, when stepping through. */
  current: string | null;
}

/**
 * What a trace shows up to step `upto` (all of it when left out). Skipped nodes
 * and error messages only show once the whole finished run is in view.
 */
export function traceView(t: Trace | undefined | null, upto?: number): TraceView {
  const out: TraceView = { nodes: new Map(), edges: new Set(), latest: null, current: null };
  if (!t) return out;
  const last = upto === undefined ? t.steps.length - 1 : Math.min(upto, t.steps.length - 1);
  for (let i = 0; i <= last; i++) {
    const s = t.steps[i]!;
    if (s.via) out.edges.add(s.via);
    const prev = out.nodes.get(s.node)?.state;
    // A node that failed once stays failed; one running again shows as running.
    const state = prev === 'failed' && s.state !== 'running' ? 'failed' : s.state;
    out.nodes.set(s.node, { state, errors: [] });
  }
  const s = t.steps[last];
  out.latest = s?.via ?? null;
  if (upto !== undefined) out.current = s?.node ?? null;
  if (t.run && last === t.steps.length - 1) {
    for (const n of t.run.nodes ?? []) {
      if (n.state === 'skipped' && !out.nodes.has(n.node_id)) out.nodes.set(n.node_id, { state: 'skipped', errors: [] });
      const got = out.nodes.get(n.node_id);
      if (got && n.errors.length) got.errors = n.errors;
    }
  }
  return out;
}
