<script lang="ts">
  import type { Snippet } from 'svelte';
  import { slide } from 'svelte/transition';
  import { ChevronRight } from '@lucide/svelte';
  import { loadPref, savePref } from '$lib/state/persist';

  interface Props {
    /** Open/closed is remembered per device under this id. */
    id: string;
    title: string;
    /** Shown after the title, e.g. a count. */
    meta?: string | number;
    open?: boolean;
    /** Show the content while true without changing the remembered state, e.g. during a search. */
    forceOpen?: boolean;
    actions?: Snippet;
    children: Snippet;
    class?: string;
  }
  let { id, title, meta, open = $bindable(true), forceOpen = false, actions, children, class: klass = '' }: Props = $props();

  const shown = $derived(open || forceOpen);

  // svelte-ignore state_referenced_locally
  open = loadPref(`open.${id}`, open);

  function toggle() {
    open = !open;
    savePref(`open.${id}`, open);
  }
</script>

<section class="collapse {klass}" class:closed={!shown}>
  <div class="head">
    <button type="button" class="toggle" aria-expanded={shown} disabled={forceOpen} onclick={toggle}>
      <span class="chev"><ChevronRight size={14} /></span>
      <span class="title">{title}</span>
      {#if meta !== undefined && meta !== ''}<span class="meta">{meta}</span>{/if}
    </button>
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
  </div>
  {#if shown}
    <div class="body" transition:slide={{ duration: 140 }}>{@render children()}</div>
  {/if}
</section>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .toggle {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 4px;
    border-radius: var(--radius);
    text-align: left;
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .toggle:hover {
    color: var(--text);
  }
  .chev {
    display: grid;
    place-items: center;
    transition: transform 0.14s var(--ease, ease);
    transform: rotate(90deg);
  }
  .closed .chev {
    transform: rotate(0deg);
  }
  .title {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .meta {
    font-weight: 600;
    letter-spacing: 0;
    color: var(--text-faint);
  }
  .actions {
    display: flex;
    gap: 4px;
  }
</style>
