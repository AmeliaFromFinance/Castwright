<script lang="ts">
  import type { Credits } from '$lib/bindings/Credits';
  import type { Event } from '$lib/bindings/Event';
  import type { Layer } from '$lib/bindings/Layer';
  import { evaluateGroup } from '$lib/logic/condition';
  import OverlayStage from '$lib/overlay/OverlayStage.svelte';
  import { app } from '$lib/state/app.svelte';
  import { BellRing, Film, Image, Lock, Type } from '@lucide/svelte';
  import {
    HANDLES,
    bounds,
    cycleHit,
    handleCursor,
    hitTest,
    resizeBox,
    snapMove,
    snapResize,
    snapTargets,
    snapThreshold,
    type Box,
    type Guide,
    type Handle,
    type Rect
  } from './geometry';
  import type { EditorStore } from './store.svelte';
  import { unionRect } from './multi';

  interface Props {
    store: EditorStore;
    stage?: OverlayStage;
    vars: Record<string, unknown>;
    recent: readonly Event[];
    chat: readonly Event[];
    credits?: Credits | null;
    assetUrl: (path: string) => string;
    onedit?: (layerId: string) => void;
    /** Right-click on a layer. */
    onmenu?: (e: MouseEvent, layerId: string) => void;
  }

  let { store, stage = $bindable(), vars, recent, chat, credits = null, assetUrl, onedit, onmenu }: Props = $props();

  const PAD = 40;
  const ZOOM_MIN = 0.05;
  const ZOOM_MAX = 4;

  let viewport = $state<HTMLDivElement>();
  let frame = $state<HTMLDivElement>();
  let surface = $state<HTMLDivElement>();
  let vw = $state(0);
  let vh = $state(0);
  let hoverId = $state<string | null>(null);
  let guides = $state<Guide[]>([]);
  let dragging = $state(false);

  type Drag =
    | {
        mode: 'move';
        /** Start positions of every layer that moves. */
        starts: Map<string, { x: number; y: number }>;
        /** Their bounds at the start, used for snapping. */
        group: Rect;
        /** Clicked inside a selection of several: picks just this one if the mouse doesn't move. */
        only: string | null;
        /** Shift or Ctrl on a picked layer: takes it out instead, if the mouse doesn't move. */
        untoggle: boolean;
        px: number;
        py: number;
        moved: boolean;
      }
    | { mode: 'resize'; id: string; handle: Handle; start: Box; px: number; py: number; moved: boolean }
    | { mode: 'box'; x0: number; y0: number; x1: number; y1: number; base: string[]; px: number; py: number; moved: boolean };
  let drag = $state<Drag | null>(null);

  const W = $derived(store.doc.width);
  const H = $derived(store.doc.height);
  const fitZoom = $derived(vw > 0 && vh > 0 ? Math.max(ZOOM_MIN, Math.min((vw - PAD * 2) / W, (vh - PAD * 2) / H, 2)) : 0.4);
  const z = $derived(store.zoom);

  $effect(() => {
    if (store.fit) store.zoom = fitZoom;
  });

  const onCanvas = $derived(
    store.doc.layers.filter((l) => store.showHidden || (l.visible && evaluateGroup(l.visible_when, vars)))
  );
  const selected = $derived(!store.multi && store.selected && onCanvas.some((l) => l.id === store.selectedId) ? store.selected : null);
  const many = $derived(store.multi ? onCanvas.filter((l) => store.isSelected(l.id)) : []);
  const manyBounds = $derived(many.length ? unionRect(many) : null);
  const hovered = $derived(hoverId && !store.isSelected(hoverId) ? (onCanvas.find((l) => l.id === hoverId) ?? null) : null);
  const boxRect = $derived(
    drag?.mode === 'box' && drag.moved
      ? { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) }
      : null
  );

  function toModel(e: PointerEvent | MouseEvent): [number, number] {
    const r = frame!.getBoundingClientRect();
    return [(e.clientX - r.left) / z, (e.clientY - r.top) / z];
  }

  function boxOf(l: Layer): Box {
    return { x: l.x, y: l.y, w: l.w, h: l.h, rotation: l.rotation };
  }

  function targetsFor(ids: ReadonlySet<string>) {
    const others: Rect[] = onCanvas.filter((l) => !ids.has(l.id)).map((l) => bounds(boxOf(l)));
    return snapTargets({ width: W, height: H }, others);
  }

  const touches = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  function placeholder(l: Layer): { icon: typeof Type; text: string } | null {
    const k = l.kind;
    if (k.type === 'alerts' && !store.testAlert) return { icon: BellRing, text: 'Alerts play here' };
    if (k.type === 'image' && !k.src) return { icon: Image, text: 'Pick an image' };
    if (k.type === 'video' && !k.src) return { icon: Film, text: 'Pick a video' };
    if (k.type === 'text' && !k.text.trim()) return { icon: Type, text: 'Empty text' };
    return null;
  }

  function down(e: PointerEvent) {
    if (e.button !== 0 || !frame) return;
    surface?.focus({ preventScroll: true });
    const [mx, my] = toModel(e);
    const hits = hitTest(onCanvas, mx, my);
    const adding = e.shiftKey || e.ctrlKey || e.metaKey;
    e.preventDefault();
    if (!hits.length) {
      // Empty canvas: drag a box to pick layers.
      if (!adding) store.select(null);
      drag = { mode: 'box', x0: mx, y0: my, x1: mx, y1: my, base: adding ? store.selectedIds.slice() : [], px: e.clientX, py: e.clientY, moved: false };
      surface?.setPointerCapture(e.pointerId);
      return;
    }
    const id = (e.altKey ? cycleHit(hits, store.selectedId) : hits[0]) ?? hits[0]!;
    // Shift or Ctrl adds the layer; a click without moving on one already picked takes it out.
    // Ctrl also turns off snapping while dragging.
    const picked = store.isSelected(id);
    const keep = (adding || store.multi) && picked && !e.altKey;
    if (adding && !e.altKey) {
      if (!picked) store.toggleSelect(id);
    } else if (!keep) store.select(id);
    const movable = store.selection.filter((l) => !l.locked);
    if (!movable.length || store.layer(id)?.locked) {
      if (adding && picked && !e.altKey) store.toggleSelect(id);
      return;
    }
    drag = {
      mode: 'move',
      starts: new Map(movable.map((l) => [l.id, { x: l.x, y: l.y }])),
      group: unionRect(movable)!,
      only: keep ? id : null,
      untoggle: adding && picked && !e.altKey,
      px: e.clientX,
      py: e.clientY,
      moved: false
    };
    surface?.setPointerCapture(e.pointerId);
  }

  function handleDown(e: PointerEvent, handle: Handle) {
    if (e.button !== 0 || !selected || selected.locked) return;
    e.stopPropagation();
    e.preventDefault();
    surface?.focus({ preventScroll: true });
    drag = { mode: 'resize', id: selected.id, handle, start: boxOf(selected), px: e.clientX, py: e.clientY, moved: false };
    surface?.setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent) {
    if (!drag) {
      if (e.buttons === 0 && frame) {
        const [mx, my] = toModel(e);
        hoverId = hitTest(onCanvas, mx, my)[0] ?? null;
      }
      return;
    }
    const sx = e.clientX - drag.px;
    const sy = e.clientY - drag.py;
    if (drag.mode === 'box') {
      [drag.x1, drag.y1] = toModel(e);
      if (!drag.moved && Math.hypot(sx, sy) < 3) return;
      drag.moved = true;
      const r = { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) };
      const inside = onCanvas.filter((l) => touches(bounds(boxOf(l)), r)).map((l) => l.id);
      store.selectMany([...drag.base, ...inside]);
      return;
    }
    if (!drag.moved) {
      if (Math.hypot(sx, sy) < 3) return;
      drag.moved = true;
      dragging = true;
      store.beginGesture();
    }
    const dx = sx / z;
    const dy = sy / z;
    const snap = store.snapping && !(e.ctrlKey || e.metaKey);
    const threshold = snapThreshold(z);
    if (drag.mode === 'move') {
      const r = { ...drag.group, x: drag.group.x + dx, y: drag.group.y + dy };
      const s = snapMove(r, targetsFor(new Set(drag.starts.keys())), threshold, snap);
      guides = s.guides;
      store.moveGroup(drag.starts, dx + s.dx, dy + s.dy);
    } else {
      let r = resizeBox(drag.start, drag.handle, dx, dy, { keepAspect: e.shiftKey, min: 4 });
      let g: Guide[] = [];
      if (snap && !e.shiftKey && !drag.start.rotation) {
        const s = snapResize(r, drag.handle, targetsFor(new Set([drag.id])), threshold);
        r = s.rect;
        g = s.guides;
      }
      guides = g;
      store.setBox(drag.id, r);
    }
  }

  function up(e: PointerEvent) {
    if (surface?.hasPointerCapture(e.pointerId)) surface.releasePointerCapture(e.pointerId);
    if (!drag) return;
    if (drag.mode !== 'box' && drag.moved) store.endGesture();
    if (drag.mode === 'move' && !drag.moved && drag.only) {
      if (drag.untoggle) store.toggleSelect(drag.only);
      else store.select(drag.only);
    }
    drag = null;
    dragging = false;
    guides = [];
  }

  function contextmenu(e: MouseEvent) {
    const [mx, my] = toModel(e);
    const id = hitTest(onCanvas, mx, my)[0];
    if (!id) return;
    e.preventDefault();
    onmenu?.(e, id);
  }

  function dblclick(e: MouseEvent) {
    const [mx, my] = toModel(e);
    const id = hitTest(onCanvas, mx, my)[0];
    if (id) onedit?.(id);
  }

  export function setZoom(next: number) {
    store.fit = false;
    store.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  }

  // Ctrl/Cmd + wheel zooms; needs a non-passive listener.
  $effect(() => {
    const el = viewport;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoom(z * Math.exp(-e.deltaY * 0.0015));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const cursor = $derived(
    dragging ? (drag?.mode === 'resize' ? handleCursor(drag.handle, drag.start.rotation) : 'grabbing') : hoverId && !store.layer(hoverId)?.locked ? 'move' : 'default'
  );

  const rectStyle = (l: Layer) =>
    `left:${l.x * z}px;top:${l.y * z}px;width:${l.w * z}px;height:${l.h * z}px;` + (l.rotation ? `transform:rotate(${l.rotation}deg);` : '');
  const selBounds = $derived(selected ? bounds(boxOf(selected)) : manyBounds);
  const sizeText = $derived.by(() => {
    const b = selBounds;
    if (!b) return '';
    if (dragging && drag?.mode === 'move') return selected ? `${Math.round(selected.x)}, ${Math.round(selected.y)}` : `${Math.round(b.x)}, ${Math.round(b.y)}`;
    return selected ? `${Math.round(selected.w)} × ${Math.round(selected.h)}` : `${many.length} layers · ${Math.round(b.w)} × ${Math.round(b.h)}`;
  });
</script>

<div class="viewport" bind:this={viewport} bind:clientWidth={vw} bind:clientHeight={vh}>
  <div class="space" style="width:{Math.max(vw, W * z + PAD * 2)}px;height:{Math.max(vh, H * z + PAD * 2)}px">
    <div class="frame" bind:this={frame} style="width:{W * z}px;height:{H * z}px">
      <div class="checker" aria-hidden="true"></div>
      <OverlayStage
        bind:this={stage}
        overlay={store.doc}
        {vars}
        {recent}
        {chat}
        {credits}
        chatRules={app.project?.chat_rules ?? null}
        defaultFont={app.project?.default_font}
        alert={store.testAlert}
        widgetState={store.widgetState}
        timers={app.timers}
        {assetUrl}
        mode="editor"
        scale={z}
        paused={!store.animate}
        muted={!store.sound}
        showHidden={store.showHidden}
        scene={store.previewScene}
        feed={store.feed}
        onWidgetStore={(layerId, key, value) => {
          const cur = { ...(store.widgetState[layerId] ?? {}) };
          if (value === undefined) delete cur[key];
          else cur[key] = value;
          store.widgetState = { ...store.widgetState, [layerId]: cur };
        }}
      />
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        bind:this={surface}
        class="surface"
        role="application"
        aria-label="Overlay canvas. Click a layer to select it, Shift or Ctrl + click to pick several, drag on empty space to pick with a box, drag to move, arrow keys to nudge."
        aria-roledescription="canvas"
        tabindex="0"
        style:cursor
        onpointerdown={down}
        onpointermove={move}
        onpointerup={up}
        onpointercancel={up}
        onpointerleave={() => !drag && (hoverId = null)}
        ondblclick={dblclick}
        oncontextmenu={contextmenu}
      >
        {#each onCanvas as l (l.id)}
          {@const ph = placeholder(l)}
          {#if ph}
            <div class="ph" style={rectStyle(l)} aria-hidden="true">
              {#if l.w * z > 70 && l.h * z > 34}
                <span class="ph-label"><ph.icon size={14} />{ph.text}</span>
              {/if}
            </div>
          {/if}
        {/each}

        {#if store.safeArea}
          <div class="safe" aria-hidden="true">
            <span>Safe area</span>
          </div>
          <div class="cross x" aria-hidden="true"></div>
          <div class="cross y" aria-hidden="true"></div>
        {/if}

        {#if hovered && !dragging}
          <div class="hover" style={rectStyle(hovered)} aria-hidden="true"></div>
        {/if}

        {#if selected}
          <div class="sel" class:locked={selected.locked} style={rectStyle(selected)} data-selected={selected.id}>
            {#if selected.locked}
              <span class="lock" title="Locked"><Lock size={11} /></span>
            {:else}
              {#each HANDLES as h (h)}
                <div
                  class="handle h-{h}"
                  role="presentation"
                  data-handle={h}
                  style:cursor={handleCursor(h, selected.rotation)}
                  onpointerdown={(e) => handleDown(e, h)}
                ></div>
              {/each}
            {/if}
          </div>
        {/if}
        {#each many as l (l.id)}
          <div class="sel multi" class:locked={l.locked} style={rectStyle(l)} data-selected={l.id}></div>
        {/each}
        {#if manyBounds}
          <div class="group-box" style="left:{manyBounds.x * z}px;top:{manyBounds.y * z}px;width:{manyBounds.w * z}px;height:{manyBounds.h * z}px" aria-hidden="true"></div>
        {/if}
        {#if selBounds && (dragging || selBounds.w * z > 60)}
          <div class="size mono" style="left:{(selBounds.x + selBounds.w / 2) * z}px;top:{(selBounds.y + selBounds.h) * z + 8}px" aria-hidden="true">{sizeText}</div>
        {/if}
        {#if boxRect}
          <div class="marquee" style="left:{boxRect.x * z}px;top:{boxRect.y * z}px;width:{boxRect.w * z}px;height:{boxRect.h * z}px" aria-hidden="true"></div>
        {/if}

        {#each guides as g (g.axis + g.pos)}
          <div class="guide {g.axis}" style={g.axis === 'x' ? `left:${g.pos * z}px` : `top:${g.pos * z}px`} aria-hidden="true"></div>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .viewport {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    background:
      radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--text) 7%, transparent) 1px, transparent 0) 0 0 / 18px 18px,
      var(--bg-0);
  }
  .space {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .frame {
    position: relative;
    flex: none;
    box-shadow:
      0 0 0 1px var(--border-strong),
      0 18px 50px rgb(0 0 0 / 0.35);
  }
  .checker {
    position: absolute;
    inset: 0;
    background: repeating-conic-gradient(#2a2d34 0 25%, #22252b 0 50%) 0 0 / 20px 20px;
  }
  :global([data-base='light']) .checker {
    background: repeating-conic-gradient(#e6e8ec 0 25%, #f5f6f8 0 50%) 0 0 / 20px 20px;
  }
  .frame :global(.cw-stage-frame) {
    position: absolute;
    inset: 0;
  }
  .surface {
    position: absolute;
    inset: 0;
    outline: none;
    touch-action: none;
  }
  .surface:focus-visible {
    box-shadow: 0 0 0 2px var(--focus);
  }
  .ph {
    position: absolute;
    display: grid;
    place-items: center;
    border: 1.5px dashed color-mix(in srgb, var(--accent) 55%, transparent);
    border-radius: 6px;
    background: color-mix(in srgb, var(--accent) 7%, transparent);
    transform-origin: 50% 50%;
    pointer-events: none;
  }
  .ph-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 9px;
    border-radius: 999px;
    background: rgb(12 15 22 / 0.72);
    color: #e8ecf4;
    font-size: 11.5px;
    font-weight: 550;
    white-space: nowrap;
  }
  .hover {
    position: absolute;
    outline: 1px solid var(--accent);
    outline-offset: 0;
    transform-origin: 50% 50%;
    pointer-events: none;
  }
  .sel {
    position: absolute;
    outline: 1.5px solid var(--accent);
    transform-origin: 50% 50%;
    pointer-events: none;
  }
  .sel.multi {
    outline-width: 1px;
  }
  .group-box {
    position: absolute;
    outline: 1px dashed color-mix(in srgb, var(--accent) 70%, transparent);
    outline-offset: 3px;
    pointer-events: none;
  }
  .marquee {
    position: absolute;
    border: 1px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    pointer-events: none;
  }
  .sel.locked {
    outline-style: dashed;
    outline-color: var(--text-muted);
  }
  .lock {
    position: absolute;
    left: -1px;
    top: -20px;
    display: inline-flex;
    align-items: center;
    padding: 2px 4px;
    border-radius: 4px;
    background: var(--bg-3);
    color: var(--text-muted);
  }
  .handle {
    position: absolute;
    width: 9px;
    height: 9px;
    margin: -4.5px 0 0 -4.5px;
    border: 1.5px solid var(--accent);
    border-radius: 2px;
    background: #fff;
    pointer-events: auto;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.35);
  }
  .handle::after {
    content: '';
    position: absolute;
    inset: -6px;
  }
  .h-nw {
    left: 0;
    top: 0;
  }
  .h-n {
    left: 50%;
    top: 0;
  }
  .h-ne {
    left: 100%;
    top: 0;
  }
  .h-e {
    left: 100%;
    top: 50%;
  }
  .h-se {
    left: 100%;
    top: 100%;
  }
  .h-s {
    left: 50%;
    top: 100%;
  }
  .h-sw {
    left: 0;
    top: 100%;
  }
  .h-w {
    left: 0;
    top: 50%;
  }
  .size {
    position: absolute;
    transform: translateX(-50%);
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 10.5px;
    white-space: nowrap;
    pointer-events: none;
  }
  .guide {
    position: absolute;
    background: #ff4fbf;
    pointer-events: none;
  }
  .guide.x {
    top: 0;
    bottom: 0;
    width: 1px;
  }
  .guide.y {
    left: 0;
    right: 0;
    height: 1px;
  }
  .safe {
    position: absolute;
    inset: 5%;
    border: 1px dashed rgb(255 255 255 / 0.45);
    pointer-events: none;
  }
  .safe span {
    position: absolute;
    left: 6px;
    top: 4px;
    font-size: 10.5px;
    color: rgb(255 255 255 / 0.6);
  }
  .cross {
    position: absolute;
    background: rgb(255 255 255 / 0.3);
    pointer-events: none;
  }
  .cross.x {
    left: 50%;
    top: calc(50% - 12px);
    width: 1px;
    height: 24px;
  }
  .cross.y {
    top: 50%;
    left: calc(50% - 12px);
    height: 1px;
    width: 24px;
  }
</style>
