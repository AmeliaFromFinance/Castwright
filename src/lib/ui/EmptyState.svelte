<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    body?: string;
    icon?: Snippet;
    children?: Snippet;
  }

  let { title, body, icon, children }: Props = $props();
</script>

<div class="empty">
  {#if icon}<div class="icon">{@render icon()}</div>{/if}
  <p class="title">{title}</p>
  {#if body}<p class="muted body">{body}</p>{/if}
  {#if children}<div class="row actions">{@render children()}</div>{/if}
</div>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 6px;
    padding: 28px 20px;
    height: 100%;
  }
  .icon {
    color: var(--text-faint);
    margin-bottom: 4px;
  }
  .title {
    font-weight: 600;
  }
  .body {
    max-width: 340px;
    font-size: 12.5px;
  }
  .actions {
    margin-top: 10px;
  }
</style>
