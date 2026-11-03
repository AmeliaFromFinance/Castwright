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

  interface Props {
    store: EditorStore;
    stage?: OverlayStage;
    vars: Record<string, unknown>;
    recent: readonly Event[];
    chat: readonly Event[];
    credits?: Credits | null;
    assetUrl: (path: string) => string;
    onedit?: (layerId: string) => void;
  }

  let { store, stage = $bindable(), vars, recent, chat, credits = null, assetUrl, onedit }: Props = $props();

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
    | { mode: 'move'; id: string; start: Box; px: number; py: number; moved: boolean }
    | { mode: 'resize'; id: string; handle: Handle; start: Box; px: number; py: number; moved: boolean };
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
  const selected = $derived(store.selected && onCanvas.some((l) => l.id === store.selectedId) ? store.selected : null);
  const hovered = $derived(hoverId && hoverId !== store.selectedId ? (onCanvas.find((l) => l.id === hoverId) ?? null) : null);

  function toModel(e: PointerEvent | MouseEvent): [number, number] {
    const r = frame!.getBoundingClientRect();
    return [(e.clientX - r.left) / z, (e.clientY - r.top) / z];
  }

  function boxOf(l: Layer): Box {
    return { x: l.x, y: l.y, w: l.w, h: l.h, rotation: l.rotation };
  }

  function targetsFor(id: string) {
    const others: Rect[] = onCanvas.filter((l) => l.id !== id).map((l) => bounds(boxOf(l)));
    return snapTargets({ width: W, height: H }, others);
  }

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
    const id = e.altKey ? cycleHit(hits, store.selectedId) : (hits[0] ?? null);
    store.select(id);
    if (!id) return;
    const l = store.layer(id);
    if (!l || l.locked) return;
    e.preventDefault();
    drag = { mode: 'move', id, start: boxOf(l), px: e.clientX, py: e.clientY, moved: false };
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
      const r = { ...drag.start, x: drag.start.x + dx, y: drag.start.y + dy };
      const s = snapMove(bounds(r), targetsFor(drag.id), threshold, snap);
      guides = s.guides;
      store.setRect(drag.id, { x: Math.round(r.x + s.dx), y: Math.round(r.y + s.dy) });
    } else {
      let r = resizeBox(drag.start, drag.handle, dx, dy, { keepAspect: e.shiftKey, min: 4 });
      let g: Guide[] = [];
      if (snap && !e.shiftKey && !drag.start.rotation) {
        const s = snapResize(r, drag.handle, targetsFor(drag.id), threshold);
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
    if (drag.moved) store.endGesture();
    drag = null;
    dragging = false;
    guides = [];
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
  const selBounds = $derived(selected ? bounds(boxOf(selected)) : null);
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
        alert={store.testAlert}
        widgetState={store.widgetState}
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
        aria-label="Overlay canvas. Click a layer to select it, drag to move, arrow keys to nudge."
        aria-roledescription="canvas"
        tabindex="0"
        style:cursor
        onpointerdown={down}
        onpointermove={move}
        onpointerup={up}
        onpointercancel={up}
        onpointerleave={() => !drag && (hoverId = null)}
        ondblclick={dblclick}
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
          {#if selBounds && (dragging || selBounds.w * z > 60)}
            <div class="size mono" style="left:{(selBounds.x + selBounds.w / 2) * z}px;top:{(selBounds.y + selBounds.h) * z + 8}px" aria-hidden="true">
              {#if dragging && drag?.mode === 'move'}{Math.round(selected.x)}, {Math.round(selected.y)}{:else}{Math.round(selected.w)} × {Math.round(selected.h)}{/if}
            </div>
          {/if}
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
