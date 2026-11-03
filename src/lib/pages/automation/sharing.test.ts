import { describe, expect, it } from 'vitest';
import type { Action } from '$lib/bindings/Action';
import type { Overlay } from '$lib/bindings/Overlay';
import type { Step } from '$lib/bindings/Step';
import { baseLayer } from '$lib/editor/layers';
import { newAction } from './defaults';
import { fromTree } from './graph';
import { ACTIONS_VERSION, applyImport, buildPackage, importChoices, isSecretName, parsePackage, planImport, stepsOf, type LocalState } from './sharing';

const action = (name: string, steps: Step[]): Action =>
  newAction({ name, triggers: [{ type: 'manual' }], graph: fromTree([{ type: 'manual' }], steps) });

function overlay(name: string, layer: string): Overlay {
  return { id: `o-${name}`, name, width: 1920, height: 1080, layers: [{ ...baseLayer(), id: `l-${layer}`, name: layer }], fonts: [], updated_at: 0 };
}

/** A project to export from: an action pointing at a layer, a sound and two other actions. */
function source() {
  const main = overlay('Main', 'Webcam frame');
  const helper = action('Helper', [{ type: 'log', message: 'hi' }]);
  const outside = action('Outside', []);
  const hype = action('Hype', [
    { type: 'add_to_variable', key: 'counter.hype', amount: 1, persist: true },
    { type: 'chat_send', message: '{{counter.hype}} {{api.token}} {{name}}', as_bot: false, reply: false },
    { type: 'set_layer_visible', overlay_id: main.id, layer_id: main.layers[0]!.id, state: 'on' },
    { type: 'play_sound', src: 'assets/ding.mp3', volume: 70 },
    { type: 'run_action', action_id: helper.id },
    { type: 'run_action', action_id: outside.id }
  ]);
  const vars = { 'counter.hype': 41, 'api.token': 's3cret', 'session.subs': 3 };
  return { actions: [hype, helper, outside], overlays: [main], vars };
}

function exported() {
  const s = source();
  const pkg = buildPackage(s.actions, [s.actions[0]!.id, s.actions[1]!.id], s.overlays, s.vars);
  return { ...s, pkg: parsePackage(JSON.stringify(pkg)) };
}

const empty = (patch: Partial<LocalState> = {}): LocalState => ({ actions: [], overlays: [], assets: [], vars: {}, ...patch });

describe('action packages', () => {
  it('stores references by name and leaves secrets out', () => {
    const { pkg } = exported();
    expect(pkg.version).toBe(ACTIONS_VERSION);
    expect(pkg.refs.map((r) => [r.kind, r.name])).toEqual([
      ['action', 'Outside'],
      ['asset', 'ding.mp3'],
      ['layer', 'Webcam frame']
    ]);
    expect(pkg.refs.find((r) => r.kind === 'layer')!.overlay_name).toBe('Main');
    expect(pkg.variables).toEqual([
      { name: 'api.token', default: null, secret: true },
      { name: 'counter.hype', default: 0, secret: false }
    ]);
    expect(JSON.stringify(pkg)).not.toContain('s3cret');
  });

  it('refuses newer versions and other files', () => {
    const { pkg } = exported();
    expect(() => parsePackage(JSON.stringify({ ...pkg, version: ACTIONS_VERSION + 1 }))).toThrow(
      expect.objectContaining({ message: expect.stringContaining('newer version') })
    );
    expect(() => parsePackage('nope')).toThrow(expect.objectContaining({ message: "That isn't a Castwright actions file." }));
    expect(() => parsePackage(JSON.stringify({ ...pkg, actions: [] }))).toThrow(expect.objectContaining({ message: 'That file has no actions in it.' }));
    const sneaky = { ...pkg, variables: [{ name: 'my.password', default: 'x', secret: false }] };
    expect(parsePackage(JSON.stringify(sneaky)).variables[0]).toEqual({ name: 'my.password', default: null, secret: true });
  });

  it('names secrets by their parts', () => {
    expect(['twitch_api_key', 'my.password', 'discord-webhook'].every(isSecretName)).toBe(true);
    expect(['counter.deaths', 'monkey.count'].some(isSecretName)).toBe(false);
  });
});

describe('planning an import', () => {
  it('finds name conflicts, links by name and lists new variables', () => {
    const { pkg } = exported();
    const cam = overlay('Gameplay', 'webcam frame');
    const mine = action('hype', []);
    const plan = planImport(pkg, empty({ actions: [mine], overlays: [cam], assets: ['chime.ogg'], vars: { 'counter.hype': 5 } }));

    expect(plan.actions.map((a) => [a.name, a.conflict, a.steps])).toEqual([
      ['Hype', 'hype', 6],
      ['Helper', null, 1]
    ]);
    expect(plan.actions[0]!.triggers).toBe('Button or Stream Deck');
    const byKind = Object.fromEntries(plan.refs.map((r) => [r.ref.kind, r]));
    expect(byKind.layer!.match).toBe(`${cam.id}/${cam.layers[0]!.id}`);
    expect(byKind.layer!.options.map((o) => o.label)).toEqual(['Gameplay › webcam frame']);
    expect(byKind.asset!.match).toBeNull();
    expect(byKind.action!.match).toBeNull();
    expect(plan.newVars.map((v) => v.name)).toEqual(['api.token']);
  });

  it('hides references that already point at the same thing', () => {
    const s = exported();
    const plan = planImport(s.pkg, empty({ actions: s.actions, overlays: s.overlays, assets: ['ding.mp3'] }));
    expect(plan.refs).toEqual([]);
  });

  it('turns dialog choices into backend choices', () => {
    const { pkg } = exported();
    const plan = planImport(pkg, empty({ actions: [action('Hype', [])] }));
    const c = importChoices(plan, {}, { [plan.refs[0]!.key]: 'x' });
    expect(c.conflicts).toEqual({ [pkg.actions[0]!.id]: 'keep_both' });
    expect(Object.values(c.links)).toEqual(['x', null, null]);
  });
});

describe('the demo import', () => {
  it('relinks, resolves conflicts and starts turned off', () => {
    const { pkg } = exported();
    const cam = overlay('Gameplay', 'Cam');
    const mine = { ...action('Hype', [{ type: 'log', message: 'mine' }]), enabled: true };
    const actions = [mine];
    const plan = planImport(pkg, empty({ actions, overlays: [cam], assets: ['chime.ogg'] }));
    const links = Object.fromEntries(
      plan.refs.map((r) => [r.key, r.ref.kind === 'layer' ? `${cam.id}/${cam.layers[0]!.id}` : r.ref.kind === 'asset' ? 'chime.ogg' : null])
    );
    const { report, vars } = applyImport(actions, [cam], ['chime.ogg'], pkg, importChoices(plan, { [pkg.actions[0]!.id]: 'replace' }, links));

    expect(report).toMatchObject({ added: 1, replaced: 1, skipped: 0, unlinked: 1, first_id: mine.id });
    expect(actions.map((a) => [a.name, a.enabled])).toEqual([
      ['Hype', false],
      ['Helper', false]
    ]);
    const steps = stepsOf(actions[0]!);
    expect(steps).toContainEqual({ type: 'set_layer_visible', overlay_id: cam.id, layer_id: cam.layers[0]!.id, state: 'on' });
    expect(steps).toContainEqual({ type: 'play_sound', src: 'assets/chime.ogg', volume: 70 });
    expect(steps).toContainEqual({ type: 'run_action', action_id: actions[1]!.id });
    expect(steps).toContainEqual({ type: 'run_action', action_id: '' });
    expect(vars).toEqual([['counter.hype', 0]]);
  });

  it('keeps both with a free name', () => {
    const { pkg } = exported();
    const actions = [action('Hype', []), action('Hype (2)', [])];
    const { report } = applyImport(actions, [], [], pkg, { conflicts: {}, links: {} });
    expect(report.added).toBe(2);
    expect(actions.map((a) => a.name)).toEqual(['Hype', 'Hype (2)', 'Hype (3)', 'Helper']);
  });
});

describe('notes and frames', () => {
  it('travel in the file and come back on import', () => {
    const s = source();
    const hype = s.actions[0]!;
    const ids = hype.graph.nodes.slice(0, 2).map((n) => n.id);
    hype.graph.notes = [{ id: 'note', x: 0, y: -200, w: 240, h: 160, text: '**Read me**', color: 'pink' }];
    hype.graph.frames = [{ id: 'frame', x: -40, y: -60, w: 600, h: 400, label: 'Start', color: 'green', collapsed: true, members: [...ids, 'note'] }];
    const pkg = parsePackage(JSON.stringify(buildPackage(s.actions, [hype.id], s.overlays, s.vars)));
    const actions: Action[] = [];
    applyImport(actions, [], [], pkg, importChoices(planImport(pkg, empty()), {}, {}));
    const g = actions[0]!.graph;
    expect(g.notes[0]!.text).toBe('**Read me**');
    expect(g.frames[0]).toMatchObject({ label: 'Start', color: 'green', collapsed: true });
    expect(g.frames[0]!.members).toEqual([...ids, 'note']);
  });

  it('files from before them load with empty lists', () => {
    const { pkg } = exported();
    const old = JSON.parse(JSON.stringify(pkg));
    for (const a of old.actions) {
      delete a.graph.notes;
      delete a.graph.frames;
    }
    const back = parsePackage(JSON.stringify(old));
    expect(back.actions.every((a) => Array.isArray(a.graph.notes) && Array.isArray(a.graph.frames))).toBe(true);
  });
});
