<script lang="ts">
  import type { TextStyle } from '$lib/bindings/TextStyle';
  import type { TextAlign } from '$lib/bindings/TextAlign';
  import ColorInput from '$lib/ui/ColorInput.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import { CaseUpper, Italic, TextAlignCenter, TextAlignEnd, TextAlignStart } from '@lucide/svelte';
  import { FONT_CHOICES, WEIGHTS } from '../fonts';
  import NumberInput from '../ui/NumberInput.svelte';
  import Prop from '../ui/Prop.svelte';

  interface Props {
    style: TextStyle;
    /** Unique prefix for element ids. */
    uid: string;
    set: (fn: (s: TextStyle) => void, key: string) => void;
  }

  let { style, uid, set }: Props = $props();

  const aligns: Array<{ value: TextAlign; label: string; icon: typeof TextAlignStart }> = [
    { value: 'left', label: 'Align left', icon: TextAlignStart },
    { value: 'center', label: 'Align centre', icon: TextAlignCenter },
    { value: 'right', label: 'Align right', icon: TextAlignEnd }
  ];
</script>

<Prop label="Font" for="{uid}-font">
  <input
    id="{uid}-font"
    class="input"
    list="{uid}-fonts"
    spellcheck="false"
    value={style.font_family}
    oninput={(e) => {
      const v = e.currentTarget.value;
      set((s) => (s.font_family = v), 'font');
    }}
  />
  <datalist id="{uid}-fonts">
    {#each FONT_CHOICES as f (f)}<option value={f}></option>{/each}
  </datalist>
</Prop>
<Prop label="Size">
  <div class="pair">
    <NumberInput label="Font size" unit="px" min={1} max={1000} value={style.font_size} oninput={(v) => set((s) => (s.font_size = v), 'size')} />
    <select
      class="input"
      aria-label="Font weight"
      value={style.font_weight}
      onchange={(e) => {
        const v = Number(e.currentTarget.value);
        set((s) => (s.font_weight = v), 'weight');
      }}
    >
      {#each WEIGHTS as w (w.value)}<option value={w.value}>{w.label}</option>{/each}
      {#if !WEIGHTS.some((w) => w.value === style.font_weight)}<option value={style.font_weight}>{style.font_weight}</option>{/if}
    </select>
  </div>
</Prop>
<Prop label="Colour">
  <ColorInput label="Text colour" value={style.color} onchange={(v) => set((s) => (s.color = v), 'color')} />
</Prop>
<Prop label="Align">
  <div class="row tools">
    <div class="group" role="group" aria-label="Text alignment">
      {#each aligns as a (a.value)}
        <IconButton size="sm" label={a.label} pressed={style.align === a.value} onclick={() => set((s) => (s.align = a.value), 'align')}>
          <a.icon />
        </IconButton>
      {/each}
    </div>
    <div class="group" role="group" aria-label="Text style">
      <IconButton size="sm" label="Uppercase" pressed={style.uppercase} onclick={() => set((s) => (s.uppercase = !s.uppercase), 'upper')}>
        <CaseUpper />
      </IconButton>
      <IconButton size="sm" label="Italic" pressed={style.italic} onclick={() => set((s) => (s.italic = !s.italic), 'italic')}>
        <Italic />
      </IconButton>
    </div>
  </div>
</Prop>
<Prop label="Spacing">
  <div class="pair">
    <NumberInput label="Line height" prefix="↕" min={0.5} max={4} step={0.05} value={style.line_height} oninput={(v) => set((s) => (s.line_height = v), 'lh')} />
    <NumberInput label="Letter spacing" prefix="↔" unit="px" min={-20} max={100} step={0.5} value={style.letter_spacing} oninput={(v) => set((s) => (s.letter_spacing = v), 'ls')} />
  </div>
</Prop>
<Prop label="Outline">
  <div class="pair">
    <NumberInput label="Outline width" unit="px" min={0} max={40} step={0.5} value={style.stroke_width} oninput={(v) => set((s) => (s.stroke_width = v), 'stroke')} />
    <ColorInput label="Outline colour" value={style.stroke_color} onchange={(v) => set((s) => (s.stroke_color = v), 'strokec')} />
  </div>
</Prop>
<Prop label="Shadow" for="{uid}-shadow" hint="CSS text-shadow, e.g. 0 2px 6px rgba(0,0,0,0.45)">
  <input
    id="{uid}-shadow"
    class="input mono"
    spellcheck="false"
    placeholder="None"
    value={style.shadow}
    oninput={(e) => {
      const v = e.currentTarget.value;
      set((s) => (s.shadow = v), 'shadow');
    }}
  />
</Prop>

<style>
  .pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 6px;
  }
  .tools {
    gap: 6px;
  }
  .group {
    display: inline-flex;
    gap: 1px;
    padding: 2px;
    border-radius: var(--radius);
    background: var(--bg-2);
    border: 1px solid var(--border);
  }
</style>
