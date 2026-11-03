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
import { fromTree, syncTriggers } from './graph';
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
  delete_message: { message_id: '' },
  set_chat_mode: { state: 'on', value: 0 },
  set_variable: { persist: false },
  add_to_variable: { persist: false },
  set_source_visible: { scene: '', state: 'on' },
  set_input_mute: { state: 'on' },
  recording: { state: 'on' },
  set_layer_visible: { state: 'on' },
  play_alert: { message: '', image: '', sound: '', duration_ms: 6000 },
  pause_alerts: { state: 'on' },
  play_sound: { volume: 70 },
  http_request: { method: 'get', body: '', save_to: '' },
  if: { then: [], else: [] },
  redemption: { reward_id: '', reward_title: '' },
  finish_redemption: { refund: false },
  start_poll: { points_per_vote: 0 },
  end_prediction: { winner: '' }
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
    expect(a).toMatchObject({ name: 'New action', group: 'General', enabled: true, triggers: [], steps: [], graph: { nodes: [], edges: [] }, cooldown_s: 0 });
    expect(a.id).toMatch(/^[a-z0-9]{12}$/);
    expect(newAction().id).not.toBe(a.id);
  });

  it('templates are valid', () => {
    for (const g of TEMPLATE_MENU)
      for (const it of g.items) {
        const a = fromTemplate(it.value);
        expect(roundTrip<Action>(a)).toEqual(a);
        expect(validateAction(a, [a])).toEqual([]);
        expect(a.triggers).toHaveLength(a.graph.nodes.filter((n) => n.kind.type === 'trigger').length);
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

describe('validation', () => {
  const base = (patch: Partial<Action> & { steps?: Step[] }) => {
    const { triggers = [], steps = [], ...rest } = patch;
    const a = newAction({ name: 'Test', ...rest, graph: fromTree(triggers, steps) });
    syncTriggers(a);
    return a;
  };
  /** Trigger or step type of the node an issue is about. */
  const typeOf = (a: Action, key: string) => {
    const n = a.graph.nodes.find((x) => `node.${x.id}` === key);
    return n?.kind.type === 'trigger' ? n.kind.trigger.type : n?.kind.step.type;
  };

  it('checks channel point, poll and prediction steps', () => {
    const redeem: Trigger = { type: 'redemption', reward_id: '', reward_title: '' };
    const finish: Step = { type: 'finish_redemption', refund: false };
    expect(validateAction(base({ triggers: [redeem], steps: [finish] }), [])).toEqual([]);
    expect(validateAction(base({ triggers: [{ type: 'manual' }], steps: [finish] }), [])[0]!.warn).toBe(true);

    const poll = (choices: string[], duration_s = 60): Step => ({ type: 'start_poll', title: 'Q', choices, duration_s, points_per_vote: 0 });
    expect(validateAction(base({ triggers: [{ type: 'manual' }], steps: [poll(['A', 'B'])] }), [])).toEqual([]);
    expect(blocking(validateAction(base({ triggers: [{ type: 'manual' }], steps: [poll(['A', ''])] }), []))).toHaveLength(1);
    expect(blocking(validateAction(base({ triggers: [{ type: 'manual' }], steps: [poll(['A', 'B'], 5)] }), []))).toHaveLength(1);

    const cost = (c: string): Step => ({ type: 'set_reward_cost', reward_id: 'r', reward_title: 'Hydrate', cost: c });
    expect(validateAction(base({ triggers: [{ type: 'manual' }], steps: [cost('{{counter.price}}')] }), [])).toEqual([]);
    expect(validateAction(base({ triggers: [{ type: 'manual' }], steps: [cost('0')] }), [])).toHaveLength(1);
    const resolve: Step = { type: 'end_prediction', action: 'resolve', winner: ' ' };
    expect(validateAction(base({ triggers: [{ type: 'manual' }], steps: [resolve] }), [])).toHaveLength(1);
  });

  it('needs a name', () => {
    expect(validateAction(base({ name: ' ' }), []).map((i) => i.key)).toEqual(['name']);
  });

  it('checks command triggers', () => {
    const cmd = (name: string, aliases: string[] = []): Trigger => ({ type: 'command', name, aliases, permission: 'everyone', user_cooldown_s: 0 });
    const empty = base({ triggers: [cmd('')] });
    expect(typeOf(empty, validateAction(empty, [])[0]!.key)).toBe('command');
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

  it('checks every step node', () => {
    const a = base({
      steps: [
        { type: 'set_variable', key: 'bad key!', value: '1', persist: false },
        iff([{ type: 'add_to_variable', key: '{{arg1}}.count', amount: 1, persist: false }, { type: 'run_action', action_id: '' }]),
        { type: 'http_request', method: 'get', url: 'ftp://x', body: '', save_to: '' }
      ]
    });
    const types = validateAction(a, [a]).map((i) => typeOf(a, i.key));
    expect(types).toEqual(['set_variable', 'run_action', 'http_request']);
  });

  it('warns about nodes no trigger reaches', () => {
    const a = base({ triggers: [{ type: 'manual' }], steps: [say('a')] });
    expect(validateAction(a, [a])).toEqual([]);
    a.graph.edges = [];
    const issues = validateAction(a, [a]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ warn: true, message: expect.stringMatching(/Not connected/) });
    expect(typeOf(a, issues[0]!.key)).toBe('chat_send');
    // Without triggers, steps run from Test, so nothing is loose.
    expect(validateAction(base({ steps: [say('a')] }), [])).toEqual([]);
  });

  it('an action cannot run itself', () => {
    const a = base({});
    a.graph = fromTree([], [{ type: 'run_action', action_id: a.id }]);
    expect(validateAction(a, [a])[0]!.message).toMatch(/itself/);
  });

  it('checks overlay layers', () => {
    const a = base({ steps: [{ type: 'set_layer_visible', overlay_id: 'nope', layer_id: 'x', state: 'on' }] });
    expect(validateAction(a, [a], project.overlays)).toHaveLength(1);
    const o = project.overlays[0]!;
    a.graph = fromTree([], [{ type: 'set_layer_visible', overlay_id: o.id, layer_id: o.layers[0]!.id, state: 'toggle' }]);
    expect(validateAction(a, [a], project.overlays)).toEqual([]);
  });

  it('starter actions are valid graphs', () => {
    for (const a of project.actions) {
      expect(validateAction(a, project.actions, project.overlays)).toEqual([]);
      expect(a.steps).toEqual([]);
      expect(a.graph.nodes.length).toBeGreaterThan(a.triggers.length);
    }
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
