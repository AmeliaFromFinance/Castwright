<script lang="ts">
  import type { TextStyle } from '$lib/bindings/TextStyle';
  import type { TextAlign } from '$lib/bindings/TextAlign';
  import type { TextOverflow } from '$lib/bindings/TextOverflow';
  import ColorInput from '$lib/ui/ColorInput.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import { CaseUpper, Italic, TextAlignCenter, TextAlignEnd, TextAlignStart } from '@lucide/svelte';
  import { FONT_CHOICES, WEIGHTS } from '../fonts';
  import FontInput from '$lib/editors/FontInput.svelte';
  import NumberInput from '../ui/NumberInput.svelte';
  import Prop from '../ui/Prop.svelte';

  interface Props {
    style: TextStyle;
    /** Unique prefix for element ids. */
    uid: string;
    set: (fn: (s: TextStyle) => void, key: string) => void;
    /** Fields that differ between several layers; they show "Mixed". */
    mixed?: ReadonlySet<keyof TextStyle>;
  }

  let { style, uid, set, mixed }: Props = $props();

  const MIXED = 'Mixed';
  const m = (k: keyof TextStyle) => !!mixed?.has(k);
  const num = (k: keyof TextStyle) => (m(k) ? NaN : (style[k] as number));
  const str = (k: keyof TextStyle) => (m(k) ? '' : (style[k] as string));

  const aligns: Array<{ value: TextAlign; label: string; icon: typeof TextAlignStart }> = [
    { value: 'left', label: 'Align left', icon: TextAlignStart },
    { value: 'center', label: 'Align centre', icon: TextAlignCenter },
    { value: 'right', label: 'Align right', icon: TextAlignEnd }
  ];
</script>

<Prop label="Font" for="{uid}-font">
  <FontInput id="{uid}-font" value={str('font_family')} mixed={m('font_family')} choices={FONT_CHOICES} onchange={(v) => set((s) => (s.font_family = v), 'font')} />
</Prop>
<Prop label="Size">
  <div class="pair">
    <NumberInput label="Font size" unit="px" min={1} max={1000} value={num('font_size')} placeholder={m('font_size') ? MIXED : undefined} oninput={(v) => set((s) => (s.font_size = v), 'size')} />
    <select
      class="input"
      aria-label="Font weight"
      value={m('font_weight') ? '' : style.font_weight}
      onchange={(e) => {
        const v = Number(e.currentTarget.value);
        set((s) => (s.font_weight = v), 'weight');
      }}
    >
      {#if m('font_weight')}<option value="" disabled>{MIXED}</option>{/if}
      {#each WEIGHTS as w (w.value)}<option value={w.value}>{w.label}</option>{/each}
      {#if !WEIGHTS.some((w) => w.value === style.font_weight)}<option value={style.font_weight}>{style.font_weight}</option>{/if}
    </select>
  </div>
</Prop>
<Prop label="Colour">
  <ColorInput label="Text colour" value={str('color')} placeholder={m('color') ? MIXED : undefined} onchange={(v) => set((s) => (s.color = v), 'color')} />
</Prop>
<Prop label="Align">
  <div class="row tools">
    <div class="group" role="group" aria-label="Text alignment">
      {#each aligns as a (a.value)}
        <IconButton size="sm" label={a.label} pressed={!m('align') && style.align === a.value} onclick={() => set((s) => (s.align = a.value), 'align')}>
          <a.icon />
        </IconButton>
      {/each}
    </div>
    <div class="group" role="group" aria-label="Text style">
      <IconButton size="sm" label="Uppercase" pressed={!m('uppercase') && style.uppercase} onclick={() => set((s) => (s.uppercase = !s.uppercase), 'upper')}>
        <CaseUpper />
      </IconButton>
      <IconButton size="sm" label="Italic" pressed={!m('italic') && style.italic} onclick={() => set((s) => (s.italic = !s.italic), 'italic')}>
        <Italic />
      </IconButton>
    </div>
  </div>
</Prop>
<Prop label="Spacing">
  <div class="pair">
    <NumberInput label="Line height" prefix="↕" min={0.5} max={4} step={0.05} value={num('line_height')} placeholder={m('line_height') ? MIXED : undefined} oninput={(v) => set((s) => (s.line_height = v), 'lh')} />
    <NumberInput label="Letter spacing" prefix="↔" unit="px" min={-20} max={100} step={0.5} value={num('letter_spacing')} placeholder={m('letter_spacing') ? MIXED : undefined} oninput={(v) => set((s) => (s.letter_spacing = v), 'ls')} />
  </div>
</Prop>
<Prop label="Long text" hint="What happens when text doesn't fit, like a long song name.">
  <div class="pair">
    <select
      class="input"
      aria-label="Long text"
      value={m('overflow') ? '' : (style.overflow ?? 'wrap')}
      onchange={(e) => {
        const v = e.currentTarget.value as TextOverflow;
        set((s) => (s.overflow = v), 'overflow');
      }}
    >
      {#if m('overflow')}<option value="" disabled>{MIXED}</option>{/if}
      <option value="wrap">Wrap</option>
      <option value="cut">Cut off</option>
      <option value="scroll">Scroll</option>
    </select>
    {#if style.overflow === 'scroll' || m('overflow')}
      <NumberInput label="Scroll speed" unit="px/s" min={10} max={400} step={5} value={m('scroll_speed') ? NaN : (style.scroll_speed ?? 60)} placeholder={m('scroll_speed') ? MIXED : undefined} oninput={(v) => set((s) => (s.scroll_speed = v), 'speed')} />
    {/if}
  </div>
</Prop>
<Prop label="Outline">
  <div class="pair">
    <NumberInput label="Outline width" unit="px" min={0} max={40} step={0.5} value={num('stroke_width')} placeholder={m('stroke_width') ? MIXED : undefined} oninput={(v) => set((s) => (s.stroke_width = v), 'stroke')} />
    <ColorInput label="Outline colour" value={str('stroke_color')} placeholder={m('stroke_color') ? MIXED : undefined} onchange={(v) => set((s) => (s.stroke_color = v), 'strokec')} />
  </div>
</Prop>
<Prop label="Shadow" for="{uid}-shadow" hint="CSS text-shadow, e.g. 0 2px 6px rgba(0,0,0,0.45)">
  <input
    id="{uid}-shadow"
    class="input mono"
    spellcheck="false"
    placeholder={m('shadow') ? MIXED : 'None'}
    value={str('shadow')}
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
