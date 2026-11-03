// Sticky notes and frames on the flow canvas. Runs ignore both; they only help people read
// the flow. Frames hold nodes and notes by id; dragging a frame moves what's inside.
import type { CanvasColor } from '$lib/bindings/CanvasColor';
import type { Graph } from '$lib/bindings/Graph';
import type { GraphEdge } from '$lib/bindings/GraphEdge';
import type { GraphFrame } from '$lib/bindings/GraphFrame';
import type { GraphNode } from '$lib/bindings/GraphNode';
import type { GraphNote } from '$lib/bindings/GraphNote';
import { newId } from '$lib/editors/ids';
import { contains, intersects, nodeRect, snap, tidy, type Point, type Rect, type Sizes } from './graph';

/** Height of a frame's title bar, and of a collapsed frame. */
export const FRAME_BAR = 40;
export const FRAME_PAD = 32;
export const NOTE_MIN = { w: 140, h: 72 };
export const FRAME_MIN = { w: 220, h: 120 };
export const NOTE_SIZE = { w: 240, h: 160 };

export const COLORS: Record<CanvasColor, string> = {
  yellow: '#e2b93b',
  orange: '#ec8a3f',
  pink: '#e3649f',
  purple: '#9b6bff',
  blue: '#4f8cff',
  green: '#3fae78',
  gray: '#8792a6'
};
export const COLOR_NAMES = Object.keys(COLORS) as CanvasColor[];

export const notesOf = (g: Graph): GraphNote[] => g.notes ?? [];
export const framesOf = (g: Graph): GraphFrame[] => g.frames ?? [];

/** Fill in notes and frames for graphs saved before they existed. */
export function withExtras(g: Graph): Graph {
  if (g.notes && g.frames) return g;
  return { ...g, notes: g.notes ?? [], frames: g.frames ?? [] };
}

export function noteById(g: Graph, id: string): GraphNote | undefined {
  return notesOf(g).find((n) => n.id === id);
}

export function frameById(g: Graph, id: string): GraphFrame | undefined {
  return framesOf(g).find((f) => f.id === id);
}

/** The frame a node or note is in. */
export function frameOf(g: Graph, id: string): GraphFrame | undefined {
  return framesOf(g).find((f) => f.members.includes(id));
}

export function noteRect(n: GraphNote): Rect {
  return { x: n.x, y: n.y, w: n.w, h: n.h };
}

/** What a frame covers on the canvas: only its title bar when collapsed. */
export function frameRect(f: GraphFrame): Rect {
  return { x: f.x, y: f.y, w: f.w, h: f.collapsed ? FRAME_BAR : f.h };
}

export function barRect(f: GraphFrame): Rect {
  return { x: f.x, y: f.y, w: f.w, h: FRAME_BAR };
}

/** Nodes and notes inside collapsed frames. */
export function hiddenIds(g: Graph): Set<string> {
  const out = new Set<string>();
  for (const f of framesOf(g)) if (f.collapsed) for (const m of f.members) out.add(m);
  return out;
}

/** Rectangle of a node or note, or null. */
export function memberRect(g: Graph, sizes: Sizes, id: string): Rect | null {
  const n = g.nodes.find((x) => x.id === id);
  if (n) return nodeRect(n, sizes);
  const note = noteById(g, id);
  return note ? noteRect(note) : null;
}

const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const area = (r: Rect) => r.w * r.h;

/** The smallest open frame under `p`, skipping `skip`. */
export function frameAt(g: Graph, p: Point, skip: ReadonlySet<string> = new Set()): GraphFrame | null {
  let best: GraphFrame | null = null;
  for (const f of framesOf(g)) {
    if (f.collapsed || skip.has(f.id) || !contains(frameRect(f), p)) continue;
    if (!best || area(frameRect(f)) < area(frameRect(best))) best = f;
  }
  return best;
}

/** Put each node or note in `ids` into the frame its middle is over, or into none. */
export function updateMembership(g: Graph, ids: Iterable<string>, sizes: Sizes): Graph {
  const frames = framesOf(g).map((f) => ({ ...f, members: [...f.members] }));
  const next = { ...g, frames };
  for (const id of ids) {
    const r = memberRect(g, sizes, id);
    if (!r) continue;
    const target = frameAt(next, center(r));
    for (const f of frames) {
      const has = f.members.includes(id);
      if (f === target && !has) f.members.push(id);
      else if (f !== target && has) f.members = f.members.filter((m) => m !== id);
    }
  }
  return next;
}

/** `ids` plus everything inside the frames among them. */
export function withMembers(g: Graph, ids: Iterable<string>): Set<string> {
  const out = new Set(ids);
  for (const f of framesOf(g)) if (out.has(f.id)) for (const m of f.members) out.add(m);
  return out;
}

/** Where every node, note and frame in `ids` is now. */
export function positions(g: Graph, ids: ReadonlySet<string>): Map<string, Point> {
  const out = new Map<string, Point>();
  for (const n of [...g.nodes, ...notesOf(g), ...framesOf(g)]) if (ids.has(n.id)) out.set(n.id, { x: n.x, y: n.y });
  return out;
}

/** Move nodes, notes and frames to new top-left corners. */
export function moveItems(g: Graph, to: ReadonlyMap<string, Point>): Graph {
  const move = <T extends { id: string; x: number; y: number }>(n: T): T => (to.has(n.id) ? { ...n, ...to.get(n.id)! } : n);
  return { ...g, nodes: g.nodes.map(move), notes: notesOf(g).map(move), frames: framesOf(g).map(move) };
}

/** Shift items, and whatever their frames hold, by `dx`, `dy`. */
export function nudgeItems(g: Graph, ids: Iterable<string>, dx: number, dy: number): Graph {
  const all = withMembers(g, ids);
  const to = new Map([...positions(g, all)].map(([id, p]) => [id, { x: p.x + dx, y: p.y + dy }]));
  return moveItems(g, to);
}

export function bounds(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null;
  const x1 = Math.min(...rects.map((r) => r.x));
  const y1 = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w));
  const y2 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Everything on the canvas that can be seen. */
export function allBounds(g: Graph, sizes: Sizes): Rect | null {
  const hidden = hiddenIds(g);
  return bounds([
    ...g.nodes.filter((n) => !hidden.has(n.id)).map((n) => nodeRect(n, sizes)),
    ...notesOf(g).filter((n) => !hidden.has(n.id)).map(noteRect),
    ...framesOf(g).map(frameRect)
  ]);
}

/** Nodes, notes and frames a selection box touches. Frames must be inside the box. */
export function itemsInBox(g: Graph, sizes: Sizes, box: Rect): string[] {
  const hidden = hiddenIds(g);
  const inside = (r: Rect) => r.x >= box.x && r.y >= box.y && r.x + r.w <= box.x + box.w && r.y + r.h <= box.y + box.h;
  return [
    ...g.nodes.filter((n) => !hidden.has(n.id) && intersects(nodeRect(n, sizes), box)).map((n) => n.id),
    ...notesOf(g).filter((n) => !hidden.has(n.id) && intersects(noteRect(n), box)).map((n) => n.id),
    ...framesOf(g).filter((f) => inside(frameRect(f))).map((f) => f.id)
  ];
}

export function allIds(g: Graph): string[] {
  return [...g.nodes, ...notesOf(g), ...framesOf(g)].map((n) => n.id);
}

export function addNote(g: Graph, at: Point, patch: Partial<GraphNote> = {}): { graph: Graph; id: string } {
  const note: GraphNote = { id: newId(), x: at.x, y: at.y, ...NOTE_SIZE, text: '', color: 'yellow', ...patch };
  return { graph: updateMembership({ ...g, notes: [...notesOf(g), note] }, [note.id], {}), id: note.id };
}

/** Wrap nodes and notes in a new frame. They leave any frame they were in. */
export function groupItems(g: Graph, ids: Iterable<string>, sizes: Sizes, label = 'Group'): { graph: Graph; id: string } | null {
  const want = new Set(ids);
  const members = [...g.nodes.map((n) => n.id), ...notesOf(g).map((n) => n.id)].filter((id) => want.has(id));
  // Frames picked too: take what they hold, and drop them.
  const picked = framesOf(g).filter((f) => want.has(f.id));
  for (const f of picked) for (const m of f.members) if (!members.includes(m)) members.push(m);
  const box = bounds(members.flatMap((id) => memberRect(g, sizes, id) ?? []));
  if (!box) return null;
  const x = snap(box.x - FRAME_PAD);
  const y = snap(box.y - FRAME_PAD - FRAME_BAR);
  const frame: GraphFrame = {
    id: newId(),
    x,
    y,
    w: Math.max(FRAME_MIN.w, snap(box.x + box.w + FRAME_PAD - x)),
    h: Math.max(FRAME_MIN.h, snap(box.y + box.h + FRAME_PAD - y)),
    label,
    color: picked[0]?.color ?? 'blue',
    collapsed: false,
    members
  };
  const gone = new Set(picked.map((f) => f.id));
  const frames = framesOf(g)
    .filter((f) => !gone.has(f.id))
    .map((f) => ({ ...f, members: f.members.filter((m) => !members.includes(m)) }));
  return { graph: { ...g, frames: [...frames, frame] }, id: frame.id };
}

/** Remove frames, keeping what they hold. */
export function ungroup(g: Graph, frameIds: Iterable<string>): Graph {
  const gone = new Set(frameIds);
  return { ...g, frames: framesOf(g).filter((f) => !gone.has(f.id)) };
}

/** Frames to ungroup for a selection: the frames picked, else the frames of the nodes picked. */
export function framesToUngroup(g: Graph, ids: readonly string[]): string[] {
  const picked = framesOf(g).filter((f) => ids.includes(f.id));
  if (picked.length) return picked.map((f) => f.id);
  return [...new Set(ids.flatMap((id) => frameOf(g, id)?.id ?? []))];
}

export function patchFrame(g: Graph, id: string, patch: Partial<GraphFrame>): Graph {
  return { ...g, frames: framesOf(g).map((f) => (f.id === id ? { ...f, ...patch } : f)) };
}

export function patchNote(g: Graph, id: string, patch: Partial<GraphNote>): Graph {
  return { ...g, notes: notesOf(g).map((n) => (n.id === id ? { ...n, ...patch } : n)) };
}

/** Resize from the bottom-right corner, keeping a minimum size. */
export function resizeTo(start: Rect, dx: number, dy: number, min: { w: number; h: number }, grid: boolean): { w: number; h: number } {
  const w = Math.max(min.w, start.w + dx);
  const h = Math.max(min.h, start.h + dy);
  return grid ? { w: Math.max(min.w, snap(start.x + w) - start.x), h: Math.max(min.h, snap(start.y + h) - start.y) } : { w, h };
}

/** Where a line ends: the node, or the title bar of the collapsed frame hiding it. Null when both ends are hidden in one frame. */
export function lineEnds(g: Graph, sizes: Sizes, e: GraphEdge): { from: Rect; to: Rect } | null {
  const end = (id: string): { r: Rect; frame: string | null } | null => {
    const n = g.nodes.find((x) => x.id === id);
    if (!n) return null;
    const f = frameOf(g, id);
    if (f?.collapsed) return { r: barRect(f), frame: f.id };
    return { r: nodeRect(n, sizes), frame: null };
  };
  const a = end(e.from);
  const b = end(e.to);
  if (!a || !b || (a.frame && a.frame === b.frame)) return null;
  return { from: a.r, to: b.r };
}

// Tidy up

/**
 * Tidy up with frames: each frame's nodes are laid out on their own, then the frame moves
 * through the layout as one block, so its contents stay together.
 */
export function tidyAll(g: Graph, sizes: Sizes): Graph {
  const nodeIds = new Set(g.nodes.map((n) => n.id));
  const blocks = framesOf(g).filter((f) => f.members.some((m) => nodeIds.has(m)));
  if (!blocks.length) return tidy(g, sizes);
  const owner = new Map<string, GraphFrame>();
  for (const f of blocks) for (const m of f.members) if (nodeIds.has(m)) owner.set(m, f);

  // Lay out each frame's nodes, relative to the frame's corner.
  const inner = new Map<string, { offsets: Map<string, Point>; w: number; h: number; sides: Map<string, GraphEdge> }>();
  for (const f of blocks) {
    const nodes = g.nodes.filter((n) => owner.get(n.id) === f);
    const edges = g.edges.filter((e) => owner.get(e.from) === f && owner.get(e.to) === f);
    const laid = tidy({ nodes, edges, notes: [], frames: [] }, sizes);
    const box = bounds(laid.nodes.map((n) => nodeRect(n, sizes)))!;
    const offsets = new Map<string, Point>();
    for (const n of laid.nodes) offsets.set(n.id, { x: FRAME_PAD + n.x - box.x, y: FRAME_BAR + FRAME_PAD + n.y - box.y });
    // Notes keep their place relative to the frame.
    for (const id of f.members) {
      const note = noteById(g, id);
      if (note) offsets.set(id, { x: note.x - f.x, y: note.y - f.y });
    }
    const extent = [...offsets].map(([id, p]) => {
      const r = memberRect(g, sizes, id)!;
      return { x: p.x, y: p.y, w: r.w, h: r.h };
    });
    const all = bounds(extent)!;
    inner.set(f.id, {
      offsets,
      w: Math.max(FRAME_MIN.w, snap(all.x + all.w + FRAME_PAD)),
      h: Math.max(FRAME_MIN.h, snap(all.y + all.h + FRAME_PAD)),
      sides: new Map(laid.edges.map((e) => [e.id, e]))
    });
  }

  // Each frame stands in for its nodes in the main layout.
  const heights: Record<string, number> = { ...sizes };
  const widths: Record<string, number> = {};
  const blocksAsNodes: GraphNode[] = blocks.map((f) => {
    const first = g.nodes.find((n) => owner.get(n.id) === f && n.kind.type === 'trigger') ?? g.nodes.find((n) => owner.get(n.id) === f)!;
    const size = inner.get(f.id)!;
    widths[f.id] = size.w;
    heights[f.id] = f.collapsed ? FRAME_BAR : size.h;
    return { id: f.id, x: f.x, y: f.y, kind: first.kind };
  });
  const outer = g.edges
    .filter((e) => !(owner.get(e.from) && owner.get(e.from) === owner.get(e.to)))
    .map((e) => ({ ...e, from: owner.get(e.from)?.id ?? e.from, to: owner.get(e.to)?.id ?? e.to }));
  const laid = tidy(
    { nodes: [...g.nodes.filter((n) => !owner.has(n.id)), ...blocksAsNodes], edges: outer, notes: [], frames: [] },
    heights,
    widths
  );
  const at = new Map(laid.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  const outerSides = new Map(laid.edges.map((e) => [e.id, e]));

  const to = new Map<string, Point>();
  for (const n of g.nodes) if (!owner.has(n.id)) to.set(n.id, at.get(n.id)!);
  for (const f of blocks) {
    const corner = at.get(f.id)!;
    to.set(f.id, corner);
    for (const [id, p] of inner.get(f.id)!.offsets) to.set(id, { x: corner.x + p.x, y: corner.y + p.y });
  }
  const moved = moveItems(g, to);
  return {
    ...moved,
    frames: moved.frames.map((f) => (inner.has(f.id) ? { ...f, w: inner.get(f.id)!.w, h: inner.get(f.id)!.h } : f)),
    edges: g.edges.map((e) => {
      const s = outerSides.get(e.id) ?? inner.get(owner.get(e.from)?.id ?? '')?.sides.get(e.id);
      return s ? { ...e, from_side: s.from_side, to_side: s.to_side } : e;
    })
  };
}
