import { tick } from 'svelte';
import { api } from '$lib/api';
import type { Check } from '$lib/bindings/Check';
import type { CheckFix } from '$lib/bindings/CheckFix';
import { tally, wentLive } from '$lib/shell/golive';
import { app } from './app.svelte';
import { toasts } from './toast.svelte';

class GoLive {
  open = $state(false);
  running = $state(false);
  checks = $state<Check[] | null>(null);
  /** Ids of custom items ticked during this stream. */
  ticked = $state(new Set<string>());
  /** Check id whose fix is running. */
  fixing = $state<string | null>(null);

  private live: boolean | null = null;
  private runId = 0;

  async run(): Promise<Check[] | null> {
    const id = ++this.runId;
    this.running = true;
    try {
      const checks = await api.goLiveCheck();
      if (id === this.runId) this.checks = checks;
      return checks;
    } catch (e) {
      toasts.error(e);
      return null;
    } finally {
      if (id === this.runId) this.running = false;
    }
  }

  show() {
    this.open = true;
    void this.run();
  }

  toggle(itemId: string) {
    const next = new Set(this.ticked);
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    this.ticked = next;
  }

  async fix(check: Check) {
    if (!check.fix) return;
    if (check.fix.type === 'open') {
      this.open = false;
      await openPlace(check.fix.place);
      return;
    }
    this.fixing = check.id;
    try {
      await api.goLiveFix(check.fix as CheckFix);
    } catch (e) {
      toasts.error(e);
    }
    // OBS takes a moment to load a fixed source.
    if (check.fix.type === 'fix_overlay_link' || check.fix.type === 'reload_source') await new Promise((r) => setTimeout(r, 1500));
    this.fixing = null;
    await this.run();
  }

  /** Call whenever the live state may have changed. */
  async watchLive(now: boolean) {
    const prev = this.live;
    this.live = now;
    if (prev && !now) this.ticked = new Set();
    if (!wentLive(prev, now) || !app.settings?.golive.open_on_live || this.open) return;
    const checks = await this.run();
    if (checks && tally(checks).fail > 0) this.open = true;
  }
}

export async function openPlace(place: string) {
  if (place === 'overlays' || place === 'activity') {
    app.editingOverlay = null;
    app.page = place;
    return;
  }
  const section = place.startsWith('settings:') ? place.slice('settings:'.length) : null;
  if (section !== null) {
    app.page = 'settings';
    await tick();
    setTimeout(() => document.getElementById(section)?.scrollIntoView({ block: 'start' }), 60);
  }
}

export const golive = new GoLive();
