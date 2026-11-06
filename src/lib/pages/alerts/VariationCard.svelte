<script lang="ts">
  import type { Animation } from '$lib/bindings/Animation';
  import type { BoxStyle } from '$lib/bindings/BoxStyle';
  import type { EventKind } from '$lib/bindings/EventKind';
  import type { TextStyle } from '$lib/bindings/TextStyle';
  import type { Variation } from '$lib/bindings/Variation';
  import { describeConditions } from '$lib/editors/conditions';
  import BoxStyleEditor from '$lib/editors/BoxStyleEditor.svelte';
  import StylePresets from '$lib/editors/StylePresets.svelte';
  import TemplateField from '$lib/editors/TemplateField.svelte';
  import { presetBox, presetText, type BoxPreset } from '$lib/overlay/presets';
  import { classicAlertCard, DEFAULT_BOX } from '$lib/overlay/styles';
  import Collapse from '$lib/ui/Collapse.svelte';
  import { app } from '$lib/state/app.svelte';
  import Button from '$lib/ui/Button.svelte';
  import ColorInput from '$lib/ui/ColorInput.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import Slider from '$lib/ui/Slider.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import AssetPicker from '$lib/widgets/AssetPicker.svelte';
  import ConditionEditor from '$lib/widgets/ConditionEditor.svelte';
  import FontInput from '$lib/editors/FontInput.svelte';
  import { ArrowDown, ArrowUp, ChevronRight, Copy, FlaskConical, Trash2 } from '@lucide/svelte';
  import { api } from '$lib/api';
  import { attemptOk, toasts } from '$lib/state/toast.svelte';
  import { ANIM_PRESETS, EASINGS, FONTS, LAYOUTS, fieldsFor, sampleEvent, tokensFor } from './alerts';
  import { alertsEditor as ed } from './store.svelte';
  import { eventForVariation } from './variation-test';

  interface Props {
    v: Variation;
    kind: EventKind;
    index: number;
    count: number;
    onmove: (by: number) => void;
    onduplicate: () => void;
    ondelete: () => void;
  }

  let { v, kind, index, count, onmove, onduplicate, ondelete }: Props = $props();

  const uid = `var-${Math.random().toString(36).slice(2, 8)}`;
  const open = $derived(!!ed.expanded[v.id]);
  const selected = $derived(ed.variationId === v.id);
  const tokens = $derived(tokensFor(kind));
  const actions = $derived(app.project?.actions ?? []);

  const patch = (p: Partial<Variation>) => ed.patchVariation(v.id, p);
  const style = (key: 'title' | 'message', p: Partial<TextStyle>) =>
    key === 'title' ? patch({ title_style: { ...v.title_style, ...p } }) : patch({ message_style: { ...v.message_style, ...p } });
  const animate = (key: 'enter' | 'exit', p: Partial<Animation>) =>
    key === 'enter' ? patch({ enter: { ...v.enter, ...p } }) : patch({ exit: { ...v.exit, ...p } });

  // Without its own card style a variation shows the classic card in its background colour.
  const cardBox = $derived<BoxStyle>(v.card ?? classicAlertCard(v.background) ?? { ...DEFAULT_BOX, fill: 'none' });

  /** Play this variation with a test event that meets its conditions. */
  async function test() {
    await ed.saver.flush();
    const list = ed.config?.types.find((t) => t.kind === kind)?.variations ?? [];
    const snap = $state.snapshot(v) as Variation;
    const r = eventForVariation(sampleEvent(kind), $state.snapshot(list) as Variation[], snap, $state.snapshot(app.vars) as Record<string, unknown>);
    if (!(await attemptOk(() => api.testVariation(v.id, r.event)))) return;
    if (!r.fits) toasts.show("Couldn't make a test event that meets every condition, so it plays with sample details.");
    else if (r.caughtBy)
      toasts.show(`A real event like this would play “${r.caughtBy.name || 'Untitled'}” instead, because it's higher in the list.`);
  }

  function setCard(fn: (b: BoxStyle) => void) {
    const next = structuredClone($state.snapshot(cardBox)) as BoxStyle;
    fn(next);
    patch({ card: next });
  }

  function applyPreset(p: BoxPreset) {
    patch({
      card: presetBox(p, 'alert'),
      title_style: presetText(v.title_style, p.title),
      message_style: presetText(v.message_style, p.message),
      accent: p.accent ?? v.accent
    });
  }

  function toggle() {
    ed.expanded[v.id] = !open;
    ed.variationId = v.id;
  }

  function num(e: { currentTarget: HTMLInputElement }, min: number, max: number): number | null {
    const n = Number(e.currentTarget.value);
    if (e.currentTarget.value.trim() === '' || !Number.isFinite(n)) return null;
    return Math.min(max, Math.max(min, n));
  }
</script>

{#snippet textStyle(label: string, key: 'title' | 'message', s: TextStyle)}
  <fieldset class="group">
    <legend class="sub">{label}</legend>
    <div class="grid4">
      <div class="f wide">
        <label for="{uid}-{key}-font">Font</label>
        <FontInput id="{uid}-{key}-font" value={s.font_family} choices={FONTS} onchange={(f) => style(key, { font_family: f })} />
      </div>
      <div class="f">
        <label for="{uid}-{key}-size">Size</label>
        <input
          id="{uid}-{key}-size"
          class="input"
          type="number"
          min="8"
          max="200"
          value={s.font_size}
          oninput={(e) => {
            const n = num(e, 8, 200);
            if (n !== null) {
              style(key, { font_size: n });
            }
          }}
        />
      </div>
      <div class="f">
        <label for="{uid}-{key}-weight">Weight</label>
        <select
          id="{uid}-{key}-weight"
          class="input"
          value={s.font_weight}
          onchange={(e) => {
            style(key, { font_weight: Number(e.currentTarget.value) });
          }}
        >
          {#each [300, 400, 500, 600, 700, 800, 900] as w (w)}<option value={w}>{w}</option>{/each}
        </select>
      </div>
      <div class="f">
        <label for="{uid}-{key}-color">Colour</label>
        <ColorInput
          id="{uid}-{key}-color"
          label="{label} colour"
          value={s.color}
          onchange={(c) => {
            style(key, { color: c });
          }}
        />
      </div>
    </div>
  </fieldset>
{/snippet}

{#snippet anim(label: string, key: 'enter' | 'exit', a: Animation)}
  <fieldset class="group">
    <legend class="sub">{label}</legend>
    <div class="grid3">
      <div class="f">
        <label for="{uid}-{key}-preset">Effect</label>
        <select
          id="{uid}-{key}-preset"
          class="input"
          value={a.preset}
          onchange={(e) => {
            animate(key, { preset: e.currentTarget.value as Animation['preset'] });
          }}
        >
          {#each ANIM_PRESETS as [value, text] (value)}<option {value}>{text}</option>{/each}
        </select>
      </div>
      <div class="f">
        <label for="{uid}-{key}-ms">Length (ms)</label>
        <input
          id="{uid}-{key}-ms"
          class="input"
          type="number"
          min="0"
          max="5000"
          step="50"
          value={a.duration_ms}
          oninput={(e) => {
            const n = num(e, 0, 5000);
            if (n !== null) {
              animate(key, { duration_ms: Math.round(n) });
            }
          }}
        />
      </div>
      <div class="f">
        <label for="{uid}-{key}-ease">Easing</label>
        <select
          id="{uid}-{key}-ease"
          class="input"
          value={a.easing}
          onchange={(e) => {
            animate(key, { easing: e.currentTarget.value as Animation['easing'] });
          }}
        >
          {#each EASINGS as [value, text] (value)}<option {value}>{text}</option>{/each}
        </select>
      </div>
    </div>
  </fieldset>
{/snippet}

<article
  class="card"
  class:selected
  class:disabled={!v.enabled}
  aria-label="Variation {v.name}"
  data-variation={v.id}
  onfocusin={() => (ed.variationId = v.id)}
>
  <header>
    <button type="button" class="expand" aria-expanded={open} aria-controls="{uid}-body" onclick={toggle}>
      <span class="chev" class:open><ChevronRight size={15} /></span>
      <span class="order mono faint">{index + 1}</span>
      <span class="title">
        <span class="name truncate">{v.name || 'Untitled'}</span>
        <span class="when truncate faint">{describeConditions(v.conditions, 'Always matches')}</span>
      </span>
    </button>
    {#if v.priority !== 0}<span class="prio mono" title="Priority in the queue">P{v.priority}</span>{/if}
    <div class="tools">
      <IconButton size="sm" label="Test this variation" onclick={test}><FlaskConical /></IconButton>
      <IconButton size="sm" label="Move up" disabled={index === 0} onclick={() => onmove(-1)}><ArrowUp /></IconButton>
      <IconButton size="sm" label="Move down" disabled={index === count - 1} onclick={() => onmove(1)}><ArrowDown /></IconButton>
      <IconButton size="sm" label="Duplicate" onclick={onduplicate}><Copy /></IconButton>
      <IconButton size="sm" label="Delete variation" tone="danger" onclick={ondelete}><Trash2 /></IconButton>
    </div>
    <Switch
      label="Variation {v.name} on"
      checked={v.enabled}
      onchange={(on) => {
        patch({ enabled: on });
      }}
    />
  </header>

  {#if open}
    <div class="body" id="{uid}-body">
      <section>
        <div class="grid3">
          <div class="f">
            <label for="{uid}-name">Name</label>
            <input
              id="{uid}-name"
              class="input"
              value={v.name}
              oninput={(e) => {
                patch({ name: e.currentTarget.value });
              }}
            />
          </div>
          <div class="f">
            <label for="{uid}-prio">Priority</label>
            <input
              id="{uid}-prio"
              class="input"
              type="number"
              step="1"
              min="-100"
              max="100"
              title="Higher plays first when several alerts are waiting"
              value={v.priority}
              oninput={(e) => {
                const n = num(e, -100, 100);
                if (n !== null) {
                  patch({ priority: Math.round(n) });
                }
              }}
            />
          </div>
          <div class="f">
            <label for="{uid}-dur">On screen (s)</label>
            <input
              id="{uid}-dur"
              class="input"
              type="number"
              step="0.5"
              min="0.5"
              max="120"
              value={v.duration_ms / 1000}
              oninput={(e) => {
                const n = num(e, 0.5, 120);
                if (n !== null) {
                  patch({ duration_ms: Math.round(n * 1000) });
                }
              }}
            />
          </div>
        </div>
      </section>

      <section>
        <Collapse id="alerts.var.when" title="Plays when">
          <ConditionEditor
            group={v.conditions}
            fields={fieldsFor(kind)}
            emptyText="Always. Add a condition to only play for some events."
            onchange={(g) => {
              patch({ conditions: g });
            }}
          />
        </Collapse>
      </section>

      <section class="stack-s">
        <Collapse id="alerts.var.text" title="Text">
          <div class="stack">
          <TemplateField
            label="Title"
            value={v.title}
            {tokens}
            onchange={(t) => {
              patch({ title: t });
            }}
          />
          <TemplateField
            label="Message"
            value={v.message}
            {tokens}
            multiline
            onchange={(t) => {
              patch({ message: t });
            }}
          />
          </div>
        </Collapse>
      </section>

      <section class="stack-s">
        <Collapse id="alerts.var.media" title="Media and sound">
          <div class="grid2">
            <div class="f">
              <label for="{uid}-image">Image</label>
              <AssetPicker
                id="{uid}-image"
                kind="image"
                label="Image"
                value={v.image}
                onchange={(p) => {
                  patch(p ? { image: p, video: '' } : { image: p });
                }}
              />
            </div>
            <div class="f">
              <label for="{uid}-video">Video</label>
              <AssetPicker
                id="{uid}-video"
                kind="video"
                label="Video"
                value={v.video}
                onchange={(p) => {
                  patch(p ? { video: p, image: '' } : { video: p });
                }}
              />
            </div>
            <div class="f">
              <label for="{uid}-layout">Layout</label>
              <select
                id="{uid}-layout"
                class="input"
                value={v.layout}
                onchange={(e) => {
                  patch({ layout: e.currentTarget.value as Variation['layout'] });
                }}
              >
                {#each LAYOUTS as [value, text] (value)}<option {value}>{text}</option>{/each}
              </select>
            </div>
            <div class="f">
              <label for="{uid}-sound">Sound</label>
              <AssetPicker
                id="{uid}-sound"
                kind="audio"
                label="Sound"
                value={v.sound}
                onchange={(p) => {
                  patch({ sound: p });
                }}
              />
            </div>
            <div class="f">
              <label for="{uid}-vol">Volume</label>
              <Slider
                id="{uid}-vol"
                label="Volume"
                min={0}
                max={100}
                value={v.volume}
                format={(n) => `${n}%`}
                oninput={(n) => {
                  patch({ volume: n });
                }}
              />
            </div>
            <div class="f switch-cell">
              <Switch
                label="Read the viewer message aloud"
                showLabel
                checked={v.tts}
                onchange={(on) => {
                  patch({ tts: on });
                }}
              />
            </div>
          </div>
        </Collapse>
      </section>

      <section class="stack-s">
        <Collapse id="alerts.var.look" title="Look">
          <div class="stack">
            <Collapse id="alerts.var.styles" title="Styles" open={false}>
              <div class="stack">
                <StylePresets target="alert" min={150} onpick={applyPreset} />
                <p class="hint">Sets the card, both text styles and the accent. Change anything after.</p>
              </div>
            </Collapse>
            {@render textStyle('Title text', 'title', v.title_style)}
            {@render textStyle('Message text', 'message', v.message_style)}
            <div class="grid2">
              <div class="f">
                <label for="{uid}-accent">Accent</label>
                <ColorInput
                  id="{uid}-accent"
                  label="Accent colour"
                  value={v.accent}
                  onchange={(c) => {
                    patch({ accent: c });
                  }}
                />
              </div>
              <div class="f card-mode">
                {#if v.card}
                  <Button size="sm" onclick={() => patch({ card: null })} title="Use the classic card in the background colour">Back to classic card</Button>
                {:else}
                  <span class="hint">Classic card</span>
                {/if}
              </div>
            </div>
            <fieldset class="group">
              <legend class="sub">Card</legend>
              <BoxStyleEditor box={cardBox} uid="{uid}-card" set={(fn) => setCard(fn)} group="alert" />
            </fieldset>
          </div>
        </Collapse>
      </section>

      <section class="stack-s">
        <Collapse id="alerts.var.anim" title="Animation">
          <div class="stack">
            {@render anim('Enter', 'enter', v.enter)}
            {@render anim('Exit', 'exit', v.exit)}
          </div>
        </Collapse>
      </section>

      <section>
        <Collapse id="alerts.var.auto" title="Automation" open={false}>
          <div class="f">
            <label for="{uid}-action">Also run an action</label>
            <select
              id="{uid}-action"
              class="input"
              value={v.run_action ?? ''}
              onchange={(e) => {
                patch({ run_action: e.currentTarget.value || null });
              }}
            >
              <option value="">None</option>
              {#each actions as a (a.id)}<option value={a.id}>{a.group ? `${a.group} · ` : ''}{a.name}</option>{/each}
              {#if v.run_action && !actions.some((a) => a.id === v.run_action)}<option value={v.run_action}>Missing action</option>{/if}
            </select>
            <p class="hint">Runs when this alert starts playing, with the event's details.</p>
          </div>
        </Collapse>
      </section>
    </div>
  {/if}
</article>

<style>
  .card {
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-1);
    transition: border-color 0.12s var(--ease);
  }
  .card.selected {
    border-color: color-mix(in srgb, var(--accent) 60%, var(--border));
  }
  .card.disabled .title {
    opacity: 0.55;
  }
  header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px 6px 4px;
  }
  .expand {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    text-align: left;
    cursor: pointer;
  }
  .expand:hover {
    background: var(--bg-2);
  }
  .chev {
    display: inline-flex;
    color: var(--text-muted);
    transition: transform 0.15s var(--ease);
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .order {
    font-size: 11px;
    width: 14px;
    text-align: center;
  }
  .title {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .name {
    font-weight: 600;
  }
  .when {
    font-size: 12px;
  }
  .prio {
    font-size: 11px;
    color: var(--accent-text);
    background: var(--accent-soft);
    padding: 1px 6px;
    border-radius: 999px;
  }
  .tools {
    display: flex;
    gap: 0;
    opacity: 0.85;
  }
  .body {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border);
  }
  section {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  section + section {
    border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  }
  .stack-s {
    gap: 10px;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-bottom: 4px;
  }
  .card-mode {
    justify-content: flex-end;
    align-items: flex-start;
  }
  .grid2,
  .grid3,
  .grid4 {
    display: grid;
    gap: 8px 10px;
    align-items: end;
  }
  .grid2 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .grid3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .grid4 {
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 0.8fr) minmax(0, 0.8fr) minmax(0, 1.3fr);
  }
  .f {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .f > label {
    font-size: 12px;
    font-weight: 550;
    color: var(--text-muted);
  }
  .switch-cell {
    justify-content: center;
    min-height: var(--row-h);
  }
  .group {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }
  .sub {
    padding: 0;
    margin-bottom: 6px;
    font-size: 12px;
    font-weight: 600;
  }
  .hint {
    font-size: 12px;
    color: var(--text-faint);
  }
</style>
