<script lang="ts" module>
  // "From when the overlay loaded" means the page, not the layer being shown.
  const PAGE_LOADED = Date.now();
</script>

<script lang="ts">
  import type { LayerKind } from '$lib/bindings/LayerKind';
  import { clock, useClock } from '../clock.svelte';
  import { getStageCtx } from '../context';
  import { timerText } from '../format';
  import { controllable, timerStatus } from '../timer';
  import StyledText from '../StyledText.svelte';

  let { kind, layerId }: { kind: Extract<LayerKind, { type: 'timer' }>; layerId: string } = $props();
  const ctx = getStageCtx();

  $effect(() => useClock());

  const anchorName = $derived((kind.anchor_var ?? '').trim());
  const value = $derived(
    timerText({
      mode: kind.mode,
      durationS: kind.duration_s ?? 0,
      anchor: anchorName ? ctx.vars[anchorName] : undefined,
      hasAnchor: !!anchorName,
      loadedAt: PAGE_LOADED,
      streamStartedAt: ctx.vars['stream.started_at'],
      now: clock.now,
      run: ctx.timers[layerId]
    })
  );
  const text = $derived(value ? `${kind.prefix ?? ''}${value}` : '');
  const state = $derived(controllable(kind.mode) ? timerStatus(ctx.timers[layerId], kind.mode, kind.duration_s ?? 0, clock.now) : undefined);
</script>

<div class="cw-single cw-timer" data-state={state} style:justify-content={kind.style?.align === 'center' ? 'center' : kind.style?.align === 'right' ? 'flex-end' : 'flex-start'}>
  {#if text}<StyledText {text} style={kind.style} />{/if}
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
