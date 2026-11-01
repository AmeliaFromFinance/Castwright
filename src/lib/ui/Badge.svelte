<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    tone?: 'neutral' | 'accent' | 'live' | 'ok' | 'warn' | 'danger';
    children: Snippet;
  }

  let { tone = 'neutral', children }: Props = $props();
</script>

<span class="badge {tone}">{@render children()}</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 20px;
    padding: 0 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 650;
    white-space: nowrap;
    border: 1px solid var(--border);
    color: var(--text-muted);
    background: var(--bg-2);
  }
  .accent {
    color: var(--accent-text);
    background: var(--accent-soft);
    border-color: transparent;
  }
  .live {
    color: var(--on-live);
    background: var(--live);
    border-color: var(--live);
    letter-spacing: 0.04em;
  }
  .ok {
    color: var(--ok);
  }
  .warn {
    color: var(--warn);
  }
  .danger {
    color: var(--danger);
  }
  .ok::before,
  .warn::before,
  .danger::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
</style>
