import { api, on } from '$lib/api';
import { errorMessage, isTauri } from '$lib/api/backend';
import type { UpdateSettings } from '$lib/bindings/UpdateSettings';
import { loadPref, savePref } from './persist';
import { IDLE, step, type UpdateEvent, type UpdatePhase } from './update-flow';

const LATEST = 'https://api.github.com/repos/AmeliaFromFinance/castwright/releases/latest';
export const RELEASES_PAGE = 'https://github.com/AmeliaFromFinance/castwright/releases/latest';
const DAY = 24 * 60 * 60 * 1000;

/** `1.2.10` > `1.2.9`; anything after `-` is ignored. */
export function newerVersion(latest: string, current: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/, '')
      .split('-')[0]!
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export interface Release {
  version: string;
  url: string;
  /** The release text from GitHub, in changelog form. */
  notes: string;
}

class Updates {
  available = $state<Release | null>(null);
  phase = $state<UpdatePhase>(IDLE);
  settings = $state<UpdateSettings>({ auto_install: false, channel: 'stable' });
  /** The update dialog is open. */
  open = $state(false);
  private listening = false;

  dispatch(e: UpdateEvent) {
    this.phase = step(this.phase, e);
  }

  /** Asks GitHub once a day whether a newer release exists. Failures are ignored. */
  async check(current: string, force = false): Promise<void> {
    if (!current) return;
    if (!isTauri()) return this.demoCheck(current, force);
    const last = loadPref<{ at: number; version: string; url: string; notes?: string } | null>('update-check', null);
    if (!force && last && Date.now() - last.at < DAY) {
      if (newerVersion(last.version, current)) this.found({ version: last.version, url: last.url, notes: last.notes ?? '' });
      return;
    }
    try {
      const r = await fetch(LATEST, { headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) return;
      const j = (await r.json()) as { tag_name?: string; html_url?: string; body?: string };
      const version = (j.tag_name ?? '').replace(/^v/, '');
      const url = j.html_url ?? RELEASES_PAGE;
      if (!version) return;
      const notes = typeof j.body === 'string' ? j.body : '';
      savePref('update-check', { at: Date.now(), version, url, notes });
      if (newerVersion(version, current)) this.found({ version, url, notes });
      else this.available = null;
    } catch {
      // Offline or blocked; try again next start.
    }
  }

  /** The browser demo has an update when asked for one (Check for updates, `?update` or `?busy`). */
  private async demoCheck(current: string, force: boolean) {
    const q = new URLSearchParams(location.search);
    if (!force && !q.has('update') && !q.has('busy')) return;
    const { demoRelease } = await import('$lib/api/mock-updates');
    this.found(demoRelease(current));
  }

  private found(r: Release) {
    this.available = r;
    void this.prepare();
  }

  /** Ask the app whether this copy can install the update itself. */
  async prepare() {
    await this.listen();
    try {
      const plan = await api.updatePrepare();
      this.dispatch({ type: 'found', canInstall: plan.can_install, reason: plan.reason });
    } catch (e) {
      this.dispatch({ type: 'found', canInstall: false, reason: errorMessage(e) });
    }
    const p = this.phase;
    if (this.settings.auto_install && p.kind === 'available' && p.canInstall) void this.download();
  }

  async download() {
    this.dispatch({ type: 'download' });
    if (this.phase.kind !== 'downloading') return;
    try {
      await api.updateDownload();
      this.dispatch({ type: 'downloaded' });
    } catch (e) {
      this.dispatch({ type: 'failed', message: errorMessage(e) });
    }
  }

  /** `confirmed`: restart even though the stream is live. */
  async restart(confirmed = false) {
    try {
      const outcome = await api.updateRestart(confirmed);
      this.dispatch({ type: 'restart', outcome });
      if (outcome === 'restarting') await api.relaunch();
    } catch (e) {
      this.dispatch({ type: 'failed', message: errorMessage(e) });
    }
  }

  async cancelRestart() {
    this.dispatch({ type: 'cancel' });
    await api.updateCancelRestart().catch(() => {});
  }

  private async listen() {
    if (this.listening) return;
    this.listening = true;
    await Promise.all([
      on('cw://update-progress', (p) => this.dispatch({ type: 'progress', downloaded: p.downloaded, total: p.total })),
      on('cw://update-ask', () => {
        this.dispatch({ type: 'stream_ended' });
        this.open = true;
      })
    ]);
  }
}

export const updates = new Updates();
