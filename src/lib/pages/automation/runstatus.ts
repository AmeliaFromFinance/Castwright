// What the latest run did at each node, from the results the engine reports.
import type { ActionRun } from '$lib/bindings/ActionRun';

export type NodeState = 'ok' | 'failed' | 'skipped';

export interface NodeStatus {
  state: NodeState;
  errors: string[];
}

/** Status by node id, in the order the run reached them. */
export function runStatus(run: ActionRun): Map<string, NodeStatus> {
  const out = new Map<string, NodeStatus>();
  for (const n of run.nodes ?? [])
    out.set(n.node_id, { state: n.state === 'error' ? 'failed' : n.state, errors: n.errors });
  return out;
}
