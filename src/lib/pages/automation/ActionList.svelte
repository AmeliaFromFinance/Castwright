<script lang="ts">
  import type { Action } from '$lib/bindings/Action';
  import Popover from '$lib/editor/ui/Popover.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Collapse from '$lib/ui/Collapse.svelte';
  import ContextMenu, { type ContextItem } from '$lib/ui/ContextMenu.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import { Copy, Download, Ellipsis, Search, Trash2, X } from '@lucide/svelte';
  import { describeTriggers } from './describe';
  import { groupActions } from './sections';
  import { actionsEditor as ed, runLog } from './store.svelte';
  import { blocking } from './validate';

  interface Props {
    onexport: (ids: string[], label: string) => void;
    onduplicate: (a: Action) => void;
    ondelete: (a: Action) => void;
  }

  let { onexport, onduplicate, ondelete }: Props = $props();

  const groups = $derived(groupActions(ed.actions ?? [], ed.search));
  const searching = $derived(ed.search.trim() !== '');
  const order = $derived(groups.flatMap((g) => g.actions.map((a) => a.id)));

  /** Actions picked with Ctrl or Shift, for exporting several at once. */
  let marked = $state<string[]>([]);
  let anchor: string | null = null;
  const many = $derived(marked.filter((id) => order.includes(id)));

  function pick(e: MouseEvent, a: Action) {
    if (e.shiftKey) {
      const from = order.indexOf(anchor ?? ed.selectedId ?? a.id);
      const to = order.indexOf(a.id);
      marked = order.slice(Math.min(from, to), Math.max(from, to) + 1);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      const base = marked.length ? marked : ed.selectedId ? [ed.selectedId] : [];
      marked = base.includes(a.id) ? base.filter((x) => x !== a.id) : [...base, a.id];
      anchor = a.id;
      return;
    }
    marked = [];
    anchor = a.id;
    ed.selectedId = a.id;
  }

  const exportMarked = () => onexport(many, `${many.length} actions`);

  let menuAt = $state<{ x: number; y: number } | null>(null);
  let menuItems = $state<ContextItem[]>([]);

  function openMenu(e: MouseEvent, a: Action) {
    e.preventDefault();
    menuItems =
      many.length > 1 && many.includes(a.id)
        ? [{ label: `Export ${many.length} actions…`, icon: Download, onselect: exportMarked }]
        : [
            { label: 'Export…', icon: Download, onselect: () => onexport([a.id], a.name) },
            { label: 'Duplicate', icon: Copy, onselect: () => onduplicate(a) },
            { label: 'Delete…', icon: Trash2, danger: true, onselect: () => ondelete(a) }
          ];
    menuAt = { x: e.clientX, y: e.clientY };
  }

  function status(a: Action): { tone: string; text: string } {
    if (blocking(ed.issues[a.id] ?? []).length) return { tone: 'warn', text: 'Needs fixing' };
    const r = runLog.last[a.id];
    if (!r) return { tone: 'idle', text: 'Not run yet' };
    return r.ok ? { tone: 'ok', text: 'Last run worked' } : { tone: 'err', text: 'Last run had errors' };
  }
</script>

<nav class="list" aria-label="Actions">
  <div class="search">
    <Search size={14} />
    <input class="input" type="search" placeholder="Search actions" aria-label="Search actions" bind:value={ed.search} />
  </div>
  <div class="scroll">
    {#each groups as g (g.name)}
      <Collapse id="automation.section.{g.name}" title={g.name} meta={g.actions.length} forceOpen={searching} class="sec">
        {#snippet actions()}
          <Popover label="{g.name} group" align="end" width={190}>
            {#snippet trigger(p)}
              <IconButton label="More for {g.name}" size="sm" class="group-more" {...p}><Ellipsis /></IconButton>
            {/snippet}
            {#snippet children(close)}
              <button
                type="button"
                role="menuitem"
                class="mi"
                onclick={() => {
                  close();
                  onexport(
                    g.actions.map((a) => a.id),
                    g.name
                  );
                }}><Download />Export group…</button
              >
            {/snippet}
          </Popover>
        {/snippet}
        <ul aria-label={g.name}>
          {#each g.actions as a (a.id)}
            {@const st = status(a)}
            <li class:on={ed.selectedId === a.id} class:marked={many.length > 1 && many.includes(a.id)} oncontextmenu={(e) => openMenu(e, a)}>
              <button
                type="button"
                class="pick"
                aria-current={ed.selectedId === a.id ? 'true' : undefined}
                aria-pressed={many.length > 1 ? many.includes(a.id) : undefined}
                title="Ctrl or Shift click to pick several"
                onclick={(e) => pick(e, a)}
              >
                <span class="dot {st.tone}" title={st.text} aria-hidden="true"></span>
                <span class="text">
                  <span class="name truncate" class:off={!a.enabled}>{a.name || 'Untitled'}</span>
                  <span class="meta truncate faint">{describeTriggers(a)}</span>
                </span>
                <span class="sr-only">({st.text})</span>
              </button>
              <Switch label="{a.name} on" checked={a.enabled} onchange={(v) => ed.patchAction(a.id, { enabled: v })} />
            </li>
          {/each}
        </ul>
      </Collapse>
    {:else}
      <p class="none faint">{ed.search ? 'No actions match.' : 'No actions yet.'}</p>
    {/each}
  </div>
  {#if many.length > 1}
    <div class="picked" role="toolbar" aria-label="Picked actions">
      <span class="count">{many.length} picked</span>
      <Button size="sm" onclick={exportMarked}><Download size={13} />Export…</Button>
      <IconButton label="Clear picked actions" size="sm" onclick={() => (marked = [])}><X /></IconButton>
    </div>
  {/if}
</nav>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && many.length && !menuAt) marked = [];
  }}
/>

<ContextMenu at={menuAt} label="Action" items={menuItems} onclose={() => (menuAt = null)} />

<style>
  .list {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    background: color-mix(in srgb, var(--bg-1) 60%, transparent);
  }
  .search {
    position: relative;
    display: flex;
    align-items: center;
    padding: 10px 10px 6px;
    color: var(--text-faint);
  }
  .search :global(svg) {
    position: absolute;
    left: 20px;
    pointer-events: none;
  }
  .search input {
    padding-left: 30px;
  }
  .scroll {
    flex: 1;
    overflow: auto;
    min-height: 0;
    padding: 0 6px 10px;
  }
  .scroll :global(.sec) {
    margin-top: 4px;
  }
  .scroll :global(.sec > .head) {
    padding: 0 4px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 4px;
    padding-right: 6px;
    border-radius: var(--radius);
  }
  li:hover {
    background: var(--bg-2);
  }
  li.on {
    background: var(--bg-3);
  }
  li.marked {
    background: var(--accent-soft);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .scroll :global(.group-more) {
    opacity: 0;
  }
  .scroll :global(.sec > .head:hover .group-more),
  .scroll :global(.group-more:focus-visible),
  .scroll :global(.group-more[aria-expanded='true']) {
    opacity: 1;
  }
  .picked {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-top: 1px solid var(--border);
    background: var(--bg-1);
  }
  .count {
    flex: 1;
    font-size: 12px;
    font-weight: 600;
  }
  .pick {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 4px 6px 10px;
    border: 0;
    background: transparent;
    text-align: left;
    cursor: pointer;
    border-radius: var(--radius);
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .name {
    font-weight: 550;
  }
  li.on .name {
    font-weight: 650;
  }
  .name.off {
    color: var(--text-faint);
  }
  .meta {
    font-size: 11.5px;
  }
  .dot {
    width: 7px;
    height: 7px;
    flex: none;
    border-radius: 50%;
    background: var(--border-strong);
  }
  .dot.ok {
    background: var(--ok);
  }
  .dot.err {
    background: var(--danger);
  }
  .dot.warn {
    background: var(--warn);
  }
  .none {
    padding: 16px 10px;
    font-size: 12px;
  }
</style>
