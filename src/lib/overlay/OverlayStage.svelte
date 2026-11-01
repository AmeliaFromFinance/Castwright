<script lang="ts">
  import type { Event } from '$lib/bindings/Event';
  import type { Layer } from '$lib/bindings/Layer';
  import type { Overlay } from '$lib/bindings/Overlay';
  import { evaluateGroup } from '$lib/logic/condition';
  import type { Phase } from './anim';
  import { setStageCtx, type StageMode, type WidgetStoreFn } from './context';
  import type { OverlayFeed } from './feed';
  import { ensureFonts, fontsFor } from './fonts';
  import LayerView from './LayerView.svelte';
  import type { ActiveAlert, WidgetState } from './state';

  interface Props {
    overlay: Overlay;
    vars?: Record<string, unknown>;
    /** Non-chat events, oldest first. */
    recent?: readonly Event[];
    /** Chat messages, oldest first. */
    chat?: readonly Event[];
    alert?: ActiveAlert | null;
    widgetState?: WidgetState;
    /** Per-layer visibility overrides (from `layer_visible`). */
    visibility?: Record<string, boolean>;
    /** Turns an asset path into a loadable URL. */
    assetUrl?: (path: string) => string;
    mode?: StageMode;
    /** Display scale; the stage keeps its native size inside. */
    scale?: number;
    /** Freeze idle loops, tickers and videos (editor). */
    paused?: boolean;
    /** No sound or speech at all. */
    muted?: boolean;
    /** Editor: keep hidden layers on the canvas, faded. */
    showHidden?: boolean;
    /** Clip layers to the stage bounds. */
    clip?: boolean;
    /** Live messages for custom widgets (event, chat deletes...). */
    feed?: OverlayFeed;
    /** A custom widget stored (or, with `undefined`, deleted) a value. */
    onWidgetStore?: WidgetStoreFn;
  }

  let {
    overlay,
    vars = {},
    recent = [],
    chat = [],
    alert = null,
    widgetState = {},
    visibility = {},
    assetUrl = (p: string) => p,
    mode = 'live',
    scale = 1,
    paused = false,
    muted = false,
    showHidden = false,
    clip = true,
    feed,
    onWidgetStore
  }: Props = $props();

  function isShown(l: Layer): boolean {
    const base = Object.prototype.hasOwnProperty.call(visibility, l.id) ? visibility[l.id] : l.visible;
    return !!base && evaluateGroup(l.visible_when, vars);
  }

  const layers = $derived(overlay?.layers ?? []);
  const shownMap = $derived(Object.fromEntries(layers.map((l) => [l.id, isShown(l)])));
  const audioLayerId = $derived(layers.find((l) => l.kind.type === 'alerts' && shownMap[l.id])?.id ?? null);
  const width = $derived(Math.max(1, overlay?.width || 1920));
  const height = $derived(Math.max(1, overlay?.height || 1080));
  const s = $derived(Number.isFinite(scale) && scale > 0 ? scale : 1);

  setStageCtx({
    get vars() {
      return vars;
    },
    get recent() {
      return recent;
    },
    get chat() {
      return chat;
    },
    get alert() {
      return alert;
    },
    get widgetState() {
      return widgetState;
    },
    get mode() {
      return mode;
    },
    get paused() {
      return paused;
    },
    get muted() {
      return muted;
    },
    get feed() {
      return feed;
    },
    get audioLayerId() {
      return audioLayerId;
    },
    assetUrl: (p: string) => {
      try {
        return assetUrl(p);
      } catch {
        return '';
      }
    },
    storeWidgetValue: (layerId: string, key: string, value: unknown) => onWidgetStore?.(layerId, key, value)
  });

  const fontKey = $derived(
    JSON.stringify(
      fontsFor(overlay, alert ? [alert.play.title_style, alert.play.message_style] : []).map((f) => [f.family, [...f.weights], f.italic])
    )
  );
  $effect(() => {
    void fontKey;
    try {
      ensureFonts(fontsFor(overlay, alert ? [alert.play.title_style, alert.play.message_style] : []));
    } catch (err) {
      console.warn('[overlay] font loading failed', err);
    }
  });

  const views: Record<string, LayerView | undefined> = $state({});

  /** Editor: play a layer's enter or exit animation. */
  export function preview(layerId: string, phase: Phase): void {
    views[layerId]?.preview(phase);
  }
</script>

<div class="cw-stage-frame" class:cw-clip={clip} style="width:{width * s}px;height:{height * s}px">
  <div
    class="cw-stage"
    class:cw-clip={clip}
    class:cw-editor={mode === 'editor'}
    data-overlay-id={overlay?.id}
    style="width:{width}px;height:{height}px;{s !== 1 ? `transform:scale(${s});` : ''}"
  >
    {#each layers as layer (layer.id)}
      <LayerView
        bind:this={views[layer.id]}
        {layer}
        shown={shownMap[layer.id] ?? false}
        ghost={mode === 'editor' && showHidden}
      />
    {/each}
  </div>
</div>

<style>
  .cw-stage-frame {
    position: relative;
  }
  .cw-stage {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    background: transparent;
    isolation: isolate;
  }
  .cw-clip {
    overflow: hidden;
  }
</style>
