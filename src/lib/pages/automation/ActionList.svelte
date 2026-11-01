<script lang="ts">
  import type { Action } from '$lib/bindings/Action';
  import Switch from '$lib/ui/Switch.svelte';
  import { Search } from '@lucide/svelte';
  import { describeTriggers } from './describe';
  import { actionsEditor as ed, runLog } from './store.svelte';
  import { blocking } from './validate';

  const groups = $derived.by(() => {
    const q = ed.search.trim().toLowerCase();
    const list = (ed.actions ?? []).filter(
      (a) => !q || a.name.toLowerCase().includes(q) || a.group.toLowerCase().includes(q) || describeTriggers(a).toLowerCase().includes(q)
    );
    const map = new Map<string, Action[]>();
    for (const a of list) {
      const g = a.group.trim() || 'General';
      map.set(g, [...(map.get(g) ?? []), a]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  });

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
    {#each groups as [group, items] (group)}
      <section aria-label={group}>
        <h3 class="eyebrow">{group} <span class="count">{items.length}</span></h3>
        <ul>
          {#each items as a (a.id)}
            {@const st = status(a)}
            <li class:on={ed.selectedId === a.id}>
              <button
                type="button"
                class="pick"
                aria-current={ed.selectedId === a.id ? 'true' : undefined}
                onclick={() => (ed.selectedId = a.id)}
              >
                <span class="dot {st.tone}" title={st.text} aria-hidden="true"></span>
                <span class="text">
                  <span class="name truncate" class:off={!a.enabled}>{a.name || 'Untitled'}</span>
                  <span class="meta truncate faint">{describeTriggers(a)}</span>
                </span>
                <span class="sr-only">({st.text})</span>
              </button>
              <Switch
                label="{a.name} on"
                checked={a.enabled}
                onchange={(v) => {
                  a.enabled = v;
                  ed.changed();
                }}
              />
            </li>
          {/each}
        </ul>
      </section>
    {:else}
      <p class="none faint">{ed.search ? 'No actions match.' : 'No actions yet.'}</p>
    {/each}
  </div>
</nav>

<style>
  .list {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid var(--border);
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
    overflow: auto;
    min-height: 0;
    padding: 0 6px 10px;
  }
  h3 {
    padding: 10px 8px 4px;
  }
  .count {
    margin-left: 4px;
    color: var(--text-faint);
    font-weight: 500;
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
