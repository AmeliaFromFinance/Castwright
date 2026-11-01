<script lang="ts">
  interface Props {
    value: string;
    label: string;
    id?: string;
    onchange?: (v: string) => void;
  }

  let { value = $bindable(), label, id, onchange }: Props = $props();

  // The native picker only understands #rrggbb.
  const hex6 = $derived(/^#[0-9a-f]{6}$/i.test(value) ? value : /^#[0-9a-f]{3}$/i.test(value) ? `#${value.slice(1).replace(/./g, (c) => c + c)}` : '#000000');

  function set(v: string) {
    value = v;
    onchange?.(v);
  }
</script>

<div class="color">
  <label class="swatch" style="--c: {value}">
    <span class="sr-only">{label} picker</span>
    <input type="color" value={hex6} oninput={(e) => set(e.currentTarget.value)} />
  </label>
  <input
    {id}
    class="input mono"
    aria-label={label}
    spellcheck="false"
    {value}
    onchange={(e) => set(e.currentTarget.value.trim())}
  />
</div>

<style>
  .color {
    display: flex;
    gap: 6px;
    align-items: center;
    min-width: 0;
  }
  .swatch {
    position: relative;
    width: var(--row-h);
    height: var(--row-h);
    flex: none;
    border-radius: var(--radius);
    border: 1px solid var(--border-strong);
    background:
      linear-gradient(var(--c), var(--c)),
      repeating-conic-gradient(#808080 0 25%, #c0c0c0 0 50%) 0 0 / 10px 10px;
    cursor: pointer;
    overflow: hidden;
  }
  .swatch input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
    width: 100%;
    height: 100%;
  }
  .swatch:focus-within {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
</style>
