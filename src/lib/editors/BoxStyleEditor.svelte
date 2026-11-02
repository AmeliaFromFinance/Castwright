<script lang="ts">
  import type { BoxStyle } from '$lib/bindings/BoxStyle';
  import { resolveBox } from '$lib/overlay/styles';
  import NumberInput from '$lib/editor/ui/NumberInput.svelte';
  import Prop from '$lib/editor/ui/Prop.svelte';
  import Collapse from '$lib/ui/Collapse.svelte';
  import ColorInput from '$lib/ui/ColorInput.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import Segmented from '$lib/ui/Segmented.svelte';
  import Slider from '$lib/ui/Slider.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import { Plus, X } from '@lucide/svelte';

  interface Props {
    box: Partial<BoxStyle>;
    uid: string;
    set: (fn: (b: BoxStyle) => void, key: string) => void;
    /** Remembers which groups are open, per kind of box. */
    group: string;
    /** Item cards can use the chatter's name colour. */
    nameColor?: boolean;
  }

  let { box, uid, set, group, nameColor = false }: Props = $props();

  const b = $derived(resolveBox(box));

  const SHAPES: [BoxStyle['shape'], string][] = [
    ['rounded', 'Rounded'],
    ['rect', 'Square'],
    ['pill', 'Pill'],
    ['bubble', 'Speech bubble'],
    ['slanted', 'Slanted'],
    ['cut', 'Cut corners'],
    ['pixel', 'Pixel steps']
  ];
  const SIDES: [BoxStyle['tail_side'], string][] = [
    ['bottom', 'Bottom'],
    ['top', 'Top'],
    ['left', 'Left'],
    ['right', 'Right'],
    ['none', 'No tail']
  ];
  const STRIPES: [BoxStyle['stripe'], string][] = [
    ['none', 'None'],
    ['left', 'Left'],
    ['top', 'Top'],
    ['right', 'Right'],
    ['bottom', 'Bottom']
  ];
  const PATTERNS: [BoxStyle['pattern'], string][] = [
    ['none', 'None'],
    ['halftone', 'Halftone dots'],
    ['stripes', 'Stripes'],
    ['grid', 'Grid'],
    ['noise', 'Paper grain']
  ];
  const BORDERS: [BoxStyle['border_style'], string][] = [
    ['solid', 'Solid'],
    ['dashed', 'Dashed'],
    ['dotted', 'Dotted'],
    ['double', 'Double'],
    ['comic', 'Thick ink']
  ];
  const SHADOWS: [BoxStyle['shadow_kind'], string][] = [
    ['none', 'None'],
    ['soft', 'Soft'],
    ['hard', 'Hard offset'],
    ['glow', 'Glow'],
    ['layered', 'Layered'],
    ['custom', 'Custom CSS']
  ];

  const rounded = $derived(b.shape === 'rounded' || b.shape === 'bubble' || b.shape === 'slanted');
  const clipped = $derived(b.shape === 'cut' || b.shape === 'pixel');
  const perCorner = $derived(Array.isArray(b.corners));
  const CORNERS = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];

  function stops(fn: (s: BoxStyle['gradient']) => void) {
    set((x) => {
      const next = (resolveBox(x).gradient ?? []).map((s) => ({ ...s }));
      fn(next);
      x.gradient = next;
    }, 'gradient');
  }
</script>

{#snippet select<T extends string>(id: string, label: string, value: T, options: [T, string][], key: string, apply: (x: BoxStyle, v: T) => void)}
  <Prop {label} for="{uid}-{id}">
    <select
      id="{uid}-{id}"
      class="input"
      {value}
      onchange={(e) => {
        const v = e.currentTarget.value as T;
        set((x) => apply(x, v), key);
      }}
    >
      {#each options as [v, text] (v)}<option value={v}>{text}</option>{/each}
    </select>
  </Prop>
{/snippet}

<div class="box-wrap"><div class="box-editor">
  <Collapse id="box.{group}.shape" title="Shape">
    <div class="group">
      {@render select('shape', 'Shape', b.shape, SHAPES, 'shape', (x, v) => (x.shape = v))}
      {#if rounded}
        <Prop label="Corners">
          <div class="pair auto">
            <NumberInput
              label="Corner radius"
              prefix="R"
              unit="px"
              min={0}
              max={2000}
              value={b.radius}
              disabled={perCorner}
              oninput={(v) => set((x) => (x.radius = v), 'radius')}
            />
            <Switch
              label="Per corner"
              showLabel
              checked={perCorner}
              onchange={(on) => set((x) => (x.corners = on ? [b.radius, b.radius, b.radius, b.radius] : null), 'corners')}
            />
          </div>
        </Prop>
        {#if perCorner && b.corners}
          {@const c = b.corners}
          <div class="quad">
            {#each CORNERS as name, i (name)}
              <NumberInput
                label="{name} radius"
                prefix={name
                  .split(' ')
                  .map((w) => w[0]?.toUpperCase())
                  .join('')}
                unit="px"
                min={0}
                max={2000}
                value={c[i] ?? 0}
                oninput={(v) =>
                  set((x) => {
                    const next = [...(x.corners ?? c)] as [number, number, number, number];
                    next[i] = v;
                    x.corners = next;
                  }, `corner${i}`)}
              />
            {/each}
          </div>
        {/if}
      {/if}
      {#if b.shape === 'bubble'}
        {@render select('tail', 'Tail', b.tail_side, SIDES, 'tail', (x, v) => (x.tail_side = v))}
        {#if b.tail_side !== 'none'}
          <Prop label="Tail spot">
            <Slider label="Tail position along the side" min={0} max={100} value={b.tail_pos} format={(v) => `${v}%`} oninput={(v) => set((x) => (x.tail_pos = v), 'tailpos')} />
          </Prop>
          <Prop label="Tail size">
            <Slider label="Tail size" min={4} max={60} value={b.tail_size} format={(v) => `${v}px`} oninput={(v) => set((x) => (x.tail_size = v), 'tailsize')} />
          </Prop>
        {/if}
      {:else if b.shape === 'slanted'}
        <Prop label="Slant">
          <Slider label="Slant" min={-30} max={30} value={b.slant} format={(v) => `${v}°`} oninput={(v) => set((x) => (x.slant = v), 'slant')} />
        </Prop>
      {:else if b.shape === 'cut'}
        <Prop label="Cut">
          <Slider label="Corner cut" min={2} max={80} value={b.cut} format={(v) => `${v}px`} oninput={(v) => set((x) => (x.cut = v), 'cut')} />
        </Prop>
      {:else if b.shape === 'pixel'}
        <Prop label="Step">
          <Slider label="Pixel step" min={1} max={20} value={b.pixel} format={(v) => `${v}px`} oninput={(v) => set((x) => (x.pixel = v), 'pixel')} />
        </Prop>
      {/if}
      <Prop label="Padding">
        <div class="pair">
          <NumberInput label="Padding top and bottom" prefix="↕" unit="px" min={0} max={500} value={b.padding} oninput={(v) => set((x) => (x.padding = v), 'pad')} />
          <NumberInput
            label="Padding left and right"
            prefix="↔"
            unit="px"
            min={0}
            max={500}
            value={b.padding_x ?? b.padding}
            oninput={(v) => set((x) => (x.padding_x = v), 'padx')}
          />
        </div>
      </Prop>
      <Prop label="Lean">
        <Slider label="Lean" min={-20} max={20} step={0.5} value={b.lean} format={(v) => `${v}°`} oninput={(v) => set((x) => (x.lean = v), 'lean')} />
      </Prop>
    </div>
  </Collapse>

  <Collapse id="box.{group}.fill" title="Fill">
    <div class="group">
      <Segmented
        label="Fill"
        value={b.fill}
        options={[
          { value: 'solid', label: 'Colour' },
          { value: 'gradient', label: 'Gradient' },
          { value: 'none', label: 'None' }
        ]}
        onchange={(v) => set((x) => (x.fill = v), 'fill')}
      />
      {#if b.fill === 'solid'}
        <Prop label="Colour">
          <ColorInput label="Fill colour" value={b.background} onchange={(v) => set((x) => (x.background = v), 'bg')} />
        </Prop>
      {:else if b.fill === 'gradient'}
        <Prop label="Angle">
          <Slider label="Gradient angle" min={0} max={360} step={5} value={b.gradient_angle} format={(v) => `${v}°`} oninput={(v) => set((x) => (x.gradient_angle = v), 'gangle')} />
        </Prop>
        {#each b.gradient as stop, i (i)}
          <div class="stop">
            <ColorInput label="Gradient colour {i + 1}" value={stop.color} onchange={(v) => stops((s) => (s[i]!.color = v))} />
            <NumberInput label="Gradient colour {i + 1} position" unit="%" min={0} max={100} value={stop.at} oninput={(v) => stops((s) => (s[i]!.at = v))} />
            <IconButton size="sm" label="Remove gradient colour {i + 1}" disabled={b.gradient.length <= 2} onclick={() => stops((s) => s.splice(i, 1))}><X /></IconButton>
          </div>
        {/each}
        {#if b.gradient.length < 6}
          <button
            type="button"
            class="add"
            onclick={() => stops((s) => s.push({ color: s[s.length - 1]?.color ?? '#ffffff', at: 100 }))}><Plus size={13} />Add colour</button
          >
        {/if}
      {/if}
      {#if b.fill !== 'none'}
        <Prop label="Opacity">
          <Slider
            label="Fill opacity"
            min={0}
            max={100}
            value={Math.round(b.fill_opacity * 100)}
            format={(v) => `${v}%`}
            oninput={(v) => set((x) => (x.fill_opacity = v / 100), 'fillop')}
          />
        </Prop>
      {/if}
      <Prop label="Blur behind">
        <Slider label="Backdrop blur" min={0} max={40} value={b.backdrop_blur} format={(v) => `${v}px`} oninput={(v) => set((x) => (x.backdrop_blur = v), 'blur')} />
      </Prop>
    </div>
  </Collapse>

  <Collapse id="box.{group}.pattern" title="Pattern" meta={b.pattern === 'none' ? '' : PATTERNS.find((p) => p[0] === b.pattern)?.[1]} open={false}>
    <div class="group">
      {@render select('pattern', 'Pattern', b.pattern, PATTERNS, 'pattern', (x, v) => (x.pattern = v))}
      {#if b.pattern !== 'none'}
        <Prop label="Colour">
          <ColorInput label="Pattern colour" value={b.pattern_color} onchange={(v) => set((x) => (x.pattern_color = v), 'pcolor')} />
        </Prop>
        <Prop label="Strength">
          <Slider
            label="Pattern strength"
            min={0}
            max={100}
            value={Math.round(b.pattern_opacity * 100)}
            format={(v) => `${v}%`}
            oninput={(v) => set((x) => (x.pattern_opacity = v / 100), 'pop')}
          />
        </Prop>
        <Prop label="Size">
          <Slider label="Pattern size" min={3} max={60} value={b.pattern_size} format={(v) => `${v}px`} oninput={(v) => set((x) => (x.pattern_size = v), 'psize')} />
        </Prop>
      {/if}
    </div>
  </Collapse>

  <Collapse id="box.{group}.border" title="Border and stripe" open={false}>
    <div class="group">
      <Prop label="Border">
        <div class="pair">
          <NumberInput label="Border width" unit="px" min={0} max={100} value={b.border_width} oninput={(v) => set((x) => (x.border_width = v), 'bw')} />
          <ColorInput label="Border colour" value={b.border_color} onchange={(v) => set((x) => (x.border_color = v), 'bc')} />
        </div>
      </Prop>
      {@render select('bstyle', 'Line', b.border_style, BORDERS, 'bstyle', (x, v) => (x.border_style = v))}
      {#if clipped && b.border_style !== 'solid' && b.border_style !== 'comic'}
        <p class="hint">Cut and pixel shapes draw solid borders.</p>
      {/if}
      {@render select('stripe', 'Stripe', b.stripe, STRIPES, 'stripe', (x, v) => (x.stripe = v))}
      {#if b.stripe !== 'none'}
        <Prop label="Stripe">
          <div class="pair">
            <NumberInput label="Stripe width" unit="px" min={1} max={200} value={b.stripe_width} oninput={(v) => set((x) => (x.stripe_width = v), 'sw')} />
            <ColorInput label="Stripe colour" value={b.stripe_color} onchange={(v) => set((x) => (x.stripe_color = v), 'sc')} />
          </div>
        </Prop>
        {#if nameColor}
          <Prop label="">
            <Switch label="Use the name colour" showLabel checked={b.stripe_name_color} onchange={(v) => set((x) => (x.stripe_name_color = v), 'sname')} />
          </Prop>
        {/if}
      {/if}
    </div>
  </Collapse>

  <Collapse id="box.{group}.shadow" title="Shadow" meta={SHADOWS.find((s) => s[0] === b.shadow_kind)?.[1]} open={false}>
    <div class="group">
      {@render select('shadow', 'Shadow', b.shadow_kind, SHADOWS, 'shadowkind', (x, v) => (x.shadow_kind = v))}
      {#if b.shadow_kind === 'custom'}
        <Prop label="CSS" for="{uid}-box-shadow" hint="CSS box-shadow, e.g. 0 12px 40px rgba(0,0,0,0.35)">
          <input
            id="{uid}-box-shadow"
            class="input mono"
            spellcheck="false"
            placeholder="None"
            value={b.shadow}
            oninput={(e) => {
              const v = e.currentTarget.value;
              set((x) => (x.shadow = v), 'shadow');
            }}
          />
        </Prop>
      {:else if b.shadow_kind !== 'none'}
        <Prop label="Colour">
          <ColorInput label="Shadow colour" value={b.shadow_color} onchange={(v) => set((x) => (x.shadow_color = v), 'shc')} />
        </Prop>
        {#if b.shadow_kind !== 'glow'}
          <Prop label="Offset">
            <div class="pair">
              <NumberInput label="Shadow offset X" prefix="X" unit="px" min={-200} max={200} value={b.shadow_x} oninput={(v) => set((x) => (x.shadow_x = v), 'shx')} />
              <NumberInput label="Shadow offset Y" prefix="Y" unit="px" min={-200} max={200} value={b.shadow_y} oninput={(v) => set((x) => (x.shadow_y = v), 'shy')} />
            </div>
          </Prop>
        {/if}
        {#if b.shadow_kind !== 'hard'}
          <Prop label="Blur">
            <Slider label="Shadow blur" min={0} max={120} value={b.shadow_blur} format={(v) => `${v}px`} oninput={(v) => set((x) => (x.shadow_blur = v), 'shb')} />
          </Prop>
        {/if}
      {/if}
    </div>
  </Collapse>
</div></div>

<style>
  .box-wrap {
    container-type: inline-size;
  }
  @container (min-width: 640px) {
    .box-editor {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      column-gap: 28px;
      align-items: start;
    }
  }
  .box-editor {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 2px 0 10px;
  }
  .pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 6px;
    align-items: center;
  }
  .pair.auto {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .quad {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 4px;
  }
  .stop {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 72px auto;
    gap: 6px;
    align-items: center;
  }
  .add {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    align-self: flex-start;
    padding: 4px 8px;
    border-radius: var(--radius);
    font-size: 12px;
    color: var(--accent-text);
  }
  .add:hover {
    background: var(--accent-soft);
  }
  .hint {
    font-size: 11.5px;
    color: var(--text-faint);
  }
</style>
