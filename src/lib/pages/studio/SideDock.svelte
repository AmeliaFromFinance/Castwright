<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { count } from '$lib/format';
  import EventFeed from '$lib/widgets/EventFeed.svelte';
  import ChatPanel from '$lib/widgets/ChatPanel.svelte';

  const tw = $derived(app.twitch);
  const obs = $derived(app.obs);
</script>

<aside class="dock" aria-label="Live activity">
  <div class="stats">
    <div class="stat">
      <span class="eyebrow">Viewers</span>
      <span class="value mono">{tw?.stream.live ? count(tw.stream.viewers) : '–'}</span>
    </div>
    <div class="stat">
      <span class="eyebrow">Bitrate</span>
      <span class="value mono" class:ok={obs.stream.active}>{obs.stream.active ? `${(obs.stats.stream_kbps / 1000).toFixed(1)}k` : '–'}</span>
    </div>
    <div class="stat">
      <span class="eyebrow">Dropped</span>
      <span class="value mono" class:warn={obs.stats.stream_dropped_percent > 1}>{obs.stream.active ? `${obs.stats.stream_dropped_percent.toFixed(1)}%` : '–'}</span>
    </div>
  </div>
  <div class="feed"><EventFeed limit={40} /></div>
  <div class="chat"><ChatPanel /></div>
</aside>

<style>
  .dock {
    display: grid;
    grid-template-rows: auto minmax(140px, 0.9fr) minmax(200px, 1.4fr);
    border-left: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-1) 60%, transparent);
    min-height: 0;
    min-width: 0;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    border-bottom: 1px solid var(--border);
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 14px;
  }
  .stat + .stat {
    border-left: 1px solid var(--border);
  }
  .value {
    font-size: 20px;
    font-weight: 500;
  }
  .ok {
    color: var(--ok);
  }
  .warn {
    color: var(--warn);
  }
  .feed,
  .chat {
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .feed {
    border-bottom: 1px solid var(--border);
  }
</style>
