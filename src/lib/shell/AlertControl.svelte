<script lang="ts">
  import { api } from '$lib/api';
  import { KIND_LABELS } from '$lib/format';
  import { app } from '$lib/state/app.svelte';
  import { attempt } from '$lib/state/toast.svelte';
  import Popover from '$lib/editor/ui/Popover.svelte';
  import { Bell, BellOff, ListOrdered, Pause, Play, RotateCcw, SkipForward, Volume2, VolumeX } from '@lucide/svelte';
  import { alertSummary } from './alert-control';

  const q = $derived(app.queue);
  const s = $derived(alertSummary(q));
</script>

<Popover role="dialog" label="Alert controls" align="end" above width={260}>
  {#snippet trigger(p)}
    <button type="button" class="item link alerts {s.tone}" title={s.title} aria-label="Alert controls: {s.title}" {...p}>
      {#if q.paused}<Pause size={12} strokeWidth={2.4} />{:else if q.muted}<BellOff size={12} />{:else}<Bell size={12} />{/if}
      {s.label}
      {#if q.paused && q.muted}<BellOff size={12} aria-hidden="true" />{/if}
      {#if s.count}<span class="count mono">{s.count}</span>{/if}
    </button>
  {/snippet}
  {#snippet children(close)}
    <div class="now">
      <div class="eyebrow">Now playing</div>
      <div class="truncate">
        {#if q.playing}{q.playing.title || KIND_LABELS[q.playing.kind]}{:else}<span class="faint">Nothing</span>{/if}
      </div>
      <div class="faint small">{[`${q.waiting.length} waiting`, q.paused && 'paused', q.muted && 'muted'].filter(Boolean).join(' · ')}</div>
    </div>
    <button type="button" class="mi" onclick={() => attempt(() => api.alertPause(!q.paused))}>
      {#if q.paused}<Play />Resume alerts{:else}<Pause />Pause alerts{/if}
    </button>
    <button type="button" class="mi" disabled={!q.playing} onclick={() => attempt(() => api.alertSkip())}><SkipForward />Skip current</button>
    <button type="button" class="mi" disabled={!q.last} title={q.last ? q.last.title : undefined} onclick={() => attempt(() => api.alertReplayLast())}>
      <RotateCcw />Replay last
    </button>
    <button type="button" class="mi" aria-pressed={q.muted} onclick={() => attempt(() => api.alertMute(!q.muted))}>
      {#if q.muted}<Volume2 />Unmute alert sound{:else}<VolumeX />Mute alert sound{/if}
    </button>
    <div class="menu-sep"></div>
    <button
      type="button"
      class="mi"
      onclick={() => {
        close();
        app.editingOverlay = null;
        app.page = 'alerts';
      }}><ListOrdered />Open alerts page</button
    >
  {/snippet}
</Popover>

<style>
  .alerts {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: inherit;
    color: inherit;
    border-radius: 4px;
    padding: 1px 4px;
    margin: 0 -4px;
  }
  .alerts:hover,
  .alerts[aria-expanded='true'] {
    background: var(--bg-2);
    color: var(--text);
  }
  .alerts.paused,
  .alerts.muted {
    color: var(--warn);
  }
  .alerts.paused {
    font-weight: 600;
  }
  .count {
    min-width: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--bg-3);
    color: var(--text);
    text-align: center;
    font-size: 10.5px;
    line-height: 15px;
  }
  .now {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 9px 9px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--border);
    font-size: 12.5px;
  }
  .small {
    font-size: 11.5px;
  }
</style>
