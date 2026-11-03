// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Action } from '$lib/bindings/Action';
import type { Overlay } from '$lib/bindings/Overlay';
import { baseLayer, kindDefaults } from '$lib/editor/layers';
import { outgoing, triggerNodes, unreachable } from '../graph';
import { applyImport, importChoices, parsePackage, planImport } from '../sharing';
import { validateAction } from '../validate';
import { ACTION_TEMPLATES } from './index';

const dir = fileURLToPath(new URL('.', import.meta.url));

const ending: Overlay = {
  id: 'ov-end',
  name: 'Stream end',
  width: 1920,
  height: 1080,
  fonts: [],
  updated_at: 0,
  layers: [
    { ...baseLayer(), id: 'l-title', name: 'Title' },
    { ...baseLayer(), id: 'l-roll', name: 'Credits', kind: kindDefaults('credits') }
  ]
};
const assets = ['ding.mp3'];

describe('action templates', () => {
  it('lists every template file once', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(ACTION_TEMPLATES.length).toBe(files.length);
    expect(ACTION_TEMPLATES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(ACTION_TEMPLATES.map((t) => t.id)).size).toBe(ACTION_TEMPLATES.length);
    for (const t of ACTION_TEMPLATES) {
      expect(t.name.length, t.id).toBeGreaterThan(2);
      expect(t.description.length, t.id).toBeLessThan(80);
    }
  });

  for (const t of ACTION_TEMPLATES) {
    describe(t.name, () => {
      it('parses like a shared file', () => {
        const text = readFileSync(`${dir}/${t.id}.json`, 'utf8');
        expect(parsePackage(text)).toEqual(t.pkg);
        expect(t.pkg.actions.length).toBeGreaterThan(0);
      });

      it('has triggers that lead to every step', () => {
        for (const a of t.pkg.actions) {
          const triggers = triggerNodes(a.graph);
          expect(triggers.length, a.name).toBeGreaterThan(0);
          expect(a.triggers).toEqual(triggers.map((n) => (n.kind.type === 'trigger' ? n.kind.trigger : null)));
          for (const n of triggers) expect(outgoing(a.graph, n.id).length, `${a.name} trigger`).toBeGreaterThan(0);
          expect(a.graph.nodes.some((n) => n.kind.type === 'step')).toBe(true);
          expect(unreachable(a.graph)).toEqual([]);
        }
      });

      it('validates once linked, and can start turned on', () => {
        const actions: Action[] = [];
        const local = { actions, overlays: [ending], assets, vars: {} };
        const plan = planImport(t.pkg, local);
        // Link each reference to the first choice, as someone would in the dialog.
        const links = Object.fromEntries(plan.refs.map((r) => [r.key, r.match ?? r.options.find((o) => o.label.includes('Credits'))?.value ?? r.options[0]?.value ?? null]));
        const { report, vars } = applyImport(actions, [ending], assets, t.pkg, importChoices(plan, {}, links, true));
        expect(report.unlinked).toBe(0);
        expect(report.added).toBe(t.pkg.actions.length);
        for (const a of actions) {
          expect(a.enabled).toBe(true);
          expect(validateAction(a, actions, [ending])).toEqual([]);
        }
        for (const v of t.pkg.variables) expect(vars).toContainEqual([v.name, v.default]);
      });
    });
  }

  it('counters come with their variable', () => {
    const deaths = ACTION_TEMPLATES.find((t) => t.id === 'death-counter')!;
    expect(planImport(deaths.pkg, { actions: [], overlays: [], assets: [], vars: {} }).newVars).toEqual([{ name: 'counter.deaths', default: 0, secret: false }]);
  });

  it('imports start off unless turned on', () => {
    const actions: Action[] = [];
    const t = ACTION_TEMPLATES[0]!;
    applyImport(actions, [], [], t.pkg, importChoices(planImport(t.pkg, { actions, overlays: [], assets: [], vars: {} }), {}, {}));
    expect(actions.every((a) => !a.enabled)).toBe(true);
  });
});
