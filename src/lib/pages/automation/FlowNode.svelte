<script lang="ts">
  import type { Component } from 'svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import { Check, Copy, Minus, Trash2, X } from '@lucide/svelte';
  import type { NodeStatus } from './runstatus';
  import type { Issue } from './validate';

  interface Props {
    id: string;
    icon: Component<{ size?: number | string }>;
    tone: string;
    title: string;
    summary: string;
    /** Placeholder when there is no summary. */
    unset?: string;
    number?: string;
    rows?: Array<[string, string]>;
    chips?: string[];
    issues?: Issue[];
    status?: NodeStatus;
    running?: boolean;
    selected?: boolean;
    dragging?: boolean;
    draggable?: boolean;
    onselect: () => void;
    onduplicate?: () => void;
    ondelete: () => void;
    deleteLabel?: string;
    ondragstart?: (e: DragEvent) => void;
    ondragend?: () => void;
  }

  let {
    id,
    icon: Icon,
    tone,
    title,
    summary,
    unset = 'Not set up yet',
    number,
    rows = [],
    chips = [],
    issues = [],
    status,
    running = false,
    selected = false,
    dragging = false,
    draggable = false,
    onselect,
    onduplicate,
    ondelete,
    deleteLabel = 'Delete step',
    ondragstart,
    ondragend
  }: Props = $props();

  const error = $derived(issues.find((i) => !i.warn));
  const warning = $derived(issues.find((i) => i.warn));
  // Template tokens stand out in summaries.
  const parts = $derived(summary.split(/(\{\{[^}]*\}\})/g).filter(Boolean));
  const stateText = $derived(
    running ? 'Running' : status?.state === 'ok' ? 'Ran fine' : status?.state === 'failed' ? 'Failed' : status?.state === 'skipped' ? 'Skipped' : ''
  );
</script>

<div
  class="node tone-{tone}"
  class:selected
  class:invalid={!!error}
  class:failed={status?.state === 'failed'}
  class:ok={status?.state === 'ok'}
  class:skipped={status?.state === 'skipped'}
  class:running
  class:dragging
>
  <button
    type="button"
    class="card"
    data-node={id}
    aria-pressed={selected}
    aria-label="{number ? `${number}. ` : ''}{title}{summary ? `: ${summary}` : ''}{stateText ? ` (${stateText})` : ''}"
    {draggable}
    onclick={onselect}
    {ondragstart}
    {ondragend}
  >
    <span class="top">
      <span class="ic"><Icon size={14} /></span>
      <span class="title truncate">{title}</span>
      {#if number}<span class="num mono">{number}</span>{/if}
      {#if running}
        <span class="state run" aria-hidden="true"></span>
      {:else if status?.state === 'ok'}
        <span class="state good" title="Ran fine"><Check size={11} strokeWidth={3} /></span>
      {:else if status?.state === 'failed'}
        <span class="state bad" title="Failed"><X size={11} strokeWidth={3} /></span>
      {:else if status?.state === 'skipped'}
        <span class="state skip" title="Skipped"><Minus size={11} strokeWidth={3} /></span>
      {/if}
    </span>
    <span class="body">
      <span class="sum" class:unset={!summary} title={summary}>
        {#if summary}
          {#each parts as p, i (i)}{#if p.startsWith('{{')}<span class="tok">{p}</span>{:else}{p}{/if}{/each}
        {:else}
          {unset}
        {/if}
      </span>
      {#each rows as [k, v] (k)}
        <span class="kv"><span class="k">{k}</span><span class="v truncate" title={v}>{v}</span></span>
      {/each}
      {#if chips.length}
        <span class="chips">
          {#each chips as c (c)}<span class="chip mono">{c}</span>{/each}
        </span>
      {/if}
      {#if status?.state === 'failed'}
        {#each status.errors as e, i (i)}<span class="msg bad">{e}</span>{/each}
      {/if}
      {#if error}
        <span class="msg bad">{error.message}</span>
      {:else if warning}
        <span class="msg warn">{warning.message}</span>
      {/if}
    </span>
  </button>
  <div class="tools">
    {#if onduplicate}<IconButton size="sm" label="Duplicate" onclick={onduplicate}><Copy /></IconButton>{/if}
    <IconButton size="sm" label={deleteLabel} tone="danger" onclick={ondelete}><Trash2 /></IconButton>
  </div>
</div>

<style>
  .node {
    --tone: #4f8cff;
    position: relative;
    width: var(--node-w);
    max-width: 100%;
    margin: 0 auto;
  }
  .tone-trigger {
    --tone: #3fb96b;
  }
  .tone-chat {
    --tone: #4f8cff;
  }
  .tone-twitch {
    --tone: #9b6bff;
  }
  .tone-obs {
    --tone: #27b3a3;
  }
  .tone-media {
    --tone: #e3649f;
  }
  .tone-vars {
    --tone: #d99a2b;
  }
  .tone-logic {
    --tone: #ef7d45;
  }
  .tone-advanced {
    --tone: #8792a6;
  }
  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    text-align: left;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-1);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.12), 0 4px 14px rgb(0 0 0 / 0.08);
    overflow: hidden;
    cursor: pointer;
    transition:
      border-color 0.12s var(--ease),
      box-shadow 0.12s var(--ease),
      opacity 0.12s;
  }
  .card:hover {
    border-color: var(--border-strong);
  }
  .card:focus-visible {
    outline-offset: 3px;
  }
  .selected .card {
    border-color: var(--accent);
    box-shadow:
      0 0 0 1px var(--accent),
      0 6px 20px rgb(0 0 0 / 0.16);
  }
  .invalid .card {
    border-color: color-mix(in srgb, var(--danger) 60%, var(--border));
  }
  .failed .card {
    border-color: var(--danger);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--danger) 60%, transparent);
  }
  .ok .card {
    border-color: color-mix(in srgb, var(--ok) 55%, var(--border));
  }
  .skipped .card {
    opacity: 0.55;
  }
  .running .card {
    animation: pulse 1s var(--ease) infinite alternate;
  }
  .dragging .card {
    opacity: 0.4;
  }
  @keyframes pulse {
    from {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 50%, transparent);
    }
    to {
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 25%, transparent);
    }
  }
  .top {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 6px 10px 6px 8px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
    background: color-mix(in srgb, var(--tone) 8%, var(--bg-1));
  }
  .ic {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    flex: none;
    border-radius: 6px;
    background: color-mix(in srgb, var(--tone) 22%, transparent);
    color: color-mix(in srgb, var(--tone) 75%, var(--text));
  }
  .title {
    flex: 1;
    font-weight: 620;
    font-size: 12.5px;
  }
  .num {
    font-size: 11px;
    color: var(--text-faint);
  }
  .state {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    flex: none;
    border-radius: 50%;
    color: var(--bg-0);
  }
  .good {
    background: var(--ok);
  }
  .bad {
    background: var(--danger);
  }
  .skip {
    background: var(--border-strong);
  }
  .run {
    border: 2px solid var(--accent);
    border-right-color: transparent;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 8px 12px 10px;
    min-width: 0;
  }
  .sum {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
    font-size: 12.5px;
    color: var(--text);
  }
  .sum.unset {
    color: var(--text-faint);
    font-style: italic;
  }
  .tok {
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--accent-text);
  }
  .kv {
    display: flex;
    gap: 10px;
    font-size: 12px;
  }
  .k {
    flex: none;
    color: var(--text-faint);
  }
  .v {
    margin-left: auto;
    color: var(--text-muted);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding-top: 2px;
  }
  .chip {
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10.5px;
    background: var(--bg-3);
    color: var(--text-muted);
  }
  .msg {
    font-size: 11.5px;
    line-height: 1.35;
  }
  .msg.bad {
    background: none;
    color: var(--danger);
  }
  .msg.warn {
    color: var(--warn);
  }
  .tools {
    position: absolute;
    top: 5px;
    right: -38px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-1);
    box-shadow: var(--shadow-pop);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s;
  }
  .node:hover .tools,
  .node:focus-within .tools,
  .selected .tools {
    opacity: 1;
    pointer-events: auto;
  }
</style>
