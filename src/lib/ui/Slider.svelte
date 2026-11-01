<script lang="ts">
  interface Props {
    value: number;
    min: number;
    max: number;
    step?: number;
    label: string;
    id?: string;
    /** How to show the value next to the slider. */
    format?: (v: number) => string;
    disabled?: boolean;
    oninput?: (v: number) => void;
    onchange?: (v: number) => void;
  }

  let {
    value = $bindable(),
    min,
    max,
    step = 1,
    label,
    id,
    format = (v) => String(v),
    disabled = false,
    oninput,
    onchange
  }: Props = $props();

  const pct = $derived(max > min ? ((value - min) / (max - min)) * 100 : 0);
</script>

<div class="slider">
  <input
    type="range"
    {id}
    {min}
    {max}
    {step}
    {disabled}
    aria-label={label}
    bind:value
    style="--pct: {pct}%"
    oninput={() => oninput?.(value)}
    onchange={() => onchange?.(value)}
  />
  <output class="mono" for={id}>{format(value)}</output>
</div>

<style>
  .slider {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  input {
    flex: 1;
    min-width: 0;
    height: 18px;
    margin: 0;
    background: transparent;
    -webkit-appearance: none;
    appearance: none;
    cursor: pointer;
  }
  input::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 2px;
    background: linear-gradient(to right, var(--accent) var(--pct), var(--bg-3) var(--pct));
  }
  input::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    margin-top: -5px;
    border-radius: 50%;
    background: var(--bg-1);
    border: 2px solid var(--accent);
  }
  input:focus-visible::-webkit-slider-thumb {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 35%, transparent);
  }
  input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  output {
    min-width: 48px;
    text-align: right;
    font-size: 12px;
    color: var(--text-muted);
  }
</style>
