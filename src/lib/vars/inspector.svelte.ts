import { api } from '$lib/api';
import { errorMessage } from '$lib/api/backend';
import type { Project } from '$lib/bindings/Project';
import { clone } from '$lib/editors/ids';
import { alertsEditor } from '$lib/pages/alerts/store.svelte';
import { actionsEditor, flow } from '$lib/pages/automation/store.svelte';
import { app } from '$lib/state/app.svelte';
import { toasts } from '$lib/state/toast.svelte';
import { isLiveKey } from './builtins';
import { buildUsage, problemOf, renameVar, usedIn, type Problem, type ProjectParts, type VarUsage, type Where } from './usage';

export type VarFilter = 'all' | 'used' | 'unused' | 'problems';

export interface VarInfo {
  key: string;
  value: unknown;
  exists: boolean;
  live: boolean;
  saved: boolean;
  usedIn: number;
  usage: VarUsage;
  problem: Problem | null;
}

/** Variable usage across the project, with the open details and rename dialogs. */
class VarInspector {
  /** Names the backend saves to disk. */
  saved = $state<Set<string>>(new Set());
  /** Variable shown in the details dialog. */
  details = $state<string | null>(null);
  /** Variable being renamed, and the name to start with. */
  renaming = $state<{ from: string; to: string } | null>(null);
  #pending: ReturnType<typeof setTimeout> | null = null;

  /** The project as edited, unsaved changes included. */
  parts = $derived.by((): ProjectParts | null => {
    const p = app.project;
    if (!p) return null;
    return { actions: actionsEditor.actions ?? p.actions, overlays: p.overlays, alerts: alertsEditor.config ?? p.alerts };
  });

  usage = $derived.by(() => (this.parts ? buildUsage(this.parts, Object.keys(app.vars)) : new Map<string, VarUsage>()));

  infos = $derived.by((): VarInfo[] => {
    const names = [...this.usage.keys()];
    return [...this.usage.values()]
      .filter((u) => u.key in app.vars || u.readers.length || u.writers.some((w) => w.where.type !== 'app'))
      .map((u) => this.#info(u, names))
      .sort((a, b) => a.key.localeCompare(b.key));
  });

  #info(u: VarUsage, names: string[]): VarInfo {
    const exists = u.key in app.vars;
    const saved = !isLiveKey(u.key) && (this.saved.has(u.key) || (u.builtIn?.saved ?? false));
    return {
      key: u.key,
      value: app.vars[u.key],
      exists,
      live: isLiveKey(u.key),
      saved,
      usedIn: usedIn(u),
      usage: u,
      problem: problemOf(u, exists, saved && exists, names)
    };
  }

  info(key: string): VarInfo | null {
    return this.infos.find((i) => i.key === key) ?? null;
  }

  /** Ask the backend which variables are saved, at most a few times a second. */
  refreshSaved(): void {
    if (this.#pending) return;
    this.#pending = setTimeout(() => {
      this.#pending = null;
      api
        .savedVarKeys()
        .then((keys) => (this.saved = new Set(keys)))
        .catch(() => {});
    }, 300);
  }

  /** Go to a place that sets or shows a variable. */
  goTo(w: Where): void {
    this.details = null;
    if (w.type === 'node') {
      app.page = 'automation';
      actionsEditor.selectedId = w.actionId;
      flow.focus = { actionId: w.actionId, nodeId: w.nodeId };
    } else if (w.type === 'layer') {
      app.focusLayer = w.layerId;
      app.editingOverlay = w.overlayId;
      app.page = 'overlays';
    } else if (w.type === 'alert') {
      alertsEditor.kind = w.kind;
      alertsEditor.variationId = w.variationId;
      alertsEditor.expanded[w.variationId] = true;
      app.page = 'alerts';
    }
  }

  /** The project with `from` renamed, and what changes. */
  preview(from: string, to: string) {
    const parts = this.parts;
    if (!parts) return null;
    return renameVar($state.snapshot(parts) as ProjectParts, from, to, Object.keys(app.vars));
  }

  async rename(from: string, to: string): Promise<boolean> {
    if (actionsEditor.held) {
      toasts.show('Fix the problems in your actions first, then rename.', 'error');
      return false;
    }
    await Promise.all([actionsEditor.saver.flush(), alertsEditor.saver.flush()]);
    const out = this.preview(from, to);
    if (!app.project || !out) return false;
    try {
      const r = await api.renameVar(from, to, { ...($state.snapshot(app.project) as Project), ...out.project });
      this.adopt(r.project);
      this.details = to;
      this.refreshSaved();
      const file = r.backup;
      toasts.show(
        `Renamed ${from} to ${to}.`,
        'success',
        10_000,
        'var-rename',
        file ? { label: 'Undo', run: () => void this.undo(file) } : undefined
      );
      return true;
    } catch (e) {
      toasts.show(errorMessage(e), 'error');
      return false;
    }
  }

  async undo(file: string): Promise<void> {
    try {
      this.adopt(await api.restoreBackup(file));
      this.details = null;
      this.refreshSaved();
      toasts.success('Rename undone');
    } catch (e) {
      toasts.error(e);
    }
  }

  /** Take a project saved by the backend, dropping the editors' copies. */
  adopt(p: Project): void {
    app.project = p;
    actionsEditor.actions = clone(p.actions);
    alertsEditor.config = clone(p.alerts);
  }
}

export const varInspector = new VarInspector();
