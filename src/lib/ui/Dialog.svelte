<script lang="ts">
  import type { Snippet } from 'svelte';
  import { X } from '@lucide/svelte';

  interface Props {
    open: boolean;
    title: string;
    description?: string;
    width?: number;
    onclose?: () => void;
    children: Snippet;
    footer?: Snippet;
  }

  let { open = $bindable(), title, description, width = 480, onclose, children, footer }: Props = $props();

  let dialog: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

  function close() {
    open = false;
    onclose?.();
  }
</script>

<dialog
  bind:this={dialog}
  style="width: min({width}px, calc(100vw - 48px))"
  aria-labelledby="dlg-title"
  onclose={() => {
    if (open) close();
  }}
  onclick={(e) => {
    if (e.target === dialog) close();
  }}
>
  {#if open}
    <div class="body">
      <header>
        <div class="grow">
          <h2 id="dlg-title">{title}</h2>
          {#if description}<p class="muted">{description}</p>{/if}
        </div>
        <button type="button" class="x" aria-label="Close" onclick={close}><X size={16} /></button>
      </header>
      <div class="content">
        {@render children()}
      </div>
      {#if footer}
        <footer>{@render footer()}</footer>
      {/if}
    </div>
  {/if}
</dialog>

<style>
  dialog {
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-1);
    color: var(--text);
    box-shadow: var(--shadow-pop);
    max-height: calc(100vh - 48px);
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.45);
  }
  .body {
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 50px);
  }
  header {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 18px 20px 6px;
  }
  h2 {
    font-size: 16px;
  }
  header p {
    margin-top: 4px;
    font-size: 12.5px;
  }
  .x {
    border: 0;
    background: none;
    color: var(--text-muted);
    width: 28px;
    height: 28px;
    border-radius: var(--radius);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .x:hover {
    background: var(--bg-3);
    color: var(--text);
  }
  .content {
    padding: 12px 20px 18px;
    overflow: auto;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 20px;
    border-top: 1px solid var(--border);
  }
</style>
