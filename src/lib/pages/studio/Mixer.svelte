<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { app } from '$lib/state/app.svelte';
  import { api } from '$lib/api';
  import { attempt } from '$lib/state/toast.svelte';
  import { db } from '$lib/format';
  import Panel from '$lib/ui/Panel.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import { Volume2, VolumeX, Headphones } from '@lucide/svelte';

  const obs = $derived(app.obs);
  const MIN_DB = -60;

  // Local fader values while dragging, so OBS updates don't fight the pointer.
  let dragging = $state<Record<string, number>>({});
  let pending: Record<string, ReturnType<typeof setTimeout>> = {};

  onMount(() => {
    api.obsLevels(true).catch(() => {});
  });
  onDestroy(() => {
    api.obsLevels(false).catch(() => {});
    Object.values(pending).forEach(clearTimeout);
  });

  function faderValue(name: string, vol: number) {
    return dragging[name] ?? Math.max(MIN_DB, vol);
  }

  function setVolume(name: string, v: number) {
    dragging = { ...dragging, [name]: v };
    clearTimeout(pending[name]);
    pending[name] = setTimeout(() => {
      const value = v <= MIN_DB ? -100 : v;
      attempt(() => api.obsSetVolume(name, value)).finally(() => {
        const { [name]: _, ...rest } = dragging;
        dragging = rest;
      });
    }, 60);
  }

  function meterPct(peak: number) {
    return Math.max(0, Math.min(100, ((peak - MIN_DB) / -MIN_DB) * 100));
  }
</script>

<Panel title="Audio mixer" flush>
  <ul class="list" aria-label="Audio inputs">
    {#each obs.inputs as input (input.name)}
      {@const peaks = app.levels[input.name] ?? []}
      {@const value = faderValue(input.name, input.volume_db)}
      <li class:muted={input.muted}>
        <div class="top">
          <span class="grow truncate name">{input.name}</span>
          <span class="mono faint vol">{db(input.volume_db)}</span>
          <IconButton
            size="sm"
            label={input.monitoring ? `Stop monitoring ${input.name}` : `Monitor ${input.name}`}
            pressed={input.monitoring}
            onclick={() => attempt(() => api.obsSetMonitoring(input.name, !input.monitoring))}
          >
            <Headphones />
          </IconButton>
          <IconButton
            size="sm"
            label={input.muted ? `Unmute ${input.name}` : `Mute ${input.name}`}
            tone="danger"
            pressed={input.muted}
            onclick={() => attempt(() => api.obsSetMute(input.name, !input.muted))}
          >
            {#if input.muted}<VolumeX />{:else}<Volume2 />{/if}
          </IconButton>
        </div>
        <div class="meters" aria-hidden="true">
          {#each peaks.length ? peaks.slice(0, 2) : [-100, -100] as p, i (i)}
            <div class="meter"><span class="cover" style:width="{100 - (input.muted ? 0 : meterPct(p))}%"></span></div>
          {/each}
        </div>
        <input
          class="fader"
          type="range"
          min={MIN_DB}
          max="0"
          step="0.5"
          aria-label="{input.name} volume"
          aria-valuetext={db(value <= MIN_DB ? -100 : value)}
          value={value}
          style:--pct="{((value - MIN_DB) / -MIN_DB) * 100}%"
          oninput={(e) => setVolume(input.name, Number(e.currentTarget.value))}
        />
      </li>
    {:else}
      <li class="none muted">No audio inputs in OBS.</li>
    {/each}
  </ul>
</Panel>

<style>
  .list {
    list-style: none;
    margin: 0;
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  li {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
  }
  .name {
    font-weight: 550;
  }
  .vol {
    font-size: 11px;
    margin-right: 4px;
  }
  .meters {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .meter {
    position: relative;
    height: 4px;
    border-radius: 2px;
    overflow: hidden;
    /* -60..-20 dB green, -20..-9 yellow, above -9 red (same zones as OBS) */
    background: linear-gradient(90deg, #3fb950 0 66.6%, #d29922 66.6% 85%, #e5484d 85% 100%);
  }
  .cover {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    background: var(--bg-3);
    transition: width 0.06s linear;
  }
  .muted .name {
    color: var(--text-faint);
  }
  .fader {
    width: 100%;
    margin: 0;
    height: 16px;
    background: transparent;
    -webkit-appearance: none;
    appearance: none;
    cursor: pointer;
  }
  .fader::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 2px;
    background: linear-gradient(to right, var(--text-muted) var(--pct), var(--bg-3) var(--pct));
  }
  .fader::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 16px;
    margin-top: -6px;
    border-radius: 3px;
    background: var(--text);
    border: 1px solid var(--bg-1);
  }
  .none {
    padding: 4px 0;
  }
</style>
