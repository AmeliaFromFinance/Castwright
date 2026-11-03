// What a run did at a node.
export type NodeState = 'ok' | 'failed' | 'skipped';

export interface NodeStatus {
  state: NodeState;
  errors: string[];
}
