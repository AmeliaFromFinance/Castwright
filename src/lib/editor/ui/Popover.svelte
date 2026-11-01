<script lang="ts">
  import { tick, type Snippet } from 'svelte';

  interface TriggerProps {
    'aria-haspopup': 'menu' | 'dialog';
    'aria-expanded': boolean;
    onclick: () => void;
  }

  interface Props {
    /** "menu" gets arrow-key navigation between items with role="menuitem". */
    role?: 'menu' | 'dialog';
    label: string;
    align?: 'start' | 'end';
    width?: number;
    trigger: Snippet<[TriggerProps]>;
    children: Snippet<[() => void]>;
  }

  let { role = 'menu', label, align = 'start', width = 220, trigger, children }: Props = $props();

  let open = $state(false);
  let root = $state<HTMLDivElement>();
  let panel = $state<HTMLDivElement>();

  function items(): HTMLElement[] {
    return panel ? [...panel.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')] : [];
  }

  async function toggle() {
    open = !open;
    if (open) {
      await tick();
      const first = role === 'menu' ? items()[0] : panel?.querySelector<HTMLElement>('button, select, input, [tabindex="0"]');
      (first ?? panel)?.focus();
    }
  }

  function close(refocus = true) {
    if (!open) return;
    open = false;
    if (refocus) root?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (role !== 'menu' || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const list = items();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
    list[next]?.focus();
  }

  $effect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) close(false);
    };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  });
</script>

<div class="pop-root" bind:this={root}>
  {@render trigger({ 'aria-haspopup': role, 'aria-expanded': open, onclick: toggle })}
  {#if open}
    <div
      bind:this={panel}
      class="pop {align}"
      {role}
      aria-label={label}
      tabindex="-1"
      style="width:{width}px"
      {onkeydown}
      onfocusout={(e) => {
        if (role === 'menu' && root && !root.contains(e.relatedTarget as Node | null) && e.relatedTarget) close(false);
      }}
    >
      {@render children(() => close())}
    </div>
  {/if}
</div>

<style>
  .pop-root {
    position: relative;
    display: inline-flex;
  }
  .pop {
    position: absolute;
    top: calc(100% + 6px);
    z-index: 50;
    display: flex;
    flex-direction: column;
    padding: 5px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-1);
    box-shadow: var(--shadow-pop);
    animation: pop-in 0.12s var(--ease);
  }
  .start {
    left: 0;
  }
  .end {
    right: 0;
  }
  .pop :global(.mi) {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    height: 30px;
    padding: 0 9px;
    border: 0;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--text);
    text-align: left;
    font-size: 12.5px;
    cursor: pointer;
  }
  .pop :global(.mi:hover:not(:disabled)),
  .pop :global(.mi:focus-visible) {
    background: var(--bg-3);
    outline: none;
  }
  .pop :global(.mi:disabled) {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .pop :global(.mi svg) {
    width: 15px;
    height: 15px;
    color: var(--text-muted);
    flex: none;
  }
  .pop :global(.mi.danger) {
    color: var(--danger);
  }
  .pop :global(.mi.danger svg) {
    color: var(--danger);
  }
  .pop :global(.menu-sep) {
    height: 1px;
    margin: 4px 2px;
    background: var(--border);
  }
  @keyframes pop-in {
    from {
      opacity: 0;
      transform: translateY(-3px);
    }
  }
</style>
