<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    /** id of the control, so clicking the label focuses it */
    for?: string;
    hint?: string;
    error?: string | null;
    /** Put the control under the label instead of beside it. */
    stacked?: boolean;
    children: Snippet;
  }

  let { label, for: forId, hint, error, stacked = false, children }: Props = $props();
</script>

<div class="prop" class:stacked>
  {#if forId}<label class="label" for={forId}>{label}</label>{:else}<span class="label">{label}</span>{/if}
  <div class="control">
    {@render children()}
    {#if error}<p class="error" role="alert">{error}</p>{:else if hint}<p class="hint">{hint}</p>{/if}
  </div>
</div>

<style>
  .prop {
    display: grid;
    grid-template-columns: 84px minmax(0, 1fr);
    align-items: start;
    gap: 10px;
  }
  .stacked {
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }
  .label {
    font-size: 12px;
    color: var(--text-muted);
    line-height: var(--row-h);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .stacked .label {
    line-height: 1.3;
  }
  .control {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    justify-content: center;
    min-height: var(--row-h);
  }
  .hint {
    font-size: 11.5px;
    color: var(--text-faint);
    line-height: 1.4;
  }
  .error {
    font-size: 12px;
    color: var(--danger);
  }
</style>
