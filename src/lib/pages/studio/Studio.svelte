<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { api } from '$lib/api';
  import { attempt } from '$lib/state/toast.svelte';
  import { duration } from '$lib/format';
  import Button from '$lib/ui/Button.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import Previews from './Previews.svelte';
  import Scenes from './Scenes.svelte';
  import Sources from './Sources.svelte';
  import Mixer from './Mixer.svelte';
  import SideDock from './SideDock.svelte';
  import ConnectObs from './ConnectObs.svelte';
  import StreamInfo from './StreamInfo.svelte';
  import { Radio, Circle, Pause, Play, Square, Clapperboard, Video, Save } from '@lucide/svelte';

  const obs = $derived(app.obs);
  const connected = $derived(obs.state === 'connected');
  let confirmEnd = $state(false);
  let infoOpen = $state(false);
  let busy = $state<string | null>(null);

  async function run(key: string, fn: () => Promise<unknown>, ok?: string) {
    busy = key;
    await attempt(fn, ok);
    busy = null;
  }
</script>

<div class="studio">
  <header class="toolbar">
    <button type="button" class="info" onclick={() => (infoOpen = true)} disabled={!app.twitch?.broadcaster}>
      <span class="eyebrow">Stream info</span>
      <span class="title truncate">{app.twitch?.stream.title || 'Set a title'}</span>
      <span class="cat truncate muted">{app.twitch?.stream.category || 'No category'}</span>
    </button>
    <div class="grow"></div>
    {#if connected}
      <div class="row tools">
        <Switch
          label="Studio mode"
          showLabel
          checked={obs.studio_mode}
          onchange={(v) => run('studio', () => api.obsSetStudioMode(v))}
        />
        <span class="sep"></span>
        {#if obs.replay_buffer !== null}
          <Button
            size="sm"
            pressed={obs.replay_buffer}
            onclick={() => run('replay', () => api.obsReplay('toggle'))}
            title="Turn the replay buffer on or off"
          >
            <Clapperboard size={14} />Replay
          </Button>
          {#if obs.replay_buffer}
            <Button size="sm" onclick={() => run('save', () => api.obsReplay('save'), 'Replay saved')}>
              <Save size={14} />Save replay
            </Button>
          {/if}
        {/if}
        <Button size="sm" pressed={obs.virtual_cam} onclick={() => run('vcam', () => api.obsVirtualCam())}>
          <Video size={14} />Virtual cam
        </Button>
        {#if obs.record.active}
          <Button
            size="sm"
            onclick={() => run('pause', () => api.obsRecord(obs.record.paused ? 'resume' : 'pause'))}
            title={obs.record.paused ? 'Resume recording' : 'Pause recording'}
          >
            {#if obs.record.paused}<Play size={14} />{:else}<Pause size={14} />{/if}
          </Button>
        {/if}
        <Button
          size="sm"
          pressed={obs.record.active}
          busy={busy === 'record'}
          onclick={() => run('record', () => api.obsRecord('toggle'))}
        >
          <Circle size={12} fill={obs.record.active ? 'var(--live)' : 'none'} color={obs.record.active ? 'var(--live)' : 'currentColor'} />
          {#if obs.record.active}<span class="mono">{duration(obs.record.duration_ms)}</span>{:else}Record{/if}
        </Button>
        {#if obs.stream.active}
          <Button variant="live" busy={busy === 'stream'} onclick={() => (confirmEnd = true)}>
            <Square size={13} fill="currentColor" />End stream
          </Button>
        {:else}
          <Button variant="primary" busy={busy === 'stream'} onclick={() => run('stream', () => api.obsStream('start'))}>
            <Radio size={15} />Go live
          </Button>
        {/if}
      </div>
    {/if}
  </header>

  <div class="body">
    <div class="center">
      {#if connected}
        <Previews />
        <div class="docks">
          <Scenes />
          <Sources />
          <Mixer />
        </div>
      {:else}
        <ConnectObs />
      {/if}
    </div>
    <SideDock />
  </div>
</div>

<Dialog bind:open={confirmEnd} title="End the stream?" description="Viewers will see the stream go offline." width={420}>
  <p class="muted">OBS stops sending to Twitch. Recording keeps going if it's on.</p>
  {#snippet footer()}
    <Button onclick={() => (confirmEnd = false)}>Keep streaming</Button>
    <Button
      variant="live"
      onclick={() => {
        confirmEnd = false;
        run('stream', () => api.obsStream('stop'));
      }}>End stream</Button
    >
  {/snippet}
</Dialog>

<StreamInfo bind:open={infoOpen} />

<style>
  .studio {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 54px;
    flex: none;
    padding: 0 16px;
    border-bottom: 1px solid var(--border);
  }
  .info {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: auto auto;
    column-gap: 10px;
    align-items: center;
    max-width: 480px;
    min-width: 0;
    padding: 4px 10px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    text-align: left;
    cursor: pointer;
  }
  .info:hover:not(:disabled) {
    background: var(--bg-2);
    border-color: var(--border);
  }
  .info .eyebrow {
    grid-row: span 2;
  }
  .title {
    font-weight: 600;
  }
  .cat {
    font-size: 12px;
  }
  .tools {
    gap: 6px;
  }
  .sep {
    width: 1px;
    height: 22px;
    background: var(--border);
    margin: 0 4px;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 340px;
  }
  .center {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    min-width: 0;
    min-height: 0;
    overflow: auto;
  }
  .docks {
    flex: 1;
    min-height: 220px;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }
  @media (max-width: 1240px) {
    .body {
      grid-template-columns: minmax(0, 1fr) 300px;
    }
    .docks {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
