<script lang="ts">
  import type { Overlay } from '$lib/bindings/Overlay';
  import Button from '$lib/ui/Button.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import { Link } from '@lucide/svelte';

  interface Props {
    open: boolean;
    overlays: Overlay[];
    oncopy: (id: string) => void;
  }

  let { open = $bindable(), overlays, oncopy }: Props = $props();
  let pick = $state('');

  $effect(() => {
    if (open && !overlays.some((o) => o.id === pick)) pick = overlays[0]?.id ?? '';
  });

  const chosen = $derived(overlays.find((o) => o.id === pick));
</script>

<Dialog bind:open title="Use an overlay in OBS" width={500}>
  <ol class="steps">
    <li>
      <p>Copy the overlay link.</p>
      {#if overlays.length}
        <div class="row copy">
          <select class="input" aria-label="Overlay" bind:value={pick}>
            {#each overlays as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
          </select>
          <Button size="sm" disabled={!pick} onclick={() => oncopy(pick)}><Link size={13} />Copy link</Button>
        </div>
      {:else}
        <p class="muted">Create an overlay first.</p>
      {/if}
    </li>
    <li>
      <p>In OBS, pick a scene and add a <strong>Browser</strong> source.</p>
    </li>
    <li>
      <p>
        Paste the link as the URL and set the width and height to
        <span class="mono">{chosen ? `${chosen.width} × ${chosen.height}` : 'the overlay size'}</span>.
      </p>
    </li>
  </ol>
  <p class="muted tip">When OBS is connected, <strong>Add to OBS</strong> on an overlay does all of this for you. Keep Castwright running while you stream.</p>
  {#snippet footer()}
    <Button variant="primary" onclick={() => (open = false)}>Got it</Button>
  {/snippet}
</Dialog>

<style>
  .steps {
    margin: 0;
    padding: 0;
    list-style: none;
    counter-reset: step;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  li {
    position: relative;
    padding-left: 34px;
    counter-increment: step;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  li::before {
    content: counter(step);
    position: absolute;
    left: 0;
    top: -2px;
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: 11.5px;
    font-weight: 650;
  }
  .copy select {
    flex: 1;
    min-width: 0;
  }
  .tip {
    margin-top: 16px;
    font-size: 12.5px;
  }
</style>
