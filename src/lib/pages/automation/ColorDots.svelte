<script lang="ts">
  import type { CanvasColor } from '$lib/bindings/CanvasColor';
  import { COLORS, COLOR_NAMES } from './canvas';

  let { value, onpick }: { value: CanvasColor; onpick: (c: CanvasColor) => void } = $props();
</script>

<div class="dots" role="radiogroup" aria-label="Colour">
  {#each COLOR_NAMES as c (c)}
    {@const name = c[0]!.toUpperCase() + c.slice(1)}
    <button
      type="button"
      role="radio"
      class="dot"
      aria-checked={value === c}
      aria-label={name}
      title={name}
      style="--c:{COLORS[c]}"
      onclick={() => onpick(c)}
    ></button>
  {/each}
</div>

<style>
  .dots {
    display: flex;
    gap: 4px;
  }
  .dot {
    width: 16px;
    height: 16px;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 50%;
    background: var(--c);
    background-clip: padding-box;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--c) 60%, var(--border));
    cursor: pointer;
  }
  .dot[aria-checked='true'] {
    box-shadow: 0 0 0 2px var(--text);
  }
  .dot:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
</style>
