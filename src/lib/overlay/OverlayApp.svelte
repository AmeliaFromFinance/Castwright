<script lang="ts">
  import OverlayStage from './OverlayStage.svelte';
  import type { OverlayRuntime } from './runtime.svelte';

  let { runtime }: { runtime: OverlayRuntime } = $props();
  const s = $derived(runtime.state);
</script>

{#if s.overlay}
  <OverlayStage
    overlay={s.overlay}
    vars={s.vars}
    recent={s.recent}
    chat={s.chat}
    alert={s.alert}
    widgetState={s.widgetState}
    visibility={s.visibility}
    assetUrl={runtime.assetUrl}
    feed={runtime.feed}
    onWidgetStore={runtime.storeWidgetValue}
    mode="live"
  />
{/if}
