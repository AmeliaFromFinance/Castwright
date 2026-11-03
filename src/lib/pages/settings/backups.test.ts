import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoBackend } from '$lib/api/mock';
import type { Backend } from '$lib/api/backend';
import type { BackupInfo } from '$lib/bindings/BackupInfo';
import type { Project } from '$lib/bindings/Project';
import type { Settings } from '$lib/bindings/Settings';

describe('demo backups', () => {
  let b: Backend;
  const list = () => b.invoke<BackupInfo[]>('list_backups');

  beforeEach(() => {
    window.history.replaceState({}, '', '/?demo=static');
    b = createDemoBackend();
  });

  it('skips a backup when nothing changed', async () => {
    const before = await list();
    expect(before.length).toBeGreaterThan(0);
    expect(await b.invoke('create_backup')).toBeNull();
    await b.invoke('rename_project', { name: 'Renamed' });
    const made = await b.invoke<BackupInfo>('create_backup');
    expect(made.reason).toBe('manual');
    expect(made.project).toBe('Renamed');
    expect(made.file).toMatch(/^\d{4}-\d\d-\d\d_\d\d-\d\d-\d\dZ_manual\.cwbackup$/);
    expect((await list())[0]).toEqual(made);
  });

  it('restores, backing up the current project first', async () => {
    const original = (await b.invoke<Project>('get_project')).name;
    const target = (await list())[0]!;
    await b.invoke('rename_project', { name: 'Broken' });
    await b.invoke('set_var', { key: 'counter.deaths', value: 99, persist: true });
    const p = await b.invoke<Project>('restore_backup', { file: target.file });
    expect(p.name).toBe(original);
    expect((await b.invoke<Record<string, unknown>>('get_vars'))['counter.deaths']).toBe(7);
    const newest = (await list())[0]!;
    expect(newest.reason).toBe('before_restore');
    expect(newest.project).toBe('Broken');
    await expect(b.invoke('restore_backup', { file: 'nope.cwbackup' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('prunes to the configured counts', async () => {
    for (let i = 0; i < 4; i++) {
      await b.invoke('rename_project', { name: `Take ${i}` });
      await b.invoke('create_backup');
    }
    const saved = await b.invoke<Settings['backups']>('save_backup_settings', { backups: { keep_daily: 1, keep_other: 2 } });
    expect(saved).toEqual({ keep_daily: 1, keep_other: 2 });
    const left = await list();
    expect(left.filter((x) => x.reason === 'startup' || x.reason === 'daily')).toHaveLength(1);
    expect(left.filter((x) => x.reason === 'manual').map((x) => x.project)).toEqual(['Take 3', 'Take 2']);
    const clamped = await b.invoke<Settings['backups']>('save_backup_settings', { backups: { keep_daily: 0, keep_other: 999 } });
    expect(clamped).toEqual({ keep_daily: 1, keep_other: 100 });
  });
});
