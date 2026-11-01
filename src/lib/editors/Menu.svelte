<script lang="ts" generics="T extends string">
  import type { Snippet } from 'svelte';
  import { tick } from 'svelte';
  import type { MenuGroup } from './menu';

  interface Props {
    groups: MenuGroup<T>[];
    label: string;
    /** Button content; defaults to the label. */
    children?: Snippet;
    variant?: 'secondary' | 'ghost' | 'primary';
    size?: 'sm' | 'md';
    align?: 'left' | 'right';
    onselect: (value: T) => void;
  }

  let { groups, label, children, variant = 'secondary', size = 'sm', align = 'left', onselect }: Props = $props();

  const id = `menu-${Math.random().toString(36).slice(2, 9)}`;
  let open = $state(false);
  let btn: HTMLButtonElement | undefined = $state();
  let pop: HTMLDivElement | undefined = $state();
  let pos = $state({ top: 0, left: 0, maxH: 400 });

  async function show() {
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    open = true;
    await tick();
    const w = pop?.offsetWidth ?? 220;
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const natural = pop?.scrollHeight ?? 300;
    const down = below >= Math.min(natural, 420) || below >= above;
    const height = Math.min(natural, 420, down ? below : above);
    const top = down ? r.bottom + 4 : r.top - 4 - height;
    let left = align === 'right' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    pos = { top, left, maxH: Math.max(120, height) };
    items()[0]?.focus();
  }

  function close(focus = true) {
    open = false;
    if (focus) btn?.focus();
  }

  function items(): HTMLButtonElement[] {
    return pop ? [...pop.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')] : [];
  }

  function onKey(e: KeyboardEvent) {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      list[(i + 1) % list.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      list[(i - 1 + list.length) % list.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      list[list.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      close(false);
    }
  }

  function pick(v: T) {
    close();
    onselect(v);
  }

  $effect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop?.contains(t) && !btn?.contains(t)) close(false);
    };
    const away = () => close(false);
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', away);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', away);
    };
  });
</script>

<button
  bind:this={btn}
  type="button"
  class="trigger {variant} {size}"
  aria-haspopup="menu"
  aria-expanded={open}
  aria-controls={open ? id : undefined}
  onclick={() => (open ? close() : show())}
  onkeydown={(e) => {
    if (e.key === 'ArrowDown' && !open) {
      e.preventDefault();
      void show();
    }
  }}
>
  {#if children}{@render children()}{:else}{label}{/if}
</button>

{#if open}
  <div
    bind:this={pop}
    {id}
    class="pop"
    role="menu"
    tabindex="-1"
    aria-label={label}
    style="top:{pos.top}px;left:{pos.left}px;max-height:{pos.maxH}px"
    onkeydown={onKey}
  >
    {#each groups as g, gi (gi)}
      {#if g.label}<div class="group eyebrow" role="presentation">{g.label}</div>{/if}
      {#each g.items as it (it.value)}
        <button type="button" role="menuitem" tabindex="-1" class="item" onclick={() => pick(it.value)}>
          <span>{it.label}</span>
          {#if it.hint}<span class="hint">{it.hint}</span>{/if}
        </button>
      {/each}
    {/each}
  </div>
{/if}

<style>
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: var(--row-h);
    padding: 0 12px;
    border-radius: var(--radius);
    border: 1px solid transparent;
    font-weight: 550;
    white-space: nowrap;
    cursor: pointer;
  }
  .trigger.sm {
    height: calc(var(--row-h) - 6px);
    padding: 0 9px;
    font-size: 12px;
    gap: 5px;
  }
  .secondary {
    background: var(--bg-2);
    border-color: var(--border);
  }
  .secondary:hover,
  .secondary[aria-expanded='true'] {
    background: var(--bg-3);
  }
  .ghost {
    background: transparent;
    color: var(--text-muted);
  }
  .ghost:hover,
  .ghost[aria-expanded='true'] {
    background: var(--bg-3);
    color: var(--text);
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
  }
  .primary:hover {
    background: var(--accent-hover);
  }
  .pop {
    position: fixed;
    z-index: 50;
    min-width: 200px;
    max-width: 320px;
    overflow: auto;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-1);
    box-shadow: var(--shadow-pop);
  }
  .group {
    padding: 8px 10px 4px;
  }
  .item {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    padding: 6px 10px;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    text-align: left;
    cursor: pointer;
  }
  .item:hover,
  .item:focus-visible {
    background: var(--bg-3);
    outline: none;
  }
  .hint {
    font-size: 11.5px;
    color: var(--text-faint);
  }
</style>
