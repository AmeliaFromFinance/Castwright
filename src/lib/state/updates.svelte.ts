import { isTauri } from '$lib/api/backend';
import { loadPref, savePref } from './persist';

const LATEST = 'https://api.github.com/repos/AmeliaFromFinance/castwright/releases/latest';
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

class Updates {
  available = $state<{ version: string; url: string } | null>(null);

  /** Asks GitHub once a day whether a newer release exists. Failures are ignored. */
  async check(current: string, force = false): Promise<void> {
    if (!isTauri() || !current) return;
    const last = loadPref<{ at: number; version: string; url: string } | null>('update-check', null);
    if (!force && last && Date.now() - last.at < DAY) {
      if (newerVersion(last.version, current)) this.available = { version: last.version, url: last.url };
      return;
    }
    try {
      const r = await fetch(LATEST, { headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) return;
      const j = (await r.json()) as { tag_name?: string; html_url?: string };
      const version = (j.tag_name ?? '').replace(/^v/, '');
      const url = j.html_url ?? 'https://github.com/AmeliaFromFinance/castwright/releases/latest';
      if (!version) return;
      savePref('update-check', { at: Date.now(), version, url });
      this.available = newerVersion(version, current) ? { version, url } : null;
    } catch {
      // Offline or blocked; try again next start.
    }
  }
}

export const updates = new Updates();
