<script lang="ts">
  import type { LayerKind } from '$lib/bindings/LayerKind';
  import { getStageCtx } from '../context';
  import { statusText, totalText, type LiveInteract } from '../interact';
  import { alternator, cssValue, DEFAULT_TEXT, itemVars } from '../styles';
  import StyledText from '../StyledText.svelte';

  interface Props {
    kind: Extract<LayerKind, { type: 'poll' }>;
    /** Null while hidden; the last one stays drawn during the exit animation. */
    live: LiveInteract | null;
    now: number;
  }

  let { kind, live, now }: Props = $props();
  const ctx = getStageCtx();

  /** Twitch's prediction colours. */
  const OUTCOME = ['#387aff', '#f5009b'];

  let last = $state<LiveInteract | null>(null);
  $effect(() => {
    if (live) last = live;
  });
  const shown = $derived(live ?? last);

  const style = $derived({ ...DEFAULT_TEXT, ...(kind.style ?? {}) });
  const small = $derived({ ...style, font_size: Math.max(10, Math.round(style.font_size * 0.72)), font_weight: Math.max(400, style.font_weight - 100) });
  const bar = $derived(cssValue(kind.bar_color));
  const track = $derived(cssValue(kind.track_color) || 'rgba(255,255,255,0.14)');
  const barH = $derived(Math.max(6, Math.round(style.font_size * 0.4)));
  const flipOf = alternator();
  const animate = $derived(ctx.mode === 'live');

  function color(i: number): string {
    if (shown?.type === 'prediction' && !bar) return OUTCOME[Math.min(i, 1)]!;
    return bar || '#5b8def';
  }

  function amount(c: LiveInteract['choices'][number]): string {
    const n = c.amount.toLocaleString('en-US');
    return shown?.type === 'prediction' ? `${n} pts` : n;
  }
</script>

{#if shown}
  <div class="cw-poll" class:cw-open={shown.open} class:cw-ended={!shown.running} data-type={shown.type} data-status={shown.status}>
    {#if kind.show_title && shown.title}
      <div class="cw-poll-head"><StyledText class="cw-poll-title" text={shown.title} {style} block /></div>
    {/if}
    <div class="cw-poll-choices">
      {#each shown.choices as c, i (c.id)}
        <div
          class="cw-poll-choice"
          class:cw-winner={c.winner}
          class:cw-loser={!shown.running && shown.choices.some((x) => x.winner) && !c.winner}
          style="--cw-pct:{c.pct}%;{itemVars(kind.item_card, kind.item_box, color(i), flipOf(c.id))}"
          data-choice={c.id}
        >
          <div class="cw-poll-row">
            <StyledText class="cw-poll-label" text={c.title} {style} />
            <span class="cw-poll-nums">
              {#if kind.show_totals}<StyledText class="cw-poll-count" text={amount(c)} style={small} />{/if}
              <StyledText class="cw-poll-pct" text="{c.pct}%" {style} />
            </span>
          </div>
          <div class="cw-poll-track" style="height:{barH}px;background:{track}">
            <div class="cw-poll-fill" class:cw-anim={animate} style="width:{c.pct}%;background:{color(i)}"></div>
          </div>
        </div>
      {/each}
    </div>
    {#if kind.show_timer || kind.show_totals}
      <div class="cw-poll-foot">
        {#if kind.show_timer}<StyledText class="cw-poll-timer" text={statusText(shown, now)} style={small} />{/if}
        {#if kind.show_totals}<StyledText class="cw-poll-total" text={totalText(shown)} style={small} />{/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .cw-poll {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow: hidden;
  }
  .cw-poll-choices {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .cw-poll-choice {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    transition: opacity 0.4s ease;
  }
  .cw-loser {
    opacity: 0.55;
  }
  .cw-poll-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;
  }
  .cw-poll-row :global(.cw-poll-label) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cw-poll-nums {
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    flex: none;
    font-variant-numeric: tabular-nums;
  }
  .cw-poll-track {
    position: relative;
    width: 100%;
    border-radius: 999px;
    overflow: hidden;
  }
  .cw-poll-fill {
    height: 100%;
    border-radius: inherit;
  }
  .cw-poll-fill.cw-anim {
    transition: width 0.8s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .cw-winner .cw-poll-fill {
    filter: brightness(1.15);
  }
  .cw-poll-foot {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-top: auto;
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
  }
</style>
