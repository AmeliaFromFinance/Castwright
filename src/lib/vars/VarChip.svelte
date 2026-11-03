<script lang="ts">
  import { varText } from '$lib/pages/automation/validate';
  import { CircleAlert } from '@lucide/svelte';
  import type { VarCard, VarHover } from './hover';

  let { card, hover }: { card: VarCard; hover: VarHover } = $props();

  const id = `var-card-${Math.random().toString(36).slice(2, 9)}`;
  let open = $state(false);
</script>

<span class="wrap" role="presentation" onmouseenter={() => (open = true)} onmouseleave={() => (open = false)}>
  <button
    type="button"
    class="chip mono"
    class:problem={!!card.problem}
    aria-describedby={open ? id : undefined}
    onfocus={() => (open = true)}
    onblur={() => (open = false)}
    onclick={() => hover.open(card.key)}
  >
    {#if card.problem}<CircleAlert size={11} />{/if}{card.key}
  </button>
  {#if open}
    <span class="card" role="tooltip" {id}>
      <span class="val mono">{card.exists ? varText(card.value) || '(empty)' : 'Not set'}</span>
      <span class="faint">Used in {card.usedIn} {card.usedIn === 1 ? 'place' : 'places'}</span>
      {#if card.problem}<span class="warn">{card.problem}</span>{/if}
      <span class="faint">Click for details</span>
    </span>
  {/if}
</span>

<style>
  .wrap {
    position: relative;
    display: inline-flex;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 20px;
    padding: 0 7px;
    border: 1px dashed var(--border-strong);
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font-size: 11px;
    cursor: pointer;
  }
  .chip:hover,
  .chip:focus-visible {
    color: var(--accent-text);
    border-color: var(--accent);
  }
  .chip.problem {
    color: var(--warn);
    border-color: color-mix(in srgb, var(--warn) 60%, transparent);
  }
  .card {
    position: absolute;
    z-index: 30;
    top: calc(100% + 4px);
    left: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 180px;
    max-width: 280px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-1);
    box-shadow: var(--shadow-pop);
    font-size: 12px;
    pointer-events: none;
  }
  .val {
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .warn {
    color: var(--warn);
  }
</style>
