<script lang="ts">
  import { untrack } from 'svelte';
  import type { Overlay } from '$lib/bindings/Overlay';
  import Button from '$lib/ui/Button.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import { Plus, Target, X } from '@lucide/svelte';

  interface Props {
    open: boolean;
    overlay: Overlay;
    vars: Record<string, unknown>;
    overrides: Record<string, unknown>;
    onchange: (next: Record<string, unknown>) => void;
  }

  let { open = $bindable(), overlay, vars, overrides, onchange }: Props = $props();

  type Row = { key: string; text: string };
  let rows = $state<Row[]>([]);

  $effect(() => {
    if (open) untrack(() => (rows = Object.entries(overrides).map(([key, v]) => ({ key, text: show(v) }))));
  });

  function show(v: unknown): string {
    if (v === null || v === undefined) return '';
    return typeof v === 'string' ? v : JSON.stringify(v);
  }

  /** Numbers and true/false become real values; anything else stays text. */
  function parse(text: string): unknown {
    const t = text.trim();
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (t !== '' && Number.isFinite(Number(t))) return Number(t);
    return text;
  }

  function commit() {
    const next: Record<string, unknown> = {};
    for (const r of rows) if (r.key.trim()) next[r.key.trim()] = parse(r.text);
    onchange(next);
  }

  function add(key = '', value: unknown = '') {
    const existing = rows.find((r) => r.key === key && key);
    if (existing) existing.text = show(value);
    else rows.push({ key, text: show(value) });
    commit();
  }

  const goals = $derived(
    overlay.layers.flatMap((l) => (l.kind.type === 'goal' && l.kind.current_var ? [{ name: l.name, key: l.kind.current_var, target: l.kind.target }] : []))
  );
  const keys = $derived(Object.keys(vars).sort());
</script>

<Dialog bind:open title="Preview values" description="Try different values on the canvas. Nothing is saved or sent to OBS." width={520}>
  <div class="stack">
    {#if goals.length}
      <div class="quick">
        {#each goals as g (g.name + g.key)}
          {#each [0.25, 0.75, 1] as f (f)}
            <Button size="sm" onclick={() => add(g.key, Math.round(g.target * f * 100) / 100)}>
              <Target size={13} />{g.name} at {f * 100}%
            </Button>
          {/each}
        {/each}
      </div>
    {/if}
    {#if rows.length}
      <div class="rows">
        {#each rows as r, i (i)}
          <div class="r">
            <input
              class="input mono"
              aria-label="Variable"
              list="preview-var-keys"
              placeholder="session.subs"
              spellcheck="false"
              bind:value={r.key}
              oninput={commit}
            />
            <input class="input" aria-label="Value" placeholder={show(vars[r.key]) || 'value'} bind:value={r.text} oninput={commit} />
            <IconButton
              size="sm"
              label="Remove"
              tone="danger"
              onclick={() => {
                rows.splice(i, 1);
                commit();
              }}><X /></IconButton
            >
          </div>
        {/each}
      </div>
    {:else}
      <p class="muted">No preview values. The canvas uses your live values.</p>
    {/if}
    <div>
      <Button size="sm" variant="ghost" onclick={() => add()}><Plus size={14} />Add value</Button>
    </div>
    <datalist id="preview-var-keys">
      {#each keys as k (k)}<option value={k}>{show(vars[k])}</option>{/each}
    </datalist>
  </div>
  {#snippet footer()}
    {#if rows.length}
      <Button
        variant="ghost"
        onclick={() => {
          rows = [];
          commit();
        }}>Use live values</Button
      >
    {/if}
    <Button variant="primary" onclick={() => (open = false)}>Done</Button>
  {/snippet}
</Dialog>

<style>
  .quick {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .r {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) auto;
    gap: 6px;
    align-items: center;
  }
</style>
