<script lang="ts">
  import { tick } from 'svelte';
  import { app } from '$lib/state/app.svelte';
  import { updates } from '$lib/state/updates.svelte';
  import { percent } from '$lib/state/update-flow';
  import { count, duration } from '$lib/format';
  import { golive } from '$lib/state/golive.svelte';
  import { Ellipsis, HeartPulse, ListChecks } from '@lucide/svelte';
  import { health } from '$lib/health/store.svelte';
  import { tooltip } from '$lib/health/health';
  import { adPhase } from '$lib/overlay/ads';
  import { clock, useClock } from '$lib/overlay/clock.svelte';
  import Popover from '$lib/editor/ui/Popover.svelte';
  import AdControl from './AdControl.svelte';
  import AlertControl from './AlertControl.svelte';
  import { tally } from './golive';
  import { fit, PRIORITY, shortBitrate, type Fit, type Group, type StatusItem } from './statusbar';
  import { statusPrefs } from './statusbar-prefs.svelte';

  $effect(() => useClock());

  const checkTone = $derived.by(() => {
    if (!golive.checks) return null;
    const t = tally(golive.checks);
    return t.fail ? 'bad' : t.warn ? 'warn' : 'ok';
  });

  const obs = $derived(app.obs);
  const tw = $derived(app.twitch);
  const live = $derived(obs.stream.active);
  const connected = $derived(obs.state === 'connected');

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

  const showAds = $derived(!!tw?.stream.live && (app.ads.known || app.ads.running_until > 0));
  const ad = $derived(adPhase(app.ads, clock.now));
  const adUrgent = $derived(ad?.phase === 'running' || (ad?.phase === 'soon' && ad.seconds < 60));

  const kbps = $derived(`Bitrate ${count(obs.stats.stream_kbps)} kb/s`);
  const dropped = $derived(obs.stats.stream_dropped_percent);
  const server = $derived(app.server);
  const serverAddr = $derived(server ? (server.running ? server.base_url.replace(/^https?:\/\//, '') : 'stopped') : '');

  const phase = $derived(updates.phase);
  const pct = $derived(phase.kind === 'downloading' ? percent(phase.downloaded, phase.total) : null);
  const updateText = $derived.by(() => {
    const p = phase.kind;
    if (p === 'downloading') return `Downloading update${pct === null ? '' : `, ${pct}%`}`;
    if (p === 'ready' || p === 'ask') return 'Restart to update';
    if (p === 'waiting') return 'Update after stream';
    if (p === 'error') return 'Update failed';
    return `Version ${updates.available?.version ?? ''} is out`;
  });
  const updateShort = $derived.by(() => {
    const p = phase.kind;
    if (p === 'ready' || p === 'ask') return 'Restart';
    if (p === 'waiting') return 'After stream';
    if (p === 'error') return 'Failed';
    return 'Update';
  });

  function openSettings(section: string) {
    app.page = 'settings';
    setTimeout(() => document.getElementById(section)?.scrollIntoView({ block: 'start' }), 60);
  }

  const tone = (s: string) => (s === 'connected' ? 'ok' : s === 'connecting' ? 'warn' : s === 'error' ? 'bad' : 'off');

  // To add an item: write a snippet (and a shorter one if it has one) and push it here.
  const items = $derived.by(() => {
    const list: StatusItem[] = [
      { id: 'obs', group: 'stream', priority: PRIORITY.critical, critical: true, full: obsFull, compact: obsCompact },
      { id: 'twitch', group: 'stream', priority: PRIORITY.critical, critical: true, full: twitchFull, compact: twitchCompact }
    ];
    if (live) list.push({ id: 'live', group: 'stream', priority: PRIORITY.critical, critical: true, full: liveItem });
    if (obs.record.active) list.push({ id: 'rec', group: 'stream', priority: PRIORITY.critical, critical: true, full: recItem });
    if (connected) {
      if (statusPrefs.shows('cpu')) list.push({ id: 'cpu', group: 'stream', priority: PRIORITY.cpu, full: cpuFull, compact: cpuCompact });
      if (statusPrefs.shows('fps')) list.push({ id: 'fps', group: 'stream', priority: PRIORITY.fps, full: fpsItem });
      if (live && statusPrefs.shows('bitrate')) list.push({ id: 'bitrate', group: 'stream', priority: PRIORITY.bitrate, full: bitrateFull, compact: bitrateCompact });
      if (live && statusPrefs.shows('dropped')) {
        // Worth keeping in view once frames drop.
        list.push({ id: 'dropped', group: 'stream', priority: dropped > 1 ? PRIORITY.health : PRIORITY.dropped, full: droppedFull, compact: droppedCompact });
      }
    }
    if (showAds) list.push({ id: 'ads', group: 'app', priority: PRIORITY.ads, critical: adUrgent, full: adsItem });
    list.push({ id: 'health', group: 'app', priority: PRIORITY.health, critical: health.summary.level !== 'ok', full: healthItem });
    list.push({ id: 'golive', group: 'app', priority: PRIORITY.golive, critical: checkTone === 'bad' || checkTone === 'warn', full: goliveFull, compact: goliveCompact });
    list.push({ id: 'alerts', group: 'app', priority: PRIORITY.alerts, critical: app.queue.paused || app.queue.muted, full: alertsItem });
    if (server && statusPrefs.shows('server')) {
      list.push({ id: 'server', group: 'app', priority: PRIORITY.server, critical: !server.running, full: serverFull, compact: serverCompact });
    }
    if (updates.available) {
      list.push({ id: 'update', group: 'app', priority: PRIORITY.update, critical: phase.kind === 'ready' || phase.kind === 'ask', full: updateFull, compact: updateCompact });
    }
    if (app.demo) list.push({ id: 'demo', group: 'app', priority: PRIORITY.demo, full: demoFull, compact: demoCompact });
    if (statusPrefs.shows('version')) list.push({ id: 'version', group: 'app', priority: PRIORITY.version, full: versionItem });
    return list;
  });

  // Widths come from a hidden copy of every item, so they're read only when content changes.
  let widths = $state<Record<string, number>>({});
  let available = $state(0);
  let last: Fit | null = null;

  const layout = $derived.by((): Fit => {
    if (!available) return { modes: {}, hidden: [], level: 0, key: '' };
    const f = fit(
      items.map((it) => ({
        id: it.id,
        priority: it.priority,
        critical: it.critical,
        full: widths[`${it.id}:full`] ?? 0,
        compact: it.compact ? widths[`${it.id}:compact`] : undefined
      })),
      { available, more: widths.more ?? 0, extra: widths.sep ?? 0 },
      last
    );
    last = f;
    return f;
  });
  const hiddenItems = $derived(items.filter((it) => layout.modes[it.id] === 'hidden'));
  const shown = (g: Group) => items.filter((it) => it.group === g && layout.modes[it.id] !== 'hidden');
  const form = (it: StatusItem) => (layout.modes[it.id] === 'compact' && it.compact ? it.compact : it.full);

  const size = (e: ResizeObserverEntry) => Math.ceil(e.borderBoxSize?.[0]?.inlineSize ?? e.contentRect.width);

  let pending: Record<string, number> | null = null;
  const sizes = new ResizeObserver((entries) => {
    pending ??= {};
    for (const e of entries) {
      const key = (e.target as HTMLElement).dataset.key;
      if (key) pending[key] = size(e);
    }
    const changed = Object.entries(pending).some(([k, v]) => widths[k] !== v);
    if (changed) widths = { ...widths, ...pending };
    pending = null;
  });

  function measure(node: HTMLElement) {
    sizes.observe(node);
    return () => sizes.unobserve(node);
  }

  function observeBar(node: HTMLElement) {
    const ro = new ResizeObserver(([e]) => {
      if (e) available = Math.floor(e.contentBoxSize?.[0]?.inlineSize ?? e.contentRect.width);
    });
    ro.observe(node);
    return () => ro.disconnect();
  }

  // Arrow keys move between items; Tab enters and leaves the bar in one step.
  let bar = $state<HTMLDivElement>();
  let current: HTMLElement | null = null;

  function stops(): HTMLElement[] {
    if (!bar) return [];
    return [...bar.querySelectorAll<HTMLElement>('[data-sb-item], [data-sb-more]')].map((s) => s.querySelector<HTMLElement>('button')).filter((b) => !!b);
  }

  function syncTabs() {
    const list = stops();
    if (!current || !list.includes(current)) current = list[0] ?? null;
    for (const b of list) b.tabIndex = b === current ? 0 : -1;
  }

  $effect(() => {
    void layout;
    void tick().then(syncTabs);
  });

  function onkeydown(e: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const list = stops();
    const i = list.indexOf(e.target as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    const n = list.length;
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
    current = list[next] ?? null;
    syncTabs();
    current?.focus();
  }

  function onfocusin(e: FocusEvent) {
    const t = e.target as HTMLElement;
    if (stops().includes(t)) {
      current = t;
      syncTabs();
    }
  }

  /** Clicking an item in the More list does its thing and closes the list. */
  function closeOnAction(close: () => void) {
    return (node: HTMLElement) => {
      const onclick = (e: MouseEvent) => {
        const b = (e.target as HTMLElement).closest('button');
        if (b && !b.hasAttribute('aria-haspopup') && !b.closest('.pop .pop')) close();
      };
      node.addEventListener('click', onclick);
      return () => node.removeEventListener('click', onclick);
    };
  }
</script>

{#snippet obsFull()}
  <button type="button" class="item link" title="OBS settings" onclick={() => openSettings('obs')}><i class="dot {tone(obs.state)}"></i>{obsLabel}</button>
{/snippet}
{#snippet obsCompact()}
  <button type="button" class="item link" title="{obsLabel}. OBS settings" aria-label={obsLabel} onclick={() => openSettings('obs')}
    ><i class="dot {tone(obs.state)}"></i>OBS</button
  >
{/snippet}

{#snippet twitchFull()}
  <button type="button" class="item link" title="Twitch settings" onclick={() => openSettings('twitch')}
    ><i class="dot {tw?.broadcaster ? tone(tw.eventsub) : 'off'}"></i>{twLabel}</button
  >
{/snippet}
{#snippet twitchCompact()}
  <button type="button" class="item link" title="{twLabel}. Twitch settings" aria-label={twLabel} onclick={() => openSettings('twitch')}
    ><i class="dot {tw?.broadcaster ? tone(tw.eventsub) : 'off'}"></i>Twitch</button
  >
{/snippet}

{#snippet liveItem()}
  <span class="item strong"><i class="dot live"></i>Live <span class="mono">{duration(obs.stream.duration_ms)}</span></span>
{/snippet}
{#snippet recItem()}
  {#if live}
    <span class="item" title="Recording {duration(obs.record.duration_ms)}"><i class="dot rec"></i>Rec</span>
  {:else}
    <span class="item strong"><i class="dot rec"></i>Rec <span class="mono">{duration(obs.record.duration_ms)}</span></span>
  {/if}
{/snippet}

{#snippet short(full: string, text: string, value: string, warn = false)}
  <span class="item" class:warn title={full}
    ><span class="row" aria-hidden="true">{text}<span class="mono">{value}</span></span><span class="sr-only">{full}</span></span
  >
{/snippet}

{#snippet cpuFull()}
  <span class="item">CPU <span class="mono">{obs.stats.cpu_percent.toFixed(1)}%</span></span>
{/snippet}
{#snippet cpuCompact()}
  {@render short(`CPU ${obs.stats.cpu_percent.toFixed(1)}%`, 'CPU', `${Math.round(obs.stats.cpu_percent)}%`)}
{/snippet}

{#snippet fpsItem()}
  <span class="item">FPS <span class="mono">{obs.stats.active_fps.toFixed(0)}</span></span>
{/snippet}

{#snippet bitrateFull()}
  <span class="item">Bitrate <span class="mono">{count(obs.stats.stream_kbps)} kb/s</span></span>
{/snippet}
{#snippet bitrateCompact()}
  {@render short(kbps, '', shortBitrate(obs.stats.stream_kbps))}
{/snippet}

{#snippet droppedFull()}
  <span class="item" class:warn={dropped > 1}>Dropped <span class="mono">{dropped.toFixed(1)}%</span></span>
{/snippet}
{#snippet droppedCompact()}
  {@render short(`Dropped ${dropped.toFixed(1)}%`, 'Drop', `${dropped.toFixed(1)}%`, dropped > 1)}
{/snippet}

{#snippet adsItem()}
  <AdControl />
{/snippet}

{#snippet healthItem()}
  <button type="button" class="item link health {health.summary.level}" title={tooltip(health.summary)} aria-label="Health: {health.summary.text}" onclick={() => health.show()}>
    <HeartPulse size={13} />
  </button>
{/snippet}

{#snippet goliveIcon()}
  {#if checkTone}<i class="dot {checkTone}"></i>{:else}<ListChecks size={12} />{/if}
{/snippet}
{#snippet goliveFull()}
  <button type="button" class="item link" title="Run the go-live check" onclick={() => golive.show()}>{@render goliveIcon()}Go-live check</button>
{/snippet}
{#snippet goliveCompact()}
  <button type="button" class="item link" title="Run the go-live check" aria-label="Go-live check" onclick={() => golive.show()}>{@render goliveIcon()}Check</button>
{/snippet}

{#snippet alertsItem()}
  <AlertControl />
{/snippet}

{#snippet serverFull()}
  <button type="button" class="item link" title={server?.error ?? 'Overlay server settings'} onclick={() => openSettings('server')}>
    <i class="dot {server?.running ? 'ok' : 'bad'}"></i>Overlay server
    <span class="mono">{serverAddr}</span>
  </button>
{/snippet}
{#snippet serverCompact()}
  <button
    type="button"
    class="item link"
    title={server?.error ?? `Overlay server ${serverAddr}`}
    aria-label="Overlay server {serverAddr}"
    onclick={() => openSettings('server')}><i class="dot {server?.running ? 'ok' : 'bad'}"></i>Server</button
  >
{/snippet}

{#snippet progress()}
  <span class="mini" aria-hidden="true"><span style:width="{pct ?? 0}%"></span></span><span class="mono" aria-hidden="true">{pct ?? 0}%</span>
{/snippet}
{#snippet updateFull()}
  <button
    type="button"
    class="item link update"
    title={updateText}
    aria-label={phase.kind === 'downloading' ? updateText : undefined}
    onclick={() => (updates.open = true)}
  >
    {#if phase.kind === 'downloading'}{@render progress()}{:else}{updateText}{/if}
  </button>
{/snippet}
{#snippet updateCompact()}
  <button type="button" class="item link update" title={updateText} aria-label={updateText} onclick={() => (updates.open = true)}>
    {#if phase.kind === 'downloading'}{@render progress()}{:else}{updateShort}{/if}
  </button>
{/snippet}

{#snippet demoFull()}
  <span class="item demo">Demo mode</span>
{/snippet}
{#snippet demoCompact()}
  <span class="item demo" title="Demo mode"><span aria-hidden="true">Demo</span><span class="sr-only">Demo mode</span></span>
{/snippet}

{#snippet versionItem()}
  <span class="item faint" title="Castwright version">v{app.info?.version ?? ''}</span>
{/snippet}

{#snippet moreLabel(n: number)}
  <Ellipsis size={13} aria-hidden="true" />{n} more
{/snippet}

<footer class="status" aria-label="Status">
  <div class="bar" role="toolbar" tabindex="-1" aria-label="Status items" bind:this={bar} {@attach observeBar} {onkeydown} {onfocusin}>
    {#each ['stream', 'app'] as const as g (g)}
      {#if g === 'app'}<span class="sep" aria-hidden="true"></span>{/if}
      <div class="group" role="group" aria-label={g === 'stream' ? 'Stream' : 'App'}>
        {#each shown(g) as it (it.id)}
          <div class="slot" data-sb-item={it.id}>{@render form(it)()}</div>
        {/each}
        {#if g === 'app' && hiddenItems.length}
          <div class="slot" data-sb-more>
            <Popover role="dialog" label="More status items" align="end" above width={230}>
              {#snippet trigger(p)}
                <button type="button" class="item link more" title="Show {hiddenItems.length} more" {...p}>{@render moreLabel(hiddenItems.length)}</button>
              {/snippet}
              {#snippet children(close)}
                <ul class="more-list" {@attach closeOnAction(close)}>
                  {#each hiddenItems as it (it.id)}
                    <li data-sb-hidden={it.id}>{@render it.full()}</li>
                  {/each}
                </ul>
              {/snippet}
            </Popover>
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <div class="measure" aria-hidden="true" inert>
    <div class="measure-col">
      {#each items as it (it.id)}
        <span class="m" data-key="{it.id}:full" {@attach measure}>{@render it.full()}</span>
        {#if it.compact}<span class="m" data-key="{it.id}:compact" {@attach measure}>{@render it.compact()}</span>{/if}
      {/each}
      <span class="m" data-key="more" {@attach measure}><span class="item link more">{@render moreLabel(88)}</span></span>
      <span class="m" data-key="sep" {@attach measure}><span class="sep"></span></span>
    </div>
  </div>
</footer>

<style>
  .status {
    --sb-gap: 16px;
    position: relative;
    display: flex;
    align-items: center;
    height: 28px;
    padding: 0 10px;
    border-top: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-1) 80%, transparent);
    font-size: 11.5px;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .bar {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--sb-gap);
    /* Room for the hover background of the first and last links. */
    padding: 0 4px;
    outline: none;
  }
  .group {
    display: flex;
    align-items: center;
    gap: var(--sb-gap);
    min-width: 0;
  }
  .slot {
    display: flex;
    align-items: center;
  }
  .sep {
    display: block;
    width: 1px;
    height: 14px;
    margin-left: auto;
    background: var(--border);
  }
  .measure {
    position: absolute;
    left: 0;
    top: 0;
    width: 0;
    height: 0;
    overflow: hidden;
    visibility: hidden;
    pointer-events: none;
  }
  .measure-col {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: max-content;
  }
  .m {
    display: inline-flex;
    align-items: center;
    padding-right: var(--sb-gap);
  }
  .item {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .row {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .link {
    font-size: inherit;
    color: inherit;
    border-radius: 4px;
    padding: 1px 4px;
    margin: 0 -4px;
  }
  .link:hover,
  .link[aria-expanded='true'] {
    background: var(--bg-2);
    color: var(--text);
  }
  .strong {
    color: var(--text);
    font-weight: 600;
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
  @media (prefers-reduced-motion: no-preference) {
    .mini span {
      transition: width 0.2s var(--ease);
    }
  }
  .update {
    color: var(--accent-text);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
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
    flex: none;
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
  .dot.rec {
    background: var(--danger);
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
  .more {
    font-variant-numeric: tabular-nums;
  }
  .more-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 2px 0;
    list-style: none;
    font-size: 12px;
  }
  .more-list li {
    display: flex;
    align-items: center;
    min-height: 24px;
    padding: 0 9px;
  }
</style>
