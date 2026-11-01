<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    label: string;
    size?: 'sm' | 'md';
    pressed?: boolean;
    tone?: 'default' | 'danger';
    children: Snippet;
  }

  let { label, size = 'md', pressed, tone = 'default', children, class: klass = '', ...rest }: Props = $props();
</script>

<button
  type="button"
  class="ibtn {size} {tone} {klass}"
  aria-label={label}
  title={label}
  aria-pressed={pressed}
  {...rest}
>
  {@render children()}
</button>

<style>
  .ibtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--row-h);
    height: var(--row-h);
    flex: none;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: background 0.12s var(--ease), color 0.12s var(--ease);
  }
  .sm {
    width: calc(var(--row-h) - 8px);
    height: calc(var(--row-h) - 8px);
  }
  .ibtn:hover:not(:disabled),
  .ibtn[aria-pressed='true'] {
    background: var(--bg-3);
    color: var(--text);
  }
  .ibtn[aria-pressed='true'] {
    color: var(--accent-text);
  }
  .danger:hover:not(:disabled) {
    color: var(--danger);
  }
  .ibtn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .ibtn :global(svg) {
    width: 16px;
    height: 16px;
  }
</style>
