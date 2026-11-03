import { beforeEach, describe, expect, it } from 'vitest';
import { api, setBackend } from '$lib/api';
import { createDemoBackend } from '$lib/api/mock';
import { app } from './app.svelte';
import { golive } from './golive.svelte';

describe('go-live store', () => {
  beforeEach(async () => {
    setBackend(createDemoBackend());
    app.settings = await api.getSettings();
    golive.open = false;
    golive.checks = null;
    golive.ticked = new Set();
  });

  it('opens by itself when the stream starts with a problem', async () => {
    await golive.watchLive(false);
    await api.alertPause(true);
    await golive.watchLive(true);
    expect(golive.open).toBe(true);
    expect(golive.checks?.find((c) => c.id === 'alerts_paused')?.status).toBe('fail');
  });

  it('stays closed when everything passes or the setting is off', async () => {
    await golive.watchLive(false);
    await golive.watchLive(true);
    expect(golive.checks).not.toBeNull();
    expect(golive.open).toBe(false);

    await api.alertPause(true);
    app.settings!.golive.open_on_live = false;
    await golive.watchLive(false);
    await golive.watchLive(true);
    expect(golive.open).toBe(false);
  });

  it('runs a fix and checks again', async () => {
    await api.alertMute(true);
    await golive.run();
    const muted = golive.checks!.find((c) => c.id === 'alerts_muted')!;
    expect(muted.status).toBe('warn');
    await golive.fix(muted);
    expect(golive.checks!.find((c) => c.id === 'alerts_muted')!.status).toBe('pass');
    expect((await api.alertQueue()).muted).toBe(false);
  });

  it('clears ticks when the stream ends', async () => {
    await golive.watchLive(true);
    golive.toggle('mic');
    expect(golive.ticked.has('mic')).toBe(true);
    await golive.watchLive(false);
    expect(golive.ticked.size).toBe(0);
  });
});
