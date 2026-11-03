<script lang="ts" module>
  import type { Component } from 'svelte';

  type Icon = Component<{ size?: number | string }>;

  export interface ContextItem {
    label: string;
    icon?: Icon;
    danger?: boolean;
    disabled?: boolean;
    /** Shortcut shown on the right. */
    keys?: string;
    /** Makes it a choice of several; true shows a check. */
    checked?: boolean;
    /** Small title above the item, e.g. for a set of choices. */
    heading?: string;
    /** Line above the item. */
    separator?: boolean;
    onselect: () => void;
  }

  export interface SearchOption {
    id: string;
    label: string;
    hint?: string;
    icon?: Icon;
    keys?: string;
    onselect: () => void;
  }

  export interface SearchGroup {
    label?: string;
    options: SearchOption[];
  }

  export interface MenuSearch {
    /** Line above the search box. */
    title?: string;
    placeholder?: string;
    results: (query: string) => SearchGroup[];
  }

  export type CloseReason = 'pick' | 'escape' | 'outside' | 'scroll' | 'blur';
</script>

<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { Search } from '@lucide/svelte';

  interface Props {
    /** Where the menu opens, in window pixels. Null = closed. */
    at: { x: number; y: number } | null;
    /** Or open next to this rectangle (above or below), e.g. a button. */
    anchor?: DOMRect | null;
    label: string;
    items?: ContextItem[];
    /** Search mode: a search box over a list of options. */
    search?: MenuSearch | null;
    onclose: (reason: CloseReason) => void;
    /** Gets focus back after closing, unless something else took it. */
    restore?: HTMLElement | null;
  }

  let { at, anchor = null, label, items = [], search = null, onclose, restore = null }: Props = $props();

  const uid = `cm-${Math.random().toString(36).slice(2, 8)}`;
  const open = $derived(!!at || !!anchor);

  let menu = $state<HTMLDivElement>();
  let input = $state<HTMLInputElement>();
  let pos = $state<{ x: number; top?: number; bottom?: number; maxH: number } | null>(null);
  let query = $state('');
  let active = $state(0);

  const groups = $derived(search && open ? search.results(query) : []);
  const flat = $derived(groups.flatMap((g) => g.options));
  const activeId = $derived(flat[active] ? `${uid}-o${active}` : undefined);

  function close(reason: CloseReason) {
    const el = document.activeElement;
    const had = !el || el === document.body || !!menu?.contains(el);
    onclose(reason);
    if (restore && had && reason !== 'outside') restore.focus({ preventScroll: true });
  }

  function choose(fn: () => void) {
    // Close first: a failing action must not leave the menu open.
    close('pick');
    fn();
  }

  function place() {
    if (!menu) return;
    const w = menu.offsetWidth;
    const h = menu.scrollHeight;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const cap = search ? 440 : H - 16;
    if (anchor) {
      const below = H - anchor.bottom - 12;
      const above = anchor.top - 12;
      const down = below >= Math.min(h, 320) || below >= above;
      const x = Math.max(8, Math.min(anchor.left + anchor.width / 2 - w / 2, W - w - 8));
      const maxH = Math.max(160, Math.min(cap, down ? below : above));
      pos = down ? { x, top: anchor.bottom + 6, maxH } : { x, bottom: H - anchor.top + 6, maxH };
    } else if (at) {
      const below = H - at.y - 8;
      const above = at.y - 8;
      const up = below < Math.min(h, 320) && above > below;
      const x = Math.max(8, Math.min(at.x, W - w - 8));
      const maxH = Math.max(120, Math.min(cap, up ? above : below));
      pos = up ? { x, bottom: H - at.y, maxH } : { x, top: at.y, maxH };
    }
  }

  $effect(() => {
    if (!open) return;
    void at;
    void anchor;
    untrack(() => {
      query = '';
      active = 0;
      pos = null;
    });
    void (async () => {
      await tick();
      place();
      // Hidden until placed, and hidden things can't take focus.
      await tick();
      if (search) input?.focus({ preventScroll: true });
      else enabled()[0]?.focus({ preventScroll: true });
    })();
    const outside = (e: Event) => menu && !menu.contains(e.target as Node);
    const down = (e: PointerEvent) => {
      if (outside(e)) close('outside');
    };
    // Scrolling or zooming anywhere else moves things under the menu.
    const scroll = (e: Event) => {
      if (outside(e)) close('scroll');
    };
    const blur = () => close('blur');
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('wheel', scroll, { capture: true, passive: true });
    window.addEventListener('blur', blur);
    window.addEventListener('resize', blur);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('wheel', scroll, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('resize', blur);
    };
  });

  const enabled = () => (menu ? [...menu.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')] : []);

  function menuKey(e: KeyboardEvent) {
    const list = enabled();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape' || e.key === 'Tab') close('escape');
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
    else if (e.key === 'Home') list[0]?.focus();
    else if (e.key === 'End') list[list.length - 1]?.focus();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  function moveTo(i: number) {
    active = i;
    void tick().then(() => document.getElementById(`${uid}-o${i}`)?.scrollIntoView({ block: 'nearest' }));
  }

  function searchKey(e: KeyboardEvent) {
    const n = flat.length;
    if (e.key === 'Escape' || e.key === 'Tab') close('escape');
    else if (e.key === 'ArrowDown' && n) moveTo((active + 1) % n);
    else if (e.key === 'ArrowUp' && n) moveTo((active - 1 + n) % n);
    else if ((e.key === 'PageDown' || e.key === 'PageUp') && n) moveTo(e.key === 'PageDown' ? n - 1 : 0);
    else if (e.key === 'Enter' && flat[active]) choose(flat[active]!.onselect);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  const style = $derived(
    pos
      ? `left:${pos.x}px;${pos.top !== undefined ? `top:${pos.top}px` : `bottom:${pos.bottom}px`};max-height:${pos.maxH}px`
      : `left:${at?.x ?? anchor?.left ?? 0}px;top:${at?.y ?? anchor?.top ?? 0}px;visibility:hidden`
  );
</script>

{#if open}
  {#if search}
    <div bind:this={menu} class="ctx find" role="dialog" aria-label={label} tabindex="-1" {style} oncontextmenu={(e) => e.preventDefault()}>
      {#if search.title}<div class="title truncate">{search.title}</div>{/if}
      <div class="box">
        <Search size={13} />
        <input
          bind:this={input}
          class="input"
          role="combobox"
          aria-expanded="true"
          aria-controls="{uid}-list"
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-label="Search {label.toLowerCase()}"
          placeholder={search.placeholder ?? 'Search'}
          autocomplete="off"
          spellcheck="false"
          bind:value={query}
          oninput={() => (active = 0)}
          onkeydown={searchKey}
        />
      </div>
      <div class="list" id="{uid}-list" role="listbox" aria-label={label}>
        {#each groups as g, gi (gi)}
          <div role="group" aria-labelledby={g.label ? `${uid}-g${gi}` : undefined}>
            {#if g.label}<div class="group eyebrow" id="{uid}-g{gi}">{g.label}</div>{/if}
            {#each g.options as o (o.id)}
              {@const i = flat.indexOf(o)}
              {@const Icon = o.icon}
              <button
                type="button"
                role="option"
                class="opt"
                id="{uid}-o{i}"
                aria-selected={i === active}
                tabindex="-1"
                onpointermove={() => (active = i)}
                onclick={() => choose(o.onselect)}
              >
                {#if Icon}<span class="ic"><Icon size={14} /></span>{/if}
                <span class="text">
                  <span class="name">{o.label}</span>
                  {#if o.hint}<span class="hint">{o.hint}</span>{/if}
                </span>
                {#if o.keys}<kbd>{o.keys}</kbd>{/if}
              </button>
            {/each}
          </div>
        {:else}
          <p class="none faint">Nothing matches.</p>
        {/each}
      </div>
    </div>
  {:else}
    <div bind:this={menu} class="ctx" role="menu" aria-label={label} tabindex="-1" {style} onkeydown={menuKey} oncontextmenu={(e) => e.preventDefault()}>
      {#each items as it (it.label)}
        {@const Icon = it.icon}
        {#if it.separator}<div class="sep" role="separator"></div>{/if}
        {#if it.heading}<div class="group eyebrow" role="presentation">{it.heading}</div>{/if}
        <button
          type="button"
          role={it.checked === undefined ? 'menuitem' : 'menuitemradio'}
          aria-checked={it.checked}
          class="mi"
          class:danger={it.danger}
          disabled={it.disabled}
          onclick={() => choose(it.onselect)}
        >
          {#if it.checked !== undefined}
            <span class="dot" class:on={it.checked} aria-hidden="true"></span>
          {:else if Icon}<Icon size={15} />{/if}
          <span class="grow">{it.label}</span>
          {#if it.keys}<kbd>{it.keys}</kbd>{/if}
        </button>
      {/each}
    </div>
  {/if}
{/if}

<style>
  .ctx {
    position: fixed;
    z-index: 100;
    display: flex;
    flex-direction: column;
    min-width: 200px;
    padding: 5px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-1);
    box-shadow: var(--shadow-pop);
    overflow: auto;
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
  .mi:hover:not(:disabled),
  .mi:focus-visible {
    background: var(--bg-3);
    outline: none;
  }
  .mi:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .mi :global(svg) {
    flex: none;
    color: var(--text-muted);
  }
  .mi.danger,
  .mi.danger :global(svg) {
    color: var(--danger);
  }
  .grow {
    flex: 1;
  }
  kbd {
    margin-left: 14px;
    font-size: 11px;
    color: var(--text-faint);
  }
  .sep {
    height: 1px;
    margin: 4px 2px;
    background: var(--border);
  }
  .dot {
    width: 15px;
    height: 15px;
    flex: none;
    display: grid;
    place-items: center;
  }
  .dot::after {
    content: '';
    width: 7px;
    height: 7px;
    border-radius: 50%;
    border: 1.5px solid var(--text-faint);
  }
  .dot.on::after {
    border-color: var(--accent);
    background: var(--accent);
  }

  /* Search mode */
  .find {
    width: 300px;
    padding: 0;
    overflow: hidden;
  }
  .title {
    padding: 8px 12px 0;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--text-muted);
  }
  .box {
    position: relative;
    display: flex;
    align-items: center;
    padding: 6px;
    border-bottom: 1px solid var(--border);
    color: var(--text-faint);
  }
  .box :global(svg) {
    position: absolute;
    left: 16px;
    pointer-events: none;
  }
  .box input {
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
  .opt {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 5px 8px;
    border-radius: var(--radius);
    text-align: left;
  }
  .opt[aria-selected='true'] {
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
    flex: 1;
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
