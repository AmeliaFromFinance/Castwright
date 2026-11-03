// The board lives in the project; edits save straight away.
import { api } from '$lib/api';
import type { HotkeySettings } from '$lib/bindings/HotkeySettings';
import type { Soundboard } from '$lib/bindings/Soundboard';
import { withSoundHotkey } from '$lib/pages/settings/hotkeys';
import { app } from '$lib/state/app.svelte';
import { attempt } from '$lib/state/toast.svelte';
import { defaultSoundboard } from './board';

export function currentBoard(): Soundboard {
  return app.project?.soundboard ?? defaultSoundboard();
}

export async function saveBoard(next: Soundboard): Promise<boolean> {
  const plain = $state.snapshot(next) as Soundboard;
  if (app.project) app.project.soundboard = plain;
  const saved = await attempt(() => api.saveSoundboard(plain));
  if (saved && app.project) app.project.soundboard = saved;
  return !!saved;
}

/** Set (or with '' clear) the global hotkey of a button. */
export async function saveSoundHotkey(soundId: string, keys: string): Promise<boolean> {
  const current: HotkeySettings = app.settings?.hotkeys ?? { enabled: true, bindings: [] };
  const bindings = withSoundHotkey($state.snapshot(current.bindings), soundId, keys);
  const report = await attempt(() => api.saveHotkeys({ enabled: current.enabled, bindings }));
  if (report && app.settings) app.settings.hotkeys = report.hotkeys;
  return !!report;
}
