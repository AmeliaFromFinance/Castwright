<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fade, fly } from 'svelte/transition';
  import type { Event } from '$lib/bindings/Event';
  import type { LayerKind } from '$lib/bindings/LayerKind';
  import { render } from '$lib/logic/template';
  import { getStageCtx } from '../context';
  import { ALERTABLE_KINDS, eventContext } from '../labels';
  import { enterY, newEdge, ordered, tickerCopies, tickerX } from '../order';
  import { alternator, DEFAULT_TEXT, itemVars } from '../styles';
  import StyledText from '../StyledText.svelte';

  let { kind }: { kind: Extract<LayerKind, { type: 'event_list' }> } = $props();
  const ctx = getStageCtx();

  /** Ticker speed in px per second. */
  const SPEED = 60;

  const kinds = $derived(new Set<string>(kind.kinds?.length ? kind.kinds : ALERTABLE_KINDS));
  const format = $derived(kind.item_format?.trim() ? kind.item_format : '{{name}} · {{label}}');
  const items = $derived.by(() => {
    const max = Math.max(1, kind.max_items || 5);
    const out: { id: string; text: string; vars: string }[] = [];
    const recent: readonly Event[] = ctx.recent;
    for (let i = recent.length - 1; i >= 0 && out.length < max; i--) {
      const e = recent[i];
      if (!e || !kinds.has(e.kind)) continue;
      const text = render(format, eventContext(e)).trim();
      const color = typeof e.data?.color === 'string' ? e.data.color : '';
      if (text) out.push({ id: e.id, text, vars: itemVars(kind.item_card, kind.item_box, color, flipOf(e.id)) });
    }
    return out;
  });
  const flipOf = alternator();
  const style = $derived({ ...DEFAULT_TEXT, ...(kind.style ?? {}) });
  const live = $derived(ctx.mode === 'live');

  // Ticker: one copy of the items is measured; enough copies are drawn to fill the
  // width, and the strip moves left by exactly one copy before wrapping, so the loop is seamless.
  let viewport = $state<HTMLDivElement>();
  let firstCopy = $state<HTMLDivElement>();
  let copyWidth = $state(0);
  let viewWidth = $state(0);
  let strip = $state<HTMLDivElement>();
  const right = $derived(kind.ticker_dir === 'right');
  const copies = $derived(tickerCopies(viewWidth, copyWidth, right));
  // Older layers have no order yet: newest on top.
  const order = $derived(newEdge(kind.newest_on_top !== false));
  const rows = $derived(ordered(items, order === 'top'));

  $effect(() => {
    if (kind.direction !== 'ticker') return;
    const a = firstCopy;
    const b = viewport;
    if (!a || !b || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      copyWidth = a.offsetWidth;
      viewWidth = b.clientWidth;
    });
    ro.observe(a);
    ro.observe(b);
    return () => ro.disconnect();
  });

  $effect(() => {
    if (kind.direction !== 'ticker') return;
    const el = strip;
    const w = copyWidth;
    const toRight = right;
    if (!el || w <= 0) return;
    let offset = Number(el.dataset.offset ?? 0) % w;
    let last = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const dt = Math.min(100, t - last);
      last = t;
      if (!ctx.paused) offset = (offset + (SPEED * dt) / 1000) % w;
      el.style.transform = `translate3d(${tickerX(offset, w, toRight).toFixed(2)}px,0,0)`;
      el.dataset.offset = String(offset);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  });
</script>

{#snippet tickerItem(it: { text: string; vars: string })}
  <span class="cw-ticker-item cw-event-row" style="color:{style.color};{it.vars}"><StyledText text={it.text} {style} /></span><span
    class="cw-ticker-sep"
    style:color={style.color}
  ></span>
{/snippet}

{#if kind.direction === 'ticker'}
  <div class="cw-ticker" data-direction={right ? 'right' : 'left'} bind:this={viewport} style:justify-content={style.align === 'center' && copyWidth === 0 ? 'center' : undefined}>
    <div class="cw-ticker-strip" bind:this={strip}>
      {#each Array.from({ length: items.length ? copies : 0 }, (_, i) => i) as c (c)}
        {#if c === 0}
          <div class="cw-ticker-copy" bind:this={firstCopy}>
            {#each items as it (it.id)}{@render tickerItem(it)}{/each}
          </div>
        {:else}
          <div class="cw-ticker-copy" aria-hidden="true">
            {#each items as it (it.id)}{@render tickerItem(it)}{/each}
          </div>
        {/if}
      {/each}
    </div>
  </div>
{:else}
  <div class="cw-list" data-order={order}>
    {#each rows as it (it.id)}
      <div
        class="cw-list-item cw-event-row"
        style={it.vars || undefined}
        data-event-id={it.id}
        animate:flip={{ duration: live ? 300 : 0 }}
        in:fly={{ y: enterY(order, 24), duration: live ? 360 : 0, opacity: 0 }}
        out:fade={{ duration: live ? 220 : 0 }}
      >
        <StyledText text={it.text} {style} block />
      </div>
    {/each}
  </div>
{/if}

<style>
  .cw-list {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow: hidden;
  }
  .cw-list[data-order='bottom'] {
    justify-content: flex-end;
  }
  .cw-list-item {
    flex: 0 0 auto;
    min-width: 0;
  }
  .cw-list-item :global(.cw-text) {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cw-ticker {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    overflow: hidden;
    -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 24px, #000 calc(100% - 24px), transparent 100%);
    mask-image: linear-gradient(90deg, transparent 0, #000 24px, #000 calc(100% - 24px), transparent 100%);
  }
  .cw-ticker-strip {
    display: flex;
    flex: 0 0 auto;
    will-change: transform;
  }
  .cw-ticker-copy {
    display: flex;
    flex: 0 0 auto;
  }
  .cw-ticker-item {
    flex: 0 0 auto;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
  }
  .cw-ticker-sep {
    flex: 0 0 auto;
    align-self: center;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.45;
    margin: 0 28px;
  }
  .cw-ticker-item :global(.cw-text) {
    white-space: nowrap;
  }
</style>
