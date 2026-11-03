<script lang="ts">
  import type { CanvasColor } from '$lib/bindings/CanvasColor';
  import { COLORS } from './canvas';
  import type { Point, Rect } from './graph';

  type Colored = Rect & { id: string; color: CanvasColor };

  interface Props {
    nodes: Array<Rect & { id: string; trigger: boolean; selected: boolean }>;
    notes?: Colored[];
    frames?: Colored[];
    /** The part of the world the canvas shows. */
    visible: Rect;
    onjump: (p: Point) => void;
  }

  let { nodes, notes = [], frames = [], visible, onjump }: Props = $props();

  const W = 176;
  const H = 112;
  const PAD = 8;

  const box = $derived.by(() => {
    let x1 = visible.x;
    let y1 = visible.y;
    let x2 = visible.x + visible.w;
    let y2 = visible.y + visible.h;
    for (const n of [...nodes, ...notes, ...frames]) {
      x1 = Math.min(x1, n.x);
      y1 = Math.min(y1, n.y);
      x2 = Math.max(x2, n.x + n.w);
      y2 = Math.max(y2, n.y + n.h);
    }
    const s = Math.min((W - PAD * 2) / Math.max(1, x2 - x1), (H - PAD * 2) / Math.max(1, y2 - y1));
    // Centre the drawing in the map.
    const ox = (W - (x2 - x1) * s) / 2 - x1 * s;
    const oy = (H - (y2 - y1) * s) / 2 - y1 * s;
    return { s, ox, oy };
  });

  const sx = (x: number) => x * box.s + box.ox;
  const sy = (y: number) => y * box.s + box.oy;

  let dragging = false;

  function jump(e: PointerEvent) {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    onjump({ x: (e.clientX - r.left - box.ox) / box.s, y: (e.clientY - r.top - box.oy) / box.s });
  }
</script>

<svg
  class="minimap"
  width={W}
  height={H}
  viewBox="0 0 {W} {H}"
  role="img"
  aria-label="Overview of the flow. Click to move there."
  onpointerdown={(e) => {
    dragging = true;
    (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
    jump(e);
  }}
  onpointermove={(e) => dragging && jump(e)}
  onpointerup={() => (dragging = false)}
>
  {#each frames as f (f.id)}
    <rect class="f" x={sx(f.x)} y={sy(f.y)} width={Math.max(2, f.w * box.s)} height={Math.max(2, f.h * box.s)} rx="3" style="--c:{COLORS[f.color]}" />
  {/each}
  {#each notes as n (n.id)}
    <rect class="note" x={sx(n.x)} y={sy(n.y)} width={Math.max(2, n.w * box.s)} height={Math.max(2, n.h * box.s)} rx="1.5" style="--c:{COLORS[n.color]}" />
  {/each}
  {#each nodes as n (n.id)}
    <rect
      class="n"
      class:trigger={n.trigger}
      class:selected={n.selected}
      x={sx(n.x)}
      y={sy(n.y)}
      width={Math.max(2, n.w * box.s)}
      height={Math.max(2, n.h * box.s)}
      rx="2"
    />
  {/each}
  <rect class="view" x={sx(visible.x)} y={sy(visible.y)} width={visible.w * box.s} height={visible.h * box.s} rx="3" />
</svg>

<style>
  .minimap {
    display: block;
    cursor: pointer;
    touch-action: none;
  }
  .f {
    fill: color-mix(in srgb, var(--c) 12%, transparent);
    stroke: color-mix(in srgb, var(--c) 55%, transparent);
    stroke-width: 1;
  }
  .note {
    fill: color-mix(in srgb, var(--c) 60%, transparent);
  }
  .n {
    fill: color-mix(in srgb, var(--text-faint) 45%, transparent);
  }
  .n.trigger {
    fill: color-mix(in srgb, var(--accent) 75%, transparent);
  }
  .n.selected {
    fill: var(--accent-text);
  }
  .view {
    fill: color-mix(in srgb, var(--accent) 8%, transparent);
    stroke: color-mix(in srgb, var(--accent) 70%, transparent);
    stroke-width: 1.5;
  }
</style>
