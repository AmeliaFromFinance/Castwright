<script lang="ts">
  import { untrack } from 'svelte';
  import type { LayerKind } from '$lib/bindings/LayerKind';
  import { asNumber } from '$lib/logic/condition';
  import { groupThousands, render } from '$lib/logic/template';
  import { getStageCtx } from '../context';
  import { cssValue, DEFAULT_TEXT } from '../styles';
  import StyledText from '../StyledText.svelte';

  let { kind }: { kind: Extract<LayerKind, { type: 'goal' }> } = $props();
  const ctx = getStageCtx();

  const current = $derived(asNumber(ctx.vars[kind.current_var] ?? null) ?? 0);
  const target = $derived(Number.isFinite(kind.target) ? kind.target : 0);
  const pct = $derived(target > 0 ? Math.min(100, Math.max(0, (current / target) * 100)) : current > 0 ? 100 : 0);
  const reached = $derived(target > 0 && current >= target);
  const style = $derived({ ...DEFAULT_TEXT, ...(kind.style ?? {}) });
  const title = $derived(render(kind.title ?? '', ctx.vars));
  const numbers = $derived(`${groupThousands(current)} / ${groupThousands(target)}`);
  const barH = $derived(Math.max(8, Math.round(style.font_size * 0.55)));
  const bar = $derived(cssValue(kind.bar_color) || '#5b8def');
  const track = $derived(cssValue(kind.track_color) || 'rgba(255,255,255,0.14)');

  let celebrate = $state(false);
  let wasReached: boolean | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const r = reached;
    untrack(() => {
      // Only when crossing the target live, not when the page loads already complete.
      if (wasReached === false && r && ctx.mode === 'live') {
        celebrate = false;
        clearTimeout(timer);
        requestAnimationFrame(() => (celebrate = true));
        timer = setTimeout(() => (celebrate = false), 2400);
      }
      wasReached = r;
    });
  });
  $effect(() => () => clearTimeout(timer));
</script>

<div class="cw-goal" class:cw-reached={reached} class:cw-celebrate={celebrate}>
  {#if title || kind.show_numbers}
    <div class="cw-goal-head" style:justify-content={style.align === 'center' ? 'center' : style.align === 'right' ? 'flex-end' : 'space-between'}>
      {#if title}<StyledText class="cw-goal-title" text={title} {style} />{/if}
      {#if kind.show_numbers}<StyledText class="cw-goal-numbers" text={numbers} style={{ ...style, font_weight: Math.max(500, style.font_weight - 100) }} />{/if}
    </div>
  {/if}
  <div class="cw-goal-track" style="height:{barH}px;background:{track}">
    <div class="cw-goal-fill" style="width:{pct}%;background:{bar}" data-pct={pct.toFixed(2)}>
      <span class="cw-goal-shine"></span>
    </div>
  </div>
</div>

<style>
  .cw-goal {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 10px;
  }
  .cw-goal-head {
    display: flex;
    align-items: baseline;
    gap: 12px;
    min-width: 0;
  }
  .cw-goal-head :global(.cw-goal-title) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cw-goal-head :global(.cw-goal-numbers) {
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
    opacity: 0.92;
  }
  .cw-goal-track {
    position: relative;
    width: 100%;
    border-radius: 999px;
    overflow: hidden;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.25);
  }
  .cw-goal-fill {
    position: relative;
    height: 100%;
    border-radius: inherit;
    min-width: 0;
    transition: width 0.9s cubic-bezier(0.22, 1, 0.36, 1);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25);
    overflow: hidden;
  }
  .cw-goal-shine {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -40%;
    width: 40%;
    background: linear-gradient(90deg, rgba(255, 255, 255, 0), rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0));
    opacity: 0;
  }
  .cw-celebrate .cw-goal-shine {
    animation: cw-goal-shine 1.1s ease-in-out 2;
  }
  .cw-celebrate .cw-goal-track {
    animation: cw-goal-glow 2.2s ease-out;
  }
  @keyframes cw-goal-shine {
    0% {
      left: -40%;
      opacity: 1;
    }
    100% {
      left: 110%;
      opacity: 1;
    }
  }
  @keyframes cw-goal-glow {
    0% {
      box-shadow:
        inset 0 1px 2px rgba(0, 0, 0, 0.25),
        0 0 0 0 rgba(255, 255, 255, 0);
    }
    25% {
      box-shadow:
        inset 0 1px 2px rgba(0, 0, 0, 0.25),
        0 0 18px 2px rgba(255, 255, 255, 0.35);
    }
    100% {
      box-shadow:
        inset 0 1px 2px rgba(0, 0, 0, 0.25),
        0 0 0 0 rgba(255, 255, 255, 0);
    }
  }
</style>
