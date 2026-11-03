<script lang="ts" module>
  import type { Component } from 'svelte';

  export interface ContextItem {
    label: string;
    icon?: Component<{ size?: number | string }>;
    danger?: boolean;
    onselect: () => void;
  }
</script>

<script lang="ts">
  import { tick } from 'svelte';

  interface Props {
    /** Where the menu opens, in window pixels. Null = closed. */
    at: { x: number; y: number } | null;
    label: string;
    items: ContextItem[];
    onclose: () => void;
  }

  let { at, label, items, onclose }: Props = $props();

  let menu = $state<HTMLDivElement>();
  let pos = $state({ x: 0, y: 0 });

  $effect(() => {
    if (!at) return;
    const p = at;
    void tick().then(() => {
      const w = menu?.offsetWidth ?? 200;
      const h = menu?.offsetHeight ?? 100;
      pos = { x: Math.min(p.x, window.innerWidth - w - 8), y: Math.min(p.y, window.innerHeight - h - 8) };
      buttons()[0]?.focus();
    });
    const away = (e: PointerEvent) => {
      if (menu && !menu.contains(e.target as Node)) onclose();
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('blur', onclose);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('blur', onclose);
    };
  });

  const buttons = () => (menu ? [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')] : []);

  function onkeydown(e: KeyboardEvent) {
    const list = buttons();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      onclose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
    }
  }
</script>

{#if at}
  <div bind:this={menu} class="ctx" role="menu" aria-label={label} tabindex="-1" style="left:{pos.x || at.x}px;top:{pos.y || at.y}px" {onkeydown}>
    {#each items as it (it.label)}
      {@const Icon = it.icon}
      <button
        type="button"
        role="menuitem"
        class="mi"
        class:danger={it.danger}
        onclick={() => {
          onclose();
          it.onselect();
        }}
      >
        {#if Icon}<Icon size={15} />{/if}{it.label}
      </button>
    {/each}
  </div>
{/if}

<style>
  .ctx {
    position: fixed;
    z-index: 100;
    display: flex;
    flex-direction: column;
    min-width: 190px;
    padding: 5px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-1);
    box-shadow: var(--shadow-pop);
  }
  .mi {
    display: flex;
    align-items: center;
    gap: 9px;
    height: 30px;
    padding: 0 9px;
    border: 0;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--text);
    text-align: left;
    font-size: 12.5px;
    white-space: nowrap;
    cursor: pointer;
  }
  .mi:hover,
  .mi:focus-visible {
    background: var(--bg-3);
    outline: none;
  }
  .mi :global(svg) {
    flex: none;
    color: var(--text-muted);
  }
  .mi.danger,
  .mi.danger :global(svg) {
    color: var(--danger);
  }
</style>
