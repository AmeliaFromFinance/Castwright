<script lang="ts">
  import type { Point, Rect } from './graph';

  interface Props {
    nodes: Array<Rect & { id: string; trigger: boolean; selected: boolean }>;
    /** The part of the world the canvas shows. */
    visible: Rect;
    onjump: (p: Point) => void;
  }

  let { nodes, visible, onjump }: Props = $props();

  const W = 176;
  const H = 112;
  const PAD = 8;

  const box = $derived.by(() => {
    let x1 = visible.x;
    let y1 = visible.y;
    let x2 = visible.x + visible.w;
    let y2 = visible.y + visible.h;
    for (const n of nodes) {
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
