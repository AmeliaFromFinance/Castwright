<script lang="ts" module>
  export type NewOverlaySource =
    | { kind: 'blank'; width: number; height: number }
    | { kind: 'builtin'; id: string }
    | { kind: 'user'; id: string };
</script>

<script lang="ts">
  import { api } from '$lib/api';
  import type { Overlay } from '$lib/bindings/Overlay';
  import NumberInput from '$lib/editor/ui/NumberInput.svelte';
  import { MAX_SIZE, SIZE_PRESETS, type SizePreset } from '$lib/editor/starter';
  import { BUILT_IN_TEMPLATES } from '$lib/overlay/templates';
  import { toasts } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import { Plus, Trash2 } from '@lucide/svelte';
  import TemplatePreview from './TemplatePreview.svelte';

  interface Props {
    open: boolean;
    busy?: boolean;
    oncreate: (opts: { name: string; source: NewOverlaySource }) => void;
  }

  let { open = $bindable(), busy = false, oncreate }: Props = $props();

  let pick = $state('blank');
  let name = $state('New overlay');
  let named = $state(false);
  let size = $state<SizePreset>('landscape');
  let width = $state(1920);
  let height = $state(1080);
  let mine = $state<Overlay[]>([]);

  $effect(() => {
    if (open) {
      pick = 'blank';
      name = 'New overlay';
      named = false;
      size = 'landscape';
      width = 1920;
      height = 1080;
      api
        .listOverlayTemplates()
        .then((t) => (mine = t))
        .catch(() => (mine = []));
    }
  });

  const dims = $derived(size === 'custom' ? { width, height } : SIZE_PRESETS.find((p) => p.id === size)!);

  function choose(id: string, label: string) {
    pick = id;
    if (!named) name = id === 'blank' ? 'New overlay' : label;
  }

  function source(): NewOverlaySource {
    if (pick === 'blank') return { kind: 'blank', width: dims.width, height: dims.height };
    if (pick.startsWith('user:')) return { kind: 'user', id: pick.slice(5) };
    return { kind: 'builtin', id: pick };
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    oncreate({ name: name.trim() || 'New overlay', source: source() });
  }

  async function remove(t: Overlay) {
    try {
      await api.deleteOverlayTemplate(t.id);
      mine = mine.filter((x) => x.id !== t.id);
      if (pick === `user:${t.id}`) choose('blank', '');
      toasts.success(`Deleted template "${t.name}"`);
    } catch (e) {
      toasts.error(e);
    }
  }

  function shapeStyle(w: number, h: number) {
    const s = 22 / Math.max(w, h);
    return `width:${Math.round(w * s)}px;height:${Math.round(h * s)}px`;
  }
</script>

{#snippet tile(id: string, label: string, sub: string, overlay: Overlay | null, onremove?: () => void)}
  {@const dims = overlay ? `${overlay.width} × ${overlay.height}` : ''}
  <div class="tpl" class:on={pick === id}>
    <label class="pick">
      <input type="radio" name="template" value={id} aria-label={label} checked={pick === id} onchange={() => choose(id, label)} class="sr-only" />
      <span class="preview" class:blank={!overlay}>
        {#if overlay}
          <TemplatePreview {overlay} />
        {:else}
          <span class="blank-icon"><Plus size={22} /></span>
        {/if}
      </span>
      <span class="t-head">
        <span class="t-label truncate">{label}</span>
        {#if dims}<span class="t-dims mono faint">{dims}</span>{/if}
      </span>
      <span class="t-sub faint">{sub}</span>
    </label>
    {#if onremove}
      <span class="remove"><IconButton label="Delete template {label}" size="sm" tone="danger" onclick={onremove}><Trash2 /></IconButton></span>
    {/if}
  </div>
{/snippet}

<Dialog bind:open title="New overlay" description="Start from a layout or a blank canvas. You can change everything later." width={980}>
  <form id="new-overlay" class="stack" onsubmit={submit}>
    <fieldset>
      <legend class="label">Start from</legend>
      <div class="grid">
        {@render tile('blank', 'Blank', 'Empty canvas, any size', null)}
        {#each BUILT_IN_TEMPLATES as t (t.id)}
          {@render tile(t.id, t.name, t.description, t.overlay)}
        {/each}
      </div>
    </fieldset>
    {#if mine.length}
      <fieldset>
        <legend class="label">Your templates</legend>
        <div class="grid">
          {#each mine as t (t.id)}
            {@render tile(`user:${t.id}`, t.name, `${t.layers.length} ${t.layers.length === 1 ? 'layer' : 'layers'}`, t, () => remove(t))}
          {/each}
        </div>
      </fieldset>
    {/if}
    <div class="row">
      <div class="field name">
        <label class="label" for="new-ov-name">Name</label>
        <input id="new-ov-name" class="input" bind:value={name} oninput={() => (named = true)} maxlength="80" autocomplete="off" />
      </div>
      {#if pick === 'blank'}
        <fieldset class="size">
          <legend class="label">Size <span class="faint">· match the Browser Source in OBS</span></legend>
          <div class="sizes">
            {#each SIZE_PRESETS as p (p.id)}
              <label class="size-tile" class:on={size === p.id} title={p.id === 'custom' ? 'Custom size' : p.label}>
                <input type="radio" name="size" value={p.id} bind:group={size} class="sr-only" />
                <span class="shape" style={p.id === 'custom' ? shapeStyle(width, height) : shapeStyle(p.width, p.height)}></span>
                <span>{p.id === 'custom' ? 'Custom' : p.label}</span>
              </label>
            {/each}
          </div>
        </fieldset>
      {/if}
    </div>
    {#if pick === 'blank' && size === 'custom'}
      <div class="custom">
        <NumberInput label="Width" prefix="W" unit="px" min={16} max={MAX_SIZE} value={width} oninput={(v) => (width = Math.round(v))} />
        <span class="faint">×</span>
        <NumberInput label="Height" prefix="H" unit="px" min={16} max={MAX_SIZE} value={height} oninput={(v) => (height = Math.round(v))} />
      </div>
    {/if}
  </form>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="new-overlay" {busy}>Create overlay</Button>
  {/snippet}
</Dialog>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }
  .label {
    display: block;
    font-size: 12px;
    font-weight: 550;
    color: var(--text-muted);
    margin-bottom: 6px;
    padding: 0;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
  }
  .tpl {
    position: relative;
    min-width: 0;
  }
  .pick {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-2);
    cursor: pointer;
    transition: border-color 0.12s var(--ease), background 0.12s var(--ease);
  }
  .pick:hover {
    border-color: var(--border-strong);
  }
  .on .pick {
    border-color: var(--accent);
    background: var(--accent-soft);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .pick:focus-within {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .preview {
    display: block;
    aspect-ratio: 16 / 9;
    margin-bottom: 6px;
    padding: 4px;
    border-radius: var(--radius);
    overflow: hidden;
    /* Stands in for the game or camera behind a see-through overlay. */
    background: linear-gradient(135deg, #2b3247, #1a1e2c 60%, #232a3d);
  }
  .preview.blank {
    display: grid;
    place-items: center;
    background:
      repeating-conic-gradient(color-mix(in srgb, var(--text) 5%, transparent) 0 25%, transparent 0 50%) 0 0 / 14px 14px,
      var(--bg-0);
    border: 1px dashed var(--border-strong);
  }
  .blank-icon {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    color: var(--text-muted);
    background: var(--bg-2);
  }
  .t-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 0 4px;
    min-width: 0;
  }
  .t-label {
    flex: 1;
    font-size: 13px;
    font-weight: 600;
  }
  .t-dims {
    flex: none;
    font-size: 11px;
  }
  .t-sub {
    display: -webkit-box;
    min-height: 2.7em;
    padding: 0 4px;
    overflow: hidden;
    font-size: 11.5px;
    line-height: 1.35;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
  .remove {
    position: absolute;
    top: 10px;
    right: 10px;
    border-radius: var(--radius);
    background: var(--bg-1);
    opacity: 0;
    transition: opacity 0.12s var(--ease);
  }
  .tpl:hover .remove,
  .remove:focus-within {
    opacity: 1;
  }
  .row {
    display: flex;
    align-items: flex-end;
    gap: 16px;
  }
  .field {
    display: flex;
    flex-direction: column;
  }
  .name {
    flex: 1 1 280px;
    max-width: 360px;
  }
  .size {
    flex: 1;
  }
  .sizes {
    display: flex;
    gap: 6px;
  }
  .size-tile {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-2);
    font-size: 12.5px;
    cursor: pointer;
    white-space: nowrap;
  }
  .size-tile:hover {
    border-color: var(--border-strong);
  }
  .size-tile.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .size-tile:focus-within {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .shape {
    display: block;
    border: 1.5px solid currentColor;
    border-radius: 2px;
    color: var(--text-muted);
    transform: scale(0.75);
  }
  .on .shape {
    color: var(--accent-text);
  }
  .custom {
    display: grid;
    grid-template-columns: 160px auto 160px;
    align-items: center;
    gap: 8px;
  }
</style>
