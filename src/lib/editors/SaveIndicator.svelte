<script lang="ts">
  import type { SaveStatus } from './autosave.svelte';
  import { Check, CircleAlert, LoaderCircle } from '@lucide/svelte';

  let { status, error = null }: { status: SaveStatus; error?: string | null } = $props();
</script>

<span class="saved {status}" role="status" aria-live="polite" title={status === 'error' ? (error ?? '') : undefined}>
  {#if status === 'pending' || status === 'saving'}
    <LoaderCircle size={13} class="spin" />Saving…
  {:else if status === 'saved'}
    <Check size={13} />Saved
  {:else if status === 'error'}
    <CircleAlert size={13} />Not saved
  {/if}
</span>

<style>
  .saved {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 76px;
    font-size: 12px;
    color: var(--text-faint);
  }
  .error {
    color: var(--danger);
  }
  .saved :global(.spin) {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
