<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fade, fly } from 'svelte/transition';
  import type { LayerKind } from '$lib/bindings/LayerKind';
  import { defaultNameColor, readableColor } from '../color';
  import { getStageCtx } from '../context';
  import type { QueueRow, QueueView } from '../play';
  import { prefersReducedMotion } from '../scenes';
  import { alternator, DEFAULT_TEXT, itemVars } from '../styles';
  import StyledText from '../StyledText.svelte';

  interface Props {
    kind: Extract<LayerKind, { type: 'queue' }>;
    /** Null while hidden; the last one stays drawn during the exit animation. */
    view: QueueView | null;
  }

  let { kind, view }: Props = $props();
  const ctx = getStageCtx();

  let last = $state<QueueView | null>(null);
  $effect(() => {
    if (view) last = view;
  });
  const shown = $derived(view ?? last);

  const style = $derived({ ...DEFAULT_TEXT, ...(kind.style ?? {}) });
  const small = $derived({ ...style, font_size: Math.max(10, Math.round(style.font_size * 0.66)), font_weight: Math.max(400, style.font_weight - 150) });
  const motion = $derived(ctx.mode === 'live' && !prefersReducedMotion());
  const flipOf = alternator();
  const next = $derived(shown ? shown.lineup.slice(0, Math.max(0, kind.next_count)) : []);
  const playing = $derived(kind.show_playing && shown ? shown.playing : []);

  const color = (r: QueueRow) => readableColor(r.color || defaultNameColor(r.login || r.name), false);
</script>

{#if shown}
  <div class="cw-q" data-open={shown.open ? 'true' : 'false'} data-order={kind.first_on_top === false ? 'bottom' : 'top'}>
    {#if playing.length}
      <div class="cw-q-section cw-q-playing">
        {#if kind.playing_label.trim()}<StyledText class="cw-q-label" text={kind.playing_label} style={small} block />{/if}
        <div class="cw-q-list">
          {#each playing as r (r.id)}
          <div
            class="cw-q-item"
            class:cw-q-player={true}
            class:cw-q-sub={r.sub}
            data-user-id={r.id}
            style={itemVars(kind.item_card, kind.item_box, color(r), flipOf(r.id)) || undefined}
            animate:flip={{ duration: motion ? 260 : 0 }}
            in:fly={{ x: -16, duration: motion ? 300 : 0, opacity: 0 }}
            out:fade={{ duration: motion ? 200 : 0 }}
          >
            <span class="cw-q-name"><StyledText text={r.name} {style} /></span>
            {#if kind.show_notes && r.note}<StyledText class="cw-q-note" text={r.note} style={small} />{/if}
          </div>
          {/each}
        </div>
      </div>
    {/if}
    {#if next.length}
      <div class="cw-q-section cw-q-next">
        {#if kind.next_label.trim()}<StyledText class="cw-q-label" text={kind.next_label} style={small} block />{/if}
        <div class="cw-q-list">
          {#each next as r (r.id)}
          <div
            class="cw-q-item"
            class:cw-q-player={false}
            class:cw-q-sub={r.sub}
            data-user-id={r.id}
            style={itemVars(kind.item_card, kind.item_box, color(r), flipOf(r.id)) || undefined}
            animate:flip={{ duration: motion ? 260 : 0 }}
            in:fly={{ x: -16, duration: motion ? 300 : 0, opacity: 0 }}
            out:fade={{ duration: motion ? 200 : 0 }}
          >
            {#if kind.show_positions && r.position !== null}<StyledText class="cw-q-pos" text="#{r.position}" style={small} />{/if}
            <span class="cw-q-name"><StyledText text={r.name} {style} /></span>
            {#if kind.show_notes && r.note}<StyledText class="cw-q-note" text={r.note} style={small} />{/if}
          </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .cw-q {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow: hidden;
  }
  /* First in line at the bottom: the whole layer reads bottom up. */
  .cw-q[data-order='bottom'],
  .cw-q[data-order='bottom'] .cw-q-list {
    flex-direction: column-reverse;
  }
  .cw-q-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .cw-q-section :global(.cw-q-label) {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    opacity: 0.8;
  }
  .cw-q-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .cw-q-item {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
  }
  .cw-q-item :global(.cw-q-pos) {
    flex: none;
    min-width: 2.2em;
    font-variant-numeric: tabular-nums;
    opacity: 0.75;
  }
  .cw-q-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 700;
  }
  .cw-q-item :global(.cw-q-note) {
    margin-left: auto;
    flex: none;
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.75;
  }
</style>
