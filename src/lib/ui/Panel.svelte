<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title?: string;
    actions?: Snippet;
    children: Snippet;
    flush?: boolean;
    class?: string;
  }

  let { title, actions, children, flush = false, class: klass = '' }: Props = $props();
</script>

<section class="panel {klass}" aria-label={title}>
  {#if title || actions}
    <header>
      {#if title}<h3>{title}</h3>{/if}
      <div class="grow"></div>
      {#if actions}<div class="row actions">{@render actions()}</div>{/if}
    </header>
  {/if}
  <div class="body" class:flush>
    {@render children()}
  </div>
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    flex: none;
    padding: 0 8px 0 14px;
    border-bottom: 1px solid var(--border);
  }
  h3 {
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .actions {
    gap: 2px;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 12px 14px;
  }
  .flush {
    padding: 0;
  }
</style>
