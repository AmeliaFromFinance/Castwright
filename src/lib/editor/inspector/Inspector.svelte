<script lang="ts">
  import type { Animation } from '$lib/bindings/Animation';
  import type { BoxStyle } from '$lib/bindings/BoxStyle';
  import type { Layer } from '$lib/bindings/Layer';
  import type { LayerKind } from '$lib/bindings/LayerKind';
  import type { Phase } from '$lib/overlay/anim';
  import ConditionEditor from '$lib/widgets/ConditionEditor.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import Slider from '$lib/ui/Slider.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import {
    AlignCenterHorizontal,
    AlignCenterVertical,
    AlignEndHorizontal,
    AlignEndVertical,
    AlignStartHorizontal,
    AlignStartVertical,
    Eye,
    EyeOff,
    Lock,
    LockOpen
  } from '@lucide/svelte';
  import { typeLabel } from '../layers';
  import { MAX_SIZE } from '../starter';
  import type { EditorStore } from '../store.svelte';
  import CodeEditor from '../ui/CodeEditor.svelte';
  import LayerIcon from '../ui/LayerIcon.svelte';
  import NumberInput from '../ui/NumberInput.svelte';
  import Prop from '../ui/Prop.svelte';
  import Section from '../ui/Section.svelte';
  import AnimationEditor from './AnimationEditor.svelte';
  import BoxStyleEditor from './BoxStyleEditor.svelte';
  import ContentEditor from './ContentEditor.svelte';

  interface Props {
    store: EditorStore;
    vars: Record<string, unknown>;
    wide: boolean;
    onpreview: (layerId: string, phase: Phase) => void;
    ontestalert: () => void;
    ontogglewide: () => void;
  }

  let { store, vars, wide, onpreview, ontestalert, ontogglewide }: Props = $props();

  const open = $state({ layout: true, content: true, style: false, visibility: false, animation: false, advanced: false });

  const layer = $derived(store.selected);
  const varNames = $derived(Object.keys(vars).sort());
  const condFields = $derived(
    varNames.map((k) => {
      const v = vars[k];
      const shown = typeof v === 'string' ? (v.length > 18 ? `${v.slice(0, 18)}…` : v) : String(v);
      return { value: k, label: `now: ${shown}` };
    })
  );

  function change(fn: (l: Layer) => void, key: string) {
    const l = layer;
    if (l) store.changeLayer(l.id, fn, { key: `${l.id}:${key}` });
  }

  const setKind = (fn: (k: LayerKind) => void, key: string) => change((l) => fn(l.kind), `kind:${key}`);
  const setBox = (fn: (b: BoxStyle) => void, key: string) => change((l) => fn(l.box_style), `box:${key}`);
  const setAnim = (phase: 'enter' | 'exit' | 'idle') => (fn: (a: Animation) => void, key: string) =>
    change((l) => fn(l[phase]), `${phase}:${key}`);

  function align(where: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') {
    const W = store.doc.width;
    const H = store.doc.height;
    change((l) => {
      if (where === 'left') l.x = 0;
      if (where === 'hcenter') l.x = Math.round((W - l.w) / 2);
      if (where === 'right') l.x = W - l.w;
      if (where === 'top') l.y = 0;
      if (where === 'vcenter') l.y = Math.round((H - l.h) / 2);
      if (where === 'bottom') l.y = H - l.h;
    }, 'align');
  }

  const conditionsNote = $derived(layer && layer.visible_when.conditions.length ? `${layer.visible_when.conditions.length} rule${layer.visible_when.conditions.length === 1 ? '' : 's'}` : undefined);
  const animNote = $derived(
    layer ? [layer.enter.preset, layer.exit.preset, layer.idle.preset].filter((p) => p !== 'none').length || undefined : undefined
  );
</script>

<aside class="inspector" aria-label="Properties">
  {#if layer}
    {@const uid = `p-${layer.id}`}
    <header class="head">
      <span class="icon"><LayerIcon type={layer.kind.type} size={16} /></span>
      <div class="grow names">
        <input
          class="name"
          aria-label="Layer name"
          spellcheck="false"
          value={layer.name}
          onchange={(e) => store.rename(layer.id, e.currentTarget.value)}
          onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <span class="type faint">{typeLabel(layer.kind.type)}</span>
      </div>
      <IconButton label={layer.visible ? 'Hide layer' : 'Show layer'} pressed={!layer.visible} onclick={() => store.toggleVisible(layer.id)}>
        {#if layer.visible}<Eye />{:else}<EyeOff />{/if}
      </IconButton>
      <IconButton label={layer.locked ? 'Unlock layer' : 'Lock layer'} pressed={layer.locked} onclick={() => store.toggleLocked(layer.id)}>
        {#if layer.locked}<Lock />{:else}<LockOpen />{/if}
      </IconButton>
    </header>

    <div class="scroll body">
      <Section title="Layout" bind:open={open.layout}>
        <div class="quad">
          <NumberInput label="X position" prefix="X" value={layer.x} oninput={(v) => change((l) => (l.x = v), 'x')} />
          <NumberInput label="Y position" prefix="Y" value={layer.y} oninput={(v) => change((l) => (l.y = v), 'y')} />
          <NumberInput label="Width" prefix="W" min={1} value={layer.w} oninput={(v) => change((l) => (l.w = Math.max(1, v)), 'w')} />
          <NumberInput label="Height" prefix="H" min={1} value={layer.h} oninput={(v) => change((l) => (l.h = Math.max(1, v)), 'h')} />
          <NumberInput label="Rotation" prefix="↻" unit="°" min={-360} max={360} value={layer.rotation} oninput={(v) => change((l) => (l.rotation = v), 'rot')} />
          <div class="aligns" role="group" aria-label="Align to canvas">
            <IconButton size="sm" label="Align left edge" onclick={() => align('left')}><AlignStartVertical /></IconButton>
            <IconButton size="sm" label="Centre horizontally" onclick={() => align('hcenter')}><AlignCenterVertical /></IconButton>
            <IconButton size="sm" label="Align right edge" onclick={() => align('right')}><AlignEndVertical /></IconButton>
            <IconButton size="sm" label="Align top edge" onclick={() => align('top')}><AlignStartHorizontal /></IconButton>
            <IconButton size="sm" label="Centre vertically" onclick={() => align('vcenter')}><AlignCenterHorizontal /></IconButton>
            <IconButton size="sm" label="Align bottom edge" onclick={() => align('bottom')}><AlignEndHorizontal /></IconButton>
          </div>
        </div>
        <Prop label="Opacity">
          <Slider
            label="Opacity"
            min={0}
            max={100}
            value={Math.round(layer.opacity * 100)}
            format={(v) => `${v}%`}
            oninput={(v) => change((l) => (l.opacity = v / 100), 'opacity')}
          />
        </Prop>
        {#if layer.locked}<p class="hint">Locked: it can't be moved on the canvas, but you can still type values here.</p>{/if}
      </Section>

      <Section title={layer.kind.type === 'custom' ? 'Widget' : 'Content'} bind:open={open.content}>
        {#key layer.id}
          <ContentEditor {layer} {uid} {varNames} {wide} {ontogglewide} {ontestalert} set={setKind} />
        {/key}
      </Section>

      <Section title="Style" bind:open={open.style}>
        <BoxStyleEditor box={layer.box_style} {uid} set={setBox} />
      </Section>

      <Section title="Visibility" bind:open={open.visibility} note={conditionsNote}>
        <Prop label="Visible">
          <Switch label="Visible" checked={layer.visible} onchange={() => store.toggleVisible(layer.id)} />
        </Prop>
        <Prop label="Only show when" stacked hint="Uses live variables. Leave empty to always show.">
          <ConditionEditor
            group={layer.visible_when}
            fields={condFields}
            emptyText="Always shown"
            onchange={(g) => change((l) => { l.visible_when = g; }, 'cond')}
          />
        </Prop>
      </Section>

      <Section title="Animation" bind:open={open.animation} note={animNote ? `${animNote} set` : undefined}>
        <AnimationEditor anim={layer.enter} phase="enter" {uid} set={setAnim('enter')} onpreview={() => onpreview(layer.id, 'enter')} />
        <div class="divider"></div>
        <AnimationEditor anim={layer.exit} phase="exit" {uid} set={setAnim('exit')} onpreview={() => onpreview(layer.id, 'exit')} />
        <div class="divider"></div>
        <AnimationEditor anim={layer.idle} phase="idle" {uid} set={setAnim('idle')} />
        {#if layer.idle.preset !== 'none'}
          <Prop label="Play loops">
            <Switch label="Play animations on the canvas" checked={store.animate} onchange={(v) => (store.animate = v)} />
          </Prop>
        {/if}
      </Section>

      <Section title="Advanced" bind:open={open.advanced} note={layer.css.trim() ? 'Custom CSS' : undefined}>
        <Prop label="Custom CSS" stacked hint="Only applies to this layer. Target parts with classes like .cw-box.">
          <div class="css">
            {#key layer.id}
              <CodeEditor lang="css" label="Custom CSS" value={layer.css} onchange={(v) => change((l) => (l.css = v), 'css')} />
            {/key}
          </div>
        </Prop>
        <Prop label="Layer id">
          <code class="mono id selectable">{layer.id}</code>
        </Prop>
      </Section>
    </div>
  {:else}
    <header class="head">
      <div class="grow">
        <p class="title">Overlay</p>
        <p class="faint small">Select a layer to edit it</p>
      </div>
    </header>
    <div class="scroll body pad">
      <Prop label="Name" for="ov-name">
        <input
          id="ov-name"
          class="input"
          value={store.doc.name}
          oninput={(e) => {
            const v = e.currentTarget.value;
            store.change((d) => (d.name = v), { key: 'overlay:name' });
          }}
        />
      </Prop>
      <Prop label="Size" hint="Match the Browser Source size in OBS.">
        <div class="pair">
          <NumberInput label="Overlay width" prefix="W" min={16} max={MAX_SIZE} value={store.doc.width} oninput={(v) => store.change((d) => (d.width = Math.round(v)), { key: 'overlay:w' })} />
          <NumberInput label="Overlay height" prefix="H" min={16} max={MAX_SIZE} value={store.doc.height} oninput={(v) => store.change((d) => (d.height = Math.round(v)), { key: 'overlay:h' })} />
        </div>
      </Prop>
      <Prop label="Extra fonts" for="ov-fonts" hint="Google Fonts for custom widgets, separated by commas. Text layers load their own.">
        <input
          id="ov-fonts"
          class="input"
          value={store.doc.fonts.join(', ')}
          onchange={(e) => {
            const list = e.currentTarget.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            store.change((d) => {
              d.fonts = list;
            });
          }}
        />
      </Prop>
      <div class="tips">
        <p class="eyebrow">Shortcuts</p>
        <dl>
          <dt>Drag</dt><dd>Move. Hold <kbd>Ctrl</kbd> to skip snapping</dd>
          <dt>Handles</dt><dd>Resize. Hold <kbd>Shift</kbd> to keep the shape</dd>
          <dt><kbd>Alt</kbd> + click</dt><dd>Pick the layer underneath</dd>
          <dt>Arrows</dt><dd>Nudge 1 px, with <kbd>Shift</kbd> 10 px</dd>
          <dt><kbd>Ctrl</kbd> + <kbd>D</kbd></dt><dd>Duplicate</dd>
          <dt><kbd>Ctrl</kbd> + <kbd>Z</kbd></dt><dd>Undo, add <kbd>Shift</kbd> to redo</dd>
          <dt><kbd>Delete</kbd></dt><dd>Remove the layer</dd>
        </dl>
      </div>
    </div>
  {/if}
</aside>

<style>
  .inspector {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    border-left: 1px solid var(--border);
    background: var(--bg-1);
  }
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
  .name {
    width: 100%;
    padding: 1px 4px;
    margin-left: -4px;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    font-weight: 600;
  }
  .name:hover {
    border-color: var(--border);
  }
  .name:focus {
    border-color: var(--focus);
    background: var(--bg-2);
    outline: none;
  }
  .type {
    font-size: 11.5px;
  }
  .title {
    font-weight: 600;
  }
  .small {
    font-size: 12px;
  }
  .body {
    flex: 1;
  }
  .pad {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
  }
  .quad {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 6px;
  }
  .aligns {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 2px;
    border-radius: var(--radius);
    background: var(--bg-2);
    border: 1px solid var(--border);
  }
  .pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 6px;
  }
  .hint {
    font-size: 11.5px;
    color: var(--text-faint);
  }
  .divider {
    height: 1px;
    background: var(--border);
    margin: 2px 0;
  }
  .css {
    height: 180px;
  }
  .id {
    font-size: 11.5px;
    color: var(--text-muted);
    line-height: var(--row-h);
  }
  .tips {
    margin-top: 8px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 7px 12px;
    margin: 10px 0 0;
    font-size: 12px;
  }
  dt {
    color: var(--text);
    white-space: nowrap;
  }
  dd {
    margin: 0;
    color: var(--text-muted);
  }
  kbd {
    display: inline-block;
    padding: 0 5px;
    border: 1px solid var(--border-strong);
    border-bottom-width: 2px;
    border-radius: 4px;
    font-family: var(--font-ui);
    font-size: 10.5px;
    line-height: 16px;
    color: var(--text-muted);
    background: var(--bg-2);
  }
</style>
