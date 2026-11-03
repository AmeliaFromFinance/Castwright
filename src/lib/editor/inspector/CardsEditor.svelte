<script lang="ts">
  import type { BoxStyle } from '$lib/bindings/BoxStyle';
  import type { ItemCard } from '$lib/bindings/ItemCard';
  import type { LayerKind } from '$lib/bindings/LayerKind';
  import BoxStyleEditor from '$lib/editors/BoxStyleEditor.svelte';
  import StylePresets from '$lib/editors/StylePresets.svelte';
  import { presetBox, presetCard, presetText, type BoxPreset } from '$lib/overlay/presets';
  import { resolveItemCard } from '$lib/overlay/styles';
  import Collapse from '$lib/ui/Collapse.svelte';
  import Segmented from '$lib/ui/Segmented.svelte';
  import Slider from '$lib/ui/Slider.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import { defaultBoxStyle } from '../layers';
  import NumberInput from '../ui/NumberInput.svelte';
  import Prop from '../ui/Prop.svelte';

  type CardKind = Extract<LayerKind, { type: 'chat' | 'event_list' | 'poll' | 'ad_break' | 'now_playing' }>;

  interface Props {
    kind: CardKind;
    uid: string;
    set: (fn: (k: LayerKind) => void, key: string) => void;
  }

  let { kind, uid, set }: Props = $props();

  const chat = $derived(kind.type === 'chat');
  const card = $derived(resolveItemCard(kind.item_card));
  const box = $derived(kind.type === 'chat' ? kind.bubble : kind.item_box);

  function setCard(fn: (c: ItemCard) => void, key: string) {
    set((x) => {
      if (x.type !== 'chat' && x.type !== 'event_list' && x.type !== 'poll' && x.type !== 'ad_break' && x.type !== 'now_playing') return;
      const c = resolveItemCard(x.item_card);
      fn(c);
      x.item_card = c;
    }, `card:${key}`);
  }

  function setBox(fn: (b: BoxStyle) => void, key: string) {
    set((x) => {
      if (x.type === 'chat') fn((x.bubble ??= defaultBoxStyle()));
      else if (x.type === 'event_list' || x.type === 'poll' || x.type === 'ad_break' || x.type === 'now_playing') fn((x.item_box ??= defaultBoxStyle()));
    }, `cardbox:${key}`);
  }

  function apply(p: BoxPreset) {
    set((x) => {
      if (x.type === 'chat') x.bubble = presetBox(p, 'chat');
      else if (x.type === 'event_list' || x.type === 'ad_break') x.item_box = presetBox(p, 'events');
      else if (x.type === 'poll' || x.type === 'now_playing') {
        x.item_box = presetBox(p, 'events');
        if (p.accent) x.bar_color = p.accent;
      } else return;
      x.item_card = x.type === 'ad_break' || x.type === 'now_playing' ? { ...presetCard(p), width: resolveItemCard(x.item_card).width } : presetCard(p);
      x.style = presetText(x.style, p.text);
    }, `preset:${p.id}`);
  }
</script>

<Collapse id="insp.cards.styles" title="Styles">
  <div class="gallery">
    <StylePresets target={chat ? 'chat' : 'events'} onpick={apply} />
    <p class="hint">Picks fill in the settings below and the text style. Tweak anything after.</p>
  </div>
</Collapse>

<Collapse id="insp.cards.layout" title="Card layout">
  <div class="group">
    {#if chat}
      <Prop label="Card around">
        <Segmented
          label="Card around"
          value={card.around}
          options={[
            { value: 'message', label: 'Whole message' },
            { value: 'words', label: 'Just the words' }
          ]}
          onchange={(v) => setCard((c) => (c.around = v), 'around')}
        />
      </Prop>
    {/if}
    {#if kind.type !== 'poll' && kind.type !== 'now_playing'}
    <Prop label="Width">
      <Segmented
        label="Card width"
        value={card.width}
        options={[
          { value: 'full', label: 'Full width' },
          { value: 'fit', label: 'Fit the text' }
        ]}
        onchange={(v) => setCard((c) => (c.width = v), 'width')}
      />
    </Prop>
    {/if}
    {#if kind.type !== 'ad_break' && kind.type !== 'now_playing'}
    <Prop label="Gap">
      <NumberInput label="Space between cards" unit="px" min={0} max={200} value={card.gap} oninput={(v) => setCard((c) => (c.gap = v), 'gap')} />
    </Prop>
    <Prop label="Lean in turn" hint="Every other card leans the other way, like stickers. Set the lean under Shape.">
      <Switch label="Lean in turn" checked={card.alternate} onchange={(v) => setCard((c) => (c.alternate = v), 'alt')} />
    </Prop>
    <Prop label={kind.type === 'poll' ? 'Bar tint' : 'Name tint'} hint={chat ? 'A wash of each chatter’s name colour.' : kind.type === 'poll' ? 'A wash of the bar colour over each card.' : 'A wash of the viewer’s name colour, when known.'}>
      <Slider label="Name colour tint" min={0} max={100} value={Math.round(card.tint * 100)} format={(v) => `${v}%`} oninput={(v) => setCard((c) => (c.tint = v / 100), 'tint')} />
    </Prop>
    {/if}
  </div>
</Collapse>

<BoxStyleEditor box={box ?? {}} uid="{uid}-card" set={setBox} group="card" nameColor={kind.type !== 'poll' && kind.type !== 'ad_break' && kind.type !== 'now_playing'} />

<style>
  .gallery,
  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 2px 0 10px;
  }
  .hint {
    font-size: 11.5px;
    color: var(--text-faint);
  }
</style>
