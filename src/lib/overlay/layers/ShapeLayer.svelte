<script lang="ts">
  import type { LayerKind } from '$lib/bindings/LayerKind';
  import { cssValue } from '../styles';

  interface Props {
    kind: Extract<LayerKind, { type: 'shape' }>;
    width: number;
    height: number;
    radius: number;
  }
  let { kind, width, height, radius }: Props = $props();

  const w = $derived(Math.max(0, width));
  const h = $derived(Math.max(0, height));
  const fill = $derived(cssValue(kind.fill) || 'transparent');
  const stroke = $derived(cssValue(kind.stroke) || 'transparent');
  const sw = $derived(Math.max(0, kind.stroke_width || 0));
  const hasStroke = $derived(sw > 0 && stroke !== 'transparent');
  const inset = $derived(hasStroke ? sw / 2 : 0);
  // A line is drawn across the middle; rotate the layer for other angles.
  const lineWidth = $derived(sw > 0 ? sw : Math.max(1, h));
  const lineColor = $derived(stroke !== 'transparent' ? stroke : fill);
</script>

<svg class="cw-shape" width={w} height={h} viewBox="0 0 {w} {h}" aria-hidden="true">
  {#if kind.shape === 'ellipse'}
    <ellipse
      cx={w / 2}
      cy={h / 2}
      rx={Math.max(0, w / 2 - inset)}
      ry={Math.max(0, h / 2 - inset)}
      {fill}
      stroke={hasStroke ? stroke : 'none'}
      stroke-width={hasStroke ? sw : 0}
    />
  {:else if kind.shape === 'line'}
    <line
      x1={lineWidth / 2}
      y1={h / 2}
      x2={Math.max(lineWidth / 2, w - lineWidth / 2)}
      y2={h / 2}
      stroke={lineColor}
      stroke-width={lineWidth}
      stroke-linecap="round"
    />
  {:else}
    <rect
      x={inset}
      y={inset}
      width={Math.max(0, w - inset * 2)}
      height={Math.max(0, h - inset * 2)}
      rx={Math.max(0, radius - inset)}
      {fill}
      stroke={hasStroke ? stroke : 'none'}
      stroke-width={hasStroke ? sw : 0}
    />
  {/if}
</svg>

<style>
  .cw-shape {
    display: block;
    overflow: visible;
  }
</style>
