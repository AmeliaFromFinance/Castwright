<script lang="ts">
  import { DEFAULT_FONT, isDefaultFont } from '$lib/overlay/fonts';
  import { app } from '$lib/state/app.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import { RotateCcw } from '@lucide/svelte';

  interface Props {
    id: string;
    value: string;
    /** Suggestions. `Default` is added first unless `allowDefault` is false. */
    choices: readonly string[];
    onchange: (font: string) => void;
    /** False for the project default itself, which can't follow itself. */
    allowDefault?: boolean;
    label?: string;
    /** Several layers with different fonts are being edited. */
    mixed?: boolean;
  }

  let { id, value, choices, onchange, allowDefault = true, label, mixed = false }: Props = $props();

  const projectFont = $derived(app.project?.default_font || 'Inter');
  const list = $derived(allowDefault ? [DEFAULT_FONT, ...choices.filter((c) => c !== DEFAULT_FONT)] : choices.filter((c) => c !== DEFAULT_FONT));
  const usesDefault = $derived(!mixed && allowDefault && isDefaultFont(value));
</script>

<div class="font">
  <input
    {id}
    class="input"
    list="{id}-list"
    spellcheck="false"
    aria-label={label}
    placeholder={mixed ? 'Mixed' : allowDefault ? `Default (${projectFont})` : 'Inter'}
    value={mixed ? '' : usesDefault ? DEFAULT_FONT : value}
    title={usesDefault ? `The project's default font, now ${projectFont}` : undefined}
    onchange={(e) => {
      const v = e.currentTarget.value.trim();
      if (mixed && !v) return;
      onchange(v || (allowDefault ? DEFAULT_FONT : 'Inter'));
    }}
  />
  {#if allowDefault && !usesDefault}
    <IconButton size="sm" label="Use the default font" onclick={() => onchange(DEFAULT_FONT)}><RotateCcw /></IconButton>
  {/if}
  <datalist id="{id}-list">
    {#each list as f (f)}<option value={f}>{f === DEFAULT_FONT ? `Default (${projectFont})` : f}</option>{/each}
  </datalist>
</div>

<style>
  .font {
    display: flex;
    gap: 4px;
    align-items: center;
    min-width: 0;
  }
  .font .input {
    flex: 1;
    min-width: 0;
  }
</style>
