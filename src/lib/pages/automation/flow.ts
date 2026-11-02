// Layout of the flow view: places triggers and steps on a grid of lanes.
// Rows grow with their content in CSS; this only decides which row and columns each piece uses.
import type { Step } from '$lib/bindings/Step';
import { child, stepKey, type ListPath } from './tree';

interface Box {
  row: number;
  col: number;
  span: number;
}

export interface NodeCell extends Box {
  kind: 'node';
  /** "s.2.then.0" */
  key: string;
  path: ListPath;
  index: number;
  step: Step;
  /** Shown on the node: "3", "3.1" ... */
  number: string;
}

/** Add point at the end of a list. */
export interface EndCell extends Box {
  kind: 'end';
  path: ListPath;
  /** Index a new step gets. */
  index: number;
  /** The list has no steps. */
  empty: boolean;
}

/** Where an if-step splits into its two lanes, and where they meet again. */
export interface ForkCell extends Box {
  kind: 'split' | 'join';
  key: string;
  /** Columns used by the Then lane; the rest is Otherwise. */
  then: number;
}

/** Line that carries a shorter lane down to where the lanes join, rows `row` to `rowEnd` (exclusive). */
export interface RailCell extends Box {
  kind: 'rail';
  path: ListPath;
  rowEnd: number;
}

export interface TriggersCell extends Box {
  kind: 'triggers';
}

export type FlowCell = NodeCell | EndCell | ForkCell | RailCell | TriggersCell;

export interface FlowLayout {
  cells: FlowCell[];
  /** Step nodes in reading order. */
  nodes: NodeCell[];
  cols: number;
  rows: number;
}

export const triggerKey = (i: number) => `t.${i}`;
export const nodeKey = (path: ListPath, index: number) => `s.${stepKey(path, index)}`;

/** Columns a list needs: one, or more when it holds if-steps side by side. */
export function listWidth(steps: readonly Step[]): number {
  return Math.max(1, ...steps.map((s) => (s.type === 'if' ? listWidth(s.then) + listWidth(s.else) : 1)));
}

/** Places a list from `row` down; returns the first free row. */
function placeList(steps: readonly Step[], path: ListPath, col: number, span: number, row: number, prefix: string, out: FlowLayout): number {
  steps.forEach((step, index) => {
    const number = prefix ? `${prefix}.${index + 1}` : String(index + 1);
    const key = nodeKey(path, index);
    const node: NodeCell = { kind: 'node', key, path, index, step, number, row: row++, col, span };
    out.cells.push(node);
    out.nodes.push(node);
    if (step.type !== 'if') return;
    const wt = listWidth(step.then);
    const extra = span - wt - listWidth(step.else);
    const then = wt + Math.floor(extra / 2);
    out.cells.push({ kind: 'split', key, row: row++, col, span, then });
    const lanes = [
      { path: child(path, index, 'then'), list: step.then, col, span: then },
      { path: child(path, index, 'else'), list: step.else, col: col + then, span: span - then }
    ].map((l) => ({ ...l, end: placeList(l.list, l.path, l.col, l.span, row, number, out) }));
    row = Math.max(...lanes.map((l) => l.end));
    for (const l of lanes) {
      if (l.end < row) out.cells.push({ kind: 'rail', path: l.path, row: l.end, rowEnd: row, col: l.col, span: l.span });
    }
    out.cells.push({ kind: 'join', key, row: row++, col, span, then });
  });
  out.cells.push({ kind: 'end', path, index: steps.length, empty: steps.length === 0, row: row++, col, span });
  return row;
}

export function layoutFlow(steps: readonly Step[], triggers: number): FlowLayout {
  const cols = Math.max(listWidth(steps), Math.min(Math.max(triggers, 1), 4));
  const out: FlowLayout = { cells: [{ kind: 'triggers', row: 0, col: 0, span: cols }], nodes: [], cols, rows: 0 };
  out.rows = placeList(steps, [], 0, cols, 1, '', out);
  return out;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

const overlap = (a: Box, b: Box) => Math.min(a.col + a.span, b.col + b.span) - Math.max(a.col, b.col);
const centre = (b: Box) => b.col + b.span / 2;

/** Key of the node next to `key` in a direction, for arrow-key moves. Null when there is none. */
export function neighbour(layout: FlowLayout, triggers: number, key: string, dir: Direction): string | null {
  if (key.startsWith('t.')) {
    const i = Number(key.slice(2));
    if (dir === 'left') return i > 0 ? triggerKey(i - 1) : null;
    if (dir === 'right') return i < triggers - 1 ? triggerKey(i + 1) : null;
    if (dir === 'down') return layout.nodes.find((n) => n.path.length === 0)?.key ?? null;
    return null;
  }
  const from = layout.nodes.find((n) => n.key === key);
  if (!from) return null;
  let best: NodeCell | null = null;
  let score = Infinity;
  for (const n of layout.nodes) {
    if (n === from) continue;
    let s: number;
    if (dir === 'up' || dir === 'down') {
      const dr = dir === 'up' ? from.row - n.row : n.row - from.row;
      if (dr <= 0 || overlap(n, from) <= 0) continue;
      s = dr * 1000 + Math.abs(centre(n) - centre(from)) * 10 + n.col;
    } else {
      const dc = dir === 'left' ? from.col - (n.col + n.span) : n.col - (from.col + from.span);
      if (dc < 0) continue;
      s = Math.abs(n.row - from.row) * 1000 + dc * 10;
    }
    if (s < score) {
      score = s;
      best = n;
    }
  }
  if (!best && dir === 'up' && triggers > 0) return triggerKey(0);
  return best?.key ?? null;
}
