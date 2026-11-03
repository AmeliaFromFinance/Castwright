<script lang="ts">
  import { untrack } from 'svelte';
  import { fly } from 'svelte/transition';
  import type { LayerKind } from '$lib/bindings/LayerKind';
  import { getStageCtx } from '../context';
  import { formatTime, progressAt, progressFraction, trackKey, type Track } from '../music';
  import { prefersReducedMotion } from '../scenes';
  import { cssValue, DEFAULT_TEXT, itemVars } from '../styles';
  import StyledText from '../StyledText.svelte';

  interface Props {
    kind: Extract<LayerKind, { type: 'now_playing' }>;
    /** Null while hidden; the last one stays drawn during the exit animation. */
    track: Track | null;
    now: number;
  }

  let { kind, track, now }: Props = $props();
  const ctx = getStageCtx();

  let last = $state<Track | null>(null);
  $effect(() => {
    if (track) last = track;
  });
  const shown = $derived(track ?? last);

  // Sources report the position every few seconds; count on from when it arrived.
  let receivedAt = $state(Date.now());
  $effect(() => {
    void shown?.progressMs;
    void shown?.playing;
    untrack(() => (receivedAt = Date.now()));
  });

  const live = $derived(ctx.mode === 'live');
  const reduced = prefersReducedMotion();
  const style = $derived({ ...DEFAULT_TEXT, ...(kind.style ?? {}) });
  const small = $derived({ ...style, font_size: Math.max(10, Math.round(style.font_size * 0.72)), font_weight: Math.max(400, style.font_weight - 150) });
  const tiny = $derived({ ...small, font_size: Math.max(9, Math.round(style.font_size * 0.56)) });
  const bar = $derived(cssValue(kind.bar_color) || '#1db954');
  const trackBg = $derived(cssValue(kind.track_color) || 'rgba(255,255,255,0.18)');
  const barH = $derived(Math.max(3, Math.round(style.font_size * 0.2)));
  const progress = $derived(shown ? progressAt(shown, receivedAt, Math.max(now, receivedAt)) : 0);
  const pct = $derived(shown ? progressFraction(progress, shown.durationMs) * 100 : 0);
  const key = $derived(trackKey(shown));
  const art = $derived(shown?.artUrl ? ctx.assetUrl(shown.artUrl) : '');
  const layout = $derived(kind.layout ?? 'card');
  const enter = $derived(kind.animate && live && !reduced ? { y: 14, duration: 420, opacity: 0 } : { duration: 0 });
  const line = $derived(shown ? [shown.title, shown.artist].filter(Boolean).join(' · ') : '');

  let failed = $state('');
</script>

{#if shown}
  <div
    class="cw-np cw-np-{layout}"
    class:cw-np-playing={shown.playing}
    class:cw-np-paused={!shown.playing}
    class:cw-np-still={reduced}
    data-layout={layout}
    data-state={shown.playing ? 'playing' : 'paused'}
  >
    <div class="cw-np-item" style={itemVars(kind.item_card, kind.item_box, '', false) || undefined}>
      {#key key}
        <div class="cw-np-body" style="gap:{Math.round(style.font_size * 0.55)}px" in:fly={enter}>
          {#if kind.show_art}
            <div class="cw-np-art">
              {#if art && failed !== art}
                <img src={art} alt="" draggable="false" onerror={() => (failed = art)} />
              {:else}
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
              {/if}
            </div>
          {/if}
          <div class="cw-np-text">
            {#if layout === 'compact'}
              <div class="cw-np-line"><StyledText class="cw-np-title" text={line} {style} /></div>
            {:else}
              <div class="cw-np-line"><StyledText class="cw-np-title" text={shown.title} {style} /></div>
              {#if shown.artist}<div class="cw-np-line"><StyledText class="cw-np-artist" text={shown.artist} style={small} /></div>{/if}
              {#if kind.show_album && shown.album}<div class="cw-np-line"><StyledText class="cw-np-album" text={shown.album} style={tiny} /></div>{/if}
            {/if}
            {#if kind.show_progress && shown.durationMs > 0}
              <div class="cw-np-progress">
                <div class="cw-np-bar" style="height:{barH}px;background:{trackBg}">
                  <div class="cw-np-fill" class:cw-np-smooth={live && shown.playing} style="width:{pct}%;background:{bar}"></div>
                </div>
                {#if kind.show_times && layout !== 'compact'}
                  <div class="cw-np-times">
                    <StyledText class="cw-np-elapsed" text={formatTime(progress)} style={tiny} />
                    <StyledText class="cw-np-duration" text={formatTime(shown.durationMs)} style={tiny} />
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      {/key}
    </div>
  </div>
{/if}

<style>
  .cw-np {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .cw-np-item {
    box-sizing: border-box;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
  .cw-np-body {
    display: flex;
    align-items: center;
    height: 100%;
    min-width: 0;
  }
  .cw-np-art {
    flex: none;
    height: 100%;
    max-height: 100%;
    aspect-ratio: 1;
    border-radius: 8px;
    overflow: hidden;
    display: grid;
    place-items: center;
    background: linear-gradient(135deg, #2a3350, #5b3a6e);
    color: rgba(255, 255, 255, 0.75);
  }
  .cw-np-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .cw-np-art svg {
    width: 46%;
    height: 46%;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .cw-np-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
  }
  .cw-np-line {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .cw-np-line :global(.cw-text) {
    white-space: nowrap;
  }
  .cw-np-progress {
    margin-top: 6px;
  }
  .cw-np-bar {
    position: relative;
    width: 100%;
    border-radius: 999px;
    overflow: hidden;
  }
  .cw-np-fill {
    height: 100%;
    border-radius: inherit;
  }
  .cw-np-smooth {
    transition: width 1s linear;
  }
  .cw-np-times {
    display: flex;
    justify-content: space-between;
    margin-top: 3px;
    font-variant-numeric: tabular-nums;
  }
  .cw-np-compact .cw-np-art {
    border-radius: 6px;
  }
  .cw-np-compact .cw-np-progress {
    margin-top: 4px;
  }
  .cw-np-vinyl .cw-np-art {
    border-radius: 50%;
    position: relative;
    background: radial-gradient(circle, #222 0 18%, #0b0b0b 19% 100%);
    box-shadow: 0 0 0 3px #111, 0 6px 20px rgba(0, 0, 0, 0.45);
    animation: cw-np-spin 8s linear infinite;
    animation-play-state: paused;
  }
  .cw-np-vinyl .cw-np-art img {
    border-radius: 50%;
    -webkit-mask: radial-gradient(circle, transparent 0 7%, #000 7.5% 100%);
    mask: radial-gradient(circle, transparent 0 7%, #000 7.5% 100%);
  }
  .cw-np-vinyl .cw-np-art::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: repeating-radial-gradient(circle, rgba(255, 255, 255, 0.05) 0 1px, transparent 1px 4px);
    pointer-events: none;
  }
  .cw-np-vinyl.cw-np-playing .cw-np-art {
    animation-play-state: running;
  }
  .cw-np-vinyl.cw-np-still .cw-np-art {
    animation: none;
  }
  @keyframes cw-np-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .cw-np-vinyl .cw-np-art {
      animation: none;
    }
    .cw-np-smooth {
      transition: none;
    }
  }
</style>
