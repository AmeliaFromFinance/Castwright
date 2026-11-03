<script lang="ts">
  import type { ChatRules } from '$lib/bindings/ChatRules';
  import type { Credits } from '$lib/bindings/Credits';
  import type { Event } from '$lib/bindings/Event';
  import type { Layer } from '$lib/bindings/Layer';
  import type { Overlay } from '$lib/bindings/Overlay';
  import type { TimerRun } from '$lib/bindings/TimerRun';
  import { evaluateGroup } from '$lib/logic/condition';
  import type { Phase } from './anim';
  import { setStageCtx, type StageMode, type WidgetStoreFn } from './context';
  import type { OverlayFeed } from './feed';
  import { ensureFonts, fontsFor, resolveFont } from './fonts';
  import { DEFAULT_FONT_VAR, fontStack } from './styles';
  import LayerView from './LayerView.svelte';
  import { baseVisible, currentScene, sceneAllows } from './scenes';
  import type { ActiveAlert, WidgetState } from './state';

  interface Props {
    overlay: Overlay;
    vars?: Record<string, unknown>;
    /** Non-chat events, oldest first. */
    recent?: readonly Event[];
    /** Chat messages, oldest first. */
    chat?: readonly Event[];
    /** The app's chat rules, for chat layers that use them. */
    chatRules?: ChatRules | null;
    /** The project's default font, for text set to `Default`. */
    defaultFont?: string | null;
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
    /** OBS program scene for scene rules. Defaults to `obs.scene`; '' ignores the rules. */
    scene?: string;
    /** Clip layers to the stage bounds. */
    clip?: boolean;
    /** Live messages for custom widgets (event, chat deletes...). */
    feed?: OverlayFeed;
    /** A custom widget stored (or, with `undefined`, deleted) a value. */
    onWidgetStore?: WidgetStoreFn;
    /** Names for credits layers. */
    credits?: Credits | null;
    /** Times each credits layer was told to roll. */
    rolls?: Record<string, number>;
    /** A credits layer wants fresh names. */
    onLoadCredits?: () => void;
    /** Started, paused or reset timer layers, by layer id. */
    timers?: Record<string, TimerRun>;
  }

  let {
    overlay,
    vars = {},
    recent = [],
    chat = [],
    chatRules = null,
    defaultFont = null,
    alert = null,
    widgetState = {},
    visibility = {},
    assetUrl = (p: string) => p,
    mode = 'live',
    scale = 1,
    paused = false,
    muted = false,
    showHidden = false,
    scene,
    clip = true,
    feed,
    onWidgetStore,
    credits = null,
    rolls = {},
    onLoadCredits,
    timers = {}
  }: Props = $props();

  /** Rolls started here (editor), on top of the ones from the app. */
  let localRolls = $state<Record<string, number>>({});
  const allRolls = $derived.by(() => {
    const out: Record<string, number> = { ...rolls };
    for (const [id, n] of Object.entries(localRolls)) out[id] = (out[id] ?? 0) + n;
    return out;
  });

  // A layer shows when its own visibility (manual or automation) is on, its conditions
  // match, and its scene rule allows the current scene.
  function baseShown(l: Layer): boolean {
    return baseVisible(l, visibility) && evaluateGroup(l.visible_when, vars);
  }

  const layers = $derived(overlay?.layers ?? []);
  const sceneNow = $derived(scene ?? currentScene(vars));
  const baseMap = $derived(Object.fromEntries(layers.map((l) => [l.id, baseShown(l)])));
  const sceneMap = $derived(Object.fromEntries(layers.map((l) => [l.id, sceneAllows(l.scenes, sceneNow)])));
  const shownMap = $derived(Object.fromEntries(layers.map((l) => [l.id, !!baseMap[l.id] && !!sceneMap[l.id]])));
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
    get chatRules() {
      return chatRules;
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
    get credits() {
      return credits;
    },
    get rolls() {
      return allRolls;
    },
    get timers() {
      return timers;
    },
    loadCredits: () => onLoadCredits?.(),
    assetUrl: (p: string) => {
      try {
        return assetUrl(p);
      } catch {
        return '';
      }
    },
    storeWidgetValue: (layerId: string, key: string, value: unknown) => onWidgetStore?.(layerId, key, value)
  });

  const baseFont = $derived(resolveFont(null, defaultFont));
  const fontKey = $derived(
    JSON.stringify(
      fontsFor(overlay, alert ? [alert.play.title_style, alert.play.message_style] : [], baseFont).map((f) => [f.family, [...f.weights], f.italic])
    )
  );
  $effect(() => {
    void fontKey;
    try {
      ensureFonts(fontsFor(overlay, alert ? [alert.play.title_style, alert.play.message_style] : [], baseFont));
    } catch (err) {
      console.warn('[overlay] font loading failed', err);
    }
  });

  const views: Record<string, LayerView | undefined> = $state({});

  /** Editor: start a credits layer from the top. */
  export function rollCredits(layerId: string): void {
    localRolls = { ...localRolls, [layerId]: (localRolls[layerId] ?? 0) + 1 };
  }

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
    style="width:{width}px;height:{height}px;{DEFAULT_FONT_VAR}:{fontStack(baseFont)};{s !== 1 ? `transform:scale(${s});` : ''}"
  >
    {#each layers as layer (layer.id)}
      <LayerView
        bind:this={views[layer.id]}
        {layer}
        shown={shownMap[layer.id] ?? false}
        ghost={mode === 'editor' && (showHidden || (!!baseMap[layer.id] && !sceneMap[layer.id]))}
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
