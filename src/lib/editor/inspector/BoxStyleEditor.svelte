<script lang="ts">
  import type { BoxStyle } from '$lib/bindings/BoxStyle';
  import ColorInput from '$lib/ui/ColorInput.svelte';
  import Slider from '$lib/ui/Slider.svelte';
  import NumberInput from '../ui/NumberInput.svelte';
  import Prop from '../ui/Prop.svelte';

  interface Props {
    box: BoxStyle;
    uid: string;
    set: (fn: (b: BoxStyle) => void, key: string) => void;
    /** Leave out backdrop blur (chat bubbles). */
    simple?: boolean;
  }

  let { box, uid, set, simple = false }: Props = $props();
</script>

<Prop label="Background">
  <ColorInput label="Background colour" value={box.background} onchange={(v) => set((b) => (b.background = v), 'bg')} />
</Prop>
<Prop label="Border">
  <div class="pair">
    <NumberInput label="Border width" unit="px" min={0} max={100} value={box.border_width} oninput={(v) => set((b) => (b.border_width = v), 'bw')} />
    <ColorInput label="Border colour" value={box.border_color} onchange={(v) => set((b) => (b.border_color = v), 'bc')} />
  </div>
</Prop>
<Prop label="Corners">
  <div class="pair">
    <NumberInput label="Corner radius" prefix="R" unit="px" min={0} max={2000} value={box.radius} oninput={(v) => set((b) => (b.radius = v), 'radius')} />
    <NumberInput label="Padding" prefix="P" unit="px" min={0} max={2000} value={box.padding} oninput={(v) => set((b) => (b.padding = v), 'padding')} />
  </div>
</Prop>
<Prop label="Shadow" for="{uid}-box-shadow" hint="CSS box-shadow, e.g. 0 12px 40px rgba(0,0,0,0.35)">
  <input
    id="{uid}-box-shadow"
    class="input mono"
    spellcheck="false"
    placeholder="None"
    value={box.shadow}
    oninput={(e) => {
      const v = e.currentTarget.value;
      set((b) => (b.shadow = v), 'shadow');
    }}
  />
</Prop>
{#if !simple}
  <Prop label="Backdrop blur">
    <Slider
      label="Backdrop blur"
      min={0}
      max={40}
      value={box.backdrop_blur}
      format={(v) => `${v}px`}
      oninput={(v) => set((b) => (b.backdrop_blur = v), 'blur')}
    />
  </Prop>
{/if}

<style>
  .pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 6px;
  }
</style>
