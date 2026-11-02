<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { api } from '$lib/api';
  import type { Action } from '$lib/bindings/Action';
  import { clone, newId } from '$lib/editors/ids';
  import { copyName } from '$lib/editors/list';
  import Menu from '$lib/editors/Menu.svelte';
  import SaveIndicator from '$lib/editors/SaveIndicator.svelte';
  import { isTypingTarget } from '$lib/editor/keys';
  import { app } from '$lib/state/app.svelte';
  import { attemptOk } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import EmptyState from '$lib/ui/EmptyState.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import ResizeHandle from '$lib/ui/ResizeHandle.svelte';
  import { CircleAlert, Play, Plus, Redo2, Undo2, Zap } from '@lucide/svelte';
  import ActionHeader from './ActionHeader.svelte';
  import ActionList from './ActionList.svelte';
  import { TEMPLATE_MENU, fromTemplate, type TemplateId } from './defaults';
  import FlowView from './FlowView.svelte';
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
      ? (ed.actions ?? []).filter((a) => a.id !== confirmDelete!.id && JSON.stringify(a.graph).includes(`"action_id":"${confirmDelete!.id}"`))
      : []
  );
</script>

<svelte:window onkeydown={onKey} />

<div class="automation" bind:clientWidth={width}>
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
    <Menu groups={TEMPLATE_MENU} label="New action" variant="primary" size="md" align="right" onselect={create}>
      <Plus size={15} />New action
    </Menu>
  </header>

  {#if ed.actions}
    <div class="body">
      <div class="left" style="width:{listW}px"><ActionList /></div>
      <ResizeHandle bind:size={listW} id="automation.list" min={200} max={440} initial={wide ? 300 : 250} panel="before" label="Resize action list" />
      <section class="center" aria-label="Action editor">
        {#if ed.selected}
          {@const a = ed.selected}
          {#key a.id}
            <ActionHeader action={a} onduplicate={() => duplicate(a)} ondelete={() => (confirmDelete = a)} />
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
  .warn {
    margin-top: 8px;
    color: var(--warn);
  }
</style>
