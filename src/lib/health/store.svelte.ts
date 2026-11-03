import { api } from '$lib/api';
import { isTauri } from '$lib/api/backend';
import type { BugReportPreview } from '$lib/bindings/BugReportPreview';
import type { CrashInfo } from '$lib/bindings/CrashInfo';
import type { HealthSnapshot } from '$lib/bindings/HealthSnapshot';
import { chatExtras } from '$lib/overlay/emotes/store.svelte';
import { app } from '$lib/state/app.svelte';
import { toasts } from '$lib/state/toast.svelte';
import { reveal } from '$lib/util/os';
import { summarize } from './health';

const POLL_OPEN_MS = 1500;
const POLL_MS = 5000;

/** Facts only the app window knows, added to bug reports. */
export function windowInfo() {
  return {
    emote_providers: chatExtras.providers().map(({ name, state, emotes, error }) => ({ name, state, emotes, error })),
    page: app.page,
    theme: app.settings?.appearance.theme ?? '',
    ui_scale: app.settings?.appearance.ui_scale ?? 100,
    window_effect: app.windowEffect,
    screen: typeof screen === 'undefined' ? null : { width: screen.width, height: screen.height, scale: window.devicePixelRatio || 1 },
    webview: typeof navigator === 'undefined' ? '' : navigator.userAgent
  };
}

class Health {
  open = $state(false);
  snapshot = $state<HealthSnapshot | null>(null);
  summary = $derived(summarize(this.snapshot, chatExtras.providers()));

  reportOpen = $state(false);
  includeProject = $state(false);
  preview = $state<BugReportPreview | null>(null);
  saving = $state(false);

  /** The crash that ended the last run, until dismissed. */
  crash = $state<CrashInfo | null>(null);

  #timer: ReturnType<typeof setTimeout> | null = null;

  async refresh() {
    try {
      this.snapshot = await api.healthSnapshot();
    } catch {
      // Keep the last snapshot; the next poll tries again.
    }
  }

  /** Poll while the app runs; faster while the panel is open. */
  start() {
    if (this.#timer) return;
    const tick = async () => {
      await this.refresh();
      this.#timer = setTimeout(tick, this.open ? POLL_OPEN_MS : POLL_MS);
    };
    void tick();
    void api
      .crashNotice()
      .then((c) => (this.crash = c))
      .catch(() => {});
  }

  stop() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  show() {
    this.open = true;
    void this.refresh();
  }

  showReport() {
    this.open = false;
    this.crash = null;
    this.reportOpen = true;
    void this.loadPreview();
  }

  async loadPreview() {
    try {
      this.preview = await api.bugReportPreview(this.includeProject, windowInfo());
    } catch (e) {
      toasts.error(e);
    }
  }

  async save() {
    const name = this.preview?.file_name ?? 'castwright-bug-report.zip';
    let path = name;
    if (isTauri()) {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const picked = await save({ defaultPath: name, filters: [{ name: 'Zip file', extensions: ['zip'] }] });
      if (!picked) return;
      path = picked;
    }
    this.saving = true;
    try {
      await api.saveBugReport(path, this.includeProject, windowInfo());
      this.reportOpen = false;
      const where = path;
      toasts.show('Bug report saved', 'success', 6000, 'bug-report', isTauri() ? { label: 'Show file', run: () => void reveal(where) } : undefined);
    } catch (e) {
      toasts.error(e);
    } finally {
      this.saving = false;
    }
  }
}

export const health = new Health();
