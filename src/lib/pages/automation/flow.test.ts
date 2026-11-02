import { describe, expect, it } from 'vitest';
import type { Action } from '$lib/bindings/Action';
import type { ActionRun } from '$lib/bindings/ActionRun';
import type { Step } from '$lib/bindings/Step';
import { fromTemplate, newAction, newStep, newTrigger } from './defaults';
import { describeStep } from './describe';
import { layoutFlow, listWidth, neighbour, type FlowCell, type NodeCell } from './flow';
import { ActionHistory } from './history';
import { runStatus, triggerMatches } from './runstatus';
import { groupActions, sectionOf } from './sections';
import { allLists, getList, isInside, moveStepTo, parseStepKey, pathAfterRemove, stepKey } from './tree';

const say = (message: string): Step => ({ type: 'chat_send', message, as_bot: false, reply: false });
const iff = (then: Step[] = [], otherwise: Step[] = []): Step => ({ type: 'if', conditions: { mode: 'all', conditions: [] }, then, else: otherwise });
const stop: Step = { type: 'stop' };

const node = (cells: FlowCell[], key: string) => cells.find((c): c is NodeCell => c.kind === 'node' && c.key === key)!;
const msgs = (steps: readonly Step[]) => steps.map((s) => (s.type === 'chat_send' ? s.message : s.type));

describe('flow layout', () => {
  it('lays out a plain list in one lane', () => {
    const l = layoutFlow([say('a'), say('b')], 1);
    expect(l.cols).toBe(1);
    expect(l.nodes.map((n) => [n.key, n.number, n.row, n.col])).toEqual([
      ['s.0', '1', 1, 0],
      ['s.1', '2', 2, 0]
    ]);
    const end = l.cells.find((c) => c.kind === 'end')!;
    expect(end).toMatchObject({ row: 3, index: 2, empty: false });
    expect(l.rows).toBe(4);
    expect(l.cells.some((c) => c.kind === 'rail')).toBe(false);
  });

  it('handles no steps', () => {
    const l = layoutFlow([], 0);
    expect(l.nodes).toEqual([]);
    expect(l.cells.filter((c) => c.kind === 'end')).toEqual([expect.objectContaining({ empty: true, row: 1, span: 1 })]);
  });

  it('splits an if into two lanes that join below', () => {
    const l = layoutFlow([iff([say('yes'), say('again')], []), say('after')], 1);
    expect(l.cols).toBe(2);
    expect(node(l.cells, 's.0')).toMatchObject({ row: 1, col: 0, span: 2 });
    expect(l.cells.find((c) => c.kind === 'split')).toMatchObject({ row: 2, then: 1 });
    expect(node(l.cells, 's.0.then.0')).toMatchObject({ row: 3, col: 0, span: 1, number: '1.1' });
    expect(node(l.cells, 's.0.then.1')).toMatchObject({ row: 4, col: 0, number: '1.2' });
    // The empty Otherwise lane is just an add point; a line carries it down to the join.
    const ends = l.cells.filter((c) => c.kind === 'end');
    expect(ends).toContainEqual(expect.objectContaining({ path: [{ index: 0, branch: 'else' }], row: 3, col: 1, empty: true }));
    expect(l.cells.filter((c) => c.kind === 'rail')).toEqual([
      { kind: 'rail', path: [{ index: 0, branch: 'else' }], row: 4, rowEnd: 6, col: 1, span: 1 }
    ]);
    expect(l.cells.find((c) => c.kind === 'join')).toMatchObject({ row: 6 });
    expect(node(l.cells, 's.1')).toMatchObject({ row: 7, col: 0, span: 2 });
  });

  it('nests ifs and widens the lane that needs it', () => {
    const steps = [iff([iff([say('deep')], [say('deeper')])], [say('no')])];
    expect(listWidth(steps)).toBe(3);
    const l = layoutFlow(steps, 1);
    expect(node(l.cells, 's.0.then.0')).toMatchObject({ col: 0, span: 2 });
    expect(node(l.cells, 's.0.then.0.then.0')).toMatchObject({ col: 0, span: 1, number: '1.1.1' });
    expect(node(l.cells, 's.0.then.0.else.0')).toMatchObject({ col: 1, span: 1 });
    expect(node(l.cells, 's.0.else.0')).toMatchObject({ col: 2, span: 1, row: node(l.cells, 's.0.then.0').row });
  });

  it('shares extra width between lanes when a sibling is wider', () => {
    const steps = [iff(), iff([iff(), iff()], [])];
    const l = layoutFlow(steps, 1);
    expect(l.cols).toBe(3);
    const split = l.cells.find((c) => c.kind === 'split' && c.key === 's.0')!;
    expect(split).toMatchObject({ span: 3, then: 1 });
    expect(l.cells.filter((c) => c.kind === 'end' && c.path.length === 1 && c.path[0]!.index === 0).map((c) => [c.col, c.span])).toEqual([
      [0, 1],
      [1, 2]
    ]);
  });

  it('makes room for several triggers', () => {
    expect(layoutFlow([say('a')], 3).cols).toBe(3);
    expect(layoutFlow([say('a')], 9).cols).toBe(4);
  });

  it('finds neighbours for arrow keys', () => {
    const steps = [say('a'), iff([say('t1'), say('t2')], [say('e1')]), say('z')];
    const l = layoutFlow(steps, 2);
    const go = (k: string, d: 'up' | 'down' | 'left' | 'right') => neighbour(l, 2, k, d);
    expect(go('t.0', 'right')).toBe('t.1');
    expect(go('t.1', 'right')).toBeNull();
    expect(go('t.1', 'down')).toBe('s.0');
    expect(go('s.0', 'up')).toBe('t.0');
    expect(go('s.0', 'down')).toBe('s.1');
    expect(go('s.1', 'down')).toBe('s.1.then.0');
    expect(go('s.1.then.0', 'right')).toBe('s.1.else.0');
    expect(go('s.1.else.0', 'left')).toBe('s.1.then.0');
    expect(go('s.1.then.1', 'down')).toBe('s.2');
    expect(go('s.1.else.0', 'up')).toBe('s.1');
    expect(go('s.2', 'down')).toBeNull();
  });
});

describe('moving steps', () => {
  const tree = () => [say('a'), say('b'), iff([say('t')], [say('e')]), say('c')];

  it('reads keys back', () => {
    expect(parseStepKey('2.then.1')).toEqual({ path: [{ index: 2, branch: 'then' }], index: 1 });
    expect(parseStepKey(stepKey([{ index: 0, branch: 'else' }, { index: 3, branch: 'then' }], 4))).toEqual({
      path: [{ index: 0, branch: 'else' }, { index: 3, branch: 'then' }],
      index: 4
    });
    expect(parseStepKey('1.maybe.0')).toBeNull();
    expect(parseStepKey('1.then')).toBeNull();
  });

  it('moves within a list', () => {
    expect(msgs(moveStepTo(tree(), { path: [], index: 0 }, { path: [], index: 2 })!.steps)).toEqual(['b', 'a', 'if', 'c']);
    expect(msgs(moveStepTo(tree(), { path: [], index: 3 }, { path: [], index: 0 })!.steps)).toEqual(['c', 'a', 'b', 'if']);
    const end = moveStepTo(tree(), { path: [], index: 0 }, { path: [], index: 4 })!;
    expect(msgs(end.steps)).toEqual(['b', 'if', 'c', 'a']);
    expect(end.at).toEqual({ path: [], index: 3 });
  });

  it('moves into a branch and fixes the path when an earlier step leaves', () => {
    const r = moveStepTo(tree(), { path: [], index: 0 }, { path: [{ index: 2, branch: 'else' }], index: 0 })!;
    expect(r.at).toEqual({ path: [{ index: 1, branch: 'else' }], index: 0 });
    expect(msgs(r.steps)).toEqual(['b', 'if', 'c']);
    expect(msgs(getList(r.steps, r.at.path)!)).toEqual(['a', 'e']);
  });

  it('moves out of a branch and between branches', () => {
    const out = moveStepTo(tree(), { path: [{ index: 2, branch: 'then' }], index: 0 }, { path: [], index: 0 })!;
    expect(msgs(out.steps)).toEqual(['t', 'a', 'b', 'if', 'c']);
    const across = moveStepTo(tree(), { path: [{ index: 2, branch: 'then' }], index: 0 }, { path: [{ index: 2, branch: 'else' }], index: 1 })!;
    expect(msgs(getList(across.steps, [{ index: 2, branch: 'else' }])!)).toEqual(['e', 't']);
    expect(getList(across.steps, [{ index: 2, branch: 'then' }])).toEqual([]);
  });

  it('refuses to put an if inside itself', () => {
    expect(moveStepTo(tree(), { path: [], index: 2 }, { path: [{ index: 2, branch: 'then' }], index: 0 })).toBeNull();
    expect(isInside([{ index: 2, branch: 'then' }, { index: 0, branch: 'else' }], [], 2)).toBe(true);
    expect(isInside([{ index: 1, branch: 'then' }], [], 2)).toBe(false);
    expect(moveStepTo(tree(), { path: [], index: 9 }, { path: [], index: 0 })).toBeNull();
  });

  it('adjusts deeper paths', () => {
    expect(pathAfterRemove([{ index: 3, branch: 'then' }, { index: 1, branch: 'else' }], [], 0)).toEqual([
      { index: 2, branch: 'then' },
      { index: 1, branch: 'else' }
    ]);
    expect(pathAfterRemove([{ index: 3, branch: 'then' }], [{ index: 3, branch: 'then' }], 0)).toEqual([{ index: 3, branch: 'then' }]);
  });

  it('lists every branch for the move menu', () => {
    expect(allLists([say('a'), iff([iff()], [])]).map((l) => l.label)).toEqual([
      'Main steps',
      'Then of step 2',
      'Then of step 2.1',
      'Otherwise of step 2.1',
      'Otherwise of step 2'
    ]);
  });
});

describe('undo history', () => {
  it('keeps one history per action and merges typing', () => {
    const h = new ActionHistory(10, 1000);
    const a = newAction({ name: 'One' });
    const b = newAction({ name: 'Other' });
    h.record({ ...a, name: 'O' }, 'name', 0);
    h.record({ ...a, name: 'On' }, 'name', 500);
    h.record({ ...b, name: 'x' }, 'name', 600);
    expect(h.canUndo(a.id)).toBe(true);
    const prev = h.undo(a)!;
    expect(prev.name).toBe('O');
    expect(h.canUndo(a.id)).toBe(false);
    expect(h.canRedo(a.id)).toBe(true);
    expect(h.redo(prev)!.name).toBe('One');
    expect(h.undo(b)!.name).toBe('x');
    h.forget(a.id);
    expect(h.canRedo(a.id)).toBe(false);
  });

  it('starts a new step after a seal', () => {
    const h = new ActionHistory();
    const a = newAction();
    h.record(a, 'k', 0);
    h.seal(a.id);
    h.record(a, 'k', 10);
    expect(h.undo(a)).not.toBeNull();
    expect(h.undo(a)).not.toBeNull();
    expect(h.undo(a)).toBeNull();
  });
});

describe('run status', () => {
  const action = (steps: Step[]): Action => newAction({ steps, triggers: [newTrigger('manual'), { ...newTrigger('command'), name: 'go' } as never] });
  const run = (errors: string[] = [], trigger = 'manual'): ActionRun => ({ action_id: 'x', name: 'x', trigger, ok: !errors.length, errors, duration_ms: 3 });

  it('marks a clean run', () => {
    const s = runStatus(action([say('a'), iff([say('t')], [say('e')]), say('z')]), run());
    expect(s['s.0']!.state).toBe('ok');
    expect(s['s.1']!.state).toBe('ok');
    expect(s['s.2']!.state).toBe('ok');
    // Can't tell which branch ran.
    expect(s['s.1.then.0']).toBeUndefined();
    expect(s['t.0']!.state).toBe('ok');
    expect(s['t.1']).toBeUndefined();
  });

  it('finds the failed step and the branch it was in', () => {
    const steps = [say('a'), iff([{ type: 'shoutout', user: 'x', message: '' }], [say('e')]), say('z')];
    const s = runStatus(action(steps), run(['Shoutout: Twitch isn’t connected.'], '!go'));
    expect(s['s.1.then.0']).toEqual({ state: 'failed', errors: ['Twitch isn’t connected.'] });
    expect(s['s.1.else.0']!.state).toBe('skipped');
    expect(s['s.2']!.state).toBe('ok');
    expect(s['t.1']!.state).toBe('failed');
  });

  it('marks every candidate when the label is shared', () => {
    const s = runStatus(action([say('a'), say('b')]), run(['Send chat message: no chat']));
    expect(s['s.0']!.state).toBe('failed');
    expect(s['s.1']!.state).toBe('failed');
  });

  it('skips steps after a stop', () => {
    const s = runStatus(action([say('a'), stop, say('b')]), run());
    expect(s['s.1']!.state).toBe('ok');
    expect(s['s.2']!.state).toBe('skipped');
  });

  it('is unsure after a branch that may stop', () => {
    const s = runStatus(action([iff([stop], []), say('b')]), run());
    expect(s['s.0']!.state).toBe('ok');
    expect(s['s.1']).toBeUndefined();
  });

  it('matches triggers', () => {
    expect(triggerMatches({ type: 'command', name: 'so', aliases: ['shoutout'], permission: 'everyone', user_cooldown_s: 0 }, '!Shoutout')).toBe(true);
    expect(triggerMatches(newTrigger('timer'), 'timer')).toBe(true);
    expect(triggerMatches(newTrigger('scene_changed'), 'scene change')).toBe(true);
    expect(triggerMatches({ type: 'event', kind: 'raid', conditions: { mode: 'all', conditions: [] } }, 'raid')).toBe(true);
    expect(triggerMatches(newTrigger('manual'), 'timer')).toBe(false);
  });
});

describe('action list sections', () => {
  it('uses the group, or the trigger when the group is General', () => {
    expect(sectionOf(fromTemplate('timer'))).toBe('Timers');
    expect(sectionOf(newAction({ triggers: [newTrigger('command')] }))).toBe('Chat commands');
    expect(sectionOf(newAction({ triggers: [newTrigger('stream_online')] }))).toBe('Stream events');
    expect(sectionOf(newAction())).toBe('Buttons and Stream Deck');
    expect(sectionOf(newAction({ group: 'Mod tools', triggers: [newTrigger('command')] }))).toBe('Mod tools');
  });

  it('orders built-in sections first and filters by search', () => {
    const list = [
      newAction({ name: 'Zeta', group: 'Zoo' }),
      newAction({ name: 'Alpha', group: 'Art' }),
      fromTemplate('timer'),
      fromTemplate('deaths'),
      newAction({ name: 'Deck', triggers: [newTrigger('manual')] })
    ];
    expect(groupActions(list).map((g) => g.name)).toEqual(['Chat commands', 'Timers', 'Buttons and Stream Deck', 'Art', 'Zoo']);
    expect(groupActions(list, 'death').map((g) => [g.name, g.actions.map((a) => a.name)])).toEqual([['Chat commands', ['Deaths counter']]]);
    expect(groupActions(list, 'every 15').map((g) => g.name)).toEqual(['Timers']);
  });
});

describe('step summaries', () => {
  it('says what each step does in one line', () => {
    expect(describeStep(say('Hi {{name}}'))).toBe('Hi {{name}}');
    expect(describeStep(newStep('chat_send'))).toBe('');
    expect(describeStep({ type: 'add_to_variable', key: 'counter.deaths', amount: 1, persist: true })).toBe('counter.deaths + 1');
    expect(describeStep({ type: 'add_to_variable', key: 'n', amount: -2, persist: true })).toBe('n − 2');
    expect(describeStep({ type: 'delay', ms: 4000 })).toBe('Wait 4 s');
    expect(describeStep({ type: 'switch_scene', scene: 'BRB' })).toBe('Go to “BRB”');
    expect(describeStep({ type: 'set_input_mute', input: 'Mic', state: 'on' })).toBe('Mute “Mic”');
    expect(describeStep({ type: 'http_request', method: 'post', url: 'https://x.test', body: '', save_to: '' })).toBe('POST https://x.test');
    expect(describeStep({ type: 'run_script', code: '// hi\nlet x = 1;' })).toBe('let x = 1;');
    expect(describeStep(iff())).toBe('Always true');
    const other = newAction({ name: 'Other' });
    expect(describeStep({ type: 'run_action', action_id: other.id }, { actions: [other] })).toBe('Run “Other”');
    expect(describeStep({ type: 'run_action', action_id: 'gone' }, { actions: [other] })).toBe('');
    for (const type of ['create_clip', 'save_replay', 'stop', 'recording', 'run_ad'] as const) expect(describeStep(newStep(type))).not.toBe('');
  });
});
