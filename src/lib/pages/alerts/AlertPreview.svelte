<script lang="ts">
  import type { AlertSettings } from '$lib/bindings/AlertSettings';
  import type { AlertType } from '$lib/bindings/AlertType';
  import type { EventKind } from '$lib/bindings/EventKind';
  import type { Variation } from '$lib/bindings/Variation';
  import { describe } from '$lib/format';
  import { newId } from '$lib/editors/ids';
  import { OverlayStage, type ActiveAlert } from '$lib/overlay';
  import { durationOf } from '$lib/overlay/anim';
  import { app } from '$lib/state/app.svelte';
  import Button from '$lib/ui/Button.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import { appAssetUrl } from '$lib/widgets/assets.svelte';
  import { RotateCcw, Volume2, VolumeX } from '@lucide/svelte';
  import { alertsLayerSize, pickVariation, previewOverlay, renderPlay, sampleFor } from './alerts';

  interface Props {
    kind: EventKind;
    type: AlertType | undefined;
    variation: Variation | null;
    settings: AlertSettings;
  }

  let { kind, type, variation, settings }: Props = $props();

  // Held on screen while editing; a replay runs the real timing once.
  const HOLD_MS = 60 * 60 * 1000;

  let width = $state(0);
  let muted = $state(true);
  let replayAt = $state<number | null>(null);
  let replayTimer: ReturnType<typeof setTimeout> | null = null;

  const size = $derived(alertsLayerSize(app.project?.overlays ?? []));
  const overlay = $derived(previewOverlay(size.width, size.height));
  const scale = $derived(width > 0 ? width / size.width : 0);
  const event = $derived(sampleFor(kind, variation));
  const matching = $derived(pickVariation(type, event, app.vars));

  const assetUrl = (p: string) =>
    /^(https?:|data:|blob:)/.test(p) ? p : app.demo ? '' : appAssetUrl(p, app.server?.base_url, app.server?.asset_key);

  const alert = $derived.by((): ActiveAlert | null => {
    if (!variation) return null;
    const play = renderPlay(variation, event, settings, newId(), app.vars);
    if (replayAt !== null) return { play, startedAt: replayAt, stoppedAt: null };
    // Join late so the enter animation is already done and edits show at once.
    const skip = durationOf(play.enter, 'enter') + (play.enter.delay_ms ?? 0) + 50;
    return { play: { ...play, duration_ms: HOLD_MS }, startedAt: Date.now() - skip, stoppedAt: null };
  });

  function replay() {
    if (!variation) return;
    if (replayTimer) clearTimeout(replayTimer);
    replayAt = Date.now();
    const total = Math.max(500, variation.duration_ms) + durationOf(variation.exit, 'exit') + 600;
    replayTimer = setTimeout(() => {
      replayAt = null;
      replayTimer = null;
    }, total);
  }

  $effect(() => () => {
    if (replayTimer) clearTimeout(replayTimer);
  });
</script>

<section class="preview" aria-label="Preview">
  <header>
    <h3 class="eyebrow">Preview</h3>
    <div class="grow"></div>
    <IconButton size="sm" label={muted ? 'Play sound in preview' : 'Mute preview'} pressed={!muted} onclick={() => (muted = !muted)}>
      {#if muted}<VolumeX />{:else}<Volume2 />{/if}
    </IconButton>
    <Button size="sm" onclick={replay} disabled={!variation}><RotateCcw size={13} />Replay</Button>
  </header>
  <div class="screen" bind:clientWidth={width} style="aspect-ratio: {size.width} / {size.height}">
    {#if variation && scale > 0}
      <OverlayStage {overlay} {alert} {scale} {assetUrl} {muted} mode="live" />
    {:else if !variation}
      <p class="empty faint">Nothing to preview</p>
    {/if}
  </div>
  <p class="sample faint">
    Sample: <span class="muted">{describe(event)}</span>
    {#if variation && !variation.enabled}
      <br /><span class="note">This variation is off, so it never plays.</span>
    {:else if variation && matching && matching.id !== variation.id}
      <br /><span class="note">“{matching.name}” is higher in the list and matches first, so this variation wouldn't play for this event.</span>
    {:else if variation && !matching}
      <br /><span class="note">This variation's conditions don't match the sample event.</span>
    {/if}
  </p>
</section>

<style>
  .preview {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0 14px 14px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 38px;
  }
  .screen {
    position: relative;
    width: 100%;
    overflow: hidden;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background:
      radial-gradient(120% 90% at 70% 20%, rgb(91 141 239 / 0.22), transparent 60%),
      linear-gradient(160deg, #1d2433, #0b0e15);
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 12px;
  }
  .sample {
    font-size: 12px;
  }
  .note {
    color: var(--warn);
  }
</style>
