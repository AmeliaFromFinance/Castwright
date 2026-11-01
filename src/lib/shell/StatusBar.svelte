<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { count, duration } from '$lib/format';

  const obs = $derived(app.obs);
  const tw = $derived(app.twitch);
  const live = $derived(obs.stream.active);

  const obsLabel = $derived(
    obs.state === 'connected'
      ? 'OBS connected'
      : obs.state === 'connecting'
        ? 'Connecting to OBS…'
        : obs.state === 'error'
          ? 'OBS problem'
          : 'OBS not connected'
  );
  const twLabel = $derived(
    !tw?.broadcaster
      ? 'Twitch not signed in'
      : tw.eventsub === 'connected'
        ? `Twitch · ${tw.broadcaster.display_name}`
        : tw.eventsub === 'connecting'
          ? 'Connecting to Twitch…'
          : 'Twitch disconnected'
  );
  const tone = (s: string) => (s === 'connected' ? 'ok' : s === 'connecting' ? 'warn' : s === 'error' ? 'bad' : 'off');
</script>

<footer class="status" aria-label="Status">
  <span class="item"><i class="dot {tone(obs.state)}"></i>{obsLabel}</span>
  <span class="item"><i class="dot {tw?.broadcaster ? tone(tw.eventsub) : 'off'}"></i>{twLabel}</span>
  {#if live}
    <span class="item"><i class="dot live"></i>Live <span class="mono">{duration(obs.stream.duration_ms)}</span></span>
  {/if}
  {#if obs.state === 'connected'}
    <span class="item">CPU <span class="mono">{obs.stats.cpu_percent.toFixed(1)}%</span></span>
    <span class="item">FPS <span class="mono">{obs.stats.active_fps.toFixed(0)}</span></span>
    {#if live}
      <span class="item">Bitrate <span class="mono">{count(obs.stats.stream_kbps)} kb/s</span></span>
      <span class="item" class:warn={obs.stats.stream_dropped_percent > 1}>Dropped <span class="mono">{obs.stats.stream_dropped_percent.toFixed(1)}%</span></span>
    {/if}
  {/if}
  <span class="grow"></span>
  {#if app.server}
    <span class="item" title={app.server.error ?? ''}>
      <i class="dot {app.server.running ? 'ok' : 'bad'}"></i>Overlay server
      <span class="mono">{app.server.running ? `127.0.0.1:${app.server.port}` : 'stopped'}</span>
    </span>
  {/if}
  {#if app.demo}<span class="item demo">Demo mode</span>{/if}
  <span class="item faint">v{app.info?.version ?? ''}</span>
</footer>

<style>
  .status {
    display: flex;
    align-items: center;
    gap: 18px;
    height: 28px;
    padding: 0 14px;
    border-top: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-1) 80%, transparent);
    font-size: 11.5px;
    color: var(--text-muted);
    overflow: hidden;
    white-space: nowrap;
  }
  .item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .item .mono {
    color: var(--text);
  }
  .warn .mono {
    color: var(--warn);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-faint);
  }
  .dot.ok {
    background: var(--ok);
  }
  .dot.warn {
    background: var(--warn);
  }
  .dot.bad {
    background: var(--danger);
  }
  .dot.live {
    background: var(--live);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--live) 30%, transparent);
  }
  .demo {
    color: var(--warn);
    font-weight: 600;
  }
</style>
