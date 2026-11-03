import { describe, expect, it } from 'vitest';
import starter from '$lib/api/fixtures/starter-project.json';
import type { Action } from '$lib/bindings/Action';
import type { AlertConfig } from '$lib/bindings/AlertConfig';
import type { GraphNode } from '$lib/bindings/GraphNode';
import type { Layer } from '$lib/bindings/Layer';
import type { Overlay } from '$lib/bindings/Overlay';
import type { Project } from '$lib/bindings/Project';
import type { Step } from '$lib/bindings/Step';
import type { Trigger } from '$lib/bindings/Trigger';
import { scanTemplate } from '$lib/logic/template';
import { buildUsage, distance, problemOf, renameVar, scriptVars, suggest, usedIn, type ProjectParts, type VarUsage } from './usage';

const cond = (field: string) => ({ mode: 'all' as const, conditions: [{ field, op: 'exists' as const, value: null }] });
const step = (id: string, s: Step): GraphNode => ({ id, x: 0, y: 0, kind: { type: 'step', step: s } });
const trigger = (id: string, t: Trigger): GraphNode => ({ id, x: 0, y: 0, kind: { type: 'trigger', trigger: t } });
const action = (id: string, nodes: GraphNode[]): Action =>
  ({ id, name: `Action ${id}`, group: 'General', enabled: true, triggers: [], steps: [], cooldown_s: 0, graph: { nodes, edges: [], notes: [], frames: [] } }) as Action;
const layer = (id: string, kind: Record<string, unknown>, visible = cond('')): Layer =>
  ({ id, name: `Layer ${id}`, kind, visible_when: { mode: 'all', conditions: visible.conditions.filter((c) => c.field) } }) as unknown as Layer;

function sample(): ProjectParts {
  return {
    actions: [
      action('a1', [
        trigger('t1', { type: 'event', kind: 'raid', conditions: cond('counter.raids') }),
        step('s1', { type: 'add_to_variable', key: 'counter.deaths', amount: 1, persist: true }),
        step('s2', { type: 'chat_send', message: 'Deaths: {{ counter.deaths | default:"0" }} by {{name}}', as_bot: true, reply: false }),
        step('s3', { type: 'set_variable', key: 'mood', value: '{{counter.deth}}', persist: false }),
        step('s4', { type: 'if', conditions: cond('counter.deaths'), then: [], else: [] }),
        step('s5', { type: 'run_script', code: 'let w = get("counter.wins");\nsave("counter.best", w);\nset(\'temp.x\', 1);' }),
        step('s6', { type: 'http_request', method: 'get', url: 'https://x/?q={{user.login}}', body: '', save_to: 'web.reply' }),
        step('s7', { type: 'create_clip' }),
        step('s8', { type: 'start_poll', title: 'Q', choices: ['{{counter.deaths}} or more', 'Less'], duration_s: 60, points_per_vote: 0 })
      ])
    ],
    overlays: [
      {
        id: 'o1',
        name: 'HUD',
        width: 1920,
        height: 1080,
        fonts: [],
        updated_at: 0,
        layers: [
          layer('l1', { type: 'text', text: 'Best: {{counter.best | number}}' }, cond('show.deaths')),
          layer('l2', { type: 'goal', title: '{{goal.name}}', current_var: 'session.subs' }),
          layer('l3', { type: 'counter', var: 'counter.deaths', format: 'Deaths: {{value}}' }),
          layer('l4', { type: 'timer', mode: 'uptime', anchor_var: 'timer.break' }),
          layer('l5', { type: 'credits', heading: 'Thanks {{twitch.display_name}}', footer: '' }),
          layer('l6', { type: 'ad_break', soon_text: 'Ads in {{time}}', running_text: '' }),
          layer('l7', { type: 'event_list', item_format: '{{name}} {{label}}' })
        ]
      } as unknown as Overlay
    ],
    alerts: {
      settings: {},
      types: [
        {
          kind: 'sub',
          enabled: true,
          variations: [{ id: 'v1', name: 'Default', title: '{{name}} is sub {{session.subs}}', message: '{{message}}', conditions: cond('counter.vip') }]
        }
      ]
    } as unknown as AlertConfig
  };
}

const where = (u: VarUsage | undefined, role: 'readers' | 'writers') =>
  (u?.[role] ?? []).map((r) => {
    const w = r.where;
    const id = w.type === 'node' ? w.nodeId : w.type === 'layer' ? w.layerId : w.type === 'alert' ? w.variationId : w.title;
    return `${id}:${r.field}`;
  });

describe('template scanning', () => {
  it('finds keys with filters, paths and spaces', () => {
    const t = scanTemplate('Hi {{ last.sub.name | default:"a|b" | upper }} and {{user.login}}');
    expect(t.map((x) => x.key)).toEqual(['last.sub.name', 'user.login']);
    expect(t[0]!.filters).toEqual(['default:"a|b"', 'upper']);
    const s = 'Hi {{ last.sub.name | upper }}';
    expect(s.slice(t[0]!.keyStart, t[0]!.keyEnd)).toBe('last.sub.name');
  });

  it('skips text that is not a template', () => {
    expect(scanTemplate('{{}} {{ }} {single} {{open')).toEqual([]);
  });
});

describe('usage index', () => {
  const u = buildUsage(sample(), ['counter.vip']);

  it('finds every kind of writer', () => {
    expect(where(u.get('counter.deaths'), 'writers')).toEqual(['s1:Variable']);
    expect(where(u.get('mood'), 'writers')).toEqual(['s3:Variable']);
    expect(where(u.get('counter.best'), 'writers')).toEqual(['s5:Script']);
    expect(where(u.get('temp.x'), 'writers')).toEqual(['s5:Script']);
    expect(where(u.get('web.reply'), 'writers')).toEqual(['s6:Save response to']);
    expect(where(u.get('last.clip.url'), 'writers')).toEqual(['Create clip step:Create clip step', 's7:Clip link']);
    expect(where(u.get('session.subs'), 'writers')).toEqual(['Twitch:Twitch']);
    expect(where(u.get('obs.scene'), 'writers')).toEqual(['OBS:OBS']);
    expect(u.get('counter.best')!.writers[0]!.persist).toBe(true);
    expect(u.get('temp.x')!.writers[0]!.persist).toBe(false);
  });

  it('finds every kind of reader', () => {
    expect(where(u.get('counter.deaths'), 'readers')).toEqual(['s2:Message', 's4:Condition', 's8:Choices', 'l3:Variable']);
    expect(where(u.get('counter.raids'), 'readers')).toEqual(['t1:Condition']);
    expect(where(u.get('counter.wins'), 'readers')).toEqual(['s5:Script']);
    expect(where(u.get('counter.best'), 'readers')).toEqual(['l1:Text']);
    expect(where(u.get('show.deaths'), 'readers')).toEqual(['l1:Condition']);
    expect(where(u.get('goal.name'), 'readers')).toEqual(['l2:Title']);
    expect(where(u.get('session.subs'), 'readers')).toEqual(['l2:Current amount', 'v1:Title']);
    expect(where(u.get('timer.break'), 'readers')).toEqual(['l4:Start time']);
    expect(where(u.get('stream.started_at'), 'readers')).toEqual(['l4:Uptime']);
    expect(where(u.get('twitch.display_name'), 'readers')).toEqual(['l5:Heading']);
    expect(where(u.get('ads.next_at'), 'readers')).toEqual(['l6:Ad schedule']);
    expect(where(u.get('counter.vip'), 'readers')).toEqual(['v1:Condition']);
  });

  it('leaves run and event values out', () => {
    for (const k of ['name', 'user.login', 'message', 'value', 'time', 'label']) expect(u.has(k), k).toBe(false);
  });

  it('counts each place once', () => {
    expect(usedIn(u.get('counter.deaths'))).toBe(5);
    expect(usedIn(u.get('obs.scene'))).toBe(0);
    expect(usedIn(undefined)).toBe(0);
  });

  it('reads script calls with either quote', () => {
    expect(scriptVars(`get("a.b"); set('c', 1); save ( "d", 2 ); other("e")`)).toEqual([
      { key: 'a.b', call: 'get' },
      { key: 'c', call: 'set' },
      { key: 'd', call: 'save' }
    ]);
  });

  it('covers the demo project', () => {
    const p = starter as unknown as Project;
    const d = buildUsage(p, []);
    expect(where(d.get('counter.deaths'), 'writers')).toHaveLength(1);
    expect(d.get('counter.deaths')!.readers).toHaveLength(1);
    expect(d.get('session.subs')!.readers.length).toBeGreaterThan(0);
    expect(d.get('stream.uptime_text')!.readers).toHaveLength(1);
  });
});

describe('problems', () => {
  const u = buildUsage(sample(), ['counter.vip']);
  const names = [...u.keys()];

  it('flags reads of variables nothing sets, with a suggestion', () => {
    expect(problemOf(u.get('counter.deth')!, false, false, names)).toEqual({ type: 'unset', suggestion: 'counter.deaths' });
    expect(problemOf(u.get('goal.name')!, false, false, names)).toEqual({ type: 'unset', suggestion: null });
    expect(problemOf(u.get('goal.name')!, true, false, names)).toBeNull();
    expect(problemOf(u.get('stream.started_at')!, false, false, names)).toBeNull();
  });

  it('flags saved variables nothing reads', () => {
    expect(problemOf(u.get('temp.x')!, true, false, names)).toBeNull();
    expect(problemOf(u.get('temp.x')!, true, true, names)).toEqual({ type: 'unread' });
    expect(problemOf(u.get('counter.best')!, true, true, names)).toBeNull();
    expect(problemOf(u.get('obs.connected')!, true, true, names)).toBeNull();
  });
});

describe('fuzzy suggestions', () => {
  const names = ['counter.deaths', 'counter.wins', 'session.subs', 'last.sub.name', 'session.bits'];

  it('counts swaps as one change', () => {
    expect(distance('deaths', 'daeths')).toBe(1);
    expect(distance('abc', 'abc')).toBe(0);
    expect(distance('', 'ab')).toBe(2);
  });

  it('picks the closest name', () => {
    expect(suggest('counter.death', names)).toBe('counter.deaths');
    expect(suggest('Counter.Deaths', names)).toBe('counter.deaths');
    expect(suggest('counter.daeths', names)).toBe('counter.deaths');
    expect(suggest('session.sub', names)).toBe('session.subs');
    expect(suggest('last.sub.nmae', names)).toBe('last.sub.name');
  });

  it('gives up when nothing is close', () => {
    expect(suggest('goal.name', names)).toBeNull();
    expect(suggest('x', names)).toBeNull();
    expect(suggest('counter.deaths', names)).not.toBe('counter.deaths');
  });
});

describe('rename', () => {
  function project(): ProjectParts {
    const p = sample();
    p.actions.push(
      action('a2', [
        step('n1', { type: 'chat_send', message: '{{counter.deaths2}} {{counter.deaths.total}} {{ counter.deaths|number }} {{xcounter.deaths}}', as_bot: false, reply: false }),
        step('n2', { type: 'run_script', code: 'save("counter.deaths", get("counter.deaths") + 1); get("counter.deaths2")' }),
        step('n3', { type: 'set_variable', key: 'counter.deaths2', value: '1', persist: true })
      ])
    );
    return p;
  }

  it('changes every reference and nothing else', () => {
    const before = project();
    const { project: p, changes } = renameVar(before, 'counter.deaths', 'counter.falls', ['counter.deaths.total']);
    const steps = Object.fromEntries(p.actions.flatMap((a) => a.graph.nodes).map((n) => [n.id, n.kind.type === 'step' ? n.kind.step : null]));
    expect(steps.s1).toMatchObject({ key: 'counter.falls' });
    expect(steps.s2).toMatchObject({ message: 'Deaths: {{ counter.falls | default:"0" }} by {{name}}' });
    expect(steps.s4).toMatchObject({ conditions: { conditions: [{ field: 'counter.falls' }] } });
    expect(steps.s8).toMatchObject({ choices: ['{{counter.falls}} or more', 'Less'] });
    expect(steps.n1).toMatchObject({ message: '{{counter.deaths2}} {{counter.deaths.total}} {{ counter.falls|number }} {{xcounter.deaths}}' });
    expect(steps.n2).toMatchObject({ code: 'save("counter.falls", get("counter.falls") + 1); get("counter.deaths2")' });
    expect(steps.n3).toMatchObject({ key: 'counter.deaths2' });
    const counter = p.overlays[0]!.layers.find((l) => l.id === 'l3')!.kind;
    expect(counter).toMatchObject({ var: 'counter.falls', format: 'Deaths: {{value}}' });
    expect(changes.map((c) => c.field)).toEqual(['Variable', 'Message', 'Condition', 'Choices', 'Message', 'Script', 'Variable']);
    expect(changes[1]).toMatchObject({ before: 'Deaths: {{ counter.deaths | default:"0" }} by {{name}}', after: 'Deaths: {{ counter.falls | default:"0" }} by {{name}}' });
    // The original is untouched.
    expect(JSON.stringify(before)).toBe(JSON.stringify(project()));
  });

  it('follows paths into the variable', () => {
    const p = sample();
    p.actions[0]!.graph.nodes.push(step('p1', { type: 'log', message: '{{web.reply.0}}' }));
    const { project: out } = renameVar(p, 'web.reply', 'web.answer');
    const n = out.actions[0]!.graph.nodes.find((x) => x.id === 'p1')!;
    expect(n.kind).toMatchObject({ step: { message: '{{web.answer.0}}' } });
  });

  it('renames alerts and layer conditions', () => {
    const { project: p } = renameVar(sample(), 'session.subs', 'session.total', []);
    expect(p.alerts.types[0]!.variations[0]!.title).toBe('{{name}} is sub {{session.total}}');
    expect(p.overlays[0]!.layers[1]!.kind).toMatchObject({ current_var: 'session.total' });
    const { project: q } = renameVar(sample(), 'show.deaths', 'show.falls', []);
    expect(q.overlays[0]!.layers[0]!.visible_when.conditions[0]!.field).toBe('show.falls');
  });

  it('reports no changes for an unused name', () => {
    expect(renameVar(sample(), 'nothing.here', 'other').changes).toEqual([]);
  });
});
