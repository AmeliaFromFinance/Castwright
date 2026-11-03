import { describe, expect, it } from 'vitest';
import type { ActionRun } from '$lib/bindings/ActionRun';
import type { RunProgress } from '$lib/bindings/RunProgress';
import { HISTORY_KEEP, addToHistory, applyProgress, finishTrace, traceView, type Trace } from './trace';
import { EDGE_BAND, EDGE_SPEED, edgePan } from './view';

const p = (node_id: string, via: string | null, state: RunProgress['state'], run_id = 1): RunProgress => ({ run_id, action_id: 'a', node_id, via, state });

function run(run_id = 1, extra: Partial<ActionRun> = {}): ActionRun {
  return {
    run_id,
    action_id: 'a',
    name: 'A',
    trigger: 'manual',
    ok: false,
    errors: ['Wait: oops'],
    duration_ms: 12,
    nodes: [
      { node_id: 't', state: 'ok', errors: [] },
      { node_id: 'w', state: 'error', errors: ['oops'] },
      { node_id: 'x', state: 'skipped', errors: [] }
    ],
    steps: [
      { node_id: 't', via: null, state: 'ok' },
      { node_id: 'w', via: 't>w', state: 'error' },
      { node_id: 'c', via: 'w>c', state: 'ok' }
    ],
    ...extra
  };
}

describe('live trace', () => {
  it('marks a node running, then done, and lights the lines taken', () => {
    let t = applyProgress(undefined, p('t', null, 'ok'));
    t = applyProgress(t, p('w', 't>w', null));
    let v = traceView(t);
    expect(v.nodes.get('t')?.state).toBe('ok');
    expect(v.nodes.get('w')?.state).toBe('running');
    expect([...v.edges]).toEqual(['t>w']);
    expect(v.latest).toBe('t>w');
    expect(v.current).toBeNull();
    t = applyProgress(t, p('w', 't>w', 'error'));
    t = applyProgress(t, p('c', 'w>c', null));
    v = traceView(t);
    expect(v.nodes.get('w')?.state).toBe('failed');
    expect(v.nodes.get('c')?.state).toBe('running');
    expect(v.edges).toEqual(new Set(['t>w', 'w>c']));
    expect(t.steps).toHaveLength(3);
  });

  it('starts over when another run reports', () => {
    const t = applyProgress(applyProgress(undefined, p('t', null, 'ok')), p('t', null, 'ok', 2));
    expect(t.runId).toBe(2);
    expect(t.steps).toHaveLength(1);
  });

  it('a node reached twice keeps both steps', () => {
    let t = applyProgress(undefined, p('m', 'a>m', null));
    t = applyProgress(t, p('m', 'a>m', 'ok'));
    t = applyProgress(t, p('m', 'b>m', null));
    expect(traceView(t).nodes.get('m')?.state).toBe('running');
    t = applyProgress(t, p('m', 'b>m', 'ok'));
    expect(t.steps.map((s) => s.state)).toEqual(['ok', 'ok']);
    expect(traceView(t).edges).toEqual(new Set(['a>m', 'b>m']));
  });
});

describe('finished trace', () => {
  it('shows skipped nodes and errors once the whole run is in view', () => {
    const t = finishTrace(run());
    const all = traceView(t);
    expect(all.nodes.get('x')?.state).toBe('skipped');
    expect(all.nodes.get('w')).toEqual({ state: 'failed', errors: ['oops'] });
    // Stepping through: only what had happened by then, and the step's node.
    const first = traceView(t, 0);
    expect([...first.nodes.keys()]).toEqual(['t']);
    expect(first.edges.size).toBe(0);
    expect(first.current).toBe('t');
    const second = traceView(t, 1);
    expect(second.edges).toEqual(new Set(['t>w']));
    expect(second.current).toBe('w');
    expect(second.nodes.has('x')).toBe(false);
    expect(traceView(t, 99).current).toBe('c');
  });

  it('is empty without a trace', () => {
    expect(traceView(undefined).nodes.size).toBe(0);
  });
});

describe('run history', () => {
  it('keeps the newest runs first, without repeats', () => {
    let list: Trace[] = [];
    for (let i = 1; i <= HISTORY_KEEP + 3; i++) list = addToHistory(list, finishTrace(run(i)));
    expect(list).toHaveLength(HISTORY_KEEP);
    expect(list[0]!.runId).toBe(HISTORY_KEEP + 3);
    expect(list.at(-1)!.runId).toBe(4);
    list = addToHistory(list, finishTrace(run(HISTORY_KEEP + 3, { ok: true })));
    expect(list).toHaveLength(HISTORY_KEEP);
    expect(list[0]!.run?.ok).toBe(true);
  });
});

describe('panning at the canvas edges', () => {
  const W = 800;
  const H = 600;

  it('does nothing away from the edges', () => {
    expect(edgePan({ x: 400, y: 300 }, W, H)).toEqual({ x: 0, y: 0 });
    expect(edgePan({ x: EDGE_BAND, y: H - EDGE_BAND }, W, H)).toEqual({ x: 0, y: 0 });
  });

  it('pans toward the edge, faster closer to it', () => {
    const near = edgePan({ x: 30, y: 300 }, W, H);
    const nearer = edgePan({ x: 5, y: 300 }, W, H);
    expect(near.x).toBeGreaterThan(0);
    expect(nearer.x).toBeGreaterThan(near.x);
    expect(near.y).toBe(0);
    // Right and bottom edges pan the other way.
    const corner = edgePan({ x: W - 5, y: H - 5 }, W, H);
    expect(corner.x).toBeLessThan(0);
    expect(corner.y).toBeLessThan(0);
  });

  it('is fastest at and past the edge', () => {
    expect(edgePan({ x: 0, y: 300 }, W, H).x).toBeCloseTo(EDGE_SPEED);
    expect(edgePan({ x: -200, y: -50 }, W, H)).toEqual({ x: EDGE_SPEED, y: EDGE_SPEED });
  });

  it('scales with frame time and ignores long pauses', () => {
    const one = edgePan({ x: 0, y: 300 }, W, H, 1000 / 60).x;
    expect(edgePan({ x: 0, y: 300 }, W, H, 2000 / 60).x).toBeCloseTo(one * 2);
    expect(edgePan({ x: 0, y: 300 }, W, H, 5000).x).toBeCloseTo(one * 3);
  });

  it('stays still in a tiny canvas', () => {
    expect(edgePan({ x: 0, y: 0 }, 100, 100)).toEqual({ x: 0, y: 0 });
  });
});
