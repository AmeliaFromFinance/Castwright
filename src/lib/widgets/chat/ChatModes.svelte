<script lang="ts">
  import type { ChatMode } from '$lib/bindings/ChatMode';
  import { Fingerprint, Heart, Shield, Smile, Star, Timer } from '@lucide/svelte';
  import type { Component } from 'svelte';
  import { mod } from './mod.svelte';
  import { FOLLOW_TIMES, MODE_LABELS, MODE_ORDER, SLOW_WAITS, modeDetail, shortSpan } from './moderation';

  const ICONS: Record<ChatMode, Component<{ size?: number | string }>> = {
    shield: Shield,
    slow: Timer,
    followers: Heart,
    subscribers: Star,
    emotes: Smile,
    unique: Fingerprint
  };

  let picking = $state<'slow' | 'followers' | null>(null);
  let box = $state<HTMLDivElement>();

  function click(mode: ChatMode) {
    if (mode === 'slow' || mode === 'followers') {
      picking = picking === mode ? null : mode;
      return;
    }
    void mod.setMode(mode, !(mod.modes?.[mode] ?? false));
  }

  function choose(mode: ChatMode, on: boolean, value: number | null) {
    picking = null;
    void mod.setMode(mode, on, value);
  }
</script>

<svelte:window
  onpointerdown={(e) => {
    if (picking && !box?.contains(e.target as Node)) picking = null;
  }}
  onkeydown={(e) => {
    if (picking && e.key === 'Escape') picking = null;
  }}
/>

<div class="modes" role="group" aria-label="Chat modes" bind:this={box}>
  {#each MODE_ORDER as m (m)}
    {@const Icon = ICONS[m]}
    {@const on = mod.modes?.[m] ?? false}
    {@const detail = mod.modes ? modeDetail(mod.modes, m) : ''}
    <button
      type="button"
      class="mode"
      class:on
      class:shield={m === 'shield'}
      aria-pressed={on}
      aria-label={MODE_LABELS[m]}
      aria-haspopup={m === 'slow' || m === 'followers' ? 'true' : undefined}
      aria-expanded={m === 'slow' || m === 'followers' ? picking === m : undefined}
      title="{MODE_LABELS[m]}{on ? `: on${detail ? ` (${detail})` : ''}` : ': off'}"
      onclick={() => click(m)}
    >
      <Icon size={13} />{#if detail}<span class="detail">{detail}</span>{/if}
    </button>
  {/each}
  {#if picking}
    {@const on = mod.modes?.[picking] ?? false}
    <div class="pop" role="group" aria-label="{MODE_LABELS[picking]} options">
      <span class="eyebrow">{picking === 'slow' ? 'Wait between messages' : 'Followed for at least'}</span>
      <div class="chips">
        {#if picking === 'slow'}
          {#each SLOW_WAITS as s (s)}
            <button type="button" class="chip" class:sel={on && mod.modes?.slow_wait_s === s} onclick={() => choose('slow', true, s)}>{shortSpan(s)}</button>
          {/each}
        {:else}
          {#each FOLLOW_TIMES as [mins, label] (mins)}
            <button type="button" class="chip" class:sel={on && mod.modes?.followers_minutes === mins} onclick={() => choose('followers', true, mins)}>{label}</button>
          {/each}
        {/if}
      </div>
      {#if on}
        <button type="button" class="chip off" onclick={() => choose(picking!, false, null)}>Turn off</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .modes {
    position: relative;
    display: flex;
    align-items: center;
    gap: 2px;
    margin-right: 6px;
  }
  .mode {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 24px;
    min-width: 24px;
    justify-content: center;
    padding: 0 5px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: var(--text-faint);
    cursor: pointer;
  }
  .mode:hover {
    background: var(--bg-3);
    color: var(--text);
  }
  .mode.on {
    background: var(--accent-soft);
    color: var(--accent-text);
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .mode.shield.on {
    background: color-mix(in srgb, var(--danger) 18%, transparent);
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 45%, transparent);
  }
  .detail {
    font-size: 10.5px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }
  .pop {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 6;
    width: 240px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-pop);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    border: 1px solid var(--border);
    background: var(--bg-2);
    color: var(--text);
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 600;
    padding: 3px 7px;
    cursor: pointer;
  }
  .chip:hover {
    background: var(--bg-3);
  }
  .chip.sel {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .chip.off {
    align-self: flex-start;
  }
</style>
