<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    id: string;
    title: string;
    description?: string;
    children: Snippet;
  }
  let { id, title, description, children }: Props = $props();
</script>

<section {id} class="section" aria-labelledby="{id}-title">
  <header>
    <h2 id="{id}-title">{title}</h2>
    {#if description}<p class="muted">{description}</p>{/if}
  </header>
  <div class="body">{@render children()}</div>
</section>

<style>
  .section {
    padding: 28px 0;
    border-bottom: 1px solid var(--border);
    scroll-margin-top: 8px;
  }
  .section:last-child {
    border-bottom: none;
  }
  header {
    margin-bottom: 18px;
  }
  h2 {
    font-size: 16px;
    font-weight: 650;
  }
  header p {
    margin-top: 4px;
    font-size: 13px;
    max-width: 620px;
    line-height: 1.5;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
</style>
