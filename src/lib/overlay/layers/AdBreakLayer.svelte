<script lang="ts">
  import type { LayerKind } from '$lib/bindings/LayerKind';
  import { adText, type AdPhase } from '../ads';
  import { DEFAULT_TEXT, itemVars } from '../styles';
  import StyledText from '../StyledText.svelte';

  interface Props {
    kind: Extract<LayerKind, { type: 'ad_break' }>;
    /** Null while hidden; the last one stays drawn during the exit animation. */
    phase: AdPhase | null;
  }

  let { kind, phase }: Props = $props();

  let last = $state<AdPhase | null>(null);
  $effect(() => {
    if (phase) last = phase;
  });
  const shown = $derived(phase ?? last);
  const style = $derived({ ...DEFAULT_TEXT, ...(kind.style ?? {}) });
  const text = $derived(shown ? adText(shown.phase === 'running' ? kind.running_text : kind.soon_text, shown) : '');
</script>

{#if shown}
  <div class="cw-ad" class:cw-ad-soon={shown.phase === 'soon'} class:cw-ad-running={shown.phase === 'running'} data-phase={shown.phase}>
    <div class="cw-ad-card" style={itemVars(kind.item_card, kind.item_box, '', false)}>
      <StyledText class="cw-ad-text" {text} {style} block />
    </div>
  </div>
{/if}

<style>
  .cw-ad {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
</style>
