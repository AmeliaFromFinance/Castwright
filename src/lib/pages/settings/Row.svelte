<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    hint?: string;
    children: Snippet;
  }
  let { label, hint, children }: Props = $props();
</script>

<div class="srow">
  <div class="text">
    <div class="label">{label}</div>
    {#if hint}<div class="hint faint">{hint}</div>{/if}
  </div>
  <div class="control">{@render children()}</div>
</div>

<style>
  .srow {
    display: flex;
    align-items: center;
    gap: 24px;
    max-width: 760px;
    min-height: 36px;
  }
  .text {
    flex: 1;
    min-width: 0;
  }
  .label {
    font-size: 13px;
    font-weight: 550;
  }
  .hint {
    font-size: 12px;
    margin-top: 2px;
    line-height: 1.45;
  }
  .control {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
  }
</style>
