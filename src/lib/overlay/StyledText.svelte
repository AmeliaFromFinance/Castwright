<script lang="ts">
  import type { TextStyle } from '$lib/bindings/TextStyle';
  import { hasStroke, textStyleCss } from './styles';

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
</script>

<span class="cw-text {cls}" class:cw-block={block} class:cw-stroked={stroked} data-text={stroked ? text : undefined} style={css}
  >{text}</span
>

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
  .cw-stroked {
    position: relative;
    z-index: 0;
    display: inline-block;
  }
  .cw-block.cw-stroked {
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
