import { api } from '$lib/api';
import type { AppearanceSettings } from '$lib/bindings/AppearanceSettings';
import { app } from '$lib/state/app.svelte';
import { toasts } from '$lib/state/toast.svelte';

/** Apply right away, then save. Rolls back if saving fails. */
export async function updateAppearance(patch: Partial<AppearanceSettings>): Promise<boolean> {
  if (!app.settings) return false;
  const before = app.settings.appearance;
  const next = { ...before, ...patch };
  app.settings.appearance = next;
  app.applyAppearance();
  try {
    await api.saveAppearance($state.snapshot(next) as AppearanceSettings);
    return true;
  } catch (e) {
    app.settings.appearance = before;
    app.applyAppearance();
    toasts.error(e);
    return false;
  }
}

export async function updateWindowEffect(effect: AppearanceSettings['window_effect']) {
  if (!(await updateAppearance({ window_effect: effect }))) return;
  if (app.demo) return;
  try {
    app.windowEffect = await api.setWindowEffect(effect, app.theme?.spec.base !== 'light');
  } catch (e) {
    app.windowEffect = 'solid';
    toasts.error(e);
  }
  app.applyAppearance();
}
