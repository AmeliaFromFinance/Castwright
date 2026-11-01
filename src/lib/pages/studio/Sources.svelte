<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { api } from '$lib/api';
  import { attempt } from '$lib/state/toast.svelte';
  import Panel from '$lib/ui/Panel.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import { Eye, EyeOff, Lock, LockOpen, Globe, Camera, Monitor, Image, Music, Gamepad2, Folder, Square } from '@lucide/svelte';

  const obs = $derived(app.obs);
  const scene = $derived(obs.studio_mode && obs.preview_scene ? obs.preview_scene : obs.program_scene);

  function iconFor(kind: string) {
    if (kind.includes('browser')) return Globe;
    if (kind.includes('dshow') || kind.includes('v4l2') || kind.includes('av_capture') || kind.includes('camera')) return Camera;
    if (kind.includes('game')) return Gamepad2;
    if (kind.includes('monitor') || kind.includes('display') || kind.includes('window') || kind.includes('screen') || kind.includes('xshm') || kind.includes('pipewire')) return Monitor;
    if (kind.includes('image') || kind.includes('slideshow')) return Image;
    if (kind.includes('ffmpeg') || kind.includes('vlc') || kind.includes('audio') || kind.includes('wasapi') || kind.includes('pulse') || kind.includes('coreaudio')) return Music;
    if (kind === 'scene' || kind === 'group') return Folder;
    return Square;
  }
</script>

<Panel title="Sources · {scene}" flush>
  <ul class="list" aria-label="Sources in {scene}">
    {#each obs.scene_items as item (item.id)}
      {@const Icon = iconFor(item.kind)}
      <li class:hidden={!item.visible}>
        <Icon size={15} />
        <span class="grow truncate" title={item.kind}>{item.name}</span>
        <IconButton
          size="sm"
          label={item.visible ? `Hide ${item.name}` : `Show ${item.name}`}
          pressed={!item.visible}
          onclick={() => attempt(() => api.obsSetItemEnabled(scene, item.id, !item.visible))}
        >
          {#if item.visible}<Eye />{:else}<EyeOff />{/if}
        </IconButton>
        <IconButton
          size="sm"
          label={item.locked ? `Unlock ${item.name}` : `Lock ${item.name}`}
          onclick={() => attempt(() => api.obsSetItemLocked(scene, item.id, !item.locked))}
        >
          {#if item.locked}<Lock />{:else}<LockOpen />{/if}
        </IconButton>
      </li>
    {:else}
      <li class="none muted">This scene is empty.</li>
    {/each}
  </ul>
</Panel>

<style>
  .list {
    list-style: none;
    margin: 0;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    height: var(--row-h);
    padding: 0 4px 0 10px;
    border-radius: var(--radius);
    color: var(--text);
  }
  li:hover {
    background: var(--bg-2);
  }
  li :global(svg:first-child) {
    color: var(--text-faint);
    flex: none;
  }
  .hidden .truncate {
    color: var(--text-faint);
    text-decoration: line-through;
  }
  .none {
    padding: 10px;
    display: block;
    height: auto;
  }
</style>
