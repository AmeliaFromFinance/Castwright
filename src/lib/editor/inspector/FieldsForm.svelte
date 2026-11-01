<script lang="ts">
  import AssetPicker from '$lib/widgets/AssetPicker.svelte';
  import ColorInput from '$lib/ui/ColorInput.svelte';
  import Slider from '$lib/ui/Slider.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import { currentValue, groupSpecs, type FieldSpec } from '../fields';
  import { FONT_CHOICES } from '../fonts';
  import NumberInput from '../ui/NumberInput.svelte';
  import Prop from '../ui/Prop.svelte';

  interface Props {
    specs: FieldSpec[];
    values: Record<string, unknown>;
    uid: string;
    onset: (key: string, value: unknown) => void;
  }

  let { specs, values, uid, onset }: Props = $props();

  const groups = $derived(groupSpecs(specs));
  const str = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'string' ? v : String(v));
  const numOf = (v: unknown, d = 0) => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const assetKind = { 'image-input': 'image', 'video-input': 'video', 'sound-input': 'audio' } as const;
</script>

{#each groups as g (g.group)}
  {#if g.group}<p class="eyebrow group">{g.group}</p>{/if}
  {#each g.specs as s (s.key)}
    {@const v = currentValue(s, values)}
    {@const id = `${uid}-f-${s.key}`}
    {#if s.type === 'checkbox'}
      <Prop label={s.label}>
        <Switch label={s.label} checked={v === true || v === 'true'} onchange={(c) => onset(s.key, c)} />
      </Prop>
    {:else if s.type === 'textarea'}
      <Prop label={s.label} for={id} stacked>
        <textarea {id} class="input" rows="3" value={str(v)} oninput={(e) => onset(s.key, e.currentTarget.value)}></textarea>
      </Prop>
    {:else if s.type === 'number'}
      <Prop label={s.label}>
        <NumberInput label={s.label} min={s.min} max={s.max} step={s.step ?? 1} value={numOf(v)} oninput={(n) => onset(s.key, n)} />
      </Prop>
    {:else if s.type === 'slider'}
      <Prop label={s.label}>
        <Slider label={s.label} min={s.min ?? 0} max={s.max ?? 100} step={s.step ?? 1} value={numOf(v, s.min ?? 0)} oninput={(n) => onset(s.key, n)} />
      </Prop>
    {:else if s.type === 'colorpicker'}
      <Prop label={s.label}>
        <ColorInput label={s.label} value={str(v)} onchange={(c) => onset(s.key, c)} />
      </Prop>
    {:else if s.type === 'dropdown'}
      <Prop label={s.label} for={id}>
        <select {id} class="input" value={str(v)} onchange={(e) => onset(s.key, e.currentTarget.value)}>
          {#each s.options ?? [] as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
          {#if !(s.options ?? []).some((o) => o.value === str(v))}<option value={str(v)}>{str(v) || 'None'}</option>{/if}
        </select>
      </Prop>
    {:else if s.type === 'googleFont'}
      <Prop label={s.label} for={id}>
        <input {id} class="input" list="{uid}-fonts-list" value={str(v)} oninput={(e) => onset(s.key, e.currentTarget.value)} />
      </Prop>
    {:else if s.type === 'image-input' || s.type === 'video-input' || s.type === 'sound-input'}
      <Prop label={s.label}>
        <AssetPicker label={s.label} kind={assetKind[s.type]} value={str(v)} onchange={(p) => onset(s.key, p)} />
      </Prop>
    {:else}
      <Prop label={s.label} for={id}>
        <input {id} class="input" value={str(v)} oninput={(e) => onset(s.key, e.currentTarget.value)} />
      </Prop>
    {/if}
  {/each}
{/each}
<datalist id="{uid}-fonts-list">
  {#each FONT_CHOICES as f (f)}<option value={f}></option>{/each}
</datalist>

<style>
  .group {
    margin-top: 6px;
  }
</style>
