<script lang="ts" generics="T extends string">
  import type { Component } from 'svelte';
  import { onMount, tick } from 'svelte';
  import type { MenuGroup } from '$lib/editors/menu';
  import { Search } from '@lucide/svelte';

  interface Props {
    groups: MenuGroup<T>[];
    label: string;
    /** Screen rectangle of the button that opened it. */
    anchor: DOMRect;
    icons?: Partial<Record<T, Component<{ size?: number | string }>>>;
    onselect: (value: T) => void;
    onclose: () => void;
  }

  let { groups, label, anchor, icons = {}, onselect, onclose }: Props = $props();

  let query = $state('');
  let active = $state(0);
  let pop: HTMLDivElement | undefined = $state();
  let input: HTMLInputElement | undefined = $state();
  let pos = $state({ top: 0, left: 0, maxH: 420 });

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return groups
      .map((g) => ({ ...g, items: g.items.filter((it) => !q || `${it.label} ${it.hint ?? ''} ${g.label ?? ''}`.toLowerCase().includes(q)) }))
      .filter((g) => g.items.length);
  });
  const flat = $derived(shown.flatMap((g) => g.items));

  $effect(() => {
    void query;
    active = 0;
  });

  onMount(async () => {
    await tick();
    const w = pop?.offsetWidth ?? 280;
    const below = window.innerHeight - anchor.bottom - 12;
    const above = anchor.top - 12;
    const down = below >= 320 || below >= above;
    const maxH = Math.max(160, Math.min(440, down ? below : above));
    const h = Math.min(pop?.scrollHeight ?? maxH, maxH);
    const left = Math.max(8, Math.min(anchor.left + anchor.width / 2 - w / 2, window.innerWidth - w - 8));
    pos = { top: down ? anchor.bottom + 6 : anchor.top - 6 - h, left, maxH };
    input?.focus();
  });

  function pick(v: T) {
    onselect(v);
    onclose();
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
    else if (e.key === 'ArrowDown') active = (active + 1) % Math.max(1, flat.length);
    else if (e.key === 'ArrowUp') active = (active - 1 + flat.length) % Math.max(1, flat.length);
    else if (e.key === 'Enter' && flat[active]) pick(flat[active]!.value);
    else return;
    e.preventDefault();
    e.stopPropagation();
    pop?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  $effect(() => {
    const outside = (e: PointerEvent) => {
      if (!pop?.contains(e.target as Node)) onclose();
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', onclose);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', onclose);
    };
  });
</script>

<div bind:this={pop} class="picker" role="dialog" aria-label={label} tabindex="-1" style="top:{pos.top}px;left:{pos.left}px;max-height:{pos.maxH}px" onkeydown={key}>
  <div class="search">
    <Search size={13} />
    <input bind:this={input} class="input" placeholder="Search" aria-label="Search {label.toLowerCase()}" bind:value={query} />
  </div>
  <div class="list" role="listbox" aria-label={label}>
    {#each shown as g, gi (gi)}
      {#if g.label}<div class="group eyebrow" role="presentation">{g.label}</div>{/if}
      {#each g.items as it (it.value)}
        {@const i = flat.indexOf(it)}
        {@const Icon = icons[it.value]}
        <button
          type="button"
          role="option"
          class="item"
          data-i={i}
          aria-selected={i === active}
          tabindex="-1"
          onpointermove={() => (active = i)}
          onclick={() => pick(it.value)}
        >
          {#if Icon}<span class="ic"><Icon size={14} /></span>{/if}
          <span class="text">
            <span class="name">{it.label}</span>
            {#if it.hint}<span class="hint">{it.hint}</span>{/if}
          </span>
        </button>
      {/each}
    {:else}
      <p class="none faint">Nothing matches.</p>
    {/each}
  </div>
</div>

<style>
  .picker {
    position: fixed;
    z-index: 60;
    width: 290px;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-1);
    box-shadow: var(--shadow-pop);
    overflow: hidden;
  }
  .search {
    position: relative;
    display: flex;
    align-items: center;
    padding: 6px;
    border-bottom: 1px solid var(--border);
    color: var(--text-faint);
  }
  .search :global(svg) {
    position: absolute;
    left: 16px;
    pointer-events: none;
  }
  .search input {
    padding-left: 28px;
  }
  .list {
    overflow: auto;
    padding: 4px;
    min-height: 0;
  }
  .group {
    padding: 8px 8px 3px;
  }
  .item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 5px 8px;
    border-radius: var(--radius);
    text-align: left;
  }
  .item[aria-selected='true'] {
    background: var(--bg-3);
  }
  .ic {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    flex: none;
    border-radius: var(--radius);
    background: var(--bg-2);
    color: var(--text-muted);
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .name {
    font-weight: 550;
  }
  .hint {
    font-size: 11.5px;
    color: var(--text-faint);
  }
  .none {
    padding: 12px 8px;
    font-size: 12px;
  }
</style>
