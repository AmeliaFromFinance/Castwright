<script lang="ts">
  import { OverlayStage } from '$lib/overlay';
  import { BOX_PRESETS, type BoxPreset, type PresetTarget } from '$lib/overlay/presets';
  import { PREVIEW_CHAT, PREVIEW_EVENTS, PREVIEW_H, PREVIEW_W, previewAlert, previewOverlay } from './preset-preview';

  interface Props {
    target: PresetTarget;
    onpick: (p: BoxPreset) => void;
    /** Smallest card width in px; the grid fits as many as it can. */
    min?: number;
  }

  let { target, onpick, min = 128 }: Props = $props();

  let width = $state(0);
  const scale = $derived(width > 0 ? width / PREVIEW_W : 0);
  const h = $derived(PREVIEW_H[target]);
</script>

<div class="presets" role="list" aria-label="Styles" style="--min:{min}px">
  {#each BOX_PRESETS as p, i (p.id)}
    <div role="listitem">
      <button type="button" class="preset" data-preset={p.id} title={p.description} aria-label="{p.name} style: {p.description}" onclick={() => onpick(p)}>
        {#if i === 0}
          <span class="screen" aria-hidden="true" bind:clientWidth={width} style="aspect-ratio:{PREVIEW_W} / {h}">
            {#if scale > 0}{@render stage(p)}{/if}
          </span>
        {:else}
          <span class="screen" aria-hidden="true" style="aspect-ratio:{PREVIEW_W} / {h}">
            {#if scale > 0}{@render stage(p)}{/if}
          </span>
        {/if}
        <span class="name" aria-hidden="true">{p.name}</span>
      </button>
    </div>
  {/each}
</div>

{#snippet stage(p: BoxPreset)}
  <OverlayStage
    overlay={previewOverlay(p, target)}
    chat={target === 'chat' ? PREVIEW_CHAT : []}
    recent={target === 'events' ? PREVIEW_EVENTS : []}
    alert={target === 'alert' ? previewAlert(p) : null}
    {scale}
    mode="editor"
    paused
    muted
  />
{/snippet}

<style>
  .presets {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(var(--min), 100%), 1fr));
    gap: 8px;
  }
  .preset {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-2);
    text-align: left;
    cursor: pointer;
    transition: border-color 0.12s var(--ease);
  }
  .preset:hover {
    border-color: var(--text-faint);
  }
  .preset:focus-visible {
    outline: none;
    border-color: var(--focus);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 28%, transparent);
  }
  .screen {
    position: relative;
    display: block;
    width: 100%;
    overflow: hidden;
    border-radius: calc(var(--radius) - 2px);
    pointer-events: none;
    background:
      radial-gradient(120% 90% at 70% 20%, rgb(91 141 239 / 0.22), transparent 60%),
      linear-gradient(160deg, #1d2433, #0b0e15);
  }
  .name {
    padding: 0 2px 2px;
    font-size: 12px;
    font-weight: 550;
    color: var(--text-muted);
  }
</style>
