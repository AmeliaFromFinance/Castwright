// The action graph: nodes placed anywhere, joined by lines from any side to any side.
// Pure functions; the editor applies them through the store.
import type { Action } from '$lib/bindings/Action';
import type { EdgeBranch } from '$lib/bindings/EdgeBranch';
import type { EdgeSide } from '$lib/bindings/EdgeSide';
import type { Graph } from '$lib/bindings/Graph';
import type { GraphEdge } from '$lib/bindings/GraphEdge';
import type { GraphFrame } from '$lib/bindings/GraphFrame';
import type { GraphNode } from '$lib/bindings/GraphNode';
import type { GraphNote } from '$lib/bindings/GraphNote';
import type { NodeResult } from '$lib/bindings/NodeResult';
import type { RunStep } from '$lib/bindings/RunStep';
import type { Step } from '$lib/bindings/Step';
import type { Trigger } from '$lib/bindings/Trigger';
import { newId } from '$lib/editors/ids';

export const NODE_W = 280;
export const GRID = 16;
/** Height used until a node has been measured. */
export const DEFAULT_H = 96;
/** Most nodes one run may go through; same as MAX_NODE_RUNS in Rust. */
export const MAX_NODE_RUNS = 500;
export const SIDES: readonly EdgeSide[] = ['top', 'right', 'bottom', 'left'];

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Measured node heights by id. */
export type Sizes = Readonly<Record<string, number>>;

// Queries

export const isTrigger = (n: GraphNode): boolean => n.kind.type === 'trigger';
export const stepOf = (n: GraphNode | undefined): Step | null => (n?.kind.type === 'step' ? n.kind.step : null);
export const triggerOf = (n: GraphNode | undefined): Trigger | null => (n?.kind.type === 'trigger' ? n.kind.trigger : null);
export const isIf = (n: GraphNode | undefined): boolean => stepOf(n)?.type === 'if';

export function nodeById(g: Graph, id: string): GraphNode | undefined {
  return g.nodes.find((n) => n.id === id);
}

export function triggerNodes(g: Graph): GraphNode[] {
  return g.nodes.filter(isTrigger);
}

/** Keep `triggers` equal to the trigger nodes, as Rust does on save. */
export function syncTriggers(a: Action): void {
  a.triggers = a.graph.nodes.flatMap((n) => (n.kind.type === 'trigger' ? [n.kind.trigger] : []));
  a.steps = [];
}

/** Every step in the graph. */
export function graphSteps(g: Graph): Step[] {
  return g.nodes.flatMap((n) => (n.kind.type === 'step' ? [n.kind.step] : []));
}

function byPosition(g: Graph): (a: string, b: string) => number {
  const pos = new Map(g.nodes.map((n) => [n.id, n]));
  return (a, b) => {
    const na = pos.get(a);
    const nb = pos.get(b);
    if (!na || !nb) return na ? -1 : nb ? 1 : 0;
    return na.y - nb.y || na.x - nb.x;
  };
}

/** Lines leaving a node, in the order a run follows them: top to bottom, then left to right. */
export function outgoing(g: Graph, id: string): GraphEdge[] {
  const cmp = byPosition(g);
  return g.edges.filter((e) => e.from === id).sort((a, b) => cmp(a.to, b.to));
}

export interface StartPlan {
  fired: string[];
  first: string[];
}

/** Same rules as Graph::start_plan in Rust. `trigger` null is a manual run. */
export function startPlan(g: Graph, trigger: number | null): StartPlan {
  const triggers = triggerNodes(g);
  let chosen: GraphNode[];
  if (trigger !== null) chosen = triggers[trigger] ? [triggers[trigger]!] : [];
  else {
    const manual = triggers.find((n) => triggerOf(n)?.type === 'manual');
    chosen = manual ? [manual] : triggers;
  }
  const cmp = byPosition(g);
  if (!chosen.length) {
    if (trigger !== null || triggers.length) return { fired: [], first: [] };
    const ledTo = new Set(g.edges.map((e) => e.to));
    return { fired: [], first: g.nodes.filter((n) => !ledTo.has(n.id)).map((n) => n.id).sort(cmp) };
  }
  const first: string[] = [];
  for (const t of chosen)
    for (const e of outgoing(g, t.id)) if (chosen.length === 1 || !first.includes(e.to)) first.push(e.to);
  if (chosen.length > 1) first.sort(cmp);
  return { fired: chosen.map((n) => n.id), first };
}

export function reachable(g: Graph, from: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const stack = [...from];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of g.edges) if (e.from === id) stack.push(e.to);
  }
  return seen;
}

/** Step nodes no trigger leads to. Without triggers every node can run from Test. */
export function unreachable(g: Graph): string[] {
  const triggers = triggerNodes(g);
  if (!triggers.length) return [];
  const ok = reachable(
    g,
    triggers.map((n) => n.id)
  );
  return g.nodes.filter((n) => !ok.has(n.id)).map((n) => n.id);
}

/**
 * Walk a run the way the engine does, for the demo backend and tests. `test` decides If
 * steps; every other step works. `onStep` sees each step as it runs.
 */
export function planRun(
  g: Graph,
  trigger: number | null,
  test: (step: Extract<Step, { type: 'if' }>) => boolean,
  opts: { budget?: number; onStep?: (step: Step) => void } = {}
): { nodes: NodeResult[]; errors: string[]; order: string[]; steps: RunStep[] } {
  let budget = opts.budget ?? MAX_NODE_RUNS;
  const plan = startPlan(g, trigger);
  const nodes: NodeResult[] = plan.fired.map((node_id) => ({ node_id, state: 'ok', errors: [] }));
  const steps: RunStep[] = plan.fired.map((node_id) => ({ node_id, via: null, state: 'ok' }));
  const errors: string[] = [];
  const order: string[] = [];
  // Each entry is a node and the line that led to it.
  const stack: Array<[string, string | null]> = plan.first
    .map((id): [string, string | null] => [id, g.edges.find((e) => e.to === id && plan.fired.includes(e.from))?.id ?? null])
    .reverse();
  while (stack.length) {
    const [id, via] = stack.pop()!;
    const n = nodeById(g, id);
    if (!n) continue;
    if (budget-- <= 0) {
      errors.push(`Stopped after ${MAX_NODE_RUNS} steps. The flow probably loops back on itself.`);
      break;
    }
    order.push(id);
    steps.push({ node_id: id, via, state: 'ok' });
    if (!nodes.some((r) => r.node_id === id)) nodes.push({ node_id: id, state: 'ok', errors: [] });
    const s = stepOf(n);
    if (s) opts.onStep?.(s);
    if (s?.type === 'stop') break;
    const yes = s?.type === 'if' ? test(s) : null;
    const next = outgoing(g, id).filter((e) => e.branch === 'next' || yes === null || (e.branch === 'then') === yes);
    for (let i = next.length - 1; i >= 0; i--) stack.push([next[i]!.to, next[i]!.id]);
  }
  const ran = new Set(nodes.map((r) => r.node_id));
  const reach = reachable(g, [...plan.fired, ...plan.first]);
  for (const n of g.nodes) if (reach.has(n.id) && !ran.has(n.id)) nodes.push({ node_id: n.id, state: 'skipped', errors: [] });
  return { nodes, errors, order, steps };
}

// Geometry

export const NORMAL: Record<EdgeSide, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 }
};

export const OPPOSITE: Record<EdgeSide, EdgeSide> = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' };

export function nodeRect(n: GraphNode, sizes: Sizes): Rect {
  return { x: n.x, y: n.y, w: NODE_W, h: sizes[n.id] ?? DEFAULT_H };
}

/** Middle of one side of a rectangle. */
export function anchor(r: Rect, side: EdgeSide): Point {
  switch (side) {
    case 'top':
      return { x: r.x + r.w / 2, y: r.y };
    case 'right':
      return { x: r.x + r.w, y: r.y + r.h / 2 };
    case 'bottom':
      return { x: r.x + r.w / 2, y: r.y + r.h };
    case 'left':
      return { x: r.x, y: r.y + r.h / 2 };
  }
}

export interface Curve {
  a: Point;
  c1: Point;
  c2: Point;
  b: Point;
}

/**
 * Bezier from `a` to `b` that leaves and enters at right angles to the sides. With no
 * end side (a line following the pointer) it bends toward the pointer.
 */
export function curve(a: Point, from: EdgeSide, b: Point, to: EdgeSide | null): Curve {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const d = Math.max(36, Math.min(180, dist * 0.45));
  const n1 = NORMAL[from];
  const c1 = { x: a.x + n1.x * d, y: a.y + n1.y * d };
  const c2 = to ? { x: b.x + NORMAL[to].x * d, y: b.y + NORMAL[to].y * d } : { x: b.x - (b.x - c1.x) * 0.3, y: b.y - (b.y - c1.y) * 0.3 };
  return { a, c1, c2, b };
}

export const ARROW = 9;

/** The curve for a line between two nodes, stopping short of the target for the arrowhead. */
export function edgeCurve(from: Rect, fromSide: EdgeSide, to: Rect, toSide: EdgeSide): Curve {
  const tip = anchor(to, toSide);
  const n = NORMAL[toSide];
  return curve(anchor(from, fromSide), fromSide, { x: tip.x + n.x * ARROW, y: tip.y + n.y * ARROW }, toSide);
}

export function pathOf(c: Curve): string {
  const f = (p: Point) => `${round(p.x)} ${round(p.y)}`;
  return `M ${f(c.a)} C ${f(c.c1)} ${f(c.c2)} ${f(c.b)}`;
}

const round = (n: number) => Math.round(n * 10) / 10;

export function pointAt(c: Curve, t: number): Point {
  const u = 1 - t;
  const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const;
  return {
    x: k[0] * c.a.x + k[1] * c.c1.x + k[2] * c.c2.x + k[3] * c.b.x,
    y: k[0] * c.a.y + k[1] * c.c1.y + k[2] * c.c2.y + k[3] * c.b.y
  };
}

/** Triangle pointing into `side` of a node with its tip at `tip`. */
export function arrowHead(tip: Point, side: EdgeSide, size = ARROW): string {
  const n = NORMAL[side];
  const base = { x: tip.x + n.x * size, y: tip.y + n.y * size };
  const w = size * 0.6;
  const p1 = { x: base.x - n.y * w, y: base.y + n.x * w };
  const p2 = { x: base.x + n.y * w, y: base.y - n.x * w };
  return [tip, p1, p2].map((p) => `${round(p.x)},${round(p.y)}`).join(' ');
}

/** Side of `r` closest to `p`. */
export function nearestSide(r: Rect, p: Point): EdgeSide {
  const d: Array<[EdgeSide, number]> = [
    ['top', Math.abs(p.y - r.y)],
    ['right', Math.abs(r.x + r.w - p.x)],
    ['bottom', Math.abs(r.y + r.h - p.y)],
    ['left', Math.abs(p.x - r.x)]
  ];
  return d.reduce((best, cur) => (cur[1] < best[1] ? cur : best))[0];
}

export function contains(r: Rect, p: Point, pad = 0): boolean {
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
}

/** Topmost node under the point (later nodes are drawn on top). */
export function hitNode(g: Graph, sizes: Sizes, p: Point, exclude?: string): string | null {
  for (let i = g.nodes.length - 1; i >= 0; i--) {
    const n = g.nodes[i]!;
    if (n.id !== exclude && contains(nodeRect(n, sizes), p)) return n.id;
  }
  return null;
}

/** Closest side handle within `radius` of the point. */
export function hitHandle(g: Graph, sizes: Sizes, p: Point, radius: number, exclude?: string): { id: string; side: EdgeSide } | null {
  let best: { id: string; side: EdgeSide; d: number } | null = null;
  for (const n of g.nodes) {
    if (n.id === exclude) continue;
    const r = nodeRect(n, sizes);
    if (!contains(r, p, radius)) continue;
    for (const side of SIDES) {
      const a = anchor(r, side);
      const d = Math.hypot(a.x - p.x, a.y - p.y);
      if (d <= radius && (!best || d < best.d)) best = { id: n.id, side, d };
    }
  }
  return best ? { id: best.id, side: best.side } : null;
}

/** Where a line dropped at `p` connects: a handle near it, else the nearest side of the node under it. */
export function dropTarget(g: Graph, sizes: Sizes, p: Point, radius: number, from: string): { id: string; side: EdgeSide } | null {
  const h = hitHandle(g, sizes, p, radius, from);
  if (h) return h;
  const id = hitNode(g, sizes, p, from);
  const n = id ? nodeById(g, id) : undefined;
  return n ? { id: n.id, side: nearestSide(nodeRect(n, sizes), p) } : null;
}

export function rectFrom(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

/** Nodes touched by a selection box. */
export function inBox(g: Graph, sizes: Sizes, box: Rect): string[] {
  return g.nodes.filter((n) => intersects(nodeRect(n, sizes), box)).map((n) => n.id);
}

export function snap(v: number, grid = GRID): number {
  return Math.round(v / grid) * grid;
}

export function bounds(nodes: readonly GraphNode[], sizes: Sizes): Rect | null {
  if (!nodes.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const n of nodes) {
    const r = nodeRect(n, sizes);
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Top-left for a new node so the middle of `side` lands on `p`. */
export function placeBySide(p: Point, side: EdgeSide, h = DEFAULT_H): Point {
  switch (side) {
    case 'top':
      return { x: p.x - NODE_W / 2, y: p.y };
    case 'right':
      return { x: p.x - NODE_W, y: p.y - h / 2 };
    case 'bottom':
      return { x: p.x - NODE_W / 2, y: p.y - h };
    case 'left':
      return { x: p.x, y: p.y - h / 2 };
  }
}

/** Move `p` down and right until no node starts there. */
export function freeSpot(g: Graph, p: Point): Point {
  let q = { ...p };
  for (let i = 0; i < 50 && g.nodes.some((n) => Math.abs(n.x - q.x) < 24 && Math.abs(n.y - q.y) < 24); i++)
    q = { x: q.x + 32, y: q.y + 32 };
  return q;
}

// Editing

/** Branch for a new line: from an If, Then first, then Otherwise. */
export function defaultBranch(g: Graph, from: string): EdgeBranch {
  if (!isIf(nodeById(g, from))) return 'next';
  const out = g.edges.filter((e) => e.from === from);
  if (!out.some((e) => e.branch === 'then')) return 'then';
  if (!out.some((e) => e.branch === 'otherwise')) return 'otherwise';
  return 'then';
}

export function nextBranch(b: EdgeBranch): EdgeBranch {
  return b === 'then' ? 'otherwise' : b === 'otherwise' ? 'next' : 'then';
}

export interface NewEdge {
  from: string;
  from_side: EdgeSide;
  to: string;
  to_side: EdgeSide;
  branch?: EdgeBranch;
}

/** Add a line. Null when it would join a node to itself or repeat an existing line. */
export function addEdge(g: Graph, e: NewEdge): { graph: Graph; edge: GraphEdge } | null {
  if (e.from === e.to || !nodeById(g, e.from) || !nodeById(g, e.to)) return null;
  if (g.edges.some((x) => x.from === e.from && x.to === e.to && x.from_side === e.from_side && x.to_side === e.to_side)) return null;
  const edge: GraphEdge = { id: newId(), ...e, branch: e.branch ?? defaultBranch(g, e.from) };
  return { graph: { ...g, edges: [...g.edges, edge] }, edge };
}

/** Remove nodes, notes and frames, and the lines to removed nodes. Frames lose removed members. */
export function removeNodes(g: Graph, ids: Iterable<string>): Graph {
  const gone = new Set(ids);
  return {
    nodes: g.nodes.filter((n) => !gone.has(n.id)),
    edges: g.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)),
    notes: (g.notes ?? []).filter((n) => !gone.has(n.id)),
    frames: (g.frames ?? []).filter((f) => !gone.has(f.id)).map((f) => ({ ...f, members: f.members.filter((m) => !gone.has(m)) }))
  };
}

export function removeEdges(g: Graph, ids: Iterable<string>): Graph {
  const gone = new Set(ids);
  return { ...g, edges: g.edges.filter((e) => !gone.has(e.id)) };
}

export function moveNodes(g: Graph, to: ReadonlyMap<string, Point>): Graph {
  return { ...g, nodes: g.nodes.map((n) => (to.has(n.id) ? { ...n, ...to.get(n.id)! } : n)) };
}

export interface Clip {
  nodes: GraphNode[];
  edges: GraphEdge[];
  notes?: GraphNote[];
  frames?: GraphFrame[];
}

/** The items and the lines between their nodes. A frame brings everything inside it. */
export function copyNodes(g: Graph, ids: Iterable<string>): Clip {
  const set = new Set(ids);
  const frames = (g.frames ?? []).filter((f) => set.has(f.id));
  for (const f of frames) for (const m of f.members) set.add(m);
  return {
    nodes: structuredClone(g.nodes.filter((n) => set.has(n.id))),
    edges: structuredClone(g.edges.filter((e) => set.has(e.from) && set.has(e.to))),
    notes: structuredClone((g.notes ?? []).filter((n) => set.has(n.id))),
    frames: structuredClone(frames.map((f) => ({ ...f, members: f.members.filter((m) => set.has(m)) })))
  };
}

const clipItems = (clip: Clip): Point[] => [...clip.nodes, ...(clip.notes ?? []), ...(clip.frames ?? [])];

/** Add a copy of `clip` with new ids, its top-left corner at `at`. Returns the new ids. */
export function pasteClip(g: Graph, clip: Clip, at: Point): { graph: Graph; ids: string[] } {
  const items = clipItems(clip);
  if (!items.length) return { graph: g, ids: [] };
  const x0 = Math.min(...items.map((n) => n.x));
  const y0 = Math.min(...items.map((n) => n.y));
  const ids = new Map<string, string>();
  const place = <T extends { id: string; x: number; y: number }>(n: T): T => {
    const id = newId();
    ids.set(n.id, id);
    return { ...structuredClone(n), id, x: n.x - x0 + at.x, y: n.y - y0 + at.y };
  };
  const nodes = clip.nodes.map(place);
  const notes = (clip.notes ?? []).map(place);
  const frames = (clip.frames ?? []).map(place).map((f) => ({ ...f, members: f.members.flatMap((m) => (ids.has(m) ? [ids.get(m)!] : [])) }));
  const edges = clip.edges
    .filter((e) => ids.has(e.from) && ids.has(e.to))
    .map((e) => ({ ...e, id: newId(), from: ids.get(e.from)!, to: ids.get(e.to)! }));
  return {
    graph: {
      nodes: [...g.nodes, ...nodes],
      edges: [...g.edges, ...edges],
      notes: [...(g.notes ?? []), ...notes],
      frames: [...(g.frames ?? []), ...frames]
    },
    ids: [...nodes, ...notes, ...frames].map((n) => n.id)
  };
}

/** Copy items in place, shifted by `offset`, keeping the lines between them. */
export function duplicateNodes(g: Graph, ids: Iterable<string>, offset: Point = { x: GRID * 2, y: GRID * 2 }): { graph: Graph; ids: string[] } {
  const clip = copyNodes(g, ids);
  const items = clipItems(clip);
  if (!items.length) return { graph: g, ids: [] };
  const x0 = Math.min(...items.map((n) => n.x));
  const y0 = Math.min(...items.map((n) => n.y));
  return pasteClip(g, clip, { x: x0 + offset.x, y: y0 + offset.y });
}

// Building

/** Older step lists as a graph; same shape as graph_from_tree in Rust, without the layout. */
export function fromTree(triggers: readonly Trigger[], steps: readonly Step[]): Graph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const link = (from: string, branch: EdgeBranch, to: string) =>
    edges.push({ id: newId(), from, from_side: 'bottom', to, to_side: 'top', branch });
  const open: Array<[string, EdgeBranch]> = triggers.map((trigger) => {
    const id = newId();
    nodes.push({ id, x: 0, y: 0, kind: { type: 'trigger', trigger: structuredClone(trigger) } });
    return [id, 'next'];
  });
  const list = (steps: readonly Step[], preds: Array<[string, EdgeBranch]>): Array<[string, EdgeBranch]> => {
    for (const s of steps) {
      const id = newId();
      for (const [p, b] of preds) link(p, b, id);
      const step: Step = s.type === 'if' ? { ...structuredClone(s), then: [], else: [] } : structuredClone(s);
      nodes.push({ id, x: 0, y: 0, kind: { type: 'step', step } });
      if (s.type === 'if') preds = [...list(s.then, [[id, 'then']]), ...list(s.else, [[id, 'otherwise']])];
      else preds = s.type === 'stop' ? [] : [[id, 'next']];
    }
    return preds;
  };
  list(steps, open);
  return tidy({ nodes, edges, notes: [], frames: [] }, {});
}

// Tidy up

const GAP_X = 48;
const GAP_Y = 72;

/**
 * Layered layout: triggers on top, each node below the nodes that lead to it, the two
 * branches of an If side by side (Then left). Lines are redrawn top to bottom, loops
 * back on the right. The drawing keeps its top-left corner.
 */
export function tidy(g: Graph, sizes: Sizes, widths: Sizes = {}): Graph {
  if (!g.nodes.length) return g;
  const wOf = (id: string) => widths[id] ?? NODE_W;
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const rank: Record<EdgeBranch, number> = { then: 0, next: 1, otherwise: 2 };
  const out = new Map<string, GraphEdge[]>();
  for (const n of g.nodes) out.set(n.id, []);
  for (const e of g.edges) out.get(e.from)?.push(e);
  for (const list of out.values()) list.sort((a, b) => rank[a.branch] - rank[b.branch] || byId.get(a.to)!.x - byId.get(b.to)!.x);

  // Depth first from triggers, then from nodes nothing leads to, then whatever is left.
  const ledTo = new Set(g.edges.map((e) => e.to));
  const lr = (a: GraphNode, b: GraphNode) => a.x - b.x || a.y - b.y;
  const roots = [
    ...g.nodes.filter(isTrigger).sort(lr),
    ...g.nodes.filter((n) => !isTrigger(n) && !ledTo.has(n.id)).sort(lr),
    ...[...g.nodes].sort((a, b) => a.y - b.y || a.x - b.x)
  ];
  const seen = new Map<string, number>();
  const onStack = new Set<string>();
  const back = new Set<string>();
  const visit = (id: string) => {
    seen.set(id, seen.size);
    onStack.add(id);
    for (const e of out.get(id)!) {
      if (onStack.has(e.to)) back.add(e.id);
      else if (!seen.has(e.to)) visit(e.to);
    }
    onStack.delete(id);
  };
  for (const r of roots) if (!seen.has(r.id)) visit(r.id);

  // Longest path layers over the lines that go forward.
  const fwd = g.edges.filter((e) => !back.has(e.id));
  const layer = new Map<string, number>(g.nodes.map((n) => [n.id, 0]));
  const indeg = new Map<string, number>(g.nodes.map((n) => [n.id, 0]));
  for (const e of fwd) indeg.set(e.to, indeg.get(e.to)! + 1);
  const queue = g.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of fwd)
      if (e.from === id) {
        layer.set(e.to, Math.max(layer.get(e.to)!, layer.get(id)! + 1));
        indeg.set(e.to, indeg.get(e.to)! - 1);
        if (indeg.get(e.to) === 0) queue.push(e.to);
      }
  }

  const layers: string[][] = [];
  for (const n of [...g.nodes].sort((a, b) => seen.get(a.id)! - seen.get(b.id)!)) (layers[layer.get(n.id)!] ??= []).push(n.id);
  const parents = new Map<string, Array<{ from: string; branch: EdgeBranch }>>();
  for (const e of fwd) parents.set(e.to, [...(parents.get(e.to) ?? []), { from: e.from, branch: e.branch }]);

  // Order each layer by where its parents are, Then before Otherwise.
  const bias = (b: EdgeBranch) => (b === 'then' ? -0.3 : b === 'otherwise' ? 0.3 : 0);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < layers.length; i++) {
      const prev = new Map((layers[i - 1] ?? []).map((id, j) => [id, j]));
      const key = (id: string) => {
        const ps = (parents.get(id) ?? []).filter((p) => prev.has(p.from));
        return ps.length ? ps.reduce((s, p) => s + prev.get(p.from)! + bias(p.branch), 0) / ps.length : Infinity;
      };
      const keys = new Map((layers[i] ?? []).map((id, j) => [id, [key(id), j] as const]));
      layers[i]?.sort((a, b) => keys.get(a)![0] - keys.get(b)![0] || keys.get(a)![1] - keys.get(b)![1]);
    }
  }

  // x: under the parents, then spread so nothing overlaps.
  const span = NODE_W + GAP_X;
  const apart = (a: string, b: string) => (wOf(a) + wOf(b)) / 2 + GAP_X;
  const cx = new Map<string, number>();
  for (const ids of layers) {
    if (!ids) continue;
    const want = ids.map((id, j) => {
      const ps = (parents.get(id) ?? []).filter((p) => cx.has(p.from));
      if (!ps.length) return j * span;
      const shift = (b: EdgeBranch) => (b === 'then' ? -span / 2 : b === 'otherwise' ? span / 2 : 0);
      return ps.reduce((s, p) => s + cx.get(p.from)! + shift(p.branch), 0) / ps.length;
    });
    const a = [...want];
    for (let j = 1; j < a.length; j++) a[j] = Math.max(a[j]!, a[j - 1]! + apart(ids[j - 1]!, ids[j]!));
    const b = [...want];
    for (let j = b.length - 2; j >= 0; j--) b[j] = Math.min(b[j]!, b[j + 1]! - apart(ids[j]!, ids[j + 1]!));
    ids.forEach((id, j) => cx.set(id, (a[j]! + b[j]!) / 2));
  }

  // y: each layer below the tallest node of the one before.
  const ys: number[] = [];
  let y = 0;
  for (const ids of layers) {
    ys.push(y);
    y += Math.max(DEFAULT_H, ...(ids ?? []).map((id) => sizes[id] ?? DEFAULT_H)) + GAP_Y;
  }

  const box = (list: readonly GraphNode[]) => ({
    x: Math.min(...list.map((n) => n.x)),
    y: Math.min(...list.map((n) => n.y))
  });
  const old = box(g.nodes);
  const placed = g.nodes.map((n) => ({ ...n, x: cx.get(n.id)! - wOf(n.id) / 2, y: ys[layer.get(n.id)!]! }));
  const now = box(placed);
  const dx = snap(old.x - now.x);
  const dy = snap(old.y - now.y);
  return {
    ...g,
    nodes: placed.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy })),
    edges: g.edges.map((e) =>
      back.has(e.id) ? { ...e, from_side: 'right', to_side: 'right' } : { ...e, from_side: 'bottom', to_side: 'top' }
    )
  };
}
