<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { Action } from '$lib/bindings/Action';
  import { clone, newId } from '$lib/editors/ids';
  import { copyName } from '$lib/editors/list';
  import Menu from '$lib/editors/Menu.svelte';
  import SaveIndicator from '$lib/editors/SaveIndicator.svelte';
  import { app } from '$lib/state/app.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import EmptyState from '$lib/ui/EmptyState.svelte';
  import { CircleAlert, Plus, Zap } from '@lucide/svelte';
  import ActionEditor from './ActionEditor.svelte';
  import ActionList from './ActionList.svelte';
  import { TEMPLATE_MENU, fromTemplate, type TemplateId } from './defaults';
  import RunLog from './RunLog.svelte';
  import { actionsEditor as ed, runLog } from './store.svelte';
  import VarsInspector from './VarsInspector.svelte';

  let confirmDelete = $state<Action | null>(null);

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

  const usedBy = $derived(
    confirmDelete
      ? (ed.actions ?? []).filter((a) => a.id !== confirmDelete!.id && JSON.stringify(a.steps).includes(`"action_id":"${confirmDelete!.id}"`))
      : []
  );
</script>

<div class="automation">
  <header class="toolbar">
    <div class="heading">
      <h1>Automation</h1>
      {#if ed.held}
        <span class="held" role="status"><CircleAlert size={13} />Not saved: fix {ed.blockingCount} problem{ed.blockingCount === 1 ? '' : 's'}</span>
      {:else}
        <SaveIndicator status={ed.saver.status} error={ed.saver.error} />
      {/if}
    </div>
    <div class="grow"></div>
    <Menu groups={TEMPLATE_MENU} label="New action" variant="primary" size="md" align="right" onselect={create}>
      <Plus size={15} />New action
    </Menu>
  </header>

  {#if ed.actions}
    <div class="body">
      <ActionList />
      <section class="center" aria-label="Action editor">
        {#if ed.selected}
          {#key ed.selected.id}
            <ActionEditor action={ed.selected} onduplicate={() => duplicate(ed.selected!)} ondelete={() => (confirmDelete = ed.selected)} />
          {/key}
        {:else}
          <EmptyState title="No action selected" body="Actions run steps when something happens: a chat command, a raid, a timer, a button.">
            {#snippet icon()}<Zap size={28} />{/snippet}
            <Button variant="primary" onclick={() => create('blank')}><Plus size={14} />New action</Button>
          </EmptyState>
        {/if}
      </section>
      <aside class="side" aria-label="Run log and variables">
        <RunLog />
        <VarsInspector />
      </aside>
    </div>
  {/if}
</div>

<Dialog open={confirmDelete !== null} title="Delete this action?" width={420} onclose={() => (confirmDelete = null)}>
  <p class="muted">“{confirmDelete?.name}” and its triggers and steps will be removed.</p>
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
  .body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 260px minmax(0, 1fr) 360px;
  }
  .center {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: 16px 20px 28px;
  }
  .side {
    display: grid;
    grid-template-rows: minmax(0, 1fr) minmax(0, 1.15fr);
    min-height: 0;
    border-left: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-1) 60%, transparent);
  }
  .warn {
    margin-top: 8px;
    color: var(--warn);
  }
  @media (max-width: 1280px) {
    .body {
      grid-template-columns: 220px minmax(0, 1fr) 320px;
    }
  }
</style>
