<script lang="ts">
  import Button from '$lib/ui/Button.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import NumberInput from '$lib/editor/ui/NumberInput.svelte';
  import { MAX_SIZE, SIZE_PRESETS, type SizePreset } from '$lib/editor/starter';

  interface Props {
    open: boolean;
    busy?: boolean;
    oncreate: (opts: { name: string; width: number; height: number; starter: boolean }) => void;
  }

  let { open = $bindable(), busy = false, oncreate }: Props = $props();

  let name = $state('New overlay');
  let size = $state<SizePreset>('landscape');
  let width = $state(1920);
  let height = $state(1080);
  let starter = $state(true);

  $effect(() => {
    if (open) {
      name = 'New overlay';
      size = 'landscape';
      width = 1920;
      height = 1080;
      starter = true;
    }
  });

  const dims = $derived(size === 'custom' ? { width, height } : SIZE_PRESETS.find((p) => p.id === size)!);

  function submit(e: SubmitEvent) {
    e.preventDefault();
    oncreate({ name: name.trim() || 'New overlay', width: dims.width, height: dims.height, starter });
  }

  function shapeStyle(w: number, h: number) {
    const s = 22 / Math.max(w, h);
    return `width:${Math.round(w * s)}px;height:${Math.round(h * s)}px`;
  }
</script>

<Dialog bind:open title="New overlay" description="Set the size to match the Browser Source in OBS." width={520}>
  <form id="new-overlay" class="stack" onsubmit={submit}>
    <div class="field">
      <label class="label" for="new-ov-name">Name</label>
      <input id="new-ov-name" class="input" bind:value={name} maxlength="80" autocomplete="off" />
    </div>
    <fieldset>
      <legend class="label">Size</legend>
      <div class="tiles four">
        {#each SIZE_PRESETS as p (p.id)}
          <label class="tile" class:on={size === p.id}>
            <input type="radio" name="size" value={p.id} bind:group={size} class="sr-only" />
            <span class="shape-box"><span class="shape" style={p.id === 'custom' ? shapeStyle(width, height) : shapeStyle(p.width, p.height)}></span></span>
            <span class="t-label">{p.id === 'custom' ? 'Custom' : p.label}</span>
            <span class="t-sub faint">{p.id === 'landscape' ? 'Full HD' : p.id === 'hd' ? 'HD' : p.id === 'vertical' ? 'Vertical' : 'Any size'}</span>
          </label>
        {/each}
      </div>
      {#if size === 'custom'}
        <div class="custom">
          <NumberInput label="Width" prefix="W" unit="px" min={16} max={MAX_SIZE} value={width} oninput={(v) => (width = Math.round(v))} />
          <span class="faint">×</span>
          <NumberInput label="Height" prefix="H" unit="px" min={16} max={MAX_SIZE} value={height} oninput={(v) => (height = Math.round(v))} />
        </div>
      {/if}
    </fieldset>
    <fieldset>
      <legend class="label">Start with</legend>
      <div class="tiles two">
        <label class="tile wide" class:on={starter}>
          <input type="radio" name="start" value={true} bind:group={starter} class="sr-only" />
          <span class="t-label">Starter layout</span>
          <span class="t-sub faint">Sub goal, chat, alerts, recent events and a Live badge</span>
        </label>
        <label class="tile wide" class:on={!starter}>
          <input type="radio" name="start" value={false} bind:group={starter} class="sr-only" />
          <span class="t-label">Empty</span>
          <span class="t-sub faint">A blank canvas to build from scratch</span>
        </label>
      </div>
    </fieldset>
  </form>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="new-overlay" {busy}>Create overlay</Button>
  {/snippet}
</Dialog>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
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
  .tiles {
    display: grid;
    gap: 6px;
  }
  .four {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .two {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 10px 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-2);
    cursor: pointer;
    text-align: center;
    transition: border-color 0.12s var(--ease), background 0.12s var(--ease);
  }
  .tile:hover {
    border-color: var(--border-strong);
  }
  .tile.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .tile:focus-within {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .wide {
    align-items: flex-start;
    text-align: left;
    padding: 10px 12px;
  }
  .shape-box {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    margin-bottom: 4px;
  }
  .shape {
    display: block;
    border: 1.5px solid currentColor;
    border-radius: 3px;
    color: var(--text-muted);
  }
  .on .shape {
    color: var(--accent-text);
  }
  .t-label {
    font-size: 12.5px;
    font-weight: 600;
  }
  .t-sub {
    font-size: 11.5px;
    line-height: 1.35;
  }
  .custom {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
  }
</style>
