<script lang="ts">
  import { toasts } from '$lib/state/toast.svelte';
  import { CircleCheck, CircleAlert, Info, X } from '@lucide/svelte';
</script>

<div class="toasts" aria-live="polite">
  {#each toasts.items as t (t.id)}
    <div class="toast {t.kind}" role={t.kind === 'error' ? 'alert' : 'status'}>
      {#if t.kind === 'success'}<CircleCheck size={16} />{:else if t.kind === 'error'}<CircleAlert size={16} />{:else}<Info
          size={16}
        />{/if}
      <span class="grow selectable">{t.message}</span>
      <button type="button" aria-label="Dismiss" onclick={() => toasts.dismiss(t.id)}><X size={14} /></button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    right: 16px;
    bottom: 40px;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: min(380px, calc(100vw - 32px));
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border-radius: var(--radius-lg);
    background: var(--bg-1);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-pop);
    animation: in 0.2s var(--ease);
  }
  .toast :global(svg) {
    flex: none;
    margin-top: 1px;
  }
  .success :global(svg:first-child) {
    color: var(--ok);
  }
  .error {
    border-color: var(--danger);
  }
  .error :global(svg:first-child) {
    color: var(--danger);
  }
  button {
    border: 0;
    background: none;
    color: var(--text-faint);
    cursor: pointer;
    padding: 2px;
    border-radius: 4px;
  }
  button:hover {
    color: var(--text);
  }
  @keyframes in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
</style>
