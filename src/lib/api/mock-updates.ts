// Updates for the browser demo: a made-up next version that downloads in a few
// seconds. `?update` offers it at start, `?update=downloading` stops the download
// halfway (for screenshots).

import type { UpdateSettings } from '$lib/bindings/UpdateSettings';

export const DEMO_SIZE = 38_400_000;

/** The minor version after `current`: 0.7.0 -> 0.8.0. */
export function nextVersion(current: string): string {
  const [major = 0, minor = 0] = current
    .replace(/^v/, '')
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);
  return `${major}.${minor + 1}.0`;
}

export function demoRelease(current: string) {
  const version = nextVersion(current);
  return {
    version,
    url: `https://github.com/AmeliaFromFinance/castwright/releases/tag/v${version}`,
    notes: [
      '### New',
      '- **One-click updates.** Download, install and restart from the status bar.',
      '- **Add stream marker** and **Create clip** hotkeys, with notes and clip links in the stream summary.',
      '### Fixed',
      '- This is the demo, so these notes are made up.'
    ].join('\n')
  };
}

interface Deps {
  emit: (name: string, payload: unknown) => void;
  live: () => boolean;
  settings: () => { updates: UpdateSettings };
  query: URLSearchParams;
}

export function createUpdatesMock({ emit, live, settings, query }: Deps): Record<string, (a: Record<string, unknown>) => unknown> {
  const hold = query.get('update') === 'downloading';
  let downloaded = false;
  return {
    update_prepare: () => ({ version: null, can_install: true, reason: null }),
    update_download: () =>
      new Promise<void>((resolve) => {
        let got = 0;
        const steps = 20;
        let n = 0;
        const tick = () => {
          n++;
          got = Math.min(DEMO_SIZE, Math.round((DEMO_SIZE * n) / steps));
          if (hold && n > steps * 0.45) return;
          emit('cw://update-progress', { downloaded: got, total: DEMO_SIZE });
          if (n >= steps) {
            downloaded = true;
            resolve();
          } else setTimeout(tick, 220);
        };
        setTimeout(tick, 150);
      }),
    update_restart: ({ confirmed }) => {
      if (!downloaded) throw { code: 'user', message: 'Download the update first.' };
      return live() && !confirmed ? 'after_stream' : 'restarting';
    },
    update_cancel_restart: () => undefined,
    save_update_settings: ({ settings: s }) => {
      settings().updates = { ...(s as UpdateSettings) };
      return settings().updates;
    },
    'plugin:process|restart': () => undefined
  };
}
