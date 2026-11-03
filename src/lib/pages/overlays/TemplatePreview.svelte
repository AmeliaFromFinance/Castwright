<script lang="ts" module>
  import { sampleChat, sampleEvent } from '$lib/editor/samples';

  // The same few messages and events in every preview.
  const CHAT = ['hi chat!', 'this layout is so clean', 'gg', 'hype!!', 'love the colours'].map((t) => sampleChat(t, 0));
  const RECENT = (['follow', 'sub', 'cheer', 'raid'] as const).map((k) => sampleEvent(k, 0));
  const VARS = { 'session.subs': 12, 'session.follows': 38, 'session.raids': 2 };
</script>

<script lang="ts">
  import type { Overlay } from '$lib/bindings/Overlay';
  import OverlayStage from '$lib/overlay/OverlayStage.svelte';
  import { app } from '$lib/state/app.svelte';
  import { appAssetUrl } from '$lib/widgets/assets.svelte';

  let { overlay }: { overlay: Overlay } = $props();

  let bw = $state(0);
  let bh = $state(0);
  const scale = $derived(bw && bh ? Math.min(bw / overlay.width, bh / overlay.height) : 0);
  const assetUrl = (p: string) => appAssetUrl(p, app.server?.base_url, app.server?.asset_key);
</script>

<div class="fit" bind:clientWidth={bw} bind:clientHeight={bh}>
  {#if scale > 0}
    <div class="stage" style="width:{overlay.width * scale}px;height:{overlay.height * scale}px" inert aria-hidden="true">
      <OverlayStage {overlay} vars={VARS} recent={RECENT} chat={CHAT} {assetUrl} defaultFont={app.project?.default_font} mode="editor" {scale} paused muted />
    </div>
  {/if}
</div>

<style>
  .fit {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
  }
  .stage {
    position: relative;
    overflow: hidden;
    border-radius: 3px;
    pointer-events: none;
  }
</style>
