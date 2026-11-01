<script lang="ts">
  import { api } from '$lib/api';
  import type { Overlay } from '$lib/bindings/Overlay';
  import { app } from '$lib/state/app.svelte';
  import { toasts } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';

  interface Props {
    open: boolean;
    overlay: Overlay | null;
  }

  let { open = $bindable(), overlay }: Props = $props();

  let scene = $state('');
  let busy = $state(false);
  const connected = $derived(app.obs.state === 'connected');
  const scenes = $derived(app.obs.scenes);

  $effect(() => {
    if (open) scene = app.obs.program_scene || app.obs.scenes[0] || '';
  });

  async function add() {
    if (!overlay || !scene) return;
    busy = true;
    try {
      await api.obsAddOverlay(overlay.id, scene);
      toasts.success(`Added "${overlay.name}" to ${scene}`);
      open = false;
    } catch (e) {
      toasts.error(e);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog bind:open title="Add to OBS" description={overlay ? `Adds "${overlay.name}" as a Browser Source, sized ${overlay.width} × ${overlay.height}.` : ''} width={440}>
  {#if connected}
    <div class="field">
      <label class="label" for="obs-scene">Scene</label>
      <select id="obs-scene" class="input" bind:value={scene}>
        {#each scenes as s (s)}<option value={s}>{s}{s === app.obs.program_scene ? ' (on air)' : ''}</option>{/each}
      </select>
    </div>
  {:else}
    <div class="off">
      <p>OBS isn't connected.</p>
      <p class="muted">Connect on the Studio page, or copy the overlay link and add a Browser Source in OBS yourself.</p>
    </div>
  {/if}
  {#snippet footer()}
    {#if !connected}
      <Button
        variant="ghost"
        onclick={() => {
          open = false;
          app.page = 'studio';
        }}>Go to Studio</Button
      >
    {/if}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" disabled={!connected || !scene} {busy} onclick={add}>Add to scene</Button>
  {/snippet}
</Dialog>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .label {
    font-size: 12px;
    font-weight: 550;
    color: var(--text-muted);
  }
  .off {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 14px;
    border-radius: var(--radius);
    background: var(--bg-2);
    font-size: 12.5px;
  }
</style>
