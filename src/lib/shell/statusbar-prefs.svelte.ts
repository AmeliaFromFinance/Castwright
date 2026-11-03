import { loadPref, savePref } from '$lib/state/persist';

/** Status bar items you can turn off in Settings → Appearance. */
export const OPTIONAL_ITEMS = [
  { id: 'cpu', label: 'CPU' },
  { id: 'fps', label: 'FPS' },
  { id: 'bitrate', label: 'Bitrate' },
  { id: 'dropped', label: 'Dropped frames' },
  { id: 'server', label: 'Overlay server' },
  { id: 'version', label: 'Version' }
] as const;

export type OptionalItem = (typeof OPTIONAL_ITEMS)[number]['id'];

const KEY = 'statusbar.items';

class StatusPrefs {
  #off = $state<OptionalItem[]>(loadPref<OptionalItem[]>(KEY, []));

  shows(id: OptionalItem): boolean {
    return !this.#off.includes(id);
  }

  set(id: OptionalItem, on: boolean) {
    this.#off = on ? this.#off.filter((x) => x !== id) : [...this.#off.filter((x) => x !== id), id];
    savePref(KEY, this.#off);
  }
}

export const statusPrefs = new StatusPrefs();
