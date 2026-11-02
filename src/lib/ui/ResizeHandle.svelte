<script lang="ts">
  import { loadPref, savePref } from '$lib/state/persist';

  interface Props {
    /** Panel size in px. Saved per device under `id`. */
    size: number;
    id: string;
    min: number;
    max: number;
    /** Size restored by double-click. */
    initial: number;
    /** Which side of the handle the resized panel is on. */
    panel: 'before' | 'after';
    orientation?: 'vertical' | 'horizontal';
    label: string;
  }
  let {
    size = $bindable(),
    id,
    min,
    max,
    initial,
    panel,
    orientation = 'vertical',
    label
  }: Props = $props();

  // svelte-ignore state_referenced_locally
  size = clamp(loadPref(`size.${id}`, size));

  let dragging = $state(false);

  function clamp(v: number) {
    return Math.round(Math.min(max, Math.max(min, Number.isFinite(v) ? v : initial)));
  }

  function set(v: number) {
    size = clamp(v);
    savePref(`size.${id}`, size);
  }

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    dragging = true;
    const start = orientation === 'vertical' ? e.clientX : e.clientY;
    const startSize = size;
    const sign = panel === 'before' ? 1 : -1;
    const move = (ev: PointerEvent) => {
      const pos = orientation === 'vertical' ? ev.clientX : ev.clientY;
      set(startSize + (pos - start) * sign);
    };
    const up = () => {
      dragging = false;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  function key(e: KeyboardEvent) {
    const grow = panel === 'before' ? 1 : -1;
    const step = e.shiftKey ? 64 : 16;
    const fwd = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
    const back = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
    if (e.key === fwd) set(size + step * grow);
    else if (e.key === back) set(size - step * grow);
    else if (e.key === 'Home') set(min);
    else if (e.key === 'End') set(max);
    else return;
    e.preventDefault();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="handle {orientation}"
  class:dragging
  role="separator"
  tabindex="0"
  aria-label={label}
  aria-orientation={orientation}
  aria-valuenow={size}
  aria-valuemin={min}
  aria-valuemax={max}
  title="Drag to resize. Double-click to reset."
  onpointerdown={down}
  ondblclick={() => set(initial)}
  onkeydown={key}
></div>

<style>
  .handle {
    position: relative;
    flex: none;
    z-index: 5;
    touch-action: none;
  }
  .vertical {
    width: 1px;
    cursor: col-resize;
    background: var(--border);
  }
  .horizontal {
    height: 1px;
    cursor: row-resize;
    background: var(--border);
  }
  /* Wider invisible grab area. */
  .handle::before {
    content: '';
    position: absolute;
  }
  .vertical::before {
    inset: 0 -4px;
  }
  .horizontal::before {
    inset: -4px 0;
  }
  .handle:hover,
  .handle:focus-visible,
  .dragging {
    background: var(--accent);
    outline: none;
  }
  .vertical:hover,
  .vertical:focus-visible,
  .vertical.dragging {
    box-shadow: 0 0 0 1px var(--accent);
  }
  .horizontal:hover,
  .horizontal:focus-visible,
  .horizontal.dragging {
    box-shadow: 0 0 0 1px var(--accent);
  }
</style>
