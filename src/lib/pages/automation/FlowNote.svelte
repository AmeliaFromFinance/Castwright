<script lang="ts">
  import { tick } from 'svelte';
  import type { CanvasColor } from '$lib/bindings/CanvasColor';
  import type { GraphNote } from '$lib/bindings/GraphNote';
  import { openExternal } from '$lib/util/os';
  import { Pencil } from '@lucide/svelte';
  import { COLORS } from './canvas';
  import ColorDots from './ColorDots.svelte';
  import { renderNote } from './notes';

  interface Props {
    note: GraphNote;
    selected: boolean;
    editing: boolean;
    /** Only one note or frame is selected, so show its tools. */
    tools: boolean;
    onedit: (on: boolean) => void;
    ontext: (text: string) => void;
    oncolor: (c: CanvasColor) => void;
  }

  let { note, selected, editing, tools, onedit, ontext, oncolor }: Props = $props();

  let area = $state<HTMLTextAreaElement>();
  const html = $derived(renderNote(note.text));

  $effect(() => {
    if (editing) void tick().then(() => area?.focus());
  });

  function click(e: MouseEvent) {
    const a = (e.target as Element).closest('a');
    if (!a) return;
    e.preventDefault();
    void openExternal(a.href);
  }
</script>

<div
  class="note"
  class:selected
  class:editing
  style="left:{note.x}px;top:{note.y}px;width:{note.w}px;height:{note.h}px;--tone:{COLORS[note.color] ?? COLORS.yellow}"
  data-note={note.id}
  data-item={note.id}
  data-x={Math.round(note.x)}
  data-y={Math.round(note.y)}
  role="note"
  aria-label="Note"
>
  {#if tools && !editing}
    <div class="tools" data-chip>
      <ColorDots value={note.color} onpick={oncolor} />
      <button type="button" class="edit" aria-label="Edit note" title="Edit (or double-click the note)" onclick={() => onedit(true)}><Pencil size={13} /></button>
    </div>
  {/if}
  {#if editing}
    <textarea
      bind:this={area}
      class="area"
      aria-label="Note text"
      placeholder="Write a note. **bold**, *italics*, [link](https://…), - list"
      value={note.text}
      oninput={(e) => ontext(e.currentTarget.value)}
      onblur={() => onedit(false)}
      onkeydown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onedit(false);
        }
      }}
    ></textarea>
  {:else}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="text" onclick={click}>
      {#if html}{@html html}{:else}<p class="empty">Double-click to write</p>{/if}
    </div>
  {/if}
  <div class="resize" data-resize={note.id} aria-hidden="true"></div>
</div>

<style>
  .note {
    position: absolute;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    border: 1px solid color-mix(in srgb, var(--tone) 55%, var(--border));
    border-radius: 8px;
    background: color-mix(in srgb, var(--tone) 20%, var(--bg-1));
    color: var(--text);
    box-shadow: 0 6px 16px rgb(0 0 0 / 0.14);
    cursor: grab;
  }
  .note.selected {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .text {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 10px 12px;
    font-size: 13px;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  .text :global(p),
  .text :global(ul),
  .text :global(ol) {
    margin: 0 0 6px;
  }
  .text :global(ul),
  .text :global(ol) {
    padding-left: 18px;
  }
  .text :global(a) {
    color: var(--accent-text);
    text-decoration: underline;
    cursor: pointer;
  }
  .empty {
    color: var(--text-faint);
  }
  .area {
    flex: 1;
    min-height: 0;
    margin: 4px;
    padding: 6px 8px;
    border: 1px solid var(--focus);
    border-radius: 6px;
    background: var(--bg-1);
    color: var(--text);
    font: inherit;
    font-size: 13px;
    line-height: 1.45;
    resize: none;
    outline: none;
    cursor: text;
  }
  .tools {
    position: absolute;
    left: 0;
    bottom: calc(100% + 8px);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-1);
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.18);
    cursor: default;
  }
  .edit {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }
  .edit:hover {
    background: var(--bg-3);
    color: var(--text);
  }
  .resize {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 14px;
    height: 14px;
    cursor: nwse-resize;
    background: linear-gradient(135deg, transparent 50%, color-mix(in srgb, var(--tone) 70%, var(--text-faint)) 50% 60%, transparent 60% 72%, color-mix(in srgb, var(--tone) 70%, var(--text-faint)) 72% 82%, transparent 82%);
    border-bottom-right-radius: 8px;
  }
</style>
