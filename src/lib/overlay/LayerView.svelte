<script lang="ts">
  import { tick, untrack } from 'svelte';
  import type { Layer } from '$lib/bindings/Layer';
  import { animSpec, hasAnimation, play, type Phase } from './anim';
  import { getStageCtx } from './context';
  import { hasSceneRule, prefersReducedMotion, sceneAnimation } from './scenes';
  import { boxInset, fillColorOf, layerFrameCss, scopeClass, scopeCss } from './styles';
  import AlertsLayer from './layers/AlertsLayer.svelte';
  import ChatLayer from './layers/ChatLayer.svelte';
  import CounterLayer from './layers/CounterLayer.svelte';
  import CustomLayer from './layers/CustomLayer.svelte';
  import EventListLayer from './layers/EventListLayer.svelte';
  import PollLayer from './layers/PollLayer.svelte';
  import CreditsLayer from './layers/CreditsLayer.svelte';
  import AdBreakLayer from './layers/AdBreakLayer.svelte';
  import NowPlayingLayer from './layers/NowPlayingLayer.svelte';
  import { npVisible, SAMPLE_TRACK, trackFromVars } from './music';
  import { adPhase, sampleAdPhase, scheduleFromVars } from './ads';
  import { adPreview } from './ad-preview.svelte';
  import { clock, useClock } from './clock.svelte';
  import { layerLive, samplePoll } from './interact';
  import GoalLayer from './layers/GoalLayer.svelte';
  import ImageLayer from './layers/ImageLayer.svelte';
  import ShapeLayer from './layers/ShapeLayer.svelte';
  import TextLayer from './layers/TextLayer.svelte';
  import TimerLayer from './layers/TimerLayer.svelte';
  import VideoLayer from './layers/VideoLayer.svelte';

  interface Props {
    layer: Layer;
    /** Visible according to `visible`, overrides and `visible_when`. */
    shown: boolean;
    /** Editor only: draw hidden layers faded instead of removing them. */
    ghost?: boolean;
  }
  let { layer, shown, ghost = false }: Props = $props();
  const ctx = getStageCtx();

  const kind = $derived(layer.kind);
  const isPoll = $derived(kind.type === 'poll');
  const isAd = $derived(kind.type === 'ad_break');
  const isNp = $derived(kind.type === 'now_playing');
  $effect(() => {
    if (isPoll || isAd || isNp) return useClock();
  });
  // Poll layers hide themselves while nothing runs; the editor shows a sample instead.
  const pollLive = $derived(
    kind.type === 'poll' ? (layerLive(ctx.recent, kind.show, kind.result_s, clock.now) ?? (ctx.mode === 'editor' ? samplePoll(clock.now) : null)) : null
  );
  // Ad break layers show only before and during an ad, and only for a phase with text.
  const adNow = $derived.by(() => {
    if (kind.type !== 'ad_break') return null;
    const p = ctx.mode === 'editor' ? sampleAdPhase(adPreview.phase, clock.now, kind.soon_s) : adPhase(scheduleFromVars(ctx.vars), clock.now, kind.soon_s);
    if (!p) return null;
    return (p.phase === 'running' ? kind.running_text : kind.soon_text).trim() ? p : null;
  });
  // Now playing layers can hide while nothing plays; the editor shows a sample song then.
  const npTrack = $derived(kind.type === 'now_playing' ? (trackFromVars(ctx.vars) ?? (ctx.mode === 'editor' ? SAMPLE_TRACK : null)) : null);
  let pausedSince = $state<number | null>(null);
  $effect(() => {
    const playing = !!npTrack?.playing;
    untrack(() => {
      if (playing) pausedSince = null;
      else if (pausedSince === null) pausedSince = Date.now();
    });
  });
  const npShown = $derived(
    kind.type === 'now_playing' ? npVisible(npTrack, kind.only_playing && ctx.mode !== 'editor', pausedSince, kind.hide_after_s, clock.now) : false
  );
  const present = $derived((shown && (!isPoll || !!pollLive) && (!isAd || !!adNow) && (!isNp || npShown)) || ghost);
  let rendered = $state(untrack(() => present));
  let animEl = $state<HTMLDivElement>();
  let idleEl = $state<HTMLDivElement>();
  let current: Animation | null = null;
  let exiting = false;
  let first = true;
  let seq = 0;

  const scope = $derived(scopeClass(layer.id));
  const inset = $derived(boxInset(layer.box_style));
  const innerW = $derived(Math.max(0, layer.w - inset.x * 2));
  const innerH = $derived(Math.max(0, layer.h - inset.y * 2));
  const opacity = $derived(Math.min(1, Math.max(0, Number.isFinite(layer.opacity) ? layer.opacity : 1)) * (ghost && !shown ? 0.35 : 1));
  const outerCss = $derived(
    `left:${layer.x}px;top:${layer.y}px;width:${Math.max(0, layer.w)}px;height:${Math.max(0, layer.h)}px;` +
      `opacity:${opacity};` +
      (layer.rotation ? `transform:rotate(${layer.rotation}deg);` : '')
  );
  // Box and card styles go in a <style> next to the layer so they can draw pseudo-elements.
  const frame = $derived(layerFrameCss(layer, scope));
  const idleKey = $derived(JSON.stringify(layer.idle));
  const scoped = $derived(scopeCss(layer.css ?? '', scope));

  /** Layers with a scene rule fall back to the rule's transition and respect reduced motion. */
  function animOf(phase: 'enter' | 'exit') {
    if (hasSceneRule(layer.scenes)) return sceneAnimation(layer, phase, prefersReducedMotion());
    return phase === 'enter' ? layer.enter : layer.exit;
  }

  function runPhase(phase: 'enter' | 'exit'): Promise<void> {
    const el = animEl;
    if (!el) return Promise.resolve();
    current?.cancel();
    const r = play(el, animSpec(animOf(phase), phase, layer.w, layer.h));
    current = r.anim;
    return r.done.then(() => {
      // Entrances end at the resting state, so drop them rather than keep a filled effect.
      if (phase === 'enter' && current === r.anim) {
        r.anim?.cancel();
        current = null;
      }
    });
  }

  $effect(() => {
    const p = present;
    const live = ctx.mode === 'live';
    untrack(() => {
      const my = ++seq;
      if (p) {
        const wasGone = !rendered || exiting;
        exiting = false;
        rendered = true;
        if (live && (first || wasGone) && hasAnimation(animOf('enter'))) {
          void tick().then(() => {
            if (my === seq) void runPhase('enter');
          });
        } else if (!live) {
          current?.cancel();
          current = null;
        }
      } else if (rendered) {
        if (live && !first && animEl && hasAnimation(animOf('exit'))) {
          exiting = true;
          void runPhase('exit').then(() => {
            if (my === seq) {
              rendered = false;
              exiting = false;
              current?.cancel();
              current = null;
            }
          });
        } else {
          rendered = false;
        }
      }
      first = false;
    });
  });

  // Idle loop on an inner element so it never fights the enter/exit transform.
  $effect(() => {
    void idleKey;
    const el = idleEl;
    const paused = ctx.paused;
    if (!el) return;
    const spec = untrack(() => animSpec(layer.idle, 'idle', layer.w, layer.h));
    const r = play(el, spec);
    if (paused) r.anim?.pause();
    return () => r.anim?.cancel();
  });

  // Custom CSS lives in <head> so it can't be broken up by the layer's markup.
  $effect(() => {
    const css = scoped;
    if (!css) return;
    const el = document.createElement('style');
    el.dataset.cwLayer = layer.id;
    el.textContent = css;
    document.head.appendChild(el);
    return () => el.remove();
  });

  /** Editor: play the layer's enter or exit animation once, then return to rest. */
  export function preview(phase: Phase): void {
    if (phase === 'idle') return;
    const my = ++seq;
    rendered = true;
    void tick().then(async () => {
      await runPhase(phase);
      if (phase === 'exit') await new Promise((r) => setTimeout(r, 250));
      if (my !== seq) return;
      current?.cancel();
      current = null;
      if (!present) rendered = false;
    });
  }
</script>

{#if rendered}
  <div
    class="cw-layer cw-type-{kind.type}"
    class:cw-ghost={ghost && !shown}
    data-layer-id={layer.id}
    data-layer-type={kind.type}
    style={outerCss}
  >
    {#if frame}{@html `<style data-cw-frame="${scope}">${frame}</style>`}{/if}
    <div class="cw-anim" bind:this={animEl}>
      <div class="cw-idle" bind:this={idleEl}>
        <div class="cw-box {scope}">
          {#if kind.type === 'text'}
            <TextLayer {kind} />
          {:else if kind.type === 'shape'}
            <ShapeLayer {kind} width={innerW} height={innerH} radius={layer.box_style?.radius ?? 0} />
          {:else if kind.type === 'image'}
            <ImageLayer {kind} />
          {:else if kind.type === 'video'}
            <VideoLayer {kind} />
          {:else if kind.type === 'alerts'}
            <AlertsLayer layerId={layer.id} width={innerW} height={innerH} />
          {:else if kind.type === 'chat'}
            <ChatLayer {kind} layerBackground={fillColorOf(layer.box_style)} />
          {:else if kind.type === 'goal'}
            <GoalLayer {kind} />
          {:else if kind.type === 'counter'}
            <CounterLayer {kind} />
          {:else if kind.type === 'timer'}
            <TimerLayer {kind} />
          {:else if kind.type === 'event_list'}
            <EventListLayer {kind} />
          {:else if kind.type === 'poll'}
            <PollLayer {kind} live={pollLive} now={clock.now} />
          {:else if kind.type === 'credits'}
            <CreditsLayer {kind} layerId={layer.id} />
          {:else if kind.type === 'ad_break'}
            <AdBreakLayer {kind} phase={adNow} />
          {:else if kind.type === 'now_playing'}
            <NowPlayingLayer {kind} track={npShown ? npTrack : null} now={clock.now} />
          {:else if kind.type === 'custom'}
            <CustomLayer layerId={layer.id} {kind} />
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .cw-layer {
    position: absolute;
    box-sizing: border-box;
    transform-origin: 50% 50%;
  }
  .cw-anim,
  .cw-idle {
    width: 100%;
    height: 100%;
    transform-origin: 50% 50%;
  }
  .cw-box {
    position: relative;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
  }
  .cw-ghost {
    filter: grayscale(0.4);
  }
</style>
