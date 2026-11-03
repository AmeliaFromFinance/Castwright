// Sharing actions as .cwactions files. The backend does the real export and import
// (src-tauri/src/store/action_package.rs); this plans the import dialog, and the
// build, parse and apply copies here stand in for it in the browser demo.
import type { Action } from '$lib/bindings/Action';
import type { ActionPackage } from '$lib/bindings/ActionPackage';
import type { ConflictChoice } from '$lib/bindings/ConflictChoice';
import type { ImportChoices } from '$lib/bindings/ImportChoices';
import type { ImportReport } from '$lib/bindings/ImportReport';
import type { Overlay } from '$lib/bindings/Overlay';
import type { PackageRef } from '$lib/bindings/PackageRef';
import type { PackageVar } from '$lib/bindings/PackageVar';
import type { RefKind } from '$lib/bindings/RefKind';
import type { Step } from '$lib/bindings/Step';
import { clone, newId } from '$lib/editors/ids';
import { withExtras } from './canvas';
import { describeTriggers } from './describe';
import { isValidVarKey } from './validate';

export const ACTIONS_KIND = 'castwright-actions';
export const ACTIONS_VERSION = 1;
export const ACTIONS_EXT = 'cwactions';

const BUILT_IN = ['stream.', 'obs.', 'twitch.', 'last.', 'session.'];
const SECRET_WORDS = ['secret', 'token', 'password', 'passwd', 'apikey', 'key', 'auth', 'webhook'];

export function isSecretName(name: string): boolean {
  return name
    .toLowerCase()
    .split(/[._-]/)
    .some((p) => SECRET_WORDS.includes(p));
}

export function refKey(kind: RefKind, overlayId: string, id: string): string {
  return kind === 'layer' ? `layer:${overlayId}/${id}` : `${kind}:${id}`;
}

export const keyOf = (r: PackageRef) => refKey(r.kind, r.overlay_id, r.id);

export function stepsOf(a: Action): Step[] {
  const out: Step[] = [];
  const walk = (s: Step) => {
    out.push(s);
    if (s.type === 'if') [...s.then, ...s.else].forEach(walk);
  };
  for (const n of a.graph.nodes) if (n.kind.type === 'step') walk(n.kind.step);
  return out;
}

const assetName = (p: string) => (p.startsWith('assets/') && p.length > 7 ? p.slice(7) : null);

/** File name for an export: the action or group name, made safe. */
export function packageFileName(label: string): string {
  return `${label.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'actions'}.${ACTIONS_EXT}`;
}

// ---------- planning the import dialog ----------

export interface Option {
  value: string;
  label: string;
}

export interface PlannedAction {
  id: string;
  name: string;
  triggers: string;
  steps: number;
  /** Name of the local action with the same name. */
  conflict: string | null;
}

export interface PlannedRef {
  key: string;
  ref: PackageRef;
  /** Best local match, or null when there is none. */
  match: string | null;
  options: Option[];
}

export interface ImportPlan {
  actions: PlannedAction[];
  /** References that don't point at the same item here. */
  refs: PlannedRef[];
  /** Variables that will be created, with their starting value. */
  newVars: PackageVar[];
}

export interface LocalState {
  actions: readonly Action[];
  overlays: readonly Overlay[];
  assets: readonly string[];
  vars: Record<string, unknown>;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function options(kind: RefKind, local: LocalState): Option[] {
  switch (kind) {
    case 'layer':
      return local.overlays.flatMap((o) => o.layers.map((l) => ({ value: `${o.id}/${l.id}`, label: `${o.name} › ${l.name}` })));
    case 'action':
      return local.actions.map((a) => ({ value: a.id, label: a.name || 'Untitled' }));
    case 'asset':
      return local.assets.map((a) => ({ value: a, label: a }));
  }
}

/** The same id here, else something with the same name. */
function findMatch(r: PackageRef, local: LocalState): { value: string | null; exact: boolean } {
  if (r.kind === 'layer') {
    const o = local.overlays.find((x) => x.id === r.overlay_id);
    if (o?.layers.some((l) => l.id === r.id)) return { value: `${r.overlay_id}/${r.id}`, exact: true };
    const named = local.overlays.filter((x) => same(x.name, r.overlay_name));
    for (const ov of [...named, ...local.overlays.filter((x) => !named.includes(x))]) {
      const l = ov.layers.find((x) => same(x.name, r.name));
      if (l) return { value: `${ov.id}/${l.id}`, exact: false };
    }
    return { value: null, exact: false };
  }
  if (r.kind === 'action') {
    if (local.actions.some((a) => a.id === r.id)) return { value: r.id, exact: true };
    return { value: local.actions.find((a) => same(a.name, r.name))?.id ?? null, exact: false };
  }
  if (local.assets.includes(r.id)) return { value: r.id, exact: true };
  return { value: local.assets.find((a) => same(a, r.name)) ?? null, exact: false };
}

export function planImport(pkg: ActionPackage, local: LocalState): ImportPlan {
  const actions = pkg.actions.map((a) => ({
    id: a.id,
    name: a.name,
    triggers: describeTriggers(a),
    steps: a.graph.nodes.filter((n) => n.kind.type === 'step').length,
    conflict: local.actions.find((x) => same(x.name, a.name))?.name ?? null
  }));
  const refs: PlannedRef[] = [];
  for (const r of pkg.refs) {
    const m = findMatch(r, local);
    if (m.exact) continue;
    refs.push({ key: keyOf(r), ref: r, match: m.value, options: options(r.kind, local) });
  }
  const newVars = pkg.variables.filter((v) => !(v.name in local.vars));
  return { actions, refs, newVars };
}

/** Stand-ins for what the file points at, so step summaries can name them. */
export function previewContext(pkg: ActionPackage): { actions: Action[]; overlays: Overlay[] } {
  const overlays = new Map<string, Overlay>();
  for (const r of pkg.refs) {
    if (r.kind !== 'layer') continue;
    const o = overlays.get(r.overlay_id) ?? { id: r.overlay_id, name: r.overlay_name, width: 0, height: 0, layers: [], fonts: [], updated_at: 0 };
    o.layers.push({ id: r.id, name: r.name } as Overlay['layers'][number]);
    overlays.set(r.overlay_id, o);
  }
  const named = pkg.refs.filter((r) => r.kind === 'action').map((r) => ({ id: r.id, name: r.name }) as Action);
  return { actions: [...pkg.actions, ...named], overlays: [...overlays.values()] };
}

/** What to send to the backend, from the choices made in the dialog. */
export function importChoices(plan: ImportPlan, conflicts: Record<string, ConflictChoice>, links: Record<string, string | null>): ImportChoices {
  const out: ImportChoices = { conflicts: {}, links: {} };
  for (const a of plan.actions) if (a.conflict) out.conflicts[a.id] = conflicts[a.id] ?? 'keep_both';
  for (const r of plan.refs) out.links[r.key] = r.key in links ? links[r.key]! : r.match;
  return out;
}

// ---------- the demo's stand-ins for the backend ----------

function templateKeys(text: string, out: Set<string>) {
  for (const m of text.matchAll(/\{\{([^}]*)\}\}/g)) {
    const key = m[1]!.split('|')[0]!.trim();
    if (key) out.add(key);
  }
}

function walkValue(v: unknown, out: Set<string>) {
  if (typeof v === 'string') templateKeys(v, out);
  else if (Array.isArray(v)) v.forEach((x) => walkValue(x, out));
  else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.field === 'string' && 'op' in o) out.add(o.field.trim());
    Object.values(o).forEach((x) => walkValue(x, out));
  }
}

export function buildPackage(all: readonly Action[], ids: readonly string[], overlays: readonly Overlay[], vars: Record<string, unknown>): ActionPackage {
  const actions = clone(all.filter((a) => ids.includes(a.id)));
  if (!actions.length) throw { code: 'user', message: 'Pick at least one action to export.' };
  const inside = new Set(actions.map((a) => a.id));
  const refs = new Map<string, PackageRef>();
  const add = (r: PackageRef) => {
    if (!refs.has(keyOf(r))) refs.set(keyOf(r), r);
  };
  const asset = (p: string) => {
    const n = assetName(p);
    if (n) add({ kind: 'asset', id: n, name: n, overlay_id: '', overlay_name: '' });
  };
  const written = new Set<string>();
  const read = new Set<string>();
  for (const a of actions) {
    for (const n of a.graph.nodes) walkValue(n.kind.type === 'trigger' ? n.kind.trigger : n.kind.step, read);
    for (const s of stepsOf(a)) {
      if (s.type === 'run_action' && !inside.has(s.action_id)) {
        const t = all.find((x) => x.id === s.action_id);
        if (t) add({ kind: 'action', id: t.id, name: t.name, overlay_id: '', overlay_name: '' });
      } else if (s.type === 'set_layer_visible') {
        const o = overlays.find((x) => x.id === s.overlay_id);
        const l = o?.layers.find((x) => x.id === s.layer_id);
        if (o && l) add({ kind: 'layer', id: l.id, name: l.name, overlay_id: o.id, overlay_name: o.name });
      } else if (s.type === 'play_sound') asset(s.src);
      else if (s.type === 'play_alert') [s.image, s.sound].forEach(asset);
      else if (s.type === 'set_variable' || s.type === 'add_to_variable') written.add(s.key.trim());
      else if (s.type === 'http_request' && s.save_to.trim()) written.add(s.save_to.trim());
    }
  }
  const names = [...new Set([...written, ...[...read].filter((k) => k in vars)])]
    .filter((k) => isValidVarKey(k) && !BUILT_IN.some((p) => k.startsWith(p)))
    .sort();
  const variables: PackageVar[] = names.map((name) => {
    const secret = isSecretName(name);
    const v = vars[name];
    const value = secret || v === undefined ? null : typeof v === 'number' ? 0 : v;
    return { name, default: value, secret };
  });
  return {
    kind: ACTIONS_KIND,
    version: ACTIONS_VERSION,
    app_version: '',
    exported_at: Date.now(),
    actions,
    variables,
    refs: [...refs.values()].sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
  };
}

const userError = (message: string) => ({ code: 'user', message });

export function parsePackage(text: string): ActionPackage {
  let raw: Partial<ActionPackage> | null = null;
  try {
    raw = JSON.parse(text) as Partial<ActionPackage>;
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== 'object' || raw.kind !== ACTIONS_KIND) throw userError("That isn't a Castwright actions file.");
  if (Number(raw.version ?? 0) > ACTIONS_VERSION)
    throw userError('These actions were exported by a newer version of Castwright. Update Castwright to import them.');
  if (!Array.isArray(raw.actions) || !raw.actions.length) throw userError('That file has no actions in it.');
  const variables = (raw.variables ?? [])
    .filter((v) => isValidVarKey(v.name))
    .map((v) => (v.secret || isSecretName(v.name) ? { ...v, secret: true, default: null } : v));
  const actions = (raw.actions as Action[]).map((a) => ({ ...a, graph: withExtras(a.graph ?? { nodes: [], edges: [], notes: [], frames: [] }) }));
  return { ...(raw as ActionPackage), actions, variables, refs: raw.refs ?? [] };
}

function freeName(name: string, taken: Set<string>): string {
  for (let n = 2; ; n++) if (!taken.has(`${name} (${n})`.toLowerCase())) return `${name} (${n})`;
}

/** Same rules as `apply` in action_package.rs. Changes `actions` in place. */
export function applyImport(
  actions: Action[],
  overlays: readonly Overlay[],
  assets: readonly string[],
  pkg: ActionPackage,
  choices: ImportChoices
): { report: ImportReport; vars: Array<[string, unknown]> } {
  const report: ImportReport = { added: 0, replaced: 0, skipped: 0, unlinked: 0, variables: 0, first_id: null };
  const taken = new Set(actions.map((a) => a.name.trim().toLowerCase()));
  const existing = actions.map((a) => [a.name.trim().toLowerCase(), a.id] as const);
  type Fate = { t: 'skip' } | { t: 'replace'; id: string } | { t: 'add'; id: string; name: string };
  const ids = new Map<string, string>();
  const fates: Fate[] = pkg.actions.map((a) => {
    const key = a.name.trim().toLowerCase();
    const local = existing.find(([n]) => n === key)?.[1];
    if (local) {
      const c = choices.conflicts[a.id] ?? 'keep_both';
      if (c === 'skip' || c === 'replace') {
        ids.set(a.id, local);
        return c === 'skip' ? { t: 'skip' } : { t: 'replace', id: local };
      }
    }
    const name = taken.has(key) ? freeName(a.name.trim(), taken) : a.name;
    taken.add(name.trim().toLowerCase());
    const id = newId();
    ids.set(a.id, id);
    return { t: 'add', id, name };
  });

  const resolve = (kind: RefKind, overlayId: string, id: string): string | null => {
    const key = refKey(kind, overlayId, id);
    if (key in choices.links) return choices.links[key] || null;
    const here =
      kind === 'layer'
        ? overlays.some((o) => o.id === overlayId && o.layers.some((l) => l.id === id))
        : kind === 'action'
          ? actions.some((a) => a.id === id)
          : assets.includes(id);
    return here ? (kind === 'layer' ? `${overlayId}/${id}` : id) : null;
  };
  const unlinked = new Set<string>();
  const relinkAsset = (p: string): string => {
    const n = assetName(p);
    if (!n) return p;
    const to = resolve('asset', '', n);
    if (to) return `assets/${to}`;
    unlinked.add(refKey('asset', '', n));
    return p;
  };

  pkg.actions.forEach((src, i) => {
    const a = clone(src);
    for (const s of stepsOf(a)) {
      if (s.type === 'run_action') {
        const mapped = ids.get(s.action_id);
        if (mapped) s.action_id = mapped;
        else if (s.action_id) {
          const to = resolve('action', '', s.action_id);
          if (!to) unlinked.add(refKey('action', '', s.action_id));
          s.action_id = to ?? '';
        }
      } else if (s.type === 'set_layer_visible' && s.layer_id) {
        const to = resolve('layer', s.overlay_id, s.layer_id)?.split('/');
        if (to?.length === 2) [s.overlay_id, s.layer_id] = to as [string, string];
        else {
          unlinked.add(refKey('layer', s.overlay_id, s.layer_id));
          s.overlay_id = '';
          s.layer_id = '';
        }
      } else if (s.type === 'play_sound') s.src = relinkAsset(s.src);
      else if (s.type === 'play_alert') {
        s.image = relinkAsset(s.image);
        s.sound = relinkAsset(s.sound);
      }
    }
    a.enabled = false;
    const fate = fates[i]!;
    if (fate.t === 'skip') report.skipped++;
    else if (fate.t === 'replace') {
      const j = actions.findIndex((x) => x.id === fate.id);
      if (j >= 0) actions[j] = { ...a, id: fate.id, name: actions[j]!.name };
      report.replaced++;
      report.first_id ??= fate.id;
    } else {
      actions.push({ ...a, id: fate.id, name: fate.name });
      report.added++;
      report.first_id ??= fate.id;
    }
  });
  report.unlinked = unlinked.size;
  const vars = pkg.variables
    .filter((v) => !v.secret && !isSecretName(v.name) && v.default !== null && v.default !== undefined)
    .map((v) => [v.name, v.default] as [string, unknown]);
  return { report, vars };
}
