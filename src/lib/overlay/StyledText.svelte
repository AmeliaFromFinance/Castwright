<script lang="ts">
  import type { TextStyle } from '$lib/bindings/TextStyle';
  import { prefersReducedMotion } from './scenes';
  import { hasStroke, marqueeDuration, textStyleCss } from './styles';

  interface Props {
    text: string;
    style: TextStyle | null | undefined;
    class?: string;
    /** Render as a block (wraps) rather than inline. */
    block?: boolean;
  }

  let { text, style, class: cls = '', block = false }: Props = $props();
  const css = $derived(textStyleCss(style));
  const stroked = $derived(hasStroke(style));
  const reduced = prefersReducedMotion();
  const overflow = $derived(style?.overflow === 'scroll' && reduced ? 'cut' : (style?.overflow ?? 'wrap'));
  const speed = $derived(style?.scroll_speed ?? 60);

  let box = $state<HTMLElement>();
  let item = $state<HTMLElement>();
  let track = $state<HTMLElement>();
  let moving = $state(false);

  // Scroll only when the text is wider than its box.
  $effect(() => {
    if (overflow !== 'scroll' || !box || !item) return;
    const b = box;
    const i = item;
    const measure = () => (moving = i.offsetWidth > b.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(b);
    ro.observe(i);
    return () => ro.disconnect();
  });

  $effect(() => {
    if (!moving || !track || !item) return;
    void text;
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    // The second copy lines up with the first, so the loop has no visible jump.
    const distance = item.offsetWidth + gap;
    const anim = track.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-distance}px)` }], {
      duration: marqueeDuration(distance, speed),
      iterations: Infinity
    });
    return () => anim.cancel();
  });
</script>

{#if overflow === 'scroll'}
  <span class="cw-marquee {cls}" class:cw-marquee-moving={moving} style={css} bind:this={box}
    ><span class="cw-marquee-track" bind:this={track}
      ><span class="cw-text cw-marquee-item" class:cw-stroked={stroked} data-text={stroked ? text : undefined} bind:this={item}>{text}</span
      >{#if moving}<span class="cw-text cw-marquee-item" class:cw-stroked={stroked} data-text={stroked ? text : undefined} aria-hidden="true">{text}</span
        >{/if}</span
    ></span
  >
{:else}
  <span class="cw-text {cls}" class:cw-block={block} class:cw-cut={overflow === 'cut'} class:cw-stroked={stroked} data-text={stroked ? text : undefined} style={css}
    >{text}</span
  >
{/if}

<style>
  .cw-text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    font-kerning: normal;
  }
  .cw-block {
    display: block;
  }
  .cw-cut {
    display: block;
    max-width: 100%;
    white-space: pre;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cw-marquee {
    display: block;
    max-width: 100%;
    min-width: 0;
    overflow: hidden;
    white-space: pre;
  }
  .cw-marquee-moving {
    text-align: left !important;
  }
  .cw-marquee-track {
    display: inline-flex;
    column-gap: 2em;
    will-change: transform;
  }
  .cw-marquee-item {
    display: inline-block;
    flex: none;
    white-space: pre;
  }
  .cw-stroked {
    position: relative;
    z-index: 0;
    display: inline-block;
  }
  .cw-block.cw-stroked,
  .cw-cut.cw-stroked {
    display: block;
  }
  .cw-stroked::before {
    content: attr(data-text);
    position: absolute;
    left: 0;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: -1;
    -webkit-text-stroke: var(--cw-stroke-w) var(--cw-stroke-c);
    color: var(--cw-stroke-c);
    text-shadow: var(--cw-shadow);
    pointer-events: none;
  }
</style>
