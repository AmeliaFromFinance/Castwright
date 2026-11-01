<script lang="ts">
  interface Props {
    value: number;
    label: string;
    /** Short text shown inside the box, e.g. "X". */
    prefix?: string;
    unit?: string;
    min?: number;
    max?: number;
    step?: number;
    id?: string;
    disabled?: boolean;
    /** Called while typing with a valid number. */
    oninput?: (v: number) => void;
  }

  let { value, label, prefix, unit, min, max, step = 1, id, disabled = false, oninput }: Props = $props();

  // Keep what the person typed while focused (e.g. "1." or "-"), show the model value otherwise.
  let focused = $state(false);
  let text = $state('');
  const shown = $derived(focused ? text : fmt(value));

  function fmt(v: number): string {
    if (!Number.isFinite(v)) return '';
    return String(Math.round(v * 1000) / 1000);
  }

  function clamp(v: number): number {
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return v;
  }

  function input(raw: string) {
    text = raw;
    const n = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(n)) oninput?.(clamp(n));
  }
</script>

<label class="num" class:disabled>
  {#if prefix}<span class="pre" aria-hidden="true">{prefix}</span>{/if}
  <input
    {id}
    type="number"
    class="mono"
    aria-label={label}
    value={shown}
    {min}
    {max}
    {step}
    {disabled}
    onfocus={() => {
      text = fmt(value);
      focused = true;
    }}
    onblur={() => (focused = false)}
    oninput={(e) => input(e.currentTarget.value)}
  />
  {#if unit}<span class="unit" aria-hidden="true">{unit}</span>{/if}
</label>

<style>
  .num {
    display: flex;
    align-items: center;
    height: var(--row-h);
    min-width: 0;
    border-radius: var(--radius);
    border: 1px solid var(--border-strong);
    background: var(--bg-2);
    transition: border-color 0.12s var(--ease), box-shadow 0.12s var(--ease);
  }
  .num:hover {
    border-color: var(--text-faint);
  }
  .num:focus-within {
    border-color: var(--focus);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 28%, transparent);
  }
  .disabled {
    opacity: 0.6;
  }
  .pre,
  .unit {
    flex: none;
    font-size: 11px;
    color: var(--text-faint);
    user-select: none;
  }
  .pre {
    padding-left: 9px;
    font-weight: 600;
  }
  .unit {
    padding-right: 8px;
  }
  input {
    flex: 1;
    min-width: 0;
    width: 100%;
    height: 100%;
    padding: 0 8px;
    border: 0;
    background: transparent;
    font-size: 12px;
    outline: none;
    appearance: textfield;
    -moz-appearance: textfield;
  }
  input::-webkit-outer-spin-button,
  input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
</style>
