import { api } from '$lib/api';
import type { AlertConfig } from '$lib/bindings/AlertConfig';
import type { AlertSettings } from '$lib/bindings/AlertSettings';
import type { EventKind } from '$lib/bindings/EventKind';
import type { Variation } from '$lib/bindings/Variation';
import { Autosaver } from '$lib/editors/autosave.svelte';
import { clone } from '$lib/editors/ids';
import { app } from '$lib/state/app.svelte';

/** Working copy of the alert config. Lives as long as the app, so edits survive page switches. */
class AlertsEditor {
  config = $state<AlertConfig | null>(null);
  kind = $state<EventKind>('follow');
  /** Variation shown in the preview. */
  variationId = $state<string | null>(null);
  /** Expanded variation cards. */
  expanded = $state<Record<string, boolean>>({});

  saver = new Autosaver<AlertConfig>(async (c) => {
    await api.saveAlerts(c);
    if (app.project) app.project.alerts = clone(c);
  });

  /** Take the project's config unless there are unsaved edits. */
  sync(): void {
    const source = app.project?.alerts;
    if (!source || this.saver.dirty) return;
    if (!this.config || JSON.stringify(source) !== JSON.stringify($state.snapshot(this.config))) {
      this.config = clone(source);
    }
  }

  patchVariation(id: string, patch: Partial<Variation>): void {
    const v = this.config?.types.flatMap((t) => t.variations).find((x) => x.id === id);
    if (!v) return;
    Object.assign(v, patch);
    this.changed();
  }

  patchSettings(patch: Partial<AlertSettings>): void {
    if (!this.config) return;
    Object.assign(this.config.settings, patch);
    this.changed();
  }

  changed(): void {
    if (this.config) this.saver.schedule(clone($state.snapshot(this.config)) as AlertConfig);
  }
}

export const alertsEditor = new AlertsEditor();
