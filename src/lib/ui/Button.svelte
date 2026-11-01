<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'live';
    size?: 'sm' | 'md';
    busy?: boolean;
    pressed?: boolean;
    children?: Snippet;
  }

  let {
    variant = 'secondary',
    size = 'md',
    busy = false,
    pressed,
    disabled,
    type = 'button',
    children,
    class: klass = '',
    ...rest
  }: Props = $props();
</script>

<button
  {type}
  class="btn {variant} {size} {klass}"
  class:busy
  disabled={disabled || busy}
  aria-pressed={pressed}
  aria-busy={busy || undefined}
  {...rest}
>
  {@render children?.()}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    height: var(--row-h);
    padding: 0 12px;
    border-radius: var(--radius);
    border: 1px solid transparent;
    font-weight: 550;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background 0.12s var(--ease),
      border-color 0.12s var(--ease),
      transform 0.06s;
  }
  .btn:active:not(:disabled) {
    transform: translateY(0.5px);
  }
  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .sm {
    height: calc(var(--row-h) - 6px);
    padding: 0 9px;
    font-size: 12px;
    gap: 5px;
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
  }
  .primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .secondary {
    background: var(--bg-2);
    border-color: var(--border);
    color: var(--text);
  }
  .secondary:hover:not(:disabled),
  .secondary[aria-pressed='true'] {
    background: var(--bg-3);
  }
  .secondary[aria-pressed='true'] {
    border-color: var(--accent);
  }
  .ghost {
    background: transparent;
    color: var(--text-muted);
  }
  .ghost:hover:not(:disabled),
  .ghost[aria-pressed='true'] {
    background: var(--bg-3);
    color: var(--text);
  }
  .danger {
    background: var(--bg-2);
    border-color: var(--border);
    color: var(--danger);
  }
  .danger:hover:not(:disabled) {
    border-color: var(--danger);
  }
  .live {
    background: var(--live);
    color: var(--on-live);
    font-weight: 650;
  }
  .live:hover:not(:disabled) {
    filter: brightness(1.08);
  }
  .busy {
    cursor: progress;
  }
</style>
