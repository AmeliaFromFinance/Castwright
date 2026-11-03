<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { api } from '$lib/api';
  import type { Overlay } from '$lib/bindings/Overlay';
  import Editor from '$lib/editor/Editor.svelte';
  import { newOverlay } from '$lib/editor/starter';
  import { BUILT_IN_TEMPLATES, fromTemplate } from '$lib/overlay/templates';
  import { app } from '$lib/state/app.svelte';
  import { attempt, toasts } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import EmptyState from '$lib/ui/EmptyState.svelte';
  import { CircleHelp, Layers, Plus, Upload } from '@lucide/svelte';
  import AddToObsDialog from './AddToObsDialog.svelte';
  import NewOverlayDialog, { type NewOverlaySource } from './NewOverlayDialog.svelte';
  import ObsHelpDialog from './ObsHelpDialog.svelte';
  import OverlayCard from './OverlayCard.svelte';

  const overlays = $derived(app.project?.overlays ?? []);

  // The editor works on a copy taken when it opens.
  let editing = $state<Overlay | null>(null);
  $effect(() => {
    const id = app.editingOverlay;
    untrack(() => {
      if (!id) {
        editing = null;
        return;
      }
      if (editing?.id === id) return;
      const found = app.project?.overlays.find((o) => o.id === id);
      editing = found ? (JSON.parse(JSON.stringify(found)) as Overlay) : null;
      if (!found) app.editingOverlay = null;
    });
  });

  let newOpen = $state(false);
  let creating = $state(false);
  let helpOpen = $state(false);
  let obsTarget = $state<Overlay | null>(null);
  let obsOpen = $state(false);
  let deleteTarget = $state<Overlay | null>(null);
  let deleteOpen = $state(false);
  let now = $state(Date.now());

  onMount(() => {
    const t = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(t);
  });

  async function create({ name, source }: { name: string; source: NewOverlaySource }) {
    creating = true;
    const saved = await attempt(() => {
      if (source.kind === 'user') return api.overlayFromTemplate(source.id, name);
      if (source.kind === 'blank') return api.saveOverlay(newOverlay(name, source.width, source.height, false));
      const t = BUILT_IN_TEMPLATES.find((x) => x.id === source.id)!;
      return api.saveOverlay(fromTemplate(t.overlay, name));
    });
    if (saved) {
      await attempt(() => app.reloadProject());
      newOpen = false;
      app.editingOverlay = saved.id;
    }
    creating = false;
  }

  let templateTarget = $state<Overlay | null>(null);
  let templateOpen = $state(false);
  let templateName = $state('');
  let savingTemplate = $state(false);

  async function saveTemplate(e: SubmitEvent) {
    e.preventDefault();
    const o = templateTarget;
    if (!o) return;
    savingTemplate = true;
    const t = await attempt(() => api.saveOverlayTemplate(o.id, templateName.trim() || o.name));
    savingTemplate = false;
    if (t) {
      templateOpen = false;
      toasts.success(`Saved "${t.name}". Pick it under New overlay.`);
    }
  }

  async function copyLink(id: string) {
    const url = await attempt(() => api.overlayUrl(id));
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toasts.success('OBS link copied. Paste it into a Browser Source.');
    } catch {
      toasts.show(url);
    }
  }

  async function duplicate(o: Overlay) {
    const copy = await attempt(() => api.duplicateOverlay(o.id));
    if (copy) {
      await attempt(() => app.reloadProject());
      toasts.success(`Made "${copy.name}"`);
    }
  }

  async function exportOverlay(o: Overlay) {
    if (app.demo) {
      toasts.show('Exporting files needs the desktop app.');
      return;
    }
    const { save } = await import('@tauri-apps/plugin-dialog');
    const safe = o.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'overlay';
    const path = await save({ defaultPath: `${safe}.cwoverlay`, filters: [{ name: 'Castwright overlay', extensions: ['cwoverlay'] }] });
    if (!path) return;
    try {
      await api.exportOverlay(o.id, path);
      toasts.success(`Exported "${o.name}"`);
    } catch (e) {
      toasts.error(e);
    }
  }

  async function importOverlay() {
    if (app.demo) {
      toasts.show('Importing files needs the desktop app.');
      return;
    }
    const { open } = await import('@tauri-apps/plugin-dialog');
    const path = await open({ multiple: false, filters: [{ name: 'Castwright overlay', extensions: ['cwoverlay'] }] });
    if (typeof path !== 'string') return;
    const o = await attempt(() => api.importOverlay(path));
    if (o) {
      await attempt(() => app.reloadProject());
      toasts.success(`Imported "${o.name}"`);
    }
  }

  async function remove() {
    const o = deleteTarget;
    if (!o) return;
    deleteOpen = false;
    try {
      await api.deleteOverlay(o.id);
      toasts.success(`Deleted "${o.name}"`);
    } catch (e) {
      toasts.error(e);
    }
    await attempt(() => app.reloadProject());
  }
</script>

{#if app.editingOverlay && editing}
  {#key editing.id}
    <Editor overlay={editing} onclose={() => (app.editingOverlay = null)} />
  {/key}
{:else}
  <div class="overlays">
    <header class="toolbar">
      <div class="heading">
        <h1>Overlays</h1>
        {#if overlays.length}<span class="faint count">{overlays.length}</span>{/if}
      </div>
      <div class="grow"></div>
      <Button size="sm" variant="ghost" onclick={() => (helpOpen = true)}><CircleHelp size={14} />How to use in OBS</Button>
      <Button size="sm" onclick={importOverlay}><Upload size={14} />Import</Button>
      <Button variant="primary" onclick={() => (newOpen = true)}><Plus size={15} />New overlay</Button>
    </header>

    <div class="content">
      {#if overlays.length}
        <div class="grid">
          {#each overlays as o (o.id)}
            <OverlayCard
              overlay={o}
              {now}
              onedit={() => (app.editingOverlay = o.id)}
              oncopy={() => copyLink(o.id)}
              onobs={() => {
                obsTarget = o;
                obsOpen = true;
              }}
              onduplicate={() => duplicate(o)}
              onexport={() => exportOverlay(o)}
              ontemplate={() => {
                templateTarget = o;
                templateName = o.name;
                templateOpen = true;
              }}
              ondelete={() => {
                deleteTarget = o;
                deleteOpen = true;
              }}
            />
          {/each}
        </div>
      {:else}
        <EmptyState title="No overlays yet" body="An overlay is a transparent page OBS shows on top of your stream: alerts, chat, goals and more.">
          {#snippet icon()}<Layers size={36} strokeWidth={1.5} />{/snippet}
          <Button variant="primary" onclick={() => (newOpen = true)}><Plus size={15} />New overlay</Button>
          <Button onclick={importOverlay}><Upload size={14} />Import</Button>
        </EmptyState>
      {/if}
    </div>
  </div>
{/if}

<NewOverlayDialog bind:open={newOpen} busy={creating} oncreate={create} />
<ObsHelpDialog bind:open={helpOpen} {overlays} oncopy={copyLink} />
<AddToObsDialog bind:open={obsOpen} overlay={obsTarget} />
<Dialog bind:open={templateOpen} title="Save as template" description="New overlays can start from it. Its images and other files are saved with it." width={420}>
  <form id="save-template" onsubmit={saveTemplate}>
    <label class="label" for="template-name">Template name</label>
    <!-- svelte-ignore a11y_autofocus -->
    <input id="template-name" class="input" bind:value={templateName} maxlength="80" autocomplete="off" autofocus />
  </form>
  {#snippet footer()}
    <Button onclick={() => (templateOpen = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="save-template" busy={savingTemplate}>Save template</Button>
  {/snippet}
</Dialog>
<Dialog bind:open={deleteOpen} title={deleteTarget ? `Delete "${deleteTarget.name}"?` : 'Delete overlay?'} width={420}>
  <p class="muted">This removes the overlay and all its layers. OBS sources using its link will go blank.</p>
  {#snippet footer()}
    <Button onclick={() => (deleteOpen = false)}>Cancel</Button>
    <Button variant="danger" onclick={remove}>Delete overlay</Button>
  {/snippet}
</Dialog>

<style>
  .overlays {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 54px;
    flex: none;
    padding: 0 16px;
    border-bottom: 1px solid var(--border);
  }
  .heading {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  h1 {
    font-size: 15px;
  }
  .count {
    font-size: 12px;
  }
  .content {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 16px;
  }
  .label {
    display: block;
    margin-bottom: 6px;
    font-size: 12px;
    font-weight: 550;
    color: var(--text-muted);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 14px;
  }
</style>
