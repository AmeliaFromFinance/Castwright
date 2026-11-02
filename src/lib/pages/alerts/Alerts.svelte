<script lang="ts">
  import { onDestroy } from 'svelte';
  import { api } from '$lib/api';
  import type { Variation } from '$lib/bindings/Variation';
  import { KIND_LABELS } from '$lib/format';
  import { moveItem } from '$lib/editors/list';
  import SaveIndicator from '$lib/editors/SaveIndicator.svelte';
  import { app } from '$lib/state/app.svelte';
  import { attempt } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import ResizeHandle from '$lib/ui/ResizeHandle.svelte';
  import EmptyState from '$lib/ui/EmptyState.svelte';
  import { BellRing, FlaskConical, Pause, Play, Plus, Settings2, SkipForward } from '@lucide/svelte';
  import { defaultSettings, defaultVariation, duplicateVariation, newAlertType, nextVariationName } from './alerts';
  import AlertPreview from './AlertPreview.svelte';
  import AlertQueue from './AlertQueue.svelte';
  import KindList from './KindList.svelte';
  import SettingsDialog from './SettingsDialog.svelte';
  import { alertsEditor as ed } from './store.svelte';
  import VariationCard from './VariationCard.svelte';

  let settingsOpen = $state(false);
  let leftW = $state(236);
  let rightW = $state(380);
  let confirmDelete = $state<Variation | null>(null);

  $effect(() => {
    void app.project?.alerts;
    ed.sync();
  });

  onDestroy(() => void ed.saver.flush());

  const type = $derived(ed.config?.types.find((t) => t.kind === ed.kind));
  const variation = $derived(
    type
      ? (type.variations.find((v) => v.id === ed.variationId) ??
          type.variations.find((v) => ed.expanded[v.id]) ??
          type.variations[0] ??
          null)
      : null
  );

  function addVariation() {
    if (!type) return;
    // Start from the last variation's text: usually the catch-all one.
    const last = type.variations[type.variations.length - 1];
    const v = defaultVariation({
      name: nextVariationName(type.variations.map((x) => x.name)),
      title: last?.title ?? '{{name}}',
      message: last?.message ?? ''
    });
    type.variations.unshift(v);
    ed.variationId = v.id;
    ed.expanded[v.id] = true;
    ed.changed();
  }

  function move(i: number, by: number) {
    if (!type) return;
    type.variations = moveItem(type.variations, i, by);
    ed.changed();
  }

  function duplicate(i: number) {
    if (!type) return;
    const src = type.variations[i];
    if (!src) return;
    const copy = duplicateVariation($state.snapshot(src) as Variation, type.variations.map((v) => v.name));
    type.variations.splice(i + 1, 0, copy);
    ed.variationId = copy.id;
    ed.expanded[copy.id] = true;
    ed.changed();
  }

  function remove(v: Variation) {
    if (!type) return;
    type.variations = type.variations.filter((x) => x.id !== v.id);
    if (ed.variationId === v.id) ed.variationId = null;
    ed.changed();
  }

  function addType() {
    if (!ed.config) return;
    const t = newAlertType(ed.kind);
    ed.config.types.push(t);
    ed.expanded[t.variations[0]!.id] = true;
    ed.changed();
  }
</script>

<div class="alerts">
  <header class="toolbar">
    <div class="heading">
      <h1>Alerts</h1>
      <SaveIndicator status={ed.saver.status} error={ed.saver.error} />
    </div>
    <div class="grow"></div>
    <Button
      size="sm"
      pressed={app.queue.paused}
      onclick={() => attempt(() => api.alertPause(!app.queue.paused))}
      title={app.queue.paused ? 'Start playing alerts again' : 'Hold new alerts in the queue'}
    >
      {#if app.queue.paused}<Play size={14} />Resume alerts{:else}<Pause size={14} />Pause alerts{/if}
    </Button>
    <Button size="sm" disabled={!app.queue.playing} onclick={() => attempt(() => api.alertSkip())}>
      <SkipForward size={14} />Skip current
    </Button>
    <span class="sep"></span>
    <Button size="sm" onclick={() => (settingsOpen = true)}><Settings2 size={14} />Alert settings</Button>
  </header>

  {#if ed.config}
    <div class="body" style="grid-template-columns:{leftW}px auto minmax(0, 1fr) auto {rightW}px">
      <KindList />
      <ResizeHandle bind:size={leftW} id="alerts.types" min={170} max={420} initial={236} panel="before" label="Resize alert types list" />

      <section class="center" aria-label="{KIND_LABELS[ed.kind]} variations">
        <div class="center-head">
          <div class="grow">
            <h2>{KIND_LABELS[ed.kind]}</h2>
            <p class="muted lead">Variations are checked from the top. The first one that matches plays.</p>
          </div>
          {#if type}
            <Button size="sm" onclick={() => attempt(() => api.testEvent(ed.kind))}><FlaskConical size={14} />Test</Button>
            <Button size="sm" variant="primary" onclick={addVariation}><Plus size={14} />Add variation</Button>
          {/if}
        </div>

        {#if type}
          {#if !type.enabled}
            <p class="banner">{KIND_LABELS[ed.kind]} alerts are off. Turn them on in the list to play them.</p>
          {/if}
          <div class="cards">
            {#each type.variations as v, i (v.id)}
              <VariationCard
                {v}
                kind={ed.kind}
                index={i}
                count={type.variations.length}
                onmove={(by) => move(i, by)}
                onduplicate={() => duplicate(i)}
                ondelete={() => (confirmDelete = v)}
              />
            {:else}
              <EmptyState title="No variations" body="Without a variation this alert never plays.">
                <Button size="sm" variant="primary" onclick={addVariation}><Plus size={14} />Add variation</Button>
              </EmptyState>
            {/each}
          </div>
        {:else}
          <EmptyState title="No {KIND_LABELS[ed.kind].toLowerCase()} alert yet" body="Add one to show it on stream when this happens.">
            {#snippet icon()}<BellRing size={28} />{/snippet}
            <Button variant="primary" onclick={addType}><Plus size={14} />Add {KIND_LABELS[ed.kind].toLowerCase()} alert</Button>
          </EmptyState>
        {/if}
      </section>

      <ResizeHandle bind:size={rightW} id="alerts.side" min={280} max={760} initial={380} panel="after" label="Resize preview panel" />
      <aside class="side" aria-label="Preview and queue">
        <AlertPreview kind={ed.kind} {type} {variation} settings={ed.config.settings} />
        <AlertQueue />
      </aside>
    </div>

    <SettingsDialog bind:open={settingsOpen} settings={ed.config.settings ?? defaultSettings()} onpatch={(p) => ed.patchSettings(p)} />
  {/if}
</div>

<Dialog open={confirmDelete !== null} title="Delete this variation?" width={400} onclose={() => (confirmDelete = null)}>
  <p class="muted">“{confirmDelete?.name}” will be removed. This can't be undone.</p>
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
  .alerts {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
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
  .sep {
    width: 1px;
    height: 22px;
    background: var(--border);
    margin: 0 4px;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: grid;
  }
  .center {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: 14px 18px 24px;
  }
  .center-head {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    margin-bottom: 12px;
  }
  h2 {
    font-size: 15px;
  }
  .lead {
    font-size: 12.5px;
    margin-top: 2px;
  }
  .banner {
    margin-bottom: 10px;
    padding: 8px 12px;
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--warn) 12%, transparent);
    color: var(--text);
    font-size: 12.5px;
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .side {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: color-mix(in srgb, var(--bg-1) 60%, transparent);
  }
</style>
