<script lang="ts">
  interface Props {
    checked: boolean;
    label: string;
    /** Show the label next to the switch (otherwise screen readers only). */
    showLabel?: boolean;
    disabled?: boolean;
    id?: string;
    onchange?: (checked: boolean) => void;
  }

  let { checked = $bindable(), label, showLabel = false, disabled = false, id, onchange }: Props = $props();

  function toggle() {
    if (disabled) return;
    checked = !checked;
    onchange?.(checked);
  }
</script>

<button
  type="button"
  role="switch"
  {id}
  class="switch"
  class:with-label={showLabel}
  aria-checked={checked}
  aria-label={showLabel ? undefined : label}
  {disabled}
  onclick={toggle}
>
  <span class="track"><span class="thumb"></span></span>
  {#if showLabel}<span class="text">{label}</span>{/if}
</button>

<style>
  .switch {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 2px;
    border: 0;
    background: none;
    cursor: pointer;
    color: var(--text);
    min-height: 24px;
  }
  .switch:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .track {
    position: relative;
    width: 32px;
    height: 18px;
    flex: none;
    border-radius: 999px;
    background: var(--bg-3);
    border: 1px solid var(--border-strong);
    transition: background 0.15s var(--ease), border-color 0.15s var(--ease);
  }
  .thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--text-muted);
    transition: transform 0.15s var(--ease), background 0.15s var(--ease);
  }
  [aria-checked='true'] .track {
    background: var(--accent);
    border-color: var(--accent);
  }
  [aria-checked='true'] .thumb {
    transform: translateX(14px);
    background: var(--on-accent);
  }
  .text {
    font-size: 13px;
  }
</style>
