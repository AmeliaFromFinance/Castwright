<script lang="ts">
  import type { BoxStyle } from '$lib/bindings/BoxStyle';
  import type { Layer } from '$lib/bindings/Layer';
  import type { SceneRule } from '$lib/bindings/SceneRule';
  import type { TextStyle } from '$lib/bindings/TextStyle';
  import BoxStyleEditor from '$lib/editors/BoxStyleEditor.svelte';
  import StylePresets from '$lib/editors/StylePresets.svelte';
  import { hasAnimation } from '$lib/overlay/anim';
  import type { BoxPreset } from '$lib/overlay/presets';
  import { defaultSceneRule, knownScenes } from '$lib/overlay/scenes';
  import { app } from '$lib/state/app.svelte';
  import Collapse from '$lib/ui/Collapse.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import Segmented from '$lib/ui/Segmented.svelte';
  import Slider from '$lib/ui/Slider.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import {
    AlignCenterHorizontal,
    AlignCenterVertical,
    AlignEndHorizontal,
    AlignEndVertical,
    AlignHorizontalDistributeCenter,
    AlignStartHorizontal,
    AlignStartVertical,
    AlignVerticalDistributeCenter,
    Eye,
    EyeOff,
    Layers,
    Lock,
    LockOpen
  } from '@lucide/svelte';
  import { typeLabel } from '../layers';
  import {
    alignLayers,
    applyBoxPreset,
    applyCardPreset,
    applyTextPatch,
    distributeLayers,
    hasCards,
    hasText,
    mainStyles,
    merge,
    mergeStyles,
    textPatch,
    type AlignTo
  } from '../multi';
  import type { EditorStore } from '../store.svelte';
  import Prop from '../ui/Prop.svelte';
  import Section from '../ui/Section.svelte';
  import SceneRuleEditor from './SceneRuleEditor.svelte';
  import TextStyleEditor from './TextStyleEditor.svelte';

  let { store }: { store: EditorStore } = $props();

  const open = $state({ layout: true, text: true, cards: false, style: false, visibility: true, scenes: false });
  let alignTo = $state<'selection' | 'canvas'>('selection');

  const layers = $derived(store.selection);
  const ids = $derived(layers.map((l) => l.id));
  const key = $derived(ids.join(','));
  const texts = $derived(layers.filter((l) => hasText(l.kind)));
  const cards = $derived(layers.filter((l) => hasCards(l.kind)));
  const text = $derived(mergeStyles(mainStyles(layers)));
  const opacity = $derived(merge(layers.map((l) => Math.round(l.opacity * 100))));
  const visible = $derived(merge(layers.map((l) => l.visible)));
  const locked = $derived(merge(layers.map((l) => l.locked)));
  const scenes = $derived(merge(layers.map((l) => l.scenes ?? defaultSceneRule())));
  const boxes = $derived(merge(layers.map((l) => l.box_style)));
  const kinds = $derived([...new Set(layers.map((l) => typeLabel(l.kind.type)))].join(', '));
  const sceneList = $derived(knownScenes(app.obs.scenes, store.doc.layers));

  /** One undo step per field while typing, across every layer. */
  const change = (fn: (ls: Layer[]) => void, field: string) => store.changeLayers(ids, fn, { key: `multi:${key}:${field}` });
  const each = (fn: (l: Layer) => void, field: string) => change((ls) => ls.forEach(fn), field);

  function setText(edit: (s: TextStyle) => void, field: string) {
    const patch = textPatch(text.style, edit);
    if (Object.keys(patch).length) each((l) => hasText(l.kind) && applyTextPatch(l.kind, patch), `text:${field}`);
  }

  const setBox = (fn: (b: BoxStyle) => void, field: string) => each((l) => fn(l.box_style), `box:${field}`);
  const setScenes = (fn: (r: SceneRule) => void, field: string) =>
    each((l) => {
      l.scenes ??= defaultSceneRule();
      fn(l.scenes);
    }, `scenes:${field}`);

  function align(to: AlignTo) {
    const area = alignTo === 'canvas' ? { x: 0, y: 0, w: store.doc.width, h: store.doc.height } : undefined;
    change((ls) => alignLayers(ls.filter((l) => !l.locked), to, area), `align:${to}`);
  }

  const ALIGNS: Array<[AlignTo, string, typeof AlignStartVertical]> = [
    ['left', 'Align left edges', AlignStartVertical],
    ['hcenter', 'Centre horizontally', AlignCenterVertical],
    ['right', 'Align right edges', AlignEndVertical],
    ['top', 'Align top edges', AlignStartHorizontal],
    ['vcenter', 'Centre vertically', AlignCenterHorizontal],
    ['bottom', 'Align bottom edges', AlignEndHorizontal]
  ];
</script>

<header class="head">
  <span class="icon"><Layers size={16} /></span>
  <div class="grow names">
    <p class="title">{layers.length} layers</p>
    <span class="type faint truncate" title={kinds}>{kinds}</span>
  </div>
  <IconButton
    label={visible.value && !visible.mixed ? 'Hide layers' : 'Show layers'}
    pressed={!visible.value && !visible.mixed}
    onclick={() => {
      const next = visible.mixed || !visible.value;
      each((l) => (l.visible = next), 'visible');
    }}
  >
    {#if visible.value || visible.mixed}<Eye />{:else}<EyeOff />{/if}
  </IconButton>
  <IconButton
    label={locked.value && !locked.mixed ? 'Unlock layers' : 'Lock layers'}
    pressed={!!locked.value && !locked.mixed}
    onclick={() => {
      const next = locked.mixed || !locked.value;
      each((l) => (l.locked = next), 'locked');
    }}
  >
    {#if locked.value && !locked.mixed}<Lock />{:else}<LockOpen />{/if}
  </IconButton>
</header>

<div class="scroll body" data-multi-inspector>
  <Section title="Layout" bind:open={open.layout}>
    <Prop label="Align to">
      <Segmented
        label="Align to"
        value={alignTo}
        options={[
          { value: 'selection', label: 'Each other' },
          { value: 'canvas', label: 'Canvas' }
        ]}
        onchange={(v) => (alignTo = v)}
      />
    </Prop>
    <div class="aligns" role="group" aria-label="Align layers">
      {#each ALIGNS as [to, label, Icon] (to)}
        <IconButton size="sm" {label} onclick={() => align(to)}><Icon /></IconButton>
      {/each}
      <span class="sep" aria-hidden="true"></span>
      <IconButton size="sm" label="Space evenly across" disabled={layers.length < 3} onclick={() => change((ls) => distributeLayers(ls, 'x'), 'dist:x')}>
        <AlignHorizontalDistributeCenter />
      </IconButton>
      <IconButton size="sm" label="Space evenly down" disabled={layers.length < 3} onclick={() => change((ls) => distributeLayers(ls, 'y'), 'dist:y')}>
        <AlignVerticalDistributeCenter />
      </IconButton>
    </div>
    <Prop label="Opacity">
      <Slider
        label="Opacity"
        min={0}
        max={100}
        value={opacity.value ?? 100}
        format={(v) => (opacity.mixed ? 'Mixed' : `${v}%`)}
        oninput={(v) => each((l) => (l.opacity = v / 100), 'opacity')}
      />
    </Prop>
    <p class="hint">Drag any of them on the canvas to move them together. Locked layers stay put.</p>
  </Section>

  {#if texts.length}
    <Section title="Text style" bind:open={open.text} note={texts.length === layers.length ? undefined : `${texts.length} of ${layers.length} have text`}>
      {#key key}
        <div class="text-group"><TextStyleEditor style={text.style} mixed={text.mixed} uid="multi" set={setText} /></div>
      {/key}
    </Section>
  {/if}

  {#if cards.length}
    <Section title="Cards" bind:open={open.cards} note="{cards.length} with cards">
      <Collapse id="insp.multi.cards" title="Styles">
        <div class="gallery">
          <StylePresets target="chat" onpick={(p: BoxPreset) => each((l) => applyCardPreset(l.kind, p), `cards:${p.id}`)} />
        </div>
      </Collapse>
    </Section>
  {/if}

  <Section title="Style" bind:open={open.style} note={boxes.mixed ? 'Mixed' : 'Layer box'}>
    <Collapse id="insp.box.styles" title="Styles" open={false}>
      <div class="gallery"><StylePresets target="layer" onpick={(p: BoxPreset) => each((l) => applyBoxPreset(l, p), `box:${p.id}`)} /></div>
    </Collapse>
    {#if boxes.mixed}<p class="hint">The boxes differ. This shows the first one; a change applies to all.</p>{/if}
    {#key key}
      <BoxStyleEditor box={boxes.value ?? {}} uid="multi-box" set={setBox} group="layer" />
    {/key}
  </Section>

  <Section title="Visibility" bind:open={open.visibility} note={visible.mixed ? 'Mixed' : undefined}>
    <Prop label="Visible" hint={visible.mixed ? 'Mixed. Switching it sets every layer.' : undefined}>
      <Switch label="Visible" checked={!!visible.value && !visible.mixed} onchange={(v) => each((l) => (l.visible = v), 'visible')} />
    </Prop>
  </Section>

  <Section title="Scenes" bind:open={open.scenes} note={scenes.mixed ? 'Mixed' : undefined}>
    {#if scenes.mixed}<p class="hint">The scene rules differ. This shows the first one; a change applies to all.</p>{/if}
    <SceneRuleEditor
      rule={scenes.value}
      scenes={sceneList}
      obsConnected={app.obs.state === 'connected'}
      ownAnimations={layers.every((l) => hasAnimation(l.enter) && hasAnimation(l.exit))}
      uid="multi-scenes"
      set={setScenes}
    />
  </Section>
</div>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 54px;
    padding: 8px 8px 8px 14px;
    border-bottom: 1px solid var(--border);
    flex: none;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    flex: none;
    border-radius: var(--radius);
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .names {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .title {
    font-weight: 600;
  }
  .type {
    font-size: 11.5px;
  }
  .body {
    flex: 1;
  }
  .aligns {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius);
    background: var(--bg-2);
    border: 1px solid var(--border);
  }
  .sep {
    width: 1px;
    height: 18px;
    margin: 0 4px;
    background: var(--border);
  }
  .hint {
    font-size: 11.5px;
    color: var(--text-faint);
  }
  .gallery {
    padding: 2px 0 10px;
  }
  .text-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
</style>
