<script lang="ts">
  import type { LayerKind } from '$lib/bindings/LayerKind';
  import { getStageCtx } from '../context';

  let { kind }: { kind: Extract<LayerKind, { type: 'image' }> } = $props();
  const ctx = getStageCtx();
  const src = $derived(ctx.assetUrl(kind.src ?? ''));
  let failed = $state(false);
  let loaded = $state(false);

  $effect(() => {
    void src;
    failed = false;
    loaded = false;
  });

  function onError() {
    failed = true;
    console.warn(`[overlay] image failed to load: ${src}`);
  }
</script>

{#if src && !failed}
  <img
    class="cw-media cw-image"
    class:cw-loaded={loaded}
    {src}
    alt=""
    draggable="false"
    style="object-fit:{kind.fit || 'contain'}"
    onload={() => (loaded = true)}
    onerror={onError}
  />
{/if}

<style>
  .cw-media {
    display: block;
    width: 100%;
    height: 100%;
    opacity: 0;
    transition: opacity 0.25s ease;
    user-select: none;
  }
  .cw-loaded {
    opacity: 1;
  }
</style>
