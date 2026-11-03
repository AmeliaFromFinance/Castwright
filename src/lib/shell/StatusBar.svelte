<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { updates } from '$lib/state/updates.svelte';
  import { percent } from '$lib/state/update-flow';
  import { count, duration } from '$lib/format';
  import { golive } from '$lib/state/golive.svelte';
  import { HeartPulse, ListChecks } from '@lucide/svelte';
  import { health } from '$lib/health/store.svelte';
  import { tooltip } from '$lib/health/health';
  import AdControl from './AdControl.svelte';
  import AlertControl from './AlertControl.svelte';
  import { tally } from './golive';

  const checkTone = $derived.by(() => {
    if (!golive.checks) return null;
    const t = tally(golive.checks);
    return t.fail ? 'bad' : t.warn ? 'warn' : 'ok';
  });

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
  function openSettings(section: string) {
    app.page = 'settings';
    setTimeout(() => document.getElementById(section)?.scrollIntoView({ block: 'start' }), 60);
  }

  const tone = (s: string) => (s === 'connected' ? 'ok' : s === 'connecting' ? 'warn' : s === 'error' ? 'bad' : 'off');
</script>

<footer class="status" aria-label="Status">
  <div class="left">
    <button type="button" class="item link" title="OBS settings" onclick={() => openSettings('obs')}><i class="dot {tone(obs.state)}"></i>{obsLabel}</button>
    <button type="button" class="item link" title="Twitch settings" onclick={() => openSettings('twitch')}
      ><i class="dot {tw?.broadcaster ? tone(tw.eventsub) : 'off'}"></i>{twLabel}</button
    >
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
  </div>
  {#if tw?.stream.live && (app.ads.known || app.ads.running_until > 0)}
    <AdControl />
  {/if}
  <button type="button" class="item link health {health.summary.level}" title={tooltip(health.summary)} aria-label="Health: {health.summary.text}" onclick={() => health.show()}>
    <HeartPulse size={13} />
  </button>
  <button type="button" class="item link" title="Run the go-live check" onclick={() => golive.show()}>
    {#if checkTone}<i class="dot {checkTone}"></i>{:else}<ListChecks size={12} />{/if}Go-live check
  </button>
  <AlertControl />
  {#if app.server}
    <button type="button" class="item link" title={app.server.error ?? 'Overlay server settings'} onclick={() => openSettings('server')}>
      <i class="dot {app.server.running ? 'ok' : 'bad'}"></i>Overlay server
      <span class="mono">{app.server.running ? app.server.base_url.replace(/^https?:\/\//, '') : 'stopped'}</span>
    </button>
  {/if}
  {#if updates.available}
    {@const u = updates.available}
    {@const p = updates.phase}
    <button type="button" class="item link update" onclick={() => (updates.open = true)}>
      {#if p.kind === 'downloading'}
        {@const pct = percent(p.downloaded, p.total)}
        <span class="mini" aria-hidden="true"><span style:width="{pct ?? 0}%"></span></span>Downloading {pct === null ? '' : `${pct}%`}
      {:else if p.kind === 'ready' || p.kind === 'ask'}
        Restart to update
      {:else if p.kind === 'waiting'}
        Update after stream
      {:else if p.kind === 'error'}
        Update failed
      {:else}
        Version {u.version} is out
      {/if}
    </button>
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
    white-space: nowrap;
  }
  .left {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 18px;
    overflow: hidden;
    /* Room for the hover background of the first link. */
    padding-left: 4px;
    margin-left: -4px;
  }
  .item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .link {
    font-size: inherit;
    color: inherit;
    border-radius: 4px;
    padding: 1px 4px;
    margin: 0 -4px;
  }
  .link:hover {
    background: var(--bg-2);
    color: var(--text);
  }
  .mini {
    width: 42px;
    height: 4px;
    border-radius: 999px;
    background: var(--bg-3);
    overflow: hidden;
  }
  .mini span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .update {
    color: var(--accent-text);
    font-weight: 600;
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
  .health.warn {
    color: var(--warn);
  }
  .health.bad {
    color: var(--danger);
  }
  .demo {
    color: var(--warn);
    font-weight: 600;
  }
</style>
