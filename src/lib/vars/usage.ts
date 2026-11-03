// Where each variable is set and shown across the project: steps, triggers, overlay
// layers and alert variations. Also finds likely mistakes and renames variables.
import type { Action } from '$lib/bindings/Action';
import type { AlertConfig } from '$lib/bindings/AlertConfig';
import type { ConditionGroup } from '$lib/bindings/ConditionGroup';
import type { EventKind } from '$lib/bindings/EventKind';
import type { Overlay } from '$lib/bindings/Overlay';
import type { Step } from '$lib/bindings/Step';
import { KIND_LABELS } from '$lib/format';
import { scanTemplate } from '$lib/logic/template';
import { STEP_LABELS, TRIGGER_LABELS } from '$lib/pages/automation/defaults';
import { isValidVarKey } from '$lib/pages/automation/validate';
import { BUILT_INS, BUILT_IN_ROOTS, builtIn, type BuiltIn } from './builtins';

export interface ProjectParts {
  actions: Action[];
  overlays: Overlay[];
  alerts: AlertConfig;
}

export type Where =
  | { type: 'node'; actionId: string; nodeId: string; title: string; detail: string }
  | { type: 'layer'; overlayId: string; layerId: string; title: string; detail: string }
  | { type: 'alert'; kind: EventKind; variationId: string; title: string; detail: string }
  | { type: 'app'; title: string; detail: string };

export interface VarRef {
  where: Where;
  /** Which setting, e.g. "Message" or "Condition". */
  field: string;
  /** Kept after a restart (steps that set variables). */
  persist?: boolean;
}

export interface VarUsage {
  key: string;
  readers: VarRef[];
  writers: VarRef[];
  builtIn?: BuiltIn;
}

/**
 * Template keys that come from the run or the event, never from variables.
 * A key under one of these isn't treated as a variable unless one exists by that name.
 */
const CONTEXT_ROOTS = new Set(['user', 'recipient', 'data', 'roles', 'poll', 'prediction', 'ad', 'event', 'args']);

/** Variables, as opposed to run and event values, are under these names when nothing else says so. */
const VAR_ROOTS = new Set([...BUILT_IN_ROOTS, 'counter']);

type Scope = 'vars' | 'mixed';

interface Slot {
  where: Where;
  field: string;
  /** template: `{{key}}` text. name: a whole variable name. script: Rhai code. */
  kind: 'template' | 'name' | 'script';
  role: 'read' | 'write';
  /** `vars` when only variables can be used there; `mixed` when run or event values can too. */
  scope: Scope;
  value: string;
  persist?: boolean;
  /** Keys read without being typed anywhere, like the ad schedule of an Ad break layer. */
  implicit?: boolean;
  set?: (v: string) => void;
}

const FIELD_LABELS: Record<string, string> = {
  message: 'Message',
  user: 'User',
  description: 'Description',
  title: 'Title',
  category: 'Category',
  reason: 'Reason',
  message_id: 'Message id',
  key: 'Variable name',
  value: 'Value',
  scene: 'Scene',
  source: 'Source',
  input: 'Input',
  url: 'Address',
  body: 'Body',
  save_to: 'Save response to',
  cost: 'Cost',
  winner: 'Winner',
  choices: 'Choices',
  outcomes: 'Outcomes',
  image: 'Image',
  sound: 'Sound',
  src: 'File'
};

/** Step fields that hold ids or code, not text. */
const NOT_TEXT = new Set(['type', 'code', 'overlay_id', 'layer_id', 'action_id', 'webhook_id', 'reward_id', 'color', 'method', 'mode', 'state']);

const nodeWhere = (a: Action, nodeId: string, detail: string): Where => ({ type: 'node', actionId: a.id, nodeId, title: a.name || 'Untitled', detail });

function conditionSlots(group: ConditionGroup, where: Where, scope: Scope, out: Slot[]) {
  for (const c of group.conditions) {
    out.push({ where, field: 'Condition', kind: 'name', role: 'read', scope, value: c.field, set: (v) => (c.field = v) });
  }
}

function stepSlots(s: Step, where: Where, out: Slot[]) {
  const rec = s as unknown as Record<string, unknown>;
  if (s.type === 'set_variable' || s.type === 'add_to_variable') {
    out.push({ where, field: 'Variable', kind: 'name', role: 'write', scope: 'vars', value: s.key, persist: s.persist, set: (v) => (s.key = v) });
  } else if (s.type === 'http_request') {
    out.push({ where, field: 'Save response to', kind: 'name', role: 'write', scope: 'vars', value: s.save_to, persist: false, set: (v) => (s.save_to = v) });
  } else if (s.type === 'create_clip') {
    out.push({ where, field: 'Clip link', kind: 'name', role: 'write', scope: 'vars', value: 'last.clip.url', persist: true, implicit: true });
  } else if (s.type === 'run_script') {
    out.push({ where, field: 'Script', kind: 'script', role: 'read', scope: 'mixed', value: s.code, set: (v) => (s.code = v) });
  } else if (s.type === 'if') {
    conditionSlots(s.conditions, where, 'mixed', out);
  }
  for (const [k, v] of Object.entries(rec)) {
    if (NOT_TEXT.has(k) || k === 'save_to') continue;
    const field = FIELD_LABELS[k] ?? k;
    if (typeof v === 'string') {
      // Variable names written by a step only count as templates when they contain one.
      if (k === 'key' && !v.includes('{{')) continue;
      out.push({ where, field, kind: 'template', role: 'read', scope: 'mixed', value: v, set: (x) => (rec[k] = x) });
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === 'string') out.push({ where, field, kind: 'template', role: 'read', scope: 'mixed', value: item, set: (x) => (v[i] = x) });
      });
    }
  }
}

/** Every place in the project that can name a variable. Setters change the project passed in. */
function slots(p: ProjectParts): Slot[] {
  const out: Slot[] = [];
  for (const a of p.actions) {
    for (const n of a.graph.nodes) {
      if (n.kind.type === 'trigger') {
        const t = n.kind.trigger;
        if (t.type === 'event') conditionSlots(t.conditions, nodeWhere(a, n.id, TRIGGER_LABELS[t.type]), 'mixed', out);
      } else {
        stepSlots(n.kind.step, nodeWhere(a, n.id, STEP_LABELS[n.kind.step.type]), out);
      }
    }
  }
  for (const o of p.overlays) {
    for (const l of o.layers) {
      const where: Where = { type: 'layer', overlayId: o.id, layerId: l.id, title: o.name || 'Untitled', detail: l.name || 'Layer' };
      const k = l.kind as unknown as Record<string, unknown>;
      const text = (key: string, field: string) =>
        out.push({ where, field, kind: 'template', role: 'read', scope: 'vars', value: String(k[key] ?? ''), set: (v) => (k[key] = v) });
      const name = (key: string, field: string) =>
        out.push({ where, field, kind: 'name', role: 'read', scope: 'vars', value: String(k[key] ?? ''), set: (v) => (k[key] = v) });
      const implicit = (keys: string[], field: string) =>
        keys.forEach((value) => out.push({ where, field, kind: 'name', role: 'read', scope: 'vars', value, implicit: true }));
      switch (l.kind.type) {
        case 'text':
          text('text', 'Text');
          break;
        case 'goal':
          text('title', 'Title');
          name('current_var', 'Current amount');
          break;
        case 'counter':
          name('var', 'Variable');
          text('format', 'Format');
          break;
        case 'timer':
          name('anchor_var', 'Start time');
          if (l.kind.mode === 'uptime') implicit(['stream.started_at'], 'Uptime');
          break;
        case 'credits':
          text('heading', 'Heading');
          text('footer', 'Footer');
          break;
        case 'ad_break':
          implicit(['ads.next_at', 'ads.length_s', 'ads.ends_at', 'ads.running_length_s'], 'Ad schedule');
          break;
        case 'hype_train':
          implicit(['hype.active', 'hype.level', 'hype.progress', 'hype.goal', 'hype.ends_at', 'hype.total'], 'Hype train');
          break;
      }
      conditionSlots(l.visible_when, where, 'vars', out);
    }
  }
  for (const t of p.alerts.types) {
    for (const v of t.variations) {
      const where: Where = { type: 'alert', kind: t.kind, variationId: v.id, title: `${KIND_LABELS[t.kind]} alert`, detail: v.name || 'Variation' };
      out.push({ where, field: 'Title', kind: 'template', role: 'read', scope: 'mixed', value: v.title, set: (x) => (v.title = x) });
      out.push({ where, field: 'Message', kind: 'template', role: 'read', scope: 'mixed', value: v.message, set: (x) => (v.message = x) });
      conditionSlots(v.conditions, where, 'mixed', out);
    }
  }
  return out;
}

const SCRIPT_CALL = /\b(get|set|save)(\s*\(\s*)(["'])([^"'\n]*)\3/g;

/** Variable names in `get("x")`, `set("x", ...)` and `save("x", ...)` calls with a plain string. */
export function scriptVars(code: string): Array<{ key: string; call: 'get' | 'set' | 'save' }> {
  return [...code.matchAll(SCRIPT_CALL)].map((m) => ({ key: m[4]!, call: m[1] as 'get' | 'set' | 'save' }));
}

export class VarResolver {
  readonly #known: Set<string>;
  readonly #roots: Set<string>;

  constructor(known: Iterable<string>) {
    this.#known = new Set(known);
    this.#roots = new Set(VAR_ROOTS);
    for (const k of this.#known) if (k.includes('.')) this.#roots.add(k.split('.')[0]!);
    for (const r of CONTEXT_ROOTS) this.#roots.delete(r);
  }

  /** The variable a key refers to, or null when it's a run or event value. */
  resolve(key: string, scope: Scope): string | null {
    if (this.#known.has(key)) return key;
    // A path inside a known variable, like `last.response.0`.
    for (let i = key.lastIndexOf('.'); i > 0; i = key.lastIndexOf('.', i - 1)) {
      if (this.#known.has(key.slice(0, i))) return key.slice(0, i);
    }
    if (!isValidVarKey(key)) return null;
    if (scope === 'vars') return key;
    return key.includes('.') && this.#roots.has(key.split('.')[0]!) ? key : null;
  }
}

interface Ref {
  key: string;
  role: 'read' | 'write';
  persist?: boolean;
}

function refsOf(slot: Slot, r: VarResolver, extra?: Set<string>): Ref[] {
  switch (slot.kind) {
    case 'name': {
      const v = slot.value.trim();
      if (!v) return [];
      if (slot.role === 'write') return isValidVarKey(v) ? [{ key: v, role: 'write', persist: slot.persist }] : [];
      const key = r.resolve(v, slot.scope);
      return key ? [{ key, role: 'read' }] : [];
    }
    case 'template':
      return scanTemplate(slot.value).flatMap((t) => {
        // A counter's own value is called `value`.
        if (extra?.has(t.key)) return [];
        const key = r.resolve(t.key, slot.scope);
        return key ? [{ key, role: 'read' as const }] : [];
      });
    case 'script':
      return scriptVars(slot.value).flatMap(({ key, call }): Ref[] => {
        if (call !== 'get') return isValidVarKey(key) ? [{ key, role: 'write', persist: call === 'save' }] : [];
        const k = r.resolve(key, 'mixed');
        return k ? [{ key: k, role: 'read' }] : [];
      });
  }
}

const extraFor = (s: Slot) => (s.where.type === 'layer' && s.field === 'Format' ? new Set(['value']) : undefined);

const placeKey = (w: Where) =>
  w.type === 'node' ? `n:${w.actionId}:${w.nodeId}` : w.type === 'layer' ? `l:${w.overlayId}:${w.layerId}` : w.type === 'alert' ? `a:${w.variationId}` : `s:${w.title}`;

/** Variables written somewhere in the project, so reads of them aren't mistaken for run values. */
function writtenKeys(all: Slot[]): Set<string> {
  const out = new Set<string>();
  const none = new VarResolver([]);
  for (const s of all) if (s.role === 'write' || s.kind === 'script') for (const r of refsOf(s, none)) if (r.role === 'write') out.add(r.key);
  return out;
}

/**
 * Build the usage of every variable in the project. `current` is the variables that exist now;
 * they and the built-ins are always listed.
 */
export function buildUsage(p: ProjectParts, current: Iterable<string> = []): Map<string, VarUsage> {
  const all = slots(p);
  const known = new Set([...BUILT_INS.map((b) => b.key), ...current, ...writtenKeys(all)]);
  const resolver = new VarResolver(known);
  const out = new Map<string, VarUsage>();
  const get = (key: string) => {
    let u = out.get(key);
    if (!u) out.set(key, (u = { key, readers: [], writers: [], builtIn: builtIn(key) }));
    return u;
  };
  for (const b of BUILT_INS) get(b.key).writers.push({ where: { type: 'app', title: b.source, detail: 'Built in' }, field: b.source });
  for (const k of current) get(k);
  for (const s of all) {
    for (const r of refsOf(s, resolver, extraFor(s))) {
      const list = r.role === 'read' ? get(r.key).readers : get(r.key).writers;
      const pk = placeKey(s.where);
      const same = list.find((x) => placeKey(x.where) === pk && x.field === s.field);
      if (same) same.persist ||= r.persist;
      else list.push({ where: s.where, field: s.field, ...(r.persist !== undefined ? { persist: r.persist } : {}) });
    }
  }
  return out;
}

/** Places that set or show the variable, each counted once. Built-in sources don't count. */
export function usedIn(u: VarUsage | undefined): number {
  if (!u) return 0;
  return new Set([...u.readers, ...u.writers].filter((r) => r.where.type !== 'app').map((r) => placeKey(r.where))).size;
}

export type Problem = { type: 'unset'; suggestion: string | null } | { type: 'unread' };

/**
 * `unset`: shown somewhere but nothing sets it and it doesn't exist, often a typo.
 * `unread`: a saved variable that nothing shows or checks.
 */
export function problemOf(u: VarUsage, exists: boolean, saved: boolean, names: readonly string[]): Problem | null {
  if (u.builtIn) return null;
  if (u.readers.length && !u.writers.length && !exists) return { type: 'unset', suggestion: suggest(u.key, names) };
  if (!u.readers.length && (saved || u.writers.some((w) => w.persist))) return { type: 'unread' };
  return null;
}

/** Edit distance where swapping two neighbouring letters counts as one change. */
export function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

/** The closest known name to a mistyped one, or null when none is close. Case is ignored. */
export function suggest(key: string, names: readonly string[]): string | null {
  const lower = key.toLowerCase();
  const root = lower.split('.')[0];
  let best: { name: string; score: number } | null = null;
  for (const name of names) {
    if (name === key) continue;
    const d = distance(lower, name.toLowerCase());
    const limit = Math.max(1, Math.min(3, Math.floor(Math.max(key.length, name.length) / 4)));
    if (d > limit) continue;
    // Same group first, then fewest changes.
    const score = d * 2 + (name.toLowerCase().split('.')[0] === root ? 0 : 1);
    if (!best || score < best.score || (score === best.score && name < best.name)) best = { name, score };
  }
  return best?.name ?? null;
}

export interface RenameChange {
  where: Where;
  field: string;
  before: string;
  after: string;
}

function renameTemplate(text: string, from: string, to: string, r: VarResolver, scope: Scope, extra?: Set<string>): string {
  let out = '';
  let pos = 0;
  for (const t of scanTemplate(text)) {
    if (extra?.has(t.key) || r.resolve(t.key, scope) !== from) continue;
    out += text.slice(pos, t.keyStart) + to + t.key.slice(from.length);
    pos = t.keyEnd;
  }
  return out + text.slice(pos);
}

function renameScript(code: string, from: string, to: string): string {
  return code.replace(SCRIPT_CALL, (m, fn: string, open: string, q: string, key: string) => (key === from ? `${fn}${open}${q}${to}${q}` : m));
}

/**
 * Rename a variable everywhere in a copy of the project. Names that only look alike
 * (`counter.deaths2`, `counter.deaths.total`) are left alone.
 */
export function renameVar(p: ProjectParts, from: string, to: string, current: Iterable<string> = []): { project: ProjectParts; changes: RenameChange[] } {
  const copy = JSON.parse(JSON.stringify({ actions: p.actions, overlays: p.overlays, alerts: p.alerts })) as ProjectParts;
  const all = slots(copy);
  const r = new VarResolver([...BUILT_INS.map((b) => b.key), ...current, ...writtenKeys(all), from]);
  const changes: RenameChange[] = [];
  for (const s of all) {
    if (!s.set || s.implicit) continue;
    let after = s.value;
    if (s.kind === 'name') {
      if (s.value.trim() === from) after = to;
      else if (s.role === 'read' && r.resolve(s.value.trim(), s.scope) === from) after = to + s.value.trim().slice(from.length);
    } else if (s.kind === 'template') after = renameTemplate(s.value, from, to, r, s.scope, extraFor(s));
    else after = renameScript(s.value, from, to);
    if (after === s.value) continue;
    s.set(after);
    changes.push({ where: s.where, field: s.field, before: s.value, after });
  }
  return { project: copy, changes };
}
