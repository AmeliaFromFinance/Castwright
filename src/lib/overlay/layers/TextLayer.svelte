<script lang="ts">
  import type { LayerKind } from '$lib/bindings/LayerKind';
  import { render } from '$lib/logic/template';
  import { getStageCtx } from '../context';
  import StyledText from '../StyledText.svelte';

  let { kind }: { kind: Extract<LayerKind, { type: 'text' }> } = $props();
  const ctx = getStageCtx();
  const text = $derived(render(kind.text ?? '', ctx.vars));
</script>

<div class="cw-text-layer">
  <StyledText {text} style={kind.style} block />
</div>

<style>
  .cw-text-layer {
    width: 100%;
    height: 100%;
  }
</style>
