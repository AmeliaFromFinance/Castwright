import { describe, expect, it } from 'vitest';
import type { Graph } from '$lib/bindings/Graph';
import type { GraphFrame } from '$lib/bindings/GraphFrame';
import type { GraphNode } from '$lib/bindings/GraphNode';
import type { GraphNote } from '$lib/bindings/GraphNote';
import type { Step } from '$lib/bindings/Step';
import {
  FRAME_BAR,
  addNote,
  allBounds,
  allIds,
  framesToUngroup,
  groupItems,
  hiddenIds,
  itemsInBox,
  lineEnds,
  moveItems,
  nudgeItems,
  positions,
  tidyAll,
  ungroup,
  updateMembership,
  withExtras,
  withMembers
} from './canvas';
import { DEFAULT_H, NODE_W, copyNodes, duplicateNodes, nodeRect, pasteClip, planRun, removeNodes, tidy, unreachable } from './graph';
import { renderNote } from './notes';

const say = (message: string): Step => ({ type: 'chat_send', message, as_bot: false, reply: false });
const step = (id: string, x: number, y: number): GraphNode => ({ id, x, y, kind: { type: 'step', step: say(id) } });
const trig = (id: string, x: number, y = 0): GraphNode => ({ id, x, y, kind: { type: 'trigger', trigger: { type: 'manual' } } });
const line = (from: string, to: string) => ({ id: `${from}>${to}`, from, from_side: 'bottom' as const, to, to_side: 'top' as const, branch: 'next' as const });
const note = (id: string, x: number, y: number, patch: Partial<GraphNote> = {}): GraphNote => ({ id, x, y, w: 200, h: 100, text: '', color: 'yellow', ...patch });
const frame = (id: string, x: number, y: number, w: number, h: number, members: string[], patch: Partial<GraphFrame> = {}): GraphFrame => ({
  id,
  x,
  y,
  w,
  h,
  label: id,
  color: 'blue',
  collapsed: false,
  members,
  ...patch
});
const graph = (p: Partial<Graph>): Graph => ({ nodes: [], edges: [], notes: [], frames: [], ...p });

describe('frame membership', () => {
  const g = graph({
    nodes: [step('a', 0, 0), step('b', 1000, 0)],
    notes: [note('n', 40, 300)],
    frames: [frame('big', -100, -100, 700, 600, []), frame('small', -50, -60, 400, 200, [])]
  });

  it('a node dropped over a frame joins the smallest frame under its middle', () => {
    const out = updateMembership(g, ['a', 'n', 'b'], {});
    expect(out.frames.find((f) => f.id === 'small')!.members).toEqual(['a']);
    expect(out.frames.find((f) => f.id === 'big')!.members).toEqual(['n']);
  });

  it('dragged out, it leaves', () => {
    const joined = updateMembership(g, ['a'], {});
    const moved = moveItems(joined, new Map([['a', { x: 2000, y: 0 }]]));
    const out = updateMembership(moved, ['a'], {});
    expect(out.frames.every((f) => !f.members.includes('a'))).toBe(true);
  });

  it('collapsed frames take nothing new', () => {
    const closed = { ...g, frames: g.frames.map((f) => ({ ...f, collapsed: true })) };
    expect(updateMembership(closed, ['a'], {}).frames.every((f) => !f.members.length)).toBe(true);
  });

  it('a new note over a frame joins it', () => {
    const { graph: out, id } = addNote(g, { x: 0, y: 200 });
    expect(out.frames.find((f) => f.id === 'big')!.members).toContain(id);
  });

  it('moving a frame carries what it holds', () => {
    const held = graph({ nodes: [step('a', 0, 100)], notes: [note('n', 0, 300)], frames: [frame('f', -20, 0, 400, 500, ['a', 'n'])] });
    const ids = withMembers(held, ['f']);
    expect([...ids].sort()).toEqual(['a', 'f', 'n']);
    const out = nudgeItems(held, ['f'], 50, 10);
    expect(positions(out, ids)).toEqual(
      new Map([
        ['a', { x: 50, y: 110 }],
        ['n', { x: 50, y: 310 }],
        ['f', { x: 30, y: 10 }]
      ])
    );
  });
});

describe('group and ungroup', () => {
  const g = graph({ nodes: [trig('t', 0), step('a', 0, 160), step('b', 400, 160)], edges: [line('t', 'a')], notes: [note('n', 0, 400)] });

  it('wraps the picked nodes and notes with room for the title', () => {
    const r = groupItems(g, ['t', 'a', 'n'], {}, 'Start')!;
    const f = r.graph.frames[0]!;
    expect(f.id).toBe(r.id);
    expect(f.label).toBe('Start');
    expect(f.members).toEqual(['t', 'a', 'n']);
    expect(f.x).toBeLessThan(0);
    expect(f.y + FRAME_BAR).toBeLessThan(0);
    expect(f.x + f.w).toBeGreaterThan(NODE_W);
    expect(f.y + f.h).toBeGreaterThan(500);
  });

  it('takes nodes out of their old frame', () => {
    const first = groupItems(g, ['t', 'a'], {})!.graph;
    const second = groupItems(first, ['a', 'b'], {})!.graph;
    expect(second.frames[0]!.members).toEqual(['t']);
    expect(second.frames[1]!.members).toEqual(['a', 'b']);
  });

  it('grouping a frame merges it into the new one', () => {
    const first = groupItems(g, ['t', 'a'], {})!;
    const second = groupItems(first.graph, [first.id, 'b'], {})!.graph;
    expect(second.frames).toHaveLength(1);
    expect(second.frames[0]!.members.sort()).toEqual(['a', 'b', 't']);
  });

  it('nothing to group', () => {
    expect(groupItems(g, ['missing'], {})).toBeNull();
  });

  it('ungroup keeps the nodes', () => {
    const r = groupItems(g, ['t', 'a'], {})!;
    expect(framesToUngroup(r.graph, ['a'])).toEqual([r.id]);
    expect(framesToUngroup(r.graph, [r.id, 'b'])).toEqual([r.id]);
    const out = ungroup(r.graph, [r.id]);
    expect(out.frames).toEqual([]);
    expect(out.nodes).toEqual(g.nodes);
  });
});

describe('collapsed frames', () => {
  const g = graph({
    nodes: [trig('t', 0), step('a', 0, 200), step('b', 0, 400), step('c', 0, 700)],
    edges: [line('t', 'a'), line('a', 'b'), line('b', 'c')],
    notes: [note('n', 300, 200)],
    frames: [frame('f', -40, 140, 600, 420, ['a', 'b', 'n'], { collapsed: true })]
  });

  it('hides what is inside and is only a title bar tall', () => {
    expect([...hiddenIds(g)].sort()).toEqual(['a', 'b', 'n']);
    const box = allBounds(g, {})!;
    expect(box.y).toBe(0);
    expect(box.y + box.h).toBe(700 + DEFAULT_H);
  });

  it('lines to hidden nodes end at the title bar; lines inside are not drawn', () => {
    const bar = { x: -40, y: 140, w: 600, h: FRAME_BAR };
    expect(lineEnds(g, {}, g.edges[0]!)).toEqual({ from: nodeRect(g.nodes[0]!, {}), to: bar });
    expect(lineEnds(g, {}, g.edges[1]!)).toBeNull();
    expect(lineEnds(g, {}, g.edges[2]!)).toEqual({ from: bar, to: nodeRect(g.nodes[3]!, {}) });
  });

  it('box select skips hidden items and only takes whole frames', () => {
    expect(itemsInBox(g, {}, { x: -100, y: 100, w: 800, h: 100 }).sort()).toEqual(['f']);
    expect(itemsInBox(g, {}, { x: -100, y: 100, w: 100, h: 30 })).toEqual([]);
  });

  it('select all takes everything', () => {
    expect(allIds(g).sort()).toEqual(['a', 'b', 'c', 'f', 'n', 't']);
  });
});

describe('runs and warnings ignore notes and frames', () => {
  it('same plan and the same loose nodes', () => {
    const plain = graph({ nodes: [trig('t', 0), step('a', 0, 200), step('x', 600, 200)], edges: [line('t', 'a')] });
    const decorated = { ...plain, notes: [note('n', 0, -300)], frames: [frame('f', -40, 100, 500, 300, ['a', 'n'], { collapsed: true })] };
    expect(unreachable(decorated)).toEqual(['x']);
    expect(planRun(decorated, null, () => true).order).toEqual(planRun(plain, null, () => true).order);
  });
});

describe('copy, paste, duplicate and delete', () => {
  const g = graph({
    nodes: [trig('t', 0), step('a', 0, 200)],
    edges: [line('t', 'a')],
    notes: [note('n', 300, 0)],
    frames: [frame('f', -40, -60, 600, 400, ['t', 'a', 'n'])]
  });

  it('copying a frame brings its contents and keeps them inside the copy', () => {
    const clip = copyNodes(g, ['f']);
    expect(clip.nodes.map((n) => n.id)).toEqual(['t', 'a']);
    expect(clip.notes!.map((n) => n.id)).toEqual(['n']);
    const { graph: out, ids } = pasteClip(g, clip, { x: 1000, y: 1000 });
    expect(ids).toHaveLength(4);
    const copy = out.frames[1]!;
    expect(copy.x).toBe(1000);
    expect(copy.members).toHaveLength(3);
    expect(copy.members.every((m) => ids.includes(m))).toBe(true);
    expect(out.edges).toHaveLength(2);
  });

  it('duplicating a note shifts it', () => {
    const { graph: out, ids } = duplicateNodes(g, ['n']);
    expect(out.notes).toHaveLength(2);
    expect(out.notes[1]!.id).toBe(ids[0]);
    expect(out.notes[1]!.x).toBe(332);
  });

  it('deleting a frame keeps its nodes; deleting a node leaves its frame', () => {
    expect(removeNodes(g, ['f']).nodes).toHaveLength(2);
    const out = removeNodes(g, ['a', 'n']);
    expect(out.frames[0]!.members).toEqual(['t']);
    expect(out.edges).toEqual([]);
  });

  it('old graphs get empty lists', () => {
    const old = { nodes: [], edges: [] } as unknown as Graph;
    expect(withExtras(old)).toEqual({ nodes: [], edges: [], notes: [], frames: [] });
  });
});

describe('tidy up with frames', () => {
  const g = graph({
    nodes: [trig('t', 0), step('a', 900, 900), step('b', -500, 50), step('c', 40, 1400), step('d', 2000, 0)],
    edges: [line('t', 'a'), line('a', 'b'), line('b', 'c'), line('c', 'd')],
    notes: [note('n', 1300, 900)],
    frames: [frame('f', 800, 800, 300, 200, ['a', 'b', 'n'])]
  });
  const out = tidyAll(g, {});
  const at = (id: string) => out.nodes.find((n) => n.id === id)!;
  const f = out.frames[0]!;
  const inside = (r: { x: number; y: number; w: number; h: number }) => r.x >= f.x && r.y >= f.y + FRAME_BAR && r.x + r.w <= f.x + f.w && r.y + r.h <= f.y + f.h;

  it('keeps the frame contents inside the frame, laid out', () => {
    expect(inside(nodeRect(at('a'), {}))).toBe(true);
    expect(inside(nodeRect(at('b'), {}))).toBe(true);
    expect(at('b').y).toBeGreaterThan(at('a').y);
    expect(at('a').x).toBe(at('b').x);
  });

  it('notes in the frame move with it', () => {
    const n = out.notes[0]!;
    expect(n.x - f.x).toBe(1300 - 800);
    expect(n.y - f.y).toBe(900 - 800);
  });

  it('places the frame in the flow: below t, above c', () => {
    expect(f.y).toBeGreaterThan(at('t').y + DEFAULT_H);
    expect(at('c').y).toBeGreaterThan(f.y + f.h);
    expect(at('d').y).toBeGreaterThan(at('c').y);
    for (const id of ['t', 'c', 'd']) expect(inside(nodeRect(at(id), {}))).toBe(false);
  });

  it('a graph without frames tidies as before', () => {
    const plain = graph({ nodes: g.nodes, edges: g.edges });
    expect(tidyAll(plain, {})).toEqual(tidy(plain, {}));
  });
});

describe('note text', () => {
  it('bold, italics, links and lists, escaped', () => {
    expect(renderNote('**Hi** *there* _you_')).toBe('<p><strong>Hi</strong> <em>there</em> <em>you</em></p>');
    expect(renderNote('[docs](https://castwright.sinist3r.lol)')).toBe(
      '<p><a href="https://castwright.sinist3r.lol" target="_blank" rel="noopener noreferrer">docs</a></p>'
    );
    expect(renderNote('- one\n- two\n\n1. first')).toBe('<ul><li>one</li><li>two</li></ul><ol><li>first</li></ol>');
    expect(renderNote('<b>x</b> & [bad](javascript:alert(1))')).toBe('<p>&lt;b&gt;x&lt;/b&gt; &amp; [bad](javascript:alert(1))</p>');
    expect(renderNote('a\nb\n\nc')).toBe('<p>a<br>b</p><p>c</p>');
    expect(renderNote('snake_case_name')).toBe('<p>snake_case_name</p>');
  });
});
