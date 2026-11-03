<script lang="ts">
  import { tick } from 'svelte';
  import type { Event } from '$lib/bindings/Event';
  import { copyText } from '$lib/util/os';
  import { Ban, Copy, Megaphone, Reply, ShieldOff, Timer, Trash2, UserRound } from '@lucide/svelte';
  import { mod } from './mod.svelte';
  import { TIMEOUTS } from './moderation';

  interface Props {
    message: Event | null;
    at: { x: number; y: number } | null;
    onclose: () => void;
    onreply: (m: Event) => void;
  }

  let { message, at, onclose, onreply }: Props = $props();

  let menu = $state<HTMLDivElement>();
  let pos = $state({ x: 0, y: 0 });

  const m = $derived(message);
  const user = $derived(m?.user ?? null);
  const canMod = $derived(!!m && mod.canModerate(m));
  const isBanned = $derived(!!user && !!mod.banned[user.id]);

  $effect(() => {
    if (!at) return;
    const p = at;
    void tick().then(() => {
      const w = menu?.offsetWidth ?? 220;
      const h = menu?.offsetHeight ?? 200;
      pos = { x: Math.max(8, Math.min(p.x, window.innerWidth - w - 8)), y: Math.max(8, Math.min(p.y, window.innerHeight - h - 8)) };
      items()[0]?.focus();
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

  const items = () => (menu ? [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')] : []);

  function onkeydown(e: KeyboardEvent) {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      onclose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      list[(i + 1) % list.length]?.focus();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      list[(i - 1 + list.length) % list.length]?.focus();
    }
  }

  function pick(run: () => void) {
    run();
    onclose();
  }
</script>

{#if at && m && user}
  <div
    bind:this={menu}
    class="ctx"
    role="menu"
    aria-label="Message actions for {user.display_name}"
    tabindex="-1"
    style="left:{pos.x || at.x}px;top:{pos.y || at.y}px"
    {onkeydown}
  >
    <button type="button" role="menuitem" class="mi" onclick={() => pick(() => onreply(m))}><Reply size={15} />Reply</button>
    <button type="button" role="menuitem" class="mi" onclick={() => pick(() => void copyText(m.message ?? '', 'Message copied'))}
      ><Copy size={15} />Copy message</button
    >
    <button
      type="button"
      role="menuitem"
      class="mi"
      onclick={(e) => pick(() => (mod.card = { user, x: e.clientX, y: e.clientY }))}><UserRound size={15} />Viewer card</button
    >
    {#if canMod && mod.canShoutout}
      <button type="button" role="menuitem" class="mi" onclick={() => pick(() => mod.shoutout(user))}><Megaphone size={15} />Shoutout</button>
    {/if}
    {#if canMod}
      <hr />
      {#if m.data.deleted !== true}
        <button type="button" role="menuitem" class="mi" onclick={() => pick(() => mod.remove(m))}
          ><Trash2 size={15} />Delete message<kbd>D</kbd></button
        >
      {/if}
      <div class="row" role="group" aria-label="Time out">
        <span class="lbl"><Timer size={15} />Time out</span>
        {#each TIMEOUTS as [s, label] (s)}
          <button type="button" role="menuitem" class="chip" aria-label="Time out {label}" onclick={() => pick(() => mod.timeout(user, s))}>{label}</button>
        {/each}
        <button type="button" role="menuitem" class="chip" aria-label="Custom timeout" onclick={() => pick(() => mod.ask('timeout', user))}>…</button>
      </div>
      {#if isBanned}
        <button type="button" role="menuitem" class="mi" onclick={() => pick(() => mod.unban(user))}><ShieldOff size={15} />Unban</button>
      {:else}
        <button type="button" role="menuitem" class="mi danger" onclick={() => pick(() => mod.ask('ban', user))}><Ban size={15} />Ban…<kbd>B</kbd></button>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .ctx {
    position: fixed;
    z-index: 100;
    display: flex;
    flex-direction: column;
    min-width: 230px;
    padding: 5px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-1);
    box-shadow: var(--shadow-pop);
  }
  hr {
    border: 0;
    border-top: 1px solid var(--border);
    margin: 4px 2px;
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
  .mi:focus-visible,
  .chip:hover,
  .chip:focus-visible {
    background: var(--bg-3);
    outline: none;
  }
  .mi :global(svg),
  .lbl :global(svg) {
    flex: none;
    color: var(--text-muted);
  }
  .mi.danger,
  .mi.danger :global(svg) {
    color: var(--danger);
  }
  kbd {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 3px;
    height: 30px;
    padding: 0 4px 0 9px;
    font-size: 12.5px;
  }
  .lbl {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    margin-right: auto;
    padding-right: 6px;
    white-space: nowrap;
  }
  .chip {
    border: 1px solid var(--border);
    background: var(--bg-2);
    color: var(--text);
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 600;
    padding: 2px 6px;
    cursor: pointer;
  }
</style>
