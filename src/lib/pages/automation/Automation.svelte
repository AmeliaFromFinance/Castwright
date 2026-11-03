<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { api } from '$lib/api';
  import type { Action } from '$lib/bindings/Action';
  import { clone, newId } from '$lib/editors/ids';
  import { copyName } from '$lib/editors/list';
  import Menu from '$lib/editors/Menu.svelte';
  import SaveIndicator from '$lib/editors/SaveIndicator.svelte';
  import { isTypingTarget } from '$lib/editor/keys';
  import type { ActionPackage } from '$lib/bindings/ActionPackage';
  import type { ImportReport } from '$lib/bindings/ImportReport';
  import { app } from '$lib/state/app.svelte';
  import { attempt, attemptOk, toasts } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import EmptyState from '$lib/ui/EmptyState.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import ResizeHandle from '$lib/ui/ResizeHandle.svelte';
  import { CircleAlert, FileUp, Play, Plus, Redo2, Undo2, Zap } from '@lucide/svelte';
  import ActionHeader from './ActionHeader.svelte';
  import ActionList from './ActionList.svelte';
  import { TEMPLATE_MENU, fromTemplate, type TemplateId } from './defaults';
  import FlowView from './FlowView.svelte';
  import ImportActionsDialog from './ImportActionsDialog.svelte';
  import { ACTIONS_EXT, packageFileName } from './sharing';
  import RunLog from './RunLog.svelte';
  import { actionsEditor as ed, flow, runLog } from './store.svelte';
  import VarsInspector from './VarsInspector.svelte';

  let confirmDelete = $state<Action | null>(null);

  const wide = typeof window !== 'undefined' && window.innerWidth >= 2000;
  let width = $state(0);
  let listW = $state(wide ? 300 : 250);
  let sideW = $state(wide ? 400 : 330);
  let logH = $state(wide ? 420 : 280);
  let logOpen = $state(true);
  let varsOpen = $state(true);

  // Without room for both, the inspector takes the place of the run log while it is open.
  const hideSide = $derived(!!flow.inspected && width < 1700);

  // A new action starts with nothing selected in the flow.
  $effect(() => {
    void ed.selectedId;
    untrack(() => flow.clear());
  });

  // The test is over once its run shows up in the log.
  $effect(() => {
    const t = flow.testing;
    if (t && (runLog.last[t.actionId]?.seq ?? 0) > t.after) flow.testing = null;
  });

  async function test(a: Action) {
    flow.testing = { actionId: a.id, after: runLog.runs[0]?.seq ?? 0 };
    // Run what is on screen, not the last autosave.
    await ed.saver.flush();
    if (!(await attemptOk(() => api.runAction(a.id)))) flow.testing = null;
  }

  function onKey(e: KeyboardEvent) {
    const a = ed.selected;
    if (!a || e.defaultPrevented || isTypingTarget(e.target) || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    const t = e.target as Element | null;
    if (t && t !== document.body && !t.closest('.automation')) return;
    const key = e.key.toLowerCase();
    if (key === 'z') ed.step(a.id, e.shiftKey ? 'redo' : 'undo');
    else if (key === 'y') ed.step(a.id, 'redo');
    else return;
    e.preventDefault();
  }

  onMount(() => runLog.listen());
  onDestroy(() => void ed.saver.flush());

  $effect(() => {
    void app.project?.actions;
    ed.sync();
  });

  $effect(() => {
    if (ed.actions && !ed.selected && ed.actions.length) ed.selectedId = ed.actions[0]!.id;
  });

  function create(id: TemplateId) {
    if (!ed.actions) return;
    const a = fromTemplate(id);
    const taken = ed.actions.map((x) => x.name);
    for (let n = 2; taken.includes(a.name); n++) a.name = `${fromTemplate(id).name} ${n}`;
    ed.actions.push(a);
    ed.selectedId = a.id;
    ed.search = '';
    ed.changed();
  }

  const onduplicate = (a: Action) => duplicate(a);

  function duplicate(a: Action) {
    if (!ed.actions) return;
    const copy = { ...clone($state.snapshot(a) as Action), id: newId(), name: copyName(a.name, ed.actions.map((x) => x.name)) };
    ed.actions.splice(ed.actions.indexOf(a) + 1, 0, copy);
    ed.selectedId = copy.id;
    ed.changed();
  }

  function remove(a: Action) {
    if (!ed.actions) return;
    const i = ed.actions.findIndex((x) => x.id === a.id);
    ed.actions = ed.actions.filter((x) => x.id !== a.id);
    ed.selectedId = ed.actions[Math.min(i, ed.actions.length - 1)]?.id ?? null;
    ed.changed();
  }

  // ---------- sharing ----------

  const FILTERS = [{ name: 'Castwright actions', extensions: [ACTIONS_EXT] }];
  let importPkg = $state<ActionPackage | null>(null);
  let importSource = $state('');
  let importOpen = $state(false);
  let fileInput = $state<HTMLInputElement>();
  let dropping = $state(false);

  async function exportActions(ids: string[], label: string) {
    if (!ids.length) return;
    // Export what is on screen, not the last autosave.
    await ed.saver.flush();
    const file = packageFileName(label);
    const done = `Exported ${ids.length === 1 ? `"${label}"` : `${ids.length} actions`}`;
    if (app.demo) {
      const pkg = await attempt(() => api.actionsPackage(ids));
      if (!pkg) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' }));
      a.download = file;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toasts.success(done);
      return;
    }
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: file, filters: FILTERS });
    if (!path) return;
    if (await attemptOk(() => api.exportActions(ids, path))) toasts.success(done);
  }

  function showImport(pkg: ActionPackage, source: string) {
    importPkg = pkg;
    importSource = source;
    importOpen = true;
  }

  async function chooseImport() {
    if (app.demo) {
      fileInput?.click();
      return;
    }
    const { open } = await import('@tauri-apps/plugin-dialog');
    const path = await open({ multiple: false, filters: FILTERS });
    if (typeof path !== 'string') return;
    const pkg = await attempt(() => api.readActionsFile(path));
    if (pkg) showImport(pkg, path.split(/[\\/]/).pop() ?? path);
  }

  async function readFile(f: File) {
    if (!f.name.toLowerCase().endsWith(`.${ACTIONS_EXT}`)) {
      toasts.error(`That isn't a .${ACTIONS_EXT} file.`);
      return;
    }
    const text = await f.text();
    const pkg = await attempt(() => api.parseActionsPackage(text));
    if (pkg) showImport(pkg, f.name);
  }

  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');

  async function imported(r: ImportReport) {
    await attempt(() => app.reloadProject());
    if (r.first_id) ed.selectedId = r.first_id;
    const parts = [r.added && `${r.added} added`, r.replaced && `${r.replaced} replaced`, r.skipped && `${r.skipped} skipped`].filter(Boolean);
    toasts.success(`Imported actions: ${parts.join(', ') || 'none'}. They are off until you switch them on.`);
  }

  const usedBy = $derived(
    confirmDelete
      ? (ed.actions ?? []).filter((a) => a.id !== confirmDelete!.id && JSON.stringify(a.graph).includes(`"action_id":"${confirmDelete!.id}"`))
      : []
  );
</script>

<svelte:window onkeydown={onKey} />

<div
  class="automation"
  class:dropping
  bind:clientWidth={width}
  role="region"
  aria-label="Automation"
  ondragover={(e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dropping = true;
  }}
  ondragleave={(e) => {
    if (!(e.currentTarget as Node).contains(e.relatedTarget as Node | null)) dropping = false;
  }}
  ondrop={(e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dropping = false;
    const f = e.dataTransfer?.files[0];
    if (f) void readFile(f);
  }}
>
  {#if dropping}<div class="drop" aria-hidden="true"><FileUp size={28} />Drop to import actions</div>{/if}
  <header class="toolbar">
    <div class="heading">
      <h1>Automation</h1>
      {#if ed.selected}<span class="crumb truncate"><span class="faint">/</span> {ed.selected.name || 'Untitled'}</span>{/if}
      {#if ed.held}
        <span class="held" role="status"><CircleAlert size={13} />Not saved: fix {ed.blockingCount} problem{ed.blockingCount === 1 ? '' : 's'}</span>
      {:else}
        <SaveIndicator status={ed.saver.status} error={ed.saver.error} />
      {/if}
    </div>
    <div class="grow"></div>
    {#if ed.selected}
      {@const a = ed.selected}
      <IconButton label="Undo (Ctrl+Z)" disabled={!ed.canUndo(a.id)} onclick={() => ed.step(a.id, 'undo')}><Undo2 /></IconButton>
      <IconButton label="Redo (Ctrl+Shift+Z)" disabled={!ed.canRedo(a.id)} onclick={() => ed.step(a.id, 'redo')}><Redo2 /></IconButton>
      <span class="sep" aria-hidden="true"></span>
      <Button busy={flow.testing?.actionId === a.id} title="Run it now from its Button trigger, or from all its triggers, ignoring cooldown" onclick={() => test(a)}>
        <Play size={14} />Test
      </Button>
      <span class="sep" aria-hidden="true"></span>
    {/if}
    <Button onclick={chooseImport}><FileUp size={14} />Import actions…</Button>
    <input
      bind:this={fileInput}
      type="file"
      accept=".{ACTIONS_EXT},application/json"
      aria-label="Actions file to import"
      hidden
      onchange={(e) => {
        const f = e.currentTarget.files?.[0];
        e.currentTarget.value = '';
        if (f) void readFile(f);
      }}
    />
    <Menu groups={TEMPLATE_MENU} label="New action" variant="primary" size="md" align="right" onselect={create}>
      <Plus size={15} />New action
    </Menu>
  </header>

  {#if ed.actions}
    <div class="body">
      <div class="left" style="width:{listW}px">
        <ActionList onexport={exportActions} {onduplicate} ondelete={(a) => (confirmDelete = a)} />
      </div>
      <ResizeHandle bind:size={listW} id="automation.list" min={200} max={440} initial={wide ? 300 : 250} panel="before" label="Resize action list" />
      <section class="center" aria-label="Action editor">
        {#if ed.selected}
          {@const a = ed.selected}
          {#key a.id}
            <ActionHeader action={a} onduplicate={() => duplicate(a)} onexport={() => exportActions([a.id], a.name)} ondelete={() => (confirmDelete = a)} />
            <FlowView action={a} />
          {/key}
        {:else}
          <EmptyState title="No action selected" body="Actions run steps when something happens: a chat command, a raid, a timer, a button.">
            {#snippet icon()}<Zap size={28} />{/snippet}
            <Button variant="primary" onclick={() => create('blank')}><Plus size={14} />New action</Button>
          </EmptyState>
        {/if}
      </section>
      {#if !hideSide}
        <ResizeHandle bind:size={sideW} id="automation.side" min={260} max={640} initial={wide ? 400 : 330} panel="after" label="Resize run log" />
        <aside class="side" style="width:{sideW}px" aria-label="Run log and variables">
          <div class="pane-wrap" class:fill={!varsOpen && logOpen} style={logOpen && varsOpen ? `height:${logH}px` : ''}>
            <RunLog bind:open={logOpen} />
          </div>
          {#if logOpen && varsOpen}
            <ResizeHandle bind:size={logH} id="automation.runlog" min={90} max={1200} initial={wide ? 420 : 280} panel="before" orientation="horizontal" label="Resize run log and variables" />
          {:else}
            <div class="rule"></div>
          {/if}
          <div class="pane-wrap" class:fill={varsOpen}>
            <VarsInspector bind:open={varsOpen} />
          </div>
        </aside>
      {/if}
    </div>
  {/if}
</div>

<ImportActionsDialog bind:open={importOpen} pkg={importPkg} source={importSource} onimported={imported} />

<Dialog open={confirmDelete !== null} title="Delete this action?" width={420} onclose={() => (confirmDelete = null)}>
  <p class="muted">“{confirmDelete?.name}” and all its nodes will be removed.</p>
  {#if usedBy.length}
    <p class="warn">Used by {usedBy.map((a) => `“${a.name}”`).join(', ')}. Those steps will fail until you change them.</p>
  {/if}
  {#snippet footer()}
    <Button onclick={() => (confirmDelete = null)}>Cancel</Button>
    <Button
      variant="danger"
      onclick={() => {
        if (confirmDelete) remove(confirmDelete);
        confirmDelete = null;
      }}>Delete</Button
    >
  {/snippet}
</Dialog>

<style>
  .automation {
    position: relative;
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
    gap: 14px;
  }
  h1 {
    font-size: 15px;
  }
  .held {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--warn);
  }
  .crumb {
    max-width: 360px;
    font-size: 14px;
    font-weight: 550;
    color: var(--text-muted);
  }
  .sep {
    width: 1px;
    height: 22px;
    margin: 0 4px;
    background: var(--border);
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .left {
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .left > :global(*) {
    flex: 1;
  }
  .center {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .side {
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: color-mix(in srgb, var(--bg-1) 60%, transparent);
  }
  .pane-wrap {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: none;
  }
  .pane-wrap.fill {
    flex: 1;
  }
  .rule {
    height: 1px;
    flex: none;
    background: var(--border);
  }
  /* Run log and Variables fill their part of the column and scroll inside. */
  .side :global(.pane) {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .side :global(.pane > .collapse) {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .side :global(.pane > .collapse > .head) {
    height: 40px;
    flex: none;
    padding: 0 8px 0 10px;
  }
  .side :global(.pane > .collapse > .body) {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .drop {
    position: absolute;
    inset: 8px;
    z-index: 40;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border: 2px dashed var(--accent);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--bg-0) 82%, transparent);
    color: var(--accent-text);
    font-weight: 600;
    pointer-events: none;
  }
  .warn {
    margin-top: 8px;
    color: var(--warn);
  }
</style>
