<script lang="ts">
  import { api } from '$lib/api';
  import type { ChecklistItem } from '$lib/bindings/ChecklistItem';
  import type { GoLiveSettings } from '$lib/bindings/GoLiveSettings';
  import { newId } from '$lib/editors/ids';
  import { app } from '$lib/state/app.svelte';
  import { golive } from '$lib/state/golive.svelte';
  import { attempt } from '$lib/state/toast.svelte';
  import { keepTicks } from '$lib/shell/golive';
  import Button from '$lib/ui/Button.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import { Plus, X } from '@lucide/svelte';
  import Row from './Row.svelte';

  const MAX = 30;
  const current = $derived(app.settings?.golive ?? { open_on_live: true, items: [] });
  let draft = $state('');

  async function save(next: GoLiveSettings) {
    const saved = await attempt(() => api.saveGoLive(next));
    if (saved && app.settings) {
      app.settings.golive = saved;
      golive.ticked = keepTicks(golive.ticked, saved.items.map((i) => i.id));
    }
  }

  function add() {
    const label = draft.trim();
    if (!label || current.items.length >= MAX) return;
    draft = '';
    void save({ ...current, items: [...current.items, { id: newId(), label }] });
  }

  function rename(item: ChecklistItem, label: string) {
    if (label.trim() === item.label) return;
    void save({ ...current, items: current.items.map((i) => (i.id === item.id ? { ...i, label } : i)) });
  }
</script>

<Row label="Open when the stream starts" hint="Only opens if a check fails.">
  <Switch label="Open when the stream starts" checked={current.open_on_live} onchange={(on) => save({ ...current, open_on_live: on })} />
</Row>
<div class="list">
  <div class="label">Your list</div>
  <p class="hint faint">Tick boxes for things Castwright can't check, like "Mic on". Ticks clear when the stream ends.</p>
  {#if current.items.length}
    <ul>
      {#each current.items as item (item.id)}
        <li>
          <input
            class="input"
            value={item.label}
            maxlength="80"
            aria-label="Checklist item"
            onchange={(e) => rename(item, e.currentTarget.value)}
          />
          <IconButton size="sm" label="Remove {item.label}" tone="danger" onclick={() => save({ ...current, items: current.items.filter((i) => i.id !== item.id) })}>
            <X />
          </IconButton>
        </li>
      {/each}
    </ul>
  {/if}
  <form
    class="add"
    onsubmit={(e) => {
      e.preventDefault();
      add();
    }}
  >
    <input class="input" bind:value={draft} maxlength="80" placeholder="Mic on" aria-label="New checklist item" disabled={current.items.length >= MAX} />
    <Button size="sm" type="submit" disabled={!draft.trim() || current.items.length >= MAX}><Plus size={14} />Add</Button>
  </form>
</div>

<style>
  .list {
    max-width: 760px;
  }
  .label {
    font-size: 13px;
    font-weight: 550;
  }
  .hint {
    font-size: 12px;
    margin: 2px 0 10px;
  }
  ul {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 6px;
  }
  li,
  .add {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 420px;
  }
  li .input,
  .add .input {
    flex: 1;
  }
</style>
