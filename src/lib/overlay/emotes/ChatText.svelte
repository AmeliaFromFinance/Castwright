<script lang="ts">
  import { srcset, type ChatPiece, type ShownEmote } from './tokenize';

  interface Props {
    pieces: ChatPiece[];
    /** Emote height in pixels. */
    height: number;
  }
  let { pieces, height }: Props = $props();
</script>

{#snippet img(e: ShownEmote, zw: boolean)}{@const s = srcset(e, height)}<img
    class="cw-emote cw-emote-{e.provider}"
    class:cw-emote-zw={zw}
    src={s.src}
    srcset={s.srcset}
    sizes={s.sizes}
    alt={e.code}
    title={e.code}
    style="height:{height}px"
    draggable="false"
  />{/snippet}
{#each pieces as p, i (i)}{#if p.type === 'emote'}{#if p.overlays.length}<span class="cw-emote-stack"
        >{@render img(p.emote, false)}{#each p.overlays as o, j (j)}{@render img(o, true)}{/each}</span
      >{:else}{@render img(p.emote, false)}{/if}{:else if p.type === 'mention'}<b class="cw-mention">{p.text}</b
    >{:else if p.type === 'cheer'}<b class="cw-cheer">{p.text}</b>{:else}{p.text}{/if}{/each}

<style>
  .cw-emote {
    display: inline-block;
    vertical-align: middle;
    margin: -0.3em 0.05em;
    width: auto;
    text-shadow: none;
  }
  .cw-emote-stack {
    display: inline-grid;
    vertical-align: middle;
    margin: -0.3em 0.05em;
  }
  .cw-emote-stack > .cw-emote {
    grid-area: 1 / 1;
    place-self: center;
    margin: 0;
  }
  .cw-mention,
  .cw-cheer {
    font-weight: 700;
  }
</style>
