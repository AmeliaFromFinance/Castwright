<script lang="ts">
  import type { LayerKind } from '$lib/bindings/LayerKind';
  import { render } from '$lib/logic/template';
  import { getStageCtx } from '../context';
  import StyledText from '../StyledText.svelte';

  let { kind }: { kind: Extract<LayerKind, { type: 'counter' }> } = $props();
  const ctx = getStageCtx();
  const text = $derived(
    render(kind.format?.trim() ? kind.format : '{{value}}', { ...ctx.vars, value: ctx.vars[kind.var] ?? 0 })
  );
</script>

<div class="cw-single cw-counter" style:justify-content={kind.style?.align === 'center' ? 'center' : kind.style?.align === 'right' ? 'flex-end' : 'flex-start'}>
  <StyledText {text} style={kind.style} />
</div>

<style>
  .cw-single {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    font-variant-numeric: tabular-nums;
  }
</style>
