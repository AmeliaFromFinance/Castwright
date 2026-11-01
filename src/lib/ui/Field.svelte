<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    hint?: string;
    error?: string | null;
    /** id of the control inside, so the label is clickable */
    for?: string;
    inline?: boolean;
    children: Snippet;
  }

  let { label, hint, error, for: forId, inline = false, children }: Props = $props();
</script>

<div class="field" class:inline>
  <label for={forId} class="label">{label}</label>
  <div class="control">
    {@render children()}
    {#if error}
      <p class="error" role="alert">{error}</p>
    {:else if hint}
      <p class="hint">{hint}</p>
    {/if}
  </div>
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .inline {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .inline .control {
    flex: none;
  }
  .label {
    font-size: 12px;
    font-weight: 550;
    color: var(--text-muted);
  }
  .control {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .hint {
    font-size: 12px;
    color: var(--text-faint);
  }
  .error {
    font-size: 12px;
    color: var(--danger);
  }
</style>
