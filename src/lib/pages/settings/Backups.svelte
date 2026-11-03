<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/state/app.svelte';
  import { api } from '$lib/api';
  import { errorMessage, isTauri } from '$lib/api/backend';
  import { attempt, attemptOk, toasts } from '$lib/state/toast.svelte';
  import type { BackupInfo } from '$lib/bindings/BackupInfo';
  import type { Project } from '$lib/bindings/Project';
  import { ago, bytes } from '$lib/format';
  import { reveal } from '$lib/util/os';
  import Button from '$lib/ui/Button.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import Row from './Row.svelte';
  import { REASON_LABELS, backupDate } from './backups';
  import { Download, FolderOpen, Trash2, Upload, X } from '@lucide/svelte';

  interface Props {
    onrestored?: (p: Project) => void;
  }
  let { onrestored }: Props = $props();

  let list = $state<BackupInfo[]>([]);
  let loaded = $state(false);
  let busy = $state(false);
  let restoreTarget = $state<BackupInfo | null>(null);
  let deleteTarget = $state<BackupInfo | null>(null);
  let error = $state<string | null>(null);
  let keepDaily = $state(app.settings?.backups.keep_daily ?? 14);
  let keepOther = $state(app.settings?.backups.keep_other ?? 5);

  onMount(load);

  async function load() {
    list = (await attempt(() => api.listBackups())) ?? [];
    loaded = true;
  }

  async function backUpNow() {
    busy = true;
    const made = await attempt(() => api.createBackup());
    busy = false;
    if (made === undefined) return;
    toasts.success(made ? 'Backup saved' : 'Nothing changed since the last backup');
    await load();
  }

  async function run(work: () => Promise<Project>) {
    error = null;
    busy = true;
    try {
      const p = await work();
      app.project = p;
      onrestored?.(p);
      toasts.success('Backup restored');
    } catch (e) {
      error = errorMessage(e);
    }
    busy = false;
    await load();
  }

  function restore() {
    if (!restoreTarget) return;
    const file = restoreTarget.file;
    restoreTarget = null;
    run(() => api.restoreBackup(file));
  }

  async function restoreFromFile() {
    if (!isTauri()) {
      toasts.show('Restoring from a file needs the desktop app');
      return;
    }
    const { open } = await import('@tauri-apps/plugin-dialog');
    const path = await open({
      title: 'Restore a backup',
      filters: [{ name: 'Castwright backup', extensions: ['cwbackup', 'json'] }]
    });
    if (typeof path !== 'string') return;
    run(() => api.restoreBackupFile(path));
  }

  async function exportBackup(b: BackupInfo) {
    if (!isTauri()) {
      toasts.show('Saving files needs the desktop app');
      return;
    }
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: b.file, filters: [{ name: 'Castwright backup', extensions: ['cwbackup'] }] });
    if (!path) return;
    await attemptOk(() => api.exportBackup(b.file, path), 'Backup saved');
  }

  async function remove() {
    if (!deleteTarget) return;
    const file = deleteTarget.file;
    deleteTarget = null;
    if (await attemptOk(() => api.deleteBackup(file), 'Backup deleted')) await load();
  }

  async function saveKeep() {
    const saved = await attempt(() => api.saveBackupSettings({ keep_daily: keepDaily, keep_other: keepOther }));
    if (!saved) return;
    keepDaily = saved.keep_daily;
    keepOther = saved.keep_other;
    await app.reloadSettings();
    await load();
  }
</script>

<div class="row gap">
  <Button size="sm" variant="primary" {busy} onclick={backUpNow}>Back up now</Button>
  <Button size="sm" disabled={busy} onclick={restoreFromFile}><Upload size={14} />Restore from file…</Button>
  <Button size="sm" variant="ghost" onclick={() => reveal(app.info?.backup_dir ?? '')}><FolderOpen size={14} />Open folder</Button>
</div>

{#if error}
  <div class="error" role="alert">
    <div class="grow">
      <b>Couldn't restore the backup.</b> Your project wasn't changed.
      <div class="detail">{error}</div>
    </div>
    <IconButton size="sm" label="Dismiss" onclick={() => (error = null)}><X size={14} /></IconButton>
  </div>
{/if}

{#if list.length}
  <div class="table-wrap">
    <table aria-label="Backups">
      <thead>
        <tr>
          <th>Date</th>
          <th>Reason</th>
          <th>Project</th>
          <th class="num">Size</th>
          <th><span class="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {#each list as b (b.file)}
          <tr>
            <td>
              <span>{backupDate(b.ts)}</span>
              <span class="faint">{ago(b.ts)}</span>
            </td>
            <td>{REASON_LABELS[b.reason]}</td>
            <td class="project truncate" title={b.project}>{b.project || 'Unreadable'}</td>
            <td class="num faint">{bytes(b.bytes)}</td>
            <td class="actions">
              <Button size="sm" disabled={busy} onclick={() => (restoreTarget = b)} aria-label="Restore backup from {backupDate(b.ts)}">Restore</Button>
              <IconButton size="sm" label="Export backup from {backupDate(b.ts)}" onclick={() => exportBackup(b)}><Download size={14} /></IconButton>
              <IconButton size="sm" tone="danger" label="Delete backup from {backupDate(b.ts)}" onclick={() => (deleteTarget = b)}><Trash2 size={14} /></IconButton>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{:else if loaded}
  <p class="faint small">No backups yet.</p>
{/if}

<Row label="Daily backups" hint="How many days to keep. One backup per day.">
  <input class="input keep" type="number" min="1" max="365" aria-label="Daily backups to keep" bind:value={keepDaily} onchange={saveKeep} />
</Row>
<Row label="Other backups" hint="Made with Back up now, or before a restore, import or upgrade.">
  <input class="input keep" type="number" min="1" max="100" aria-label="Other backups to keep" bind:value={keepOther} onchange={saveKeep} />
</Row>

<Dialog
  open={restoreTarget !== null}
  onclose={() => (restoreTarget = null)}
  title="Restore this backup?"
  description="Your overlays, alerts, actions and saved variables go back to how they were on {restoreTarget
    ? backupDate(restoreTarget.ts)
    : ''}. The current project is backed up first, so you can undo this."
  width={440}
>
  {#snippet footer()}
    <Button onclick={() => (restoreTarget = null)}>Cancel</Button>
    <Button variant="primary" onclick={restore}>Restore</Button>
  {/snippet}
</Dialog>

<Dialog open={deleteTarget !== null} onclose={() => (deleteTarget = null)} title="Delete this backup?" description="This can't be undone." width={400}>
  {#snippet footer()}
    <Button onclick={() => (deleteTarget = null)}>Cancel</Button>
    <Button variant="danger" onclick={remove}>Delete</Button>
  {/snippet}
</Dialog>

<style>
  .gap {
    gap: 8px;
  }
  .table-wrap {
    max-width: 760px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    max-height: 320px;
    overflow-y: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th {
    position: sticky;
    top: 0;
    background: var(--bg-2);
    text-align: left;
    font-weight: 550;
    font-size: 12px;
    color: var(--text-muted);
    padding: 7px 12px;
    border-bottom: 1px solid var(--border);
  }
  td {
    padding: 6px 12px;
    vertical-align: middle;
    white-space: nowrap;
  }
  tbody tr + tr td {
    border-top: 1px solid var(--border);
  }
  td:first-child span + span {
    margin-left: 8px;
  }
  .num {
    text-align: right;
  }
  .project {
    max-width: 180px;
  }
  .actions {
    width: 1%;
    text-align: right;
  }
  .actions :global(> *) {
    vertical-align: middle;
  }
  .actions :global(> * + *) {
    margin-left: 4px;
  }
  .keep {
    width: 90px;
  }
  .small {
    font-size: 12px;
  }
  .error {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    max-width: 760px;
    padding: 10px 12px;
    border: 1px solid var(--danger);
    border-radius: var(--radius-lg);
    color: var(--danger);
    font-size: 13px;
    line-height: 1.45;
  }
  .detail {
    color: var(--text-muted);
    margin-top: 2px;
  }
</style>
