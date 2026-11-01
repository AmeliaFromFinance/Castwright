<script lang="ts">
  import type { LayerKind } from '$lib/bindings/LayerKind';
  import { getStageCtx } from '../context';

  let { kind }: { kind: Extract<LayerKind, { type: 'video' }> } = $props();
  const ctx = getStageCtx();
  const src = $derived(ctx.assetUrl(kind.src ?? ''));
  const wantMuted = $derived(kind.muted || ctx.muted);
  let el = $state<HTMLVideoElement>();
  let failed = $state(false);

  $effect(() => {
    void src;
    failed = false;
  });

  $effect(() => {
    const v = el;
    if (!v) return;
    v.volume = Math.min(1, Math.max(0, (kind.volume ?? 0) / 100));
    v.muted = wantMuted;
    v.loop = kind.looped;
    if (ctx.paused) {
      v.pause();
      return;
    }
    v.play().catch(() => {
      // Browsers block unmuted autoplay; OBS doesn't. Fall back to muted rather than nothing.
      if (!v.muted) {
        v.muted = true;
        v.play().catch(() => undefined);
      }
    });
  });

  function onError() {
    failed = true;
    console.warn(`[overlay] video failed to load: ${src}`);
  }
</script>

{#if src && !failed}
  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    bind:this={el}
    class="cw-media"
    {src}
    autoplay
    playsinline
    muted
    preload="auto"
    disablepictureinpicture
    style="object-fit:{kind.fit || 'contain'}"
    onerror={onError}
  ></video>
{/if}

<style>
  .cw-media {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
