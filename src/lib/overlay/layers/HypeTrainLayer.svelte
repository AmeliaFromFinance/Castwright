<script lang="ts">
  import { untrack } from 'svelte';
  import type { LayerKind } from '$lib/bindings/LayerKind';
  import { countdown } from '../ads';
  import { getStageCtx } from '../context';
  import { endText, hypeFraction, isLevelUp, secondsLeft, trainLabel, type HypePhase } from '../hype';
  import { hypePreview } from '../hype-preview.svelte';
  import { prefersReducedMotion } from '../scenes';
  import { cssValue, DEFAULT_TEXT, itemVars } from '../styles';
  import StyledText from '../StyledText.svelte';

  interface Props {
    kind: Extract<LayerKind, { type: 'hype_train' }>;
    /** Null while hidden; the last one stays drawn during the exit animation. */
    phase: HypePhase | null;
    now: number;
  }

  let { kind, phase, now }: Props = $props();
  const ctx = getStageCtx();

  let last = $state<HypePhase | null>(null);
  $effect(() => {
    if (phase) last = phase;
  });
  const shown = $derived(phase ?? last);
  const train = $derived(shown?.train ?? null);
  const running = $derived(shown?.phase === 'running');

  const CELEBRATE_MS = 2600;
  let prevLevel: number | null = null;
  let celebrating = $state(0);
  let showLevelUp = $state(false);
  let celebrateTimer: ReturnType<typeof setTimeout> | null = null;
  function celebrate() {
    celebrating++;
    showLevelUp = true;
    if (celebrateTimer) clearTimeout(celebrateTimer);
    celebrateTimer = setTimeout(() => (showLevelUp = false), CELEBRATE_MS);
  }
  $effect(() => {
    const level = running ? (train?.level ?? null) : null;
    untrack(() => {
      if (level !== null && kind.celebrate && isLevelUp(prevLevel, level)) celebrate();
      prevLevel = level;
    });
  });
  // "Show level up" in the editor, also while a real train runs.
  let seenBumps = hypePreview.bumps;
  $effect(() => {
    const bumps = hypePreview.bumps;
    untrack(() => {
      if (bumps !== seenBumps && ctx.mode === 'editor' && running && kind.celebrate && !showLevelUp) celebrate();
      seenBumps = bumps;
    });
  });
  $effect(() => () => {
    if (celebrateTimer) clearTimeout(celebrateTimer);
  });

  const reduced = prefersReducedMotion();
  const live = $derived(ctx.mode === 'live');
  const layout = $derived(kind.layout ?? 'card');
  const style = $derived({ ...DEFAULT_TEXT, ...(kind.style ?? {}) });
  const small = $derived({ ...style, font_size: Math.max(10, Math.round(style.font_size * 0.66)), font_weight: Math.max(400, style.font_weight - 150) });
  const bar = $derived(cssValue(kind.bar_color) || '#9147ff');
  const trackBg = $derived(cssValue(kind.track_color) || 'rgba(255,255,255,0.16)');
  const barH = $derived(layout === 'bar' ? Math.max(4, Math.round(style.font_size * 0.36)) : Math.max(6, Math.round(style.font_size * 0.42)));
  const pct = $derived(train ? Math.round(hypeFraction(train.progress, train.goal) * 100) : 0);
  const left = $derived(train ? secondsLeft(train.endsAt, now) : 0);
  const n = (v: number) => Math.round(v).toLocaleString('en-US');
  const label = $derived(train ? trainLabel(train) : '');
  const top = $derived.by(() => {
    if (!train || !kind.show_top) return [];
    if (layout === 'bar') {
      const names = [train.topBits?.name, train.topSub?.name].filter((x): x is string => !!x);
      return names.length ? [`Top: ${[...new Set(names)].join(', ')}`] : [];
    }
    return [train.topBits && `Top bits: ${train.topBits.name} · ${n(train.topBits.total)}`, train.topSub && `Top sub: ${train.topSub.name}`].filter((x): x is string => !!x);
  });
</script>

{#snippet track()}
  <div class="cw-hype-track" style="height:{barH}px;background:{trackBg}">
    <div class="cw-hype-fill" class:cw-hype-smooth={live && !reduced} style="width:{pct}%;background:{bar}"></div>
  </div>
{/snippet}

{#snippet foot()}
  {#if train && (kind.show_total || top.length > 0)}
    <div class="cw-hype-foot">
      {#if kind.show_total}<StyledText class="cw-hype-total" text="Total {n(train.total)}" style={small} />{/if}
      {#if top.length}
        <span class="cw-hype-top">
          {#each top as t (t)}<StyledText class="cw-hype-top-item" text={t} style={small} />{/each}
        </span>
      {/if}
    </div>
  {/if}
{/snippet}

{#if shown && train}
  <div
    class="cw-hype cw-hype-{layout}"
    class:cw-hype-running={running}
    class:cw-hype-ended={!running}
    class:cw-hype-golden={train.type === 'golden_kappa'}
    class:cw-hype-treasure={train.type === 'treasure'}
    class:cw-hype-shared={train.shared}
    class:cw-hype-levelling={showLevelUp}
    class:cw-hype-still={reduced}
    data-layout={layout}
    data-type={train.type}
    data-level={train.level}
    style="--cw-hype-color:{bar};--cw-pct:{pct}%;font-size:{style.font_size}px"
  >
    <div class="cw-hype-item" style={itemVars(kind.item_card, kind.item_box, '', false) || undefined}>
      {#if !running}
        <StyledText class="cw-hype-end" text={endText(kind.end_text, train)} {style} block />
      {:else}
        <div class="cw-hype-head">
          <span class="cw-hype-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="14" rx="3" /><path d="M5 10h14M8 17l-2 4M16 17l2 4" /><circle cx="9" cy="13.5" r=".7" /><circle cx="15" cy="13.5" r=".7" /></svg>
          </span>
          {#if layout === 'card'}
            <span class="cw-hype-titles">
              <StyledText class="cw-hype-title" text={label} style={small} />
              <StyledText class="cw-hype-level" text="Level {train.level}" {style} />
            </span>
          {:else}
            <StyledText class="cw-hype-level" text="Lv {train.level}" {style} />
            {@render track()}
          {/if}
          <span class="cw-hype-nums">
            <StyledText class="cw-hype-pct" text="{pct}%" style={layout === 'bar' ? style : small} />
            {#if kind.show_timer && train.endsAt > 0}<StyledText class="cw-hype-timer" text={countdown(left)} {style} />{/if}
          </span>
          {#if layout === 'bar'}{@render foot()}{/if}
        </div>
        {#if layout === 'card'}
          {@render track()}
          {@render foot()}
        {/if}
        {#if showLevelUp}
          {#key celebrating}
            <div class="cw-hype-levelup" role="status"><StyledText class="cw-hype-levelup-text" text="Level up!" {style} /></div>
          {/key}
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .cw-hype {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .cw-hype-item {
    position: relative;
    box-sizing: border-box;
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.4em;
  }
  .cw-hype-card .cw-hype-item {
    height: 100%;
  }
  .cw-hype-head {
    display: flex;
    align-items: center;
    gap: 0.6em;
    min-width: 0;
  }
  .cw-hype-icon {
    flex: none;
    width: 1.6em;
    height: 1.6em;
    display: grid;
    place-items: center;
    border-radius: 0.45em;
    background: var(--cw-hype-color);
    color: #fff;
  }
  .cw-hype-bar .cw-hype-icon {
    width: 1.25em;
    height: 1.25em;
  }
  .cw-hype-bar .cw-hype-head > :global(*),
  .cw-hype-bar .cw-hype-nums,
  .cw-hype-bar .cw-hype-foot {
    flex: none;
  }
  .cw-hype-bar .cw-hype-head > .cw-hype-track {
    flex: 1;
    min-width: 3em;
  }
  .cw-hype-bar :global(.cw-text) {
    white-space: nowrap;
  }
  .cw-hype-icon svg {
    width: 72%;
    height: 72%;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .cw-hype-titles {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
    line-height: 1.15;
  }
  .cw-hype-nums {
    display: flex;
    align-items: baseline;
    gap: 0.6em;
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .cw-hype-track {
    position: relative;
    width: 100%;
    border-radius: 999px;
    overflow: hidden;
  }
  .cw-hype-head .cw-hype-track {
    flex: 1;
    min-width: 40px;
  }
  .cw-hype-fill {
    height: 100%;
    border-radius: inherit;
  }
  .cw-hype-smooth {
    transition: width 0.8s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .cw-hype-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.3em 1em;
    min-width: 0;
  }
  .cw-hype-top {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3em 1em;
    margin-left: auto;
  }
  .cw-hype-bar .cw-hype-foot {
    flex-wrap: nowrap;
  }
  .cw-hype-golden .cw-hype-fill {
    background: linear-gradient(90deg, #f5b800, #ffe27a, #f5b800) !important;
  }
  .cw-hype-treasure .cw-hype-fill {
    background: linear-gradient(90deg, #0fb5a6, #6ef0c8) !important;
  }
  .cw-hype-levelup {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    pointer-events: none;
    border-radius: inherit;
    background: color-mix(in srgb, var(--cw-hype-color) 82%, transparent);
    animation: cw-hype-pop 2.6s ease both;
  }
  .cw-hype-levelling .cw-hype-fill {
    animation: cw-hype-flash 0.6s ease 3;
  }
  .cw-hype-still .cw-hype-levelup,
  .cw-hype-still.cw-hype-levelling .cw-hype-fill {
    animation: none;
  }
  @keyframes cw-hype-pop {
    0% {
      opacity: 0;
      transform: scale(0.6);
    }
    12% {
      opacity: 1;
      transform: scale(1.06);
    }
    20% {
      transform: scale(1);
    }
    85% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
  @keyframes cw-hype-flash {
    50% {
      filter: brightness(1.8);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .cw-hype-levelup,
    .cw-hype-levelling .cw-hype-fill {
      animation: none;
    }
    .cw-hype-smooth {
      transition: none;
    }
  }
</style>
