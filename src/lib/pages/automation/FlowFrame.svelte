<script lang="ts">
  import { tick } from 'svelte';
  import type { CanvasColor } from '$lib/bindings/CanvasColor';
  import type { GraphFrame } from '$lib/bindings/GraphFrame';
  import { ChevronDown, ChevronRight } from '@lucide/svelte';
  import { COLORS, FRAME_BAR } from './canvas';
  import ColorDots from './ColorDots.svelte';

  interface Props {
    frame: GraphFrame;
    selected: boolean;
    /** Nodes inside, shown on a collapsed frame. */
    count: number;
    renaming: boolean;
    tools: boolean;
    onrename: (on: boolean) => void;
    onlabel: (label: string) => void;
    oncolor: (c: CanvasColor) => void;
    ontoggle: () => void;
  }

  let { frame, selected, count, renaming, tools, onrename, onlabel, oncolor, ontoggle }: Props = $props();

  let input = $state<HTMLInputElement>();
  $effect(() => {
    if (renaming)
      void tick().then(() => {
        input?.focus();
        input?.select();
      });
  });
</script>

<div
  class="frame"
  class:selected
  class:collapsed={frame.collapsed}
  style="left:{frame.x}px;top:{frame.y}px;width:{frame.w}px;height:{frame.collapsed ? FRAME_BAR : frame.h}px;--tone:{COLORS[frame.color] ?? COLORS.blue};--bar:{FRAME_BAR}px"
  data-frame={frame.id}
  data-x={Math.round(frame.x)}
  data-y={Math.round(frame.y)}
  data-collapsed={frame.collapsed}
>
  <div class="bar" data-item={frame.id} role="group" aria-label="Frame {frame.label}">
    <button
      type="button"
      class="fold"
      data-chip
      aria-expanded={!frame.collapsed}
      aria-label={frame.collapsed ? `Expand ${frame.label}` : `Collapse ${frame.label}`}
      onclick={ontoggle}
    >
      {#if frame.collapsed}<ChevronRight size={15} />{:else}<ChevronDown size={15} />{/if}
    </button>
    {#if renaming}
      <input
        bind:this={input}
        class="rename"
        aria-label="Frame name"
        value={frame.label}
        onchange={(e) => onlabel(e.currentTarget.value.trim() || 'Group')}
        onblur={() => onrename(false)}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (e.key === 'Enter') onlabel(e.currentTarget.value.trim() || 'Group');
            onrename(false);
          }
        }}
      />
    {:else}
      <span class="label truncate" title="Double-click to rename">{frame.label}</span>
    {/if}
    {#if frame.collapsed}<span class="count">{count} node{count === 1 ? '' : 's'}</span>{/if}
    {#if tools && !renaming}
      <div class="tools" data-chip><ColorDots value={frame.color} onpick={oncolor} /></div>
    {/if}
  </div>
  {#if !frame.collapsed}<div class="resize" data-resize={frame.id} aria-hidden="true"></div>{/if}
</div>

<style>
  .frame {
    position: absolute;
    box-sizing: border-box;
    border: 1.5px solid color-mix(in srgb, var(--tone) 45%, var(--border));
    border-radius: 12px;
    background: color-mix(in srgb, var(--tone) 7%, transparent);
    pointer-events: none;
  }
  .frame.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .frame.collapsed {
    background: color-mix(in srgb, var(--tone) 18%, var(--bg-1));
    box-shadow: 0 6px 16px rgb(0 0 0 / 0.16);
  }
  .bar {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    height: var(--bar);
    padding: 0 10px 0 6px;
    border-radius: 10px 10px 0 0;
    background: color-mix(in srgb, var(--tone) 20%, transparent);
    color: var(--text);
    pointer-events: auto;
    cursor: grab;
  }
  .collapsed .bar {
    border-radius: 10px;
  }
  .fold {
    display: grid;
    place-items: center;
    flex: none;
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }
  .fold:hover {
    background: color-mix(in srgb, var(--tone) 25%, transparent);
    color: var(--text);
  }
  .label {
    min-width: 0;
    font-size: 14px;
    font-weight: 650;
  }
  .rename {
    flex: 1;
    min-width: 0;
    height: 26px;
    padding: 0 6px;
    border: 1px solid var(--focus);
    border-radius: 6px;
    background: var(--bg-1);
    color: var(--text);
    font: inherit;
    font-size: 14px;
    font-weight: 650;
    outline: none;
  }
  .count {
    flex: none;
    padding: 1px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--tone) 25%, transparent);
    font-size: 11.5px;
    color: var(--text-muted);
  }
  .tools {
    margin-left: auto;
    padding: 3px 6px;
    border-radius: 8px;
    background: var(--bg-1);
    cursor: default;
  }
  .resize {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 16px;
    height: 16px;
    pointer-events: auto;
    cursor: nwse-resize;
    background: linear-gradient(135deg, transparent 50%, color-mix(in srgb, var(--tone) 70%, var(--text-faint)) 50% 60%, transparent 60% 72%, color-mix(in srgb, var(--tone) 70%, var(--text-faint)) 72% 82%, transparent 82%);
    border-bottom-right-radius: 11px;
  }
</style>
