import { describe, expect, it } from 'vitest';
import type { Action } from '$lib/bindings/Action';
import type { EdgeBranch } from '$lib/bindings/EdgeBranch';
import type { Graph } from '$lib/bindings/Graph';
import type { GraphNode } from '$lib/bindings/GraphNode';
import type { Step } from '$lib/bindings/Step';
import type { Trigger } from '$lib/bindings/Trigger';
import {
  ARROW,
  DEFAULT_H,
  NODE_W,
  addEdge,
  anchor,
  arrowHead,
  bounds,
  copyNodes,
  curve,
  defaultBranch,
  disconnect,
  dropTarget,
  duplicateNodes,
  edgeCurve,
  fromTree,
  graphSteps,
  hitHandle,
  hitNode,
  inBox,
  insertOnEdge,
  nearestSide,
  nextBranch,
  outgoing,
  pasteClip,
  placeBySide,
  planRun,
  pointAt,
  rectFrom,
  removeNodes,
  snap,
  startPlan,
  syncTriggers,
  tidy,
  unreachable
} from './graph';
import { ActionHistory } from './history';
import { clampZoom, fitView, toScreen, toWorld, zoomAt } from './view';

const say = (message: string): Step => ({ type: 'chat_send', message, as_bot: false, reply: false });
const iff = (then: Step[] = [], otherwise: Step[] = []): Step => ({ type: 'if', conditions: { mode: 'all', conditions: [] }, then, else: otherwise });
const manual: Trigger = { type: 'manual' };
const online: Trigger = { type: 'stream_online' };

const step = (id: string, x: number, y: number, s: Step = say(id)): GraphNode => ({ id, x, y, kind: { type: 'step', step: s } });
const trig = (id: string, x: number, t: Trigger = manual): GraphNode => ({ id, x, y: 0, kind: { type: 'trigger', trigger: t } });
const line = (from: string, to: string, branch: EdgeBranch = 'next') => ({
  id: `${from}>${to}`,
  from,
  from_side: 'bottom' as const,
  to,
  to_side: 'top' as const,
  branch
});

/** "a -next-> b" lines, sorted, using chat messages, If and trigger types as names. */
function shape(g: Graph): string[] {
  const name = (id: string) => {
    const n = g.nodes.find((x) => x.id === id)!;
    if (n.kind.type === 'trigger') return n.kind.trigger.type;
    const s = n.kind.step;
    return s.type === 'chat_send' ? s.message : s.type;
  };
  return g.edges.map((e) => `${name(e.from)} -${e.branch}-> ${name(e.to)}`).sort();
}

describe('converting step lists', () => {
  it('chains steps under every trigger', () => {
    const g = fromTree([manual, online], [say('a'), say('b')]);
    expect(shape(g)).toEqual(['a -next-> b', 'manual -next-> a', 'stream_online -next-> a']);
  });

  it('joins If branches after the If, empty branches straight through', () => {
    const g = fromTree([manual], [iff([say('t1'), iff([say('deep')])]), say('after')]);
    expect(shape(g)).toEqual([
      'deep -next-> after',
      'if -otherwise-> after',
      'if -otherwise-> after',
      'if -then-> deep',
      'if -then-> t1',
      'manual -next-> if',
      't1 -next-> if'
    ]);
    for (const s of graphSteps(g)) if (s.type === 'if') expect([s.then, s.else]).toEqual([[], []]);
  });

  it('stops chaining after a stop', () => {
    const g = fromTree([], [iff([say('yes'), { type: 'stop' }], [say('no')]), say('end')]);
    expect(shape(g)).toEqual(['if -otherwise-> no', 'if -then-> yes', 'no -next-> end', 'yes -next-> stop']);
  });
});

describe('runs', () => {
  const g: Graph = {
    notes: [],
    frames: [],
    nodes: [trig('t', 0), trig('o', 400, online), step('if', 0, 150, iff()), step('yes', 0, 300), step('no', 300, 300), step('join', 0, 450)],
    edges: [line('t', 'if'), line('o', 'if'), line('if', 'yes', 'then'), line('if', 'no', 'otherwise'), line('yes', 'join'), line('no', 'join')]
  };

  it('starts at the trigger that fired, the Button trigger, or all triggers at once', () => {
    expect(startPlan(g, 1)).toEqual({ fired: ['o'], first: ['if'] });
    expect(startPlan(g, null)).toEqual({ fired: ['t'], first: ['if'] });
    const noButton = { ...g, nodes: g.nodes.map((n) => (n.id === 't' ? trig('t', 0, online) : n)) };
    expect(startPlan(noButton, null)).toEqual({ fired: ['t', 'o'], first: ['if'] });
    expect(startPlan({ nodes: [step('a', 0, 0), step('b', 0, 100)], edges: [line('a', 'b')], notes: [], frames: [] }, null).first).toEqual(['a']);
  });

  it('follows the branch the If chose and marks the other skipped', () => {
    const run = planRun(g, null, () => false);
    expect(run.order).toEqual(['if', 'no', 'join']);
    expect(run.nodes.find((n) => n.node_id === 'yes')?.state).toBe('skipped');
    expect(run.nodes.slice(0, 4).map((n) => n.node_id)).toEqual(['t', 'if', 'no', 'join']);
  });

  it('lists each step with the line taken to reach it', () => {
    const run = planRun(g, null, () => true);
    expect(run.steps.map((s) => [s.node_id, s.via])).toEqual([
      ['t', null],
      ['if', 't>if'],
      ['yes', 'if>yes'],
      ['join', 'yes>join']
    ]);
  });

  it('runs a merge each time it is reached, depth first by position', () => {
    const fan: Graph = {
      notes: [],
      frames: [],
      nodes: [trig('t', 0), step('low', 0, 300), step('high', 300, 200), step('m', 0, 400)],
      edges: [line('t', 'low'), line('t', 'high'), line('low', 'm'), line('high', 'm')]
    };
    expect(outgoing(fan, 't').map((e) => e.to)).toEqual(['high', 'low']);
    expect(planRun(fan, 0, () => true).order).toEqual(['high', 'm', 'low', 'm']);
  });

  it('stops loops at the budget and at Stop', () => {
    const loop: Graph = { nodes: [trig('t', 0), step('a', 0, 100), step('b', 0, 200)], edges: [line('t', 'a'), line('a', 'b'), line('b', 'a')], notes: [], frames: [] };
    const run = planRun(loop, 0, () => true, { budget: 10 });
    expect(run.order).toHaveLength(10);
    expect(run.errors[0]).toMatch(/Stopped after/);
    const stop: Graph = { nodes: [trig('t', 0), step('s', 0, 100, { type: 'stop' }), step('x', 300, 200)], edges: [line('t', 's'), line('t', 'x')], notes: [], frames: [] };
    expect(planRun(stop, 0, () => true).order).toEqual(['s']);
  });

  it('finds nodes no trigger reaches', () => {
    expect(unreachable(g)).toEqual([]);
    expect(unreachable(removeNodes(g, ['if']))).toEqual(['yes', 'no', 'join']);
    expect(unreachable({ nodes: [step('a', 0, 0)], edges: [], notes: [], frames: [] })).toEqual([]);
  });
});

describe('geometry', () => {
  const r = { x: 100, y: 50, w: 200, h: 80 };

  it('anchors sit in the middle of each side', () => {
    expect(anchor(r, 'top')).toEqual({ x: 200, y: 50 });
    expect(anchor(r, 'right')).toEqual({ x: 300, y: 90 });
    expect(anchor(r, 'bottom')).toEqual({ x: 200, y: 130 });
    expect(anchor(r, 'left')).toEqual({ x: 100, y: 90 });
  });

  it('curves leave and enter at right angles to the sides', () => {
    const c = curve({ x: 0, y: 0 }, 'right', { x: 400, y: 200 }, 'top');
    expect(c.c1.y).toBe(0);
    expect(c.c1.x).toBeGreaterThan(0);
    expect(c.c2.x).toBe(400);
    expect(c.c2.y).toBeLessThan(200);
    expect(pointAt(c, 0)).toEqual(c.a);
    expect(pointAt(c, 1)).toEqual(c.b);
    // Short lines still bend out of the node.
    const short = curve({ x: 0, y: 0 }, 'bottom', { x: 0, y: 10 }, 'top');
    expect(short.c1.y).toBeGreaterThanOrEqual(36);
  });

  it('lines stop short of the target for the arrowhead', () => {
    const c = edgeCurve(r, 'right', { x: 500, y: 50, w: 200, h: 80 }, 'left');
    expect(c.b).toEqual({ x: 500 - ARROW, y: 90 });
    const tip = arrowHead({ x: 500, y: 90 }, 'left').split(' ')[0];
    expect(tip).toBe('500,90');
  });

  it('hit tests handles, nodes and sides', () => {
    const g: Graph = { nodes: [step('a', 0, 0), step('b', 400, 0)], edges: [], notes: [], frames: [] };
    const sizes = { a: 100 };
    expect(hitNode(g, sizes, { x: 10, y: 90 })).toBe('a');
    expect(hitNode(g, sizes, { x: 10, y: 99.5 + DEFAULT_H })).toBeNull();
    expect(hitHandle(g, sizes, { x: NODE_W + 6, y: 52 }, 12)).toEqual({ id: 'a', side: 'right' });
    expect(hitHandle(g, sizes, { x: NODE_W + 40, y: 52 }, 12)).toBeNull();
    expect(hitHandle(g, sizes, { x: NODE_W + 6, y: 52 }, 12, 'a')).toBeNull();
    expect(nearestSide({ x: 0, y: 0, w: 280, h: 100 }, { x: 270, y: 50 })).toBe('right');
    expect(nearestSide({ x: 0, y: 0, w: 280, h: 100 }, { x: 140, y: 95 })).toBe('bottom');
    // Dropping on a node body snaps to its nearest side.
    expect(dropTarget(g, sizes, { x: 405, y: 40 }, 12, 'a')).toEqual({ id: 'b', side: 'left' });
    expect(dropTarget(g, sizes, { x: 360, y: 40 }, 12, 'a')).toBeNull();
  });

  it('selects with a box drawn either way', () => {
    const g: Graph = { nodes: [step('a', 0, 0), step('b', 400, 0), step('c', 0, 400)], edges: [], notes: [], frames: [] };
    expect(rectFrom({ x: 50, y: 50 }, { x: 10, y: 0 })).toEqual({ x: 10, y: 0, w: 40, h: 50 });
    expect(inBox(g, {}, rectFrom({ x: 500, y: 50 }, { x: 200, y: -20 }))).toEqual(['a', 'b']);
    expect(inBox(g, {}, rectFrom({ x: -50, y: 150 }, { x: -10, y: 160 }))).toEqual([]);
  });

  it('snaps to the grid and places new nodes by side', () => {
    expect(snap(23)).toBe(16);
    expect(snap(25)).toBe(32);
    expect(snap(-9)).toBe(-16);
    expect(placeBySide({ x: 100, y: 100 }, 'left')).toEqual({ x: 100, y: 100 - DEFAULT_H / 2 });
    expect(placeBySide({ x: 100, y: 100 }, 'top')).toEqual({ x: 100 - NODE_W / 2, y: 100 });
    expect(bounds([step('a', 0, 0), step('b', 400, 300)], { b: 50 })).toEqual({ x: 0, y: 0, w: 400 + NODE_W, h: 350 });
  });

  it('pans and zooms around the pointer', () => {
    const v = { x: 100, y: 50, zoom: 1 };
    const p = { x: 300, y: 200 };
    const w = toWorld(v, p);
    const z = zoomAt(v, 2, p);
    expect(toScreen(z, w)).toEqual(p);
    expect(clampZoom(10)).toBe(2);
    const fit = fitView({ x: 0, y: 0, w: 1000, h: 500 }, 600, 400, 50);
    expect(fit.zoom).toBe(0.5);
    expect(toScreen(fit, { x: 500, y: 250 })).toEqual({ x: 300, y: 200 });
    expect(fitView({ x: 0, y: 0, w: 100, h: 100 }, 2000, 1000).zoom).toBe(1);
    const lop = fitView({ x: 0, y: 0, w: 100, h: 100 }, 1000, 1000, { top: 0, right: 400, bottom: 0, left: 0 });
    expect(toScreen(lop, { x: 50, y: 50 })).toEqual({ x: 300, y: 500 });
  });
});

describe('editing', () => {
  const base = (): Graph => ({ nodes: [trig('t', 0), step('if', 0, 150, iff()), step('a', 0, 300), step('b', 300, 300)], edges: [line('t', 'if')], notes: [], frames: [] });
  const edge = (from: string, to: string) => ({ from, from_side: 'right' as const, to, to_side: 'left' as const });

  it('gives lines from an If Then first, then Otherwise', () => {
    let g = base();
    expect(defaultBranch(g, 't')).toBe('next');
    const first = addEdge(g, edge('if', 'a'))!;
    expect(first.edge.branch).toBe('then');
    g = first.graph;
    const second = addEdge(g, edge('if', 'b'))!;
    expect(second.edge.branch).toBe('otherwise');
    expect(nextBranch('then')).toBe('otherwise');
    expect(nextBranch('otherwise')).toBe('next');
    expect(nextBranch('next')).toBe('then');
  });

  it('allows many lines into one side, but no repeats or self lines', () => {
    let g = addEdge(base(), edge('a', 'b'))!.graph;
    g = addEdge(g, edge('if', 'b'))!.graph;
    expect(g.edges.filter((e) => e.to === 'b' && e.to_side === 'left')).toHaveLength(2);
    expect(addEdge(g, edge('a', 'b'))).toBeNull();
    expect(addEdge(g, edge('a', 'a'))).toBeNull();
    expect(addEdge(g, edge('a', 'gone'))).toBeNull();
  });

  it('duplicates and pastes with the lines between the copied nodes', () => {
    const g = { ...base(), edges: [line('t', 'if'), line('if', 'a', 'then'), line('a', 'b')] };
    const d = duplicateNodes(g, ['if', 'a'], { x: 32, y: 32 });
    expect(d.ids).toHaveLength(2);
    expect(d.graph.nodes).toHaveLength(6);
    const copies = d.graph.nodes.filter((n) => d.ids.includes(n.id));
    expect(copies.map((n) => [n.x, n.y])).toEqual([
      [32, 182],
      [32, 332]
    ]);
    const added = d.graph.edges.slice(g.edges.length);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ from: d.ids[0], to: d.ids[1], branch: 'then' });

    const clip = copyNodes(g, ['a', 'b']);
    expect(clip.edges).toHaveLength(1);
    const p = pasteClip(g, clip, { x: 1000, y: 1000 });
    expect(p.graph.nodes.filter((n) => p.ids.includes(n.id)).map((n) => [n.x, n.y])).toEqual([
      [1000, 1000],
      [1300, 1000]
    ]);
    // The original is left alone.
    expect(g.nodes).toHaveLength(4);
  });

  it('removes nodes with their lines', () => {
    const g = { ...base(), edges: [line('t', 'if'), line('if', 'a', 'then')] };
    expect(removeNodes(g, ['if']).edges).toEqual([]);
  });

  it('keeps triggers in step with the graph', () => {
    const a = { triggers: [], steps: [say('old')], graph: base() } as unknown as Action;
    syncTriggers(a);
    expect(a.triggers).toEqual([manual]);
    expect(a.steps).toEqual([]);
  });
});

describe('tidy up', () => {
  const sizes = { t: 150 };

  it('puts triggers on top, If branches side by side and joins below', () => {
    const g: Graph = {
      notes: [],
      frames: [],
      nodes: [step('join', 900, 40), step('no', -300, 700), trig('t', 500), step('if', 20, 900, iff()), step('yes', 40, 20)],
      edges: [line('t', 'if'), line('if', 'yes', 'then'), line('if', 'no', 'otherwise'), line('yes', 'join'), line('no', 'join')]
    };
    const out = tidy(g, sizes);
    const at = (id: string) => out.nodes.find((n) => n.id === id)!;
    expect(at('t').y).toBeLessThan(at('if').y);
    expect(at('if').y).toBeGreaterThanOrEqual(at('t').y + 150);
    expect(at('yes').y).toBe(at('no').y);
    expect(at('yes').x + NODE_W).toBeLessThanOrEqual(at('no').x);
    expect(at('join').y).toBeGreaterThan(at('yes').y);
    // The join sits between its two parents; the If above it.
    expect(at('join').x).toBeCloseTo((at('yes').x + at('no').x) / 2);
    expect(at('if').x).toBeCloseTo(at('join').x);
    expect(out.edges.every((e) => e.from_side === 'bottom' && e.to_side === 'top')).toBe(true);
    // Keeps the drawing where it was.
    expect(bounds(out.nodes, sizes)!.x).toBe(snap(bounds(g.nodes, sizes)!.x));
  });

  it('never overlaps nodes in a layer and sends loops back on the right', () => {
    const g: Graph = {
      notes: [],
      frames: [],
      nodes: [trig('t', 0), step('a', 0, 0), step('b', 0, 0), step('c', 0, 0), step('d', 0, 0)],
      edges: [line('t', 'a'), line('t', 'b'), line('t', 'c'), line('c', 'd'), line('d', 'c')]
    };
    const out = tidy(g, {});
    const row = out.nodes.filter((n) => ['a', 'b', 'c'].includes(n.id)).sort((p, q) => p.x - q.x);
    for (let i = 1; i < row.length; i++) expect(row[i]!.x - row[i - 1]!.x).toBeGreaterThanOrEqual(NODE_W);
    expect(out.edges.find((e) => e.from === 'd')).toMatchObject({ from_side: 'right', to_side: 'right' });
  });
});

describe('history', () => {
  it('a drag is one undo step however long it takes', () => {
    const h = new ActionHistory(100, 1000);
    const act = (x: number) => ({ id: 'a', graph: { nodes: [step('n', x, 0)], edges: [], notes: [], frames: [] } }) as unknown as Action;
    h.record(act(0), 'a:g.drag', 0, Infinity);
    h.record(act(10), 'a:g.drag', 5000, Infinity);
    h.record(act(20), 'a:g.drag', 9000, Infinity);
    h.seal('a');
    h.record(act(30), 'a:g.drag', 9100, Infinity);
    const back = h.undo(act(40))!;
    expect(back.graph.nodes[0]!.x).toBe(30);
    expect(h.undo(back)!.graph.nodes[0]!.x).toBe(0);
    expect(h.canUndo('a')).toBe(false);
  });
});

describe('inserting on a line', () => {
  const base = (): Graph => ({ nodes: [step('if', 0, 0, iff()), step('yes', 0, 200), step('no', 300, 200)], edges: [line('if', 'yes', 'then'), line('if', 'no', 'otherwise')], notes: [], frames: [] });

  it('splits a line and keeps its branch', () => {
    const r = insertOnEdge(base(), 'if>no', step('mid', 300, 100))!;
    expect(shape(r.graph)).toEqual(['if -then-> yes', 'if -otherwise-> mid', 'mid -next-> no'].sort());
    const [into, out] = r.edges;
    expect(into).toMatchObject({ from: 'if', from_side: 'bottom', to: 'mid', to_side: 'top', branch: 'otherwise' });
    expect(out).toMatchObject({ from: 'mid', from_side: 'bottom', to: 'no', to_side: 'top', branch: 'next' });
    expect(r.graph.edges.some((e) => e.id === 'if>no')).toBe(false);
  });

  it('a new If leads on with Then', () => {
    const r = insertOnEdge(base(), 'if>yes', step('check', 0, 100, iff()))!;
    expect(shape(r.graph)).toContain('if -then-> if');
    expect(r.edges[1].branch).toBe('then');
  });

  it('needs a real line and a new node', () => {
    expect(insertOnEdge(base(), 'nope', step('x', 0, 0))).toBeNull();
    expect(insertOnEdge(base(), 'if>yes', step('no', 0, 0))).toBeNull();
  });

  it('disconnects nodes', () => {
    expect(disconnect(base(), ['no']).edges.map((e) => e.id)).toEqual(['if>yes']);
  });
});
