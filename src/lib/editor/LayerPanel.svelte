<script lang="ts">
  import { tick } from 'svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, GripVertical, Lock, Trash2 } from '@lucide/svelte';
  import { LAYER_TYPES, typeLabel } from './layers';
  import type { EditorStore } from './store.svelte';
  import LayerIcon from './ui/LayerIcon.svelte';

  let { store }: { store: EditorStore } = $props();

  const SHORT: Record<string, string> = { event_list: 'Events', custom: 'Widget' };

  /** Front layer first. */
  const rows = $derived(store.doc.layers.slice().reverse());
  const sel = $derived(store.selected);
  const selIndex = $derived(sel ? store.doc.layers.findIndex((l) => l.id === sel.id) : -1);

  let renaming = $state<string | null>(null);
  let dragRow = $state<number | null>(null);
  let dropBefore = $state<number | null>(null);

  async function startRename(id: string) {
    renaming = id;
    await tick();
    const el = document.getElementById(`rename-${id}`) as HTMLInputElement | null;
    el?.focus();
    el?.select();
  }

  function finishRename(id: string, value: string, commit: boolean) {
    if (renaming !== id) return;
    renaming = null;
    if (commit) store.rename(id, value);
    void tick().then(() => document.getElementById(`layer-${id}`)?.focus());
  }

  function onDragStart(e: DragEvent, row: number) {
    dragRow = row;
    e.dataTransfer?.setData('text/plain', String(row));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e: DragEvent, row: number) {
    if (dragRow === null) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dropBefore = e.clientY < r.top + r.height / 2 ? row : row + 1;
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    if (dragRow !== null && dropBefore !== null) store.moveInList(dragRow, dropBefore);
    dragRow = null;
    dropBefore = null;
  }

  function onRowKey(e: KeyboardEvent, id: string) {
    if (e.key === 'F2' || (e.key === 'Enter' && e.altKey)) {
      e.preventDefault();
      void startRename(id);
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.ctrlKey && !e.metaKey) {
      // Move focus through the list instead of nudging the layer.
      e.preventDefault();
      e.stopPropagation();
      const i = rows.findIndex((r) => r.id === id);
      const next = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) {
        store.select(next.id);
        document.getElementById(`layer-${next.id}`)?.focus();
      }
    }
  }
</script>

<aside class="left" aria-label="Layers">
  <section class="add">
    <h3 class="eyebrow">Add layer</h3>
    <div class="types">
      {#each LAYER_TYPES as t (t.type)}
        <button type="button" class="type" title={t.hint} aria-label="Add {t.label.toLowerCase()} layer" onclick={() => store.addLayer(t.type)}>
          <LayerIcon type={t.type} size={16} />
          <span>{SHORT[t.type] ?? t.label}</span>
        </button>
      {/each}
    </div>
  </section>

  <section class="layers">
    <header>
      <h3 class="eyebrow">Layers</h3>
      <span class="faint count">{rows.length}</span>
      <div class="grow"></div>
      <IconButton size="sm" label="Bring forward" disabled={!sel || selIndex === store.doc.layers.length - 1} onclick={() => sel && store.move(sel.id, 1)}>
        <ArrowUp />
      </IconButton>
      <IconButton size="sm" label="Send backward" disabled={!sel || selIndex === 0} onclick={() => sel && store.move(sel.id, -1)}>
        <ArrowDown />
      </IconButton>
      <IconButton size="sm" label="Duplicate layer" disabled={!sel} onclick={() => sel && store.duplicate(sel.id)}>
        <Copy />
      </IconButton>
      <IconButton size="sm" label="Delete layer" tone="danger" disabled={!sel} onclick={() => sel && store.remove(sel.id)}>
        <Trash2 />
      </IconButton>
    </header>
    {#if rows.length}
      <ul class="list" aria-label="Layers, front first" ondragleave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && (dropBefore = null)}>
        {#each rows as l, i (l.id)}
          <li
            class="item"
            class:on={l.id === store.selectedId}
            class:hidden={!l.visible}
            class:dragging={dragRow === i}
            class:drop-before={dropBefore === i && dragRow !== null && dragRow !== i && dragRow !== i - 1}
            class:drop-after={dropBefore === i + 1 && i === rows.length - 1 && dragRow !== null && dragRow !== i}
            draggable={renaming !== l.id}
            data-layer-row={l.id}
            ondragstart={(e) => onDragStart(e, i)}
            ondragover={(e) => onDragOver(e, i)}
            ondrop={onDrop}
            ondragend={() => {
              dragRow = null;
              dropBefore = null;
            }}
          >
            <span class="grip" aria-hidden="true"><GripVertical size={13} /></span>
            {#if renaming === l.id}
              <span class="icon"><LayerIcon type={l.kind.type} /></span>
              <input
                id="rename-{l.id}"
                class="rename"
                aria-label="Layer name"
                value={l.name}
                onkeydown={(e) => {
                  if (e.key === 'Enter') finishRename(l.id, e.currentTarget.value, true);
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    finishRename(l.id, '', false);
                  }
                }}
                onblur={(e) => finishRename(l.id, e.currentTarget.value, true)}
              />
            {:else}
              <button
                type="button"
                class="pick"
                id="layer-{l.id}"
                aria-pressed={l.id === store.selectedId}
                title="{typeLabel(l.kind.type)} · double-click or F2 to rename"
                onclick={() => store.select(l.id)}
                ondblclick={() => startRename(l.id)}
                onkeydown={(e) => onRowKey(e, l.id)}
              >
                <span class="icon"><LayerIcon type={l.kind.type} /></span>
                <span class="name truncate">{l.name}</span>
              </button>
            {/if}
            <span class="tools">
              <IconButton size="sm" label={l.locked ? `Unlock ${l.name}` : `Lock ${l.name}`} pressed={l.locked} class={l.locked ? 'keep' : ''} onclick={() => store.toggleLocked(l.id)}>
                <Lock />
              </IconButton>
              <IconButton size="sm" label={l.visible ? `Hide ${l.name}` : `Show ${l.name}`} pressed={!l.visible} class={!l.visible ? 'keep' : ''} onclick={() => store.toggleVisible(l.id)}>
                {#if l.visible}<Eye />{:else}<EyeOff />{/if}
              </IconButton>
            </span>
          </li>
        {/each}
      </ul>
    {:else}
      <div class="empty">
        <p>No layers yet</p>
        <p class="faint">Add one above to start building.</p>
      </div>
    {/if}
  </section>
</aside>

<style>
  .left {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    border-right: 1px solid var(--border);
    background: var(--bg-1);
  }
  .add {
    padding: 12px 12px 14px;
    border-bottom: 1px solid var(--border);
    flex: none;
  }
  .types {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px;
    margin-top: 10px;
  }
  .type {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: 50px;
    padding: 0 2px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-2);
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 550;
    cursor: pointer;
    transition: background 0.12s var(--ease), color 0.12s var(--ease), border-color 0.12s var(--ease);
  }
  .type:hover {
    background: var(--bg-3);
    border-color: var(--border-strong);
    color: var(--text);
  }
  .type span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .layers {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .layers header {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 40px;
    padding: 0 6px 0 12px;
    flex: none;
  }
  .count {
    margin-left: 6px;
    font-size: 11px;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0 6px 10px;
    overflow: auto;
    flex: 1;
    min-height: 0;
  }
  .item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 2px;
    height: 32px;
    padding: 0 4px 0 2px;
    border-radius: var(--radius);
  }
  .item:hover {
    background: var(--bg-2);
  }
  .item.on {
    background: var(--accent-soft);
  }
  .item.dragging {
    opacity: 0.45;
  }
  .item.drop-before::before,
  .item.drop-after::after {
    content: '';
    position: absolute;
    left: 6px;
    right: 6px;
    height: 2px;
    border-radius: 2px;
    background: var(--accent);
  }
  .item.drop-before::before {
    top: -1px;
  }
  .item.drop-after::after {
    bottom: -1px;
  }
  .grip {
    display: grid;
    place-items: center;
    width: 14px;
    color: var(--text-faint);
    cursor: grab;
    opacity: 0;
    flex: none;
  }
  .item:hover .grip {
    opacity: 1;
  }
  .pick {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 6px;
    border: 0;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  .icon {
    display: grid;
    place-items: center;
    color: var(--text-muted);
    flex: none;
  }
  .on .icon,
  .on .name {
    color: var(--accent-text);
  }
  .on .name {
    font-weight: 600;
  }
  .hidden .name,
  .hidden .icon {
    opacity: 0.5;
  }
  .rename {
    flex: 1;
    min-width: 0;
    height: 26px;
    margin-left: 6px;
    padding: 0 6px;
    border: 1px solid var(--focus);
    border-radius: 5px;
    background: var(--bg-2);
    outline: none;
  }
  .tools {
    display: flex;
    flex: none;
  }
  .tools :global(.ibtn) {
    opacity: 0;
  }
  .item:hover .tools :global(.ibtn),
  .item.on .tools :global(.ibtn),
  .tools :global(.ibtn:focus-visible),
  .tools :global(.ibtn.keep) {
    opacity: 1;
  }
  .empty {
    padding: 24px 16px;
    text-align: center;
    font-size: 12.5px;
  }
</style>
