<script lang="ts">
  import { api } from '$lib/api';
  import { KIND_LABELS, kindTone } from '$lib/format';
  import { durationOf } from '$lib/overlay/anim';
  import { app } from '$lib/state/app.svelte';
  import { attempt } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import { SkipForward, X } from '@lucide/svelte';

  const q = $derived(app.queue);
  let startedAt = $state(Date.now());
  let now = $state(Date.now());
  let lastId: string | null = null;

  $effect(() => {
    const id = q.playing?.id ?? null;
    if (id !== lastId) {
      lastId = id;
      startedAt = Date.now();
    }
  });

  $effect(() => {
    if (!q.playing) return;
    const t = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(t);
  });

  const left = $derived(
    q.playing ? Math.max(0, q.playing.duration_ms + durationOf(q.playing.exit, 'exit') - (now - startedAt)) : 0
  );
</script>

<section class="queue" aria-label="Alert queue">
  <header>
    <h3 class="eyebrow">Queue</h3>
    {#if q.paused}<span class="paused">Paused</span>{/if}
    <div class="grow"></div>
    <Button size="sm" variant="ghost" disabled={q.waiting.length === 0} onclick={() => attempt(() => api.alertClear())}>Clear</Button>
  </header>

  <div class="now" class:idle={!q.playing}>
    {#if q.playing}
      <span class="dot" style:background={kindTone(q.playing.kind)}></span>
      <div class="grow">
        <div class="eyebrow">Now playing</div>
        <div class="title truncate">{q.playing.title || KIND_LABELS[q.playing.kind]}</div>
      </div>
      <span class="mono left" aria-label="Time left">{(left / 1000).toFixed(1)} s</span>
      <IconButton size="sm" label="Skip current alert" onclick={() => attempt(() => api.alertSkip())}><SkipForward /></IconButton>
    {:else}
      <span class="faint">{q.paused ? 'Alerts are paused. New ones wait here.' : 'Nothing playing'}</span>
    {/if}
  </div>

  <ol class="waiting" aria-label="Waiting alerts">
    {#each q.waiting as w, i (w.id)}
      <li>
        <span class="pos mono faint">{i + 1}</span>
        <span class="dot" style:background={kindTone(w.kind)}></span>
        <div class="grow">
          <div class="title truncate">{w.title || KIND_LABELS[w.kind]}</div>
          <div class="meta faint">
            {KIND_LABELS[w.kind]}{w.event.test ? ' · test' : ''}{w.priority ? ` · priority ${w.priority}` : ''}
          </div>
        </div>
        <IconButton size="sm" label="Remove from queue" tone="danger" onclick={() => attempt(() => api.alertRemove(w.id))}><X /></IconButton>
      </li>
    {:else}
      <li class="none faint">No alerts waiting</li>
    {/each}
  </ol>
</section>

<style>
  .queue {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
    border-top: 1px solid var(--border);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    flex: none;
    padding: 0 8px 0 14px;
  }
  .paused {
    font-size: 11px;
    font-weight: 650;
    color: var(--warn);
  }
  .now {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 10px 6px;
    padding: 8px 10px;
    min-height: 50px;
    border-radius: var(--radius);
    background: var(--bg-2);
    border: 1px solid var(--border);
  }
  .now.idle {
    font-size: 12px;
  }
  .left {
    font-size: 12px;
    color: var(--text-muted);
  }
  .waiting {
    list-style: none;
    margin: 0;
    padding: 0 6px 8px;
    overflow: auto;
    min-height: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 6px;
    border-radius: var(--radius);
  }
  li:hover {
    background: var(--bg-2);
  }
  .pos {
    width: 14px;
    font-size: 11px;
    text-align: right;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
  }
  .title {
    font-size: 12.5px;
    font-weight: 550;
  }
  .meta {
    font-size: 11px;
  }
  .none {
    font-size: 12px;
    padding: 6px 10px;
  }
  .none:hover {
    background: none;
  }
</style>
