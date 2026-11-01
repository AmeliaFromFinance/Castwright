<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { api } from '$lib/api';
  import { attempt } from '$lib/state/toast.svelte';
  import { ALERT_KINDS, ago, describe, kindTone } from '$lib/format';
  import IconButton from '$lib/ui/IconButton.svelte';
  import { RotateCcw } from '@lucide/svelte';
  import { onDestroy } from 'svelte';

  let { limit = 50 }: { limit?: number } = $props();

  const items = $derived(app.feed.filter((e) => e.kind !== 'chat').slice(0, limit));
  // Re-render relative times every 15 s.
  let tick = $state(Date.now());
  const t = setInterval(() => (tick = Date.now()), 15_000);
  onDestroy(() => clearInterval(t));
</script>

<div class="head"><h3 class="eyebrow">Event feed</h3></div>
<ol class="feed" aria-label="Recent events" aria-live="polite">
  {#each items as e (e.id)}
    <li>
      <span class="dot" style:background={kindTone(e.kind)}></span>
      <div class="grow">
        <div class="text">{describe(e)}</div>
        <div class="meta faint">{ago(e.ts, tick)}{e.test ? ' · test' : ''}</div>
      </div>
      {#if ALERT_KINDS.includes(e.kind) && !e.test}
        <IconButton size="sm" label="Replay alert" onclick={() => attempt(() => api.alertReplay(e.id), 'Alert queued')}>
          <RotateCcw />
        </IconButton>
      {/if}
    </li>
  {:else}
    <li class="none muted">Follows, subs, bits, raids and redemptions show up here.</li>
  {/each}
</ol>

<style>
  .head {
    display: flex;
    align-items: center;
    height: 36px;
    padding: 0 14px;
    flex: none;
  }
  .feed {
    list-style: none;
    margin: 0;
    padding: 0 6px 6px;
    overflow: auto;
    min-height: 0;
  }
  li {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 7px 8px;
    border-radius: var(--radius);
  }
  li:hover {
    background: var(--bg-2);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-top: 5px;
    flex: none;
  }
  .text {
    font-size: 12.5px;
    overflow-wrap: anywhere;
  }
  .meta {
    font-size: 11px;
    margin-top: 1px;
  }
  .none {
    display: block;
    font-size: 12px;
    padding: 8px;
  }
</style>
