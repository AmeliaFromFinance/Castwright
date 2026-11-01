<script lang="ts">
  import { onDestroy } from 'svelte';
  import { app } from '$lib/state/app.svelte';
  import { api } from '$lib/api';
  import { attempt } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { ArrowRightLeft } from '@lucide/svelte';

  const obs = $derived(app.obs);
  let program = $state('');
  let preview = $state('');
  let inFlight = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let duration = $state(app.obs.transition_ms);

  $effect(() => {
    duration = obs.transition_ms;
  });

  async function refresh() {
    if (inFlight || document.hidden || obs.state !== 'connected') return;
    inFlight = true;
    try {
      const width = 640;
      program = await api.obsScreenshot(obs.program_scene, width);
      if (obs.studio_mode && obs.preview_scene) preview = await api.obsScreenshot(obs.preview_scene, width);
    } catch {
      // Screenshots fail briefly while scenes change; the next tick catches up.
    } finally {
      inFlight = false;
    }
  }

  $effect(() => {
    // Refresh straight away when the scenes change, then about once a second.
    void obs.program_scene;
    void obs.preview_scene;
    void obs.studio_mode;
    refresh();
  });

  timer = setInterval(refresh, 1000);
  onDestroy(() => timer && clearInterval(timer));

  const aspect = $derived(`${obs.base_width || 16} / ${obs.base_height || 9}`);
</script>

<div class="previews" class:studio={obs.studio_mode}>
  {#if obs.studio_mode}
    <figure>
      <figcaption><span class="eyebrow">Preview</span><span class="truncate">{obs.preview_scene ?? ''}</span></figcaption>
      <div class="screen" style:aspect-ratio={aspect}>
        {#if preview}<img src={preview} alt="Preview of {obs.preview_scene}" />{/if}
      </div>
    </figure>
    <div class="transition">
      <select
        class="input"
        aria-label="Transition"
        value={obs.current_transition}
        onchange={(e) => attempt(() => api.obsSetTransition(e.currentTarget.value))}
      >
        {#each obs.transitions as t (t)}<option value={t}>{t}</option>{/each}
      </select>
      <label class="dur">
        <span class="sr-only">Transition length in milliseconds</span>
        <input
          class="input mono"
          type="number"
          min="0"
          max="20000"
          step="50"
          bind:value={duration}
          onchange={() => attempt(() => api.obsSetTransitionDuration(Math.max(0, Math.min(20000, Number(duration) || 0))))}
        />
        <span class="faint">ms</span>
      </label>
      <Button variant="primary" onclick={() => attempt(() => api.obsTransition())}>
        <ArrowRightLeft size={15} />Transition
      </Button>
    </div>
  {/if}
  <figure>
    <figcaption>
      <span class="eyebrow">Program</span><span class="truncate">{obs.program_scene}</span>
      <span class="grow"></span>
      <span class="faint mono">{obs.base_width}×{obs.base_height} · {obs.stats.active_fps.toFixed(0)} fps</span>
    </figcaption>
    <div class="screen program" class:live={obs.stream.active} style:aspect-ratio={aspect}>
      {#if program}<img src={program} alt="What viewers see: {obs.program_scene}" />{/if}
    </div>
  </figure>
</div>

<style>
  .previews {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
    align-items: center;
  }
  .previews.studio {
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  }
  .previews:not(.studio) figure {
    max-width: min(100%, 980px);
    width: 100%;
    justify-self: center;
  }
  figure {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  figcaption {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-weight: 550;
    min-width: 0;
  }
  .screen {
    width: 100%;
    border-radius: var(--radius-lg);
    background: #05070a;
    border: 1px solid var(--border);
    overflow: hidden;
    display: grid;
  }
  .screen img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  .program.live {
    border-color: var(--live);
    box-shadow: 0 0 0 1px var(--live);
  }
  .transition {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 150px;
  }
  .dur {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .dur input {
    width: 100%;
  }
</style>
