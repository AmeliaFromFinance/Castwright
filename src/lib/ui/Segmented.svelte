<script lang="ts" generics="T extends string">
  interface Props {
    value: T;
    options: Array<{ value: T; label: string }>;
    label: string;
    onchange?: (v: T) => void;
  }

  let { value = $bindable(), options, label, onchange }: Props = $props();

  function pick(v: T) {
    value = v;
    onchange?.(v);
  }

  function key(e: KeyboardEvent) {
    const i = options.findIndex((o) => o.value === value);
    let next = i;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % options.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + options.length) % options.length;
    else return;
    e.preventDefault();
    const o = options[next];
    if (o) {
      pick(o.value);
      const target = (e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button')[next];
      target?.focus();
    }
  }
</script>

<div class="seg" role="radiogroup" aria-label={label} tabindex="-1" onkeydown={key}>
  {#each options as o (o.value)}
    <button
      type="button"
      role="radio"
      aria-checked={o.value === value}
      tabindex={o.value === value ? 0 : -1}
      onclick={() => pick(o.value)}>{o.label}</button
    >
  {/each}
</div>

<style>
  .seg {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius);
    background: var(--bg-2);
    border: 1px solid var(--border);
  }
  button {
    height: calc(var(--row-h) - 6px);
    padding: 0 11px;
    border: 0;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 550;
    cursor: pointer;
    white-space: nowrap;
  }
  button:hover {
    color: var(--text);
  }
  button[aria-checked='true'] {
    background: var(--bg-3);
    color: var(--text);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.15);
  }
</style>
