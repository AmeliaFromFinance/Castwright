<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ChevronRight } from '@lucide/svelte';

  interface Props {
    title: string;
    open?: boolean;
    /** Small text next to the title, e.g. a summary when collapsed. */
    note?: string;
    actions?: Snippet;
    children: Snippet;
  }

  let { title, open = $bindable(true), note, actions, children }: Props = $props();
  const id = `sec-${Math.random().toString(36).slice(2, 8)}`;
</script>

<section class="sec" class:open>
  <header>
    <button type="button" class="toggle" aria-expanded={open} aria-controls={id} onclick={() => (open = !open)}>
      <ChevronRight size={14} class="chev" />
      <span class="title">{title}</span>
      {#if note}<span class="note faint truncate">{note}</span>{/if}
    </button>
    {#if actions}<div class="row actions">{@render actions()}</div>{/if}
  </header>
  {#if open}
    <div class="body" {id}>
      {@render children()}
    </div>
  {/if}
</section>

<style>
  .sec {
    border-bottom: 1px solid var(--border);
  }
  header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding-right: 8px;
  }
  .toggle {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 38px;
    padding: 0 10px 0 12px;
    border: 0;
    background: none;
    cursor: pointer;
    color: var(--text);
    text-align: left;
  }
  .toggle:hover .title {
    color: var(--text);
  }
  .toggle :global(.chev) {
    color: var(--text-faint);
    transition: transform 0.15s var(--ease);
    flex: none;
  }
  .open .toggle :global(.chev) {
    transform: rotate(90deg);
  }
  .title {
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
    flex: none;
  }
  .note {
    font-size: 12px;
    margin-left: 4px;
  }
  .actions {
    gap: 2px;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 2px 14px 16px;
  }
</style>
