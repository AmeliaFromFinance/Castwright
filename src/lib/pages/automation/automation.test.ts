import { describe, expect, it } from 'vitest';
import starter from '$lib/api/fixtures/starter-project.json';
import type { Action } from '$lib/bindings/Action';
import type { Project } from '$lib/bindings/Project';
import type { Step } from '$lib/bindings/Step';
import type { Trigger } from '$lib/bindings/Trigger';
import { KIND_LABELS } from '$lib/format';
import type { EventKind } from '$lib/bindings/EventKind';
import {
  STEP_GROUPS,
  STEP_LABELS,
  TEMPLATE_MENU,
  TRIGGER_LABELS,
  fromTemplate,
  newAction,
  newStep,
  newTrigger,
  triggerKinds,
  type StepType,
  type TriggerType
} from './defaults';
import { child, countSteps, duplicateStep, getList, insertStep, moveStep, removeStep, replaceStep, stepKey, walk } from './tree';
import { blocking, commandName, isValidVarKey, parseVarValue, validateAction, varText } from './validate';

const project = starter as unknown as Project;
const roundTrip = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// Fields Rust fills in with #[serde(default)] when they're missing.
const SERDE_DEFAULTS: Partial<Record<string, Record<string, unknown>>> = {
  event: { conditions: { mode: 'all', conditions: [] } },
  command: { aliases: [], permission: 'everyone', user_cooldown_s: 0 },
  timer: { only_when_live: false, min_chat_lines: 0 },
  scene_changed: { scene: '' },
  chat_send: { as_bot: false, reply: false },
  chat_announce: { color: '' },
  shoutout: { message: '' },
  create_marker: { description: '' },
  set_stream_info: { title: '', category: '' },
  timeout_user: { reason: '' },
  set_variable: { persist: false },
  add_to_variable: { persist: false },
  set_source_visible: { scene: '', state: 'on' },
  set_input_mute: { state: 'on' },
  recording: { state: 'on' },
  set_layer_visible: { state: 'on' },
  play_alert: { message: '', image: '', sound: '', duration_ms: 6000 },
  play_sound: { volume: 70 },
  http_request: { method: 'get', body: '', save_to: '' },
  if: { then: [], else: [] }
};

describe('defaults', () => {
  it('every trigger type has a default that round-trips', () => {
    for (const type of Object.keys(TRIGGER_LABELS) as TriggerType[]) {
      const t = newTrigger(type);
      expect(t.type).toBe(type);
      expect(roundTrip<Trigger>(t)).toEqual(t);
      expect(t).toMatchObject(SERDE_DEFAULTS[type] ?? {});
    }
  });

  it('every step type has a default that round-trips and appears in the menu', () => {
    const inMenu = STEP_GROUPS.flatMap((g) => g.items.map(([t]) => t));
    for (const type of Object.keys(STEP_LABELS) as StepType[]) {
      const s = newStep(type);
      expect(s.type).toBe(type);
      expect(roundTrip<Step>(s)).toEqual(s);
      expect(s).toMatchObject(SERDE_DEFAULTS[type] ?? {});
      expect(inMenu).toContain(type);
    }
    expect(new Set(inMenu).size).toBe(inMenu.length);
  });

  it('new actions match the Rust default', () => {
    const a = newAction();
    expect(a).toMatchObject({ name: 'New action', group: 'General', enabled: true, triggers: [], steps: [], cooldown_s: 0 });
    expect(a.id).toMatch(/^[a-z0-9]{12}$/);
    expect(newAction().id).not.toBe(a.id);
  });

  it('templates are valid', () => {
    for (const g of TEMPLATE_MENU)
      for (const it of g.items) {
        const a = fromTemplate(it.value);
        expect(roundTrip<Action>(a)).toEqual(a);
        expect(blocking(validateAction(a, [a]))).toEqual([]);
      }
  });

  it('event triggers exclude chat', () => {
    const kinds = triggerKinds(Object.keys(KIND_LABELS) as EventKind[]);
    expect(kinds).not.toContain('chat');
    expect(kinds).toContain('raid');
  });
});

const say = (message: string): Step => ({ type: 'chat_send', message, as_bot: false, reply: false });
const iff = (then: Step[], otherwise: Step[] = []): Step => ({
  type: 'if',
  conditions: { mode: 'all', conditions: [] },
  then,
  else: otherwise
});

describe('step tree', () => {
  const tree = (): Step[] => [say('a'), iff([say('b'), iff([say('c')])], [say('d')]), say('e')];

  it('gets nested lists', () => {
    const t = tree();
    expect(getList(t, [])).toBe(t);
    expect(getList(t, [{ index: 1, branch: 'else' }])).toEqual([say('d')]);
    expect(getList(t, child(child([], 1, 'then'), 1, 'then'))).toEqual([say('c')]);
    expect(getList(t, [{ index: 0, branch: 'then' }])).toBeNull();
  });

  it('inserts, removes, moves and replaces by path', () => {
    const t = tree();
    const deep = child(child([], 1, 'then'), 1, 'then');
    const inserted = insertStep(t, deep, 0, say('x'));
    expect(getList(inserted, deep)).toEqual([say('x'), say('c')]);
    expect(t).toEqual(tree());

    const removed = removeStep(t, [{ index: 1, branch: 'then' }], 0);
    expect(getList(removed, [{ index: 1, branch: 'then' }])).toHaveLength(1);

    const moved = moveStep(t, [], 2, -2);
    expect(moved.map((s) => s.type)).toEqual(['chat_send', 'chat_send', 'if']);
    expect((moved[0] as Extract<Step, { type: 'chat_send' }>).message).toBe('e');

    const replaced = replaceStep(t, [{ index: 1, branch: 'else' }], 0, say('z'));
    expect(getList(replaced, [{ index: 1, branch: 'else' }])).toEqual([say('z')]);
    expect(replaceStep(t, [], 9, say('z'))).toEqual(t);
  });

  it('duplicates deep copies', () => {
    const t = tree();
    const d = duplicateStep(t, [], 1);
    expect(d).toHaveLength(4);
    expect(d[2]).toEqual(d[1]);
    expect(d[2]).not.toBe(d[1]);
  });

  it('ignores bad paths', () => {
    const t = tree();
    expect(insertStep(t, [{ index: 0, branch: 'then' }], 0, say('x'))).toEqual(t);
  });

  it('walks and keys', () => {
    const t = tree();
    expect(countSteps(t)).toBe(7);
    const keys = walk(t).map((w) => stepKey(w.path, w.index));
    expect(keys).toEqual(['0', '1', '1.then.0', '1.then.1', '1.then.1.then.0', '1.else.0', '2']);
  });
});

describe('validation', () => {
  const base = (patch: Partial<Action>) => newAction({ name: 'Test', ...patch });

  it('needs a name', () => {
    expect(validateAction(base({ name: ' ' }), []).map((i) => i.key)).toEqual(['name']);
  });

  it('checks command triggers', () => {
    const cmd = (name: string, aliases: string[] = []): Trigger => ({ type: 'command', name, aliases, permission: 'everyone', user_cooldown_s: 0 });
    expect(validateAction(base({ triggers: [cmd('')] }), [])[0]).toMatchObject({ key: 'trigger.0' });
    expect(validateAction(base({ triggers: [cmd('two words')] }), [])).toHaveLength(1);
    expect(validateAction(base({ triggers: [cmd('!so')] }), [])).toEqual([]);
    expect(validateAction(base({ triggers: [cmd('so', ['a b'])] }), [])).toHaveLength(1);
    const other = base({ name: 'Other', triggers: [cmd('x', ['SO'])] });
    const issues = validateAction(base({ triggers: [cmd('so')] }), [other]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.warn).toBe(true);
    expect(blocking(issues)).toEqual([]);
    expect(commandName(' !!hi ')).toBe('hi');
  });

  it('explains the timer minimum', () => {
    const issues = validateAction(base({ triggers: [{ type: 'timer', interval_s: 5, only_when_live: false, min_chat_lines: 0 }] }), []);
    expect(issues[0]!.message).toMatch(/10 seconds/);
  });

  it('checks steps, including nested ones', () => {
    const a = base({
      steps: [
        { type: 'set_variable', key: 'bad key!', value: '1', persist: false },
        iff([{ type: 'add_to_variable', key: '{{arg1}}.count', amount: 1, persist: false }, { type: 'run_action', action_id: '' }]),
        { type: 'http_request', method: 'get', url: 'ftp://x', body: '', save_to: '' }
      ]
    });
    const keys = validateAction(a, [a]).map((i) => i.key);
    expect(keys).toEqual(['step.0', 'step.1.then.1', 'step.2']);
  });

  it('an action cannot run itself', () => {
    const a = base({});
    a.steps = [{ type: 'run_action', action_id: a.id }];
    expect(validateAction(a, [a])[0]!.message).toMatch(/itself/);
  });

  it('checks overlay layers', () => {
    const a = base({ steps: [{ type: 'set_layer_visible', overlay_id: 'nope', layer_id: 'x', state: 'on' }] });
    expect(validateAction(a, [a], project.overlays)).toHaveLength(1);
    const o = project.overlays[0]!;
    a.steps = [{ type: 'set_layer_visible', overlay_id: o.id, layer_id: o.layers[0]!.id, state: 'toggle' }];
    expect(validateAction(a, [a], project.overlays)).toEqual([]);
  });

  it('starter actions are valid', () => {
    for (const a of project.actions) expect(blocking(validateAction(a, project.actions, project.overlays))).toEqual([]);
  });

  it('variable keys follow the backend rule', () => {
    for (const k of ['a', 'counter.deaths', 'a_b-c.1']) expect(isValidVarKey(k)).toBe(true);
    for (const k of ['', '.a', 'a.', 'a..b', 'a b', 'ä', 'x'.repeat(129)]) expect(isValidVarKey(k)).toBe(false);
  });

  it('parses variable values', () => {
    expect(parseVarValue('12', 3)).toBe(12);
    expect(parseVarValue(' 1.5 ')).toBe(1.5);
    expect(parseVarValue('true')).toBe(true);
    expect(parseVarValue('12', 'old text')).toBe('12');
    expect(parseVarValue('hello', 3)).toBe('hello');
    expect(varText(7)).toBe('7');
    expect(varText(null)).toBe('');
    expect(varText({ a: 1 })).toBe('{"a":1}');
  });
});
