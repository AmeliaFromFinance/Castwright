<script lang="ts">
  import { untrack } from 'svelte';
  import type { LayerKind } from '$lib/bindings/LayerKind';
  import { render } from '$lib/logic/template';
  import { twitchBadges } from '../chat';
  import { defaultNameColor, readableColor } from '../color';
  import { getStageCtx } from '../context';
  import ChatBadges from '../emotes/ChatBadges.svelte';
  import { paintStyle } from '../emotes/cosmetics';
  import { chatExtras } from '../emotes/store.svelte';
  import { reelOffset, spinMs, spinPhase, viewerEvent, type GiveawayView } from '../play';
  import { prefersReducedMotion } from '../scenes';
  import { cssValue, DEFAULT_TEXT, itemVars, textStyleCss } from '../styles';
  import StyledText from '../StyledText.svelte';

  interface Props {
    kind: Extract<LayerKind, { type: 'giveaway' }>;
    /** Null while hidden; the last one stays drawn during the exit animation. */
    view: GiveawayView | null;
    now: number;
  }

  let { kind, view, now }: Props = $props();
  const ctx = getStageCtx();

  let last = $state<GiveawayView | null>(null);
  $effect(() => {
    if (view) last = view;
  });
  const shown = $derived(view ?? last);

  const reduced = prefersReducedMotion();
  const live = $derived(ctx.mode === 'live');
  const style = $derived({ ...DEFAULT_TEXT, ...(kind.style ?? {}) });
  const small = $derived({ ...style, font_size: Math.max(10, Math.round(style.font_size * 0.62)), font_weight: Math.max(400, style.font_weight - 150) });
  const accent = $derived(cssValue(kind.accent_color) || '#f5c451');
  const rowH = $derived(Math.round(style.font_size * 1.6));
  const total = $derived(spinMs(kind.spin_s));
  const draw = $derived(shown?.draw ?? null);
  const phase = $derived(draw ? (!reduced ? spinPhase(draw, now, total) : 'landed') : null);
  const joinText = $derived(shown ? render(kind.open_text ?? '', { keyword: shown.keyword, entries: shown.entries, title: shown.title }).trim() : '');
  const entriesText = $derived(shown ? `${shown.entries.toLocaleString('en-US')} entered` : '');

  const winnerEvent = $derived(draw ? viewerEvent(draw.winner) : null);
  $effect(() => {
    const id = draw?.winner.id;
    if (id && (kind.seventv_paints || kind.show_badges)) chatExtras.wantCosmetics([id]);
  });
  const extra = $derived(draw && (kind.seventv_paints || kind.show_badges) ? chatExtras.cosmetics(draw.winner.id) : undefined);
  const paint = $derived(kind.seventv_paints ? (extra?.paint ?? null) : null);
  const nameColor = $derived(draw ? readableColor(draw.winner.color || defaultNameColor(draw.winner.login || draw.winner.name), false) : '');
  const nameCss = $derived.by(() => {
    const base = `${textStyleCss(style, 'inline')};color:${nameColor}`;
    const painted = paint ? paintStyle(paint, nameColor, style.font_size || 28) : '';
    return painted ? `${base};${painted}` : base;
  });
  const badgeSize = $derived(Math.round((style.font_size || 28) * 0.8));

  let strip = $state<HTMLDivElement>();
  let anim: Animation | null = null;
  // One spin per draw. Joining mid-spin (a reload) carries on from where it should be.
  $effect(() => {
    const el = strip;
    const d = draw;
    if (!el || !d || phase !== 'spinning') return;
    untrack(() => {
      anim?.cancel();
      const rows = d.names.length;
      const elapsed = Math.max(0, Date.now() - d.at);
      const from = reelOffset(rows, elapsed, total);
      const to = rows - 1;
      anim = el.animate([{ transform: `translateY(${-from * rowH}px)` }, { transform: `translateY(${-to * rowH}px)` }], {
        duration: Math.max(200, total - elapsed),
        easing: 'cubic-bezier(0.16, 0.9, 0.24, 1)',
        fill: 'forwards'
      });
    });
    return () => {
      anim?.cancel();
      anim = null;
    };
  });
</script>

{#if shown}
  <div class="cw-gw" data-status={shown.status} class:cw-gw-open={shown.status === 'open'} class:cw-gw-drawn={!!draw} class:cw-gw-still={reduced || !live}>
    <div class="cw-gw-card" style={itemVars(kind.item_card, kind.item_box, accent, false) || undefined}>
      <div class="cw-gw-head">
        <StyledText class="cw-gw-label" text="Giveaway" style={small} />
        {#if kind.show_entries}<StyledText class="cw-gw-entries" text={entriesText} style={small} />{/if}
      </div>
      <StyledText class="cw-gw-title" text={shown.title || 'Giveaway'} {style} block />
      {#if draw && phase}
        <div class="cw-gw-window" style="height:{rowH * (phase === 'spinning' ? 3 : 1)}px;--cw-accent:{accent}" data-phase={phase}>
          {#if phase === 'spinning'}
            <div class="cw-gw-reel">
              <div class="cw-gw-strip" bind:this={strip} style="padding-top:{rowH}px">
                {#each draw.names as n, i (i)}
                  <div class="cw-gw-name" style="height:{rowH}px;line-height:{rowH}px"><StyledText text={n} {style} /></div>
                {/each}
              </div>
            </div>
          {:else}
            {#key draw.seq}
              <div class="cw-gw-winner" class:cw-gw-fade={live} style="height:{rowH}px">
                {#if kind.show_badges && winnerEvent}<ChatBadges twitch={twitchBadges(winnerEvent)} seventv={extra?.badge ?? null} size={badgeSize} />{/if}<span
                  class="cw-gw-winner-name"
                  class:cw-paint={!!paint}
                  style={nameCss}>{draw.winner.name}</span
                >
              </div>
            {/key}
          {/if}
        </div>
      {:else if shown.status === 'open' && joinText}
        <StyledText class="cw-gw-join" text={joinText} style={small} block />
      {/if}
    </div>
  </div>
{/if}

<style>
  .cw-gw {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    overflow: hidden;
  }
  .cw-gw-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .cw-gw-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    opacity: 0.85;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-variant-numeric: tabular-nums;
  }
  .cw-gw-card :global(.cw-gw-title) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cw-gw-window {
    position: relative;
    margin-top: 4px;
    overflow: hidden;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.22);
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--cw-accent) 70%, transparent);
    transition: height 0.35s ease;
  }
  .cw-gw-still .cw-gw-window {
    transition: none;
  }
  .cw-gw-reel {
    position: absolute;
    inset: 0;
    mask-image: linear-gradient(transparent, #000 30%, #000 70%, transparent);
  }
  .cw-gw-reel::after {
    content: '';
    position: absolute;
    left: 6px;
    right: 6px;
    top: 33.4%;
    height: 33.3%;
    border-top: 2px solid var(--cw-accent);
    border-bottom: 2px solid var(--cw-accent);
    pointer-events: none;
  }
  .cw-gw-strip {
    will-change: transform;
  }
  .cw-gw-name {
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0 12px;
  }
  .cw-gw-winner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 0 12px;
    white-space: nowrap;
    overflow: hidden;
  }
  .cw-gw-winner-name {
    font-weight: 800;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cw-gw-fade {
    animation: cw-gw-in 0.6s ease both;
  }
  @keyframes cw-gw-in {
    from {
      opacity: 0;
      transform: scale(0.94);
    }
  }
  .cw-gw-still .cw-gw-fade {
    animation-name: cw-gw-fade-only;
  }
  @keyframes cw-gw-fade-only {
    from {
      opacity: 0;
    }
  }
</style>
