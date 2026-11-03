<script lang="ts">
  import { api } from '$lib/api';
  import { app } from '$lib/state/app.svelte';
  import { attempt } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Collapse from '$lib/ui/Collapse.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import Segmented from '$lib/ui/Segmented.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import { varInspector as vi, type VarFilter, type VarInfo } from '$lib/vars/inspector.svelte';
  import { problemText } from '$lib/vars/text';
  import { CircleAlert, Pin, Plus, Search, X } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { VAR_KEY_HELP, isValidVarKey, parseVarValue, varText } from './validate';

  let { open = $bindable(true) }: { open?: boolean } = $props();

  let search = $state('');
  let filter = $state<VarFilter>('all');
  let adding = $state(false);
  let newKey = $state('');
  let newValue = $state('');
  let newPersist = $state(true);
  let keyError = $state<string | null>(null);
  let pinned = $state<Record<string, boolean>>({});

  // Ask again which variables are saved when variables come or go.
  const names = $derived(Object.keys(app.vars).sort().join('|'));
  onMount(() => vi.refreshSaved());
  $effect(() => {
    void names;
    vi.refreshSaved();
  });

  const problems = $derived(vi.infos.filter((i) => i.problem).length);
  const filters = $derived<Array<{ value: VarFilter; label: string }>>([
    { value: 'all', label: 'All' },
    { value: 'used', label: 'Used' },
    { value: 'unused', label: 'Unused' },
    { value: 'problems', label: problems ? `Problems ${problems}` : 'Problems' }
  ]);

  const show = (i: VarInfo): boolean => {
    if (filter === 'used') return i.usedIn > 0;
    if (filter === 'unused') return i.usedIn === 0;
    if (filter === 'problems') return !!i.problem;
    return true;
  };
  const rows = $derived.by(() => {
    const q = search.trim().toLowerCase();
    return vi.infos.filter((i) => show(i) && (!q || i.key.toLowerCase().includes(q)));
  });

  const persistOf = (k: string) => pinned[k] ?? vi.saved.has(k);

  function commit(k: string, text: string) {
    const prev = app.vars[k];
    const value = parseVarValue(text, prev);
    if (value === prev) return;
    void attempt(() => api.setVar(k, value, persistOf(k)));
  }

  async function togglePin(k: string) {
    pinned[k] = !persistOf(k);
    await attempt(() => api.setVar(k, app.vars[k], pinned[k]!));
    vi.refreshSaved();
  }

  async function add() {
    const k = newKey.trim();
    if (!isValidVarKey(k)) {
      keyError = k ? VAR_KEY_HELP : 'Name the variable.';
      return;
    }
    keyError = null;
    const ok = await attempt(() => api.setVar(k, parseVarValue(newValue), newPersist).then(() => true));
    if (ok) {
      pinned[k] = newPersist;
      newKey = '';
      newValue = '';
      adding = false;
    }
  }
</script>

<section class="vars pane" aria-label="Variables">
  <Collapse id="automation.vars" title="Variables" meta={vi.infos.length} bind:open>
    {#snippet actions()}
      <Button size="sm" variant="ghost" pressed={adding} onclick={() => (adding = !adding)}><Plus size={13} />Add</Button>
    {/snippet}

  {#if adding}
    <form
      class="add"
      onsubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <div class="pair">
        <input
          class="input mono"
          placeholder="name, e.g. counter.wins"
          aria-label="New variable name"
          aria-invalid={keyError ? 'true' : undefined}
          spellcheck="false"
          bind:value={newKey}
        />
        <input class="input mono" placeholder="value" aria-label="New variable value" spellcheck="false" bind:value={newValue} />
      </div>
      {#if keyError}<p class="error" role="alert">{keyError}</p>{/if}
      <div class="row">
        <Switch label="Keep after restart" showLabel bind:checked={newPersist} />
        <div class="grow"></div>
        <Button size="sm" onclick={() => (adding = false)}>Cancel</Button>
        <Button size="sm" variant="primary" type="submit">Add</Button>
      </div>
    </form>
  {/if}

  <div class="search">
    <Search size={13} />
    <input class="input" type="search" placeholder="Search variables" aria-label="Search variables" bind:value={search} />
  </div>
  <div class="filter">
    <Segmented label="Show variables" options={filters} bind:value={filter} />
  </div>

  <ul>
    {#each rows as i (i.key)}
      {@const k = i.key}
      {@const note = problemText(i.problem)}
      <li class:problem={!!i.problem}>
        <button type="button" class="open" title={note ? `${k}: ${note}` : `${k}: details`} aria-label="{k} details" onclick={() => (vi.details = k)}>
          {#if i.problem}<CircleAlert size={12} />{/if}
          <span class="key mono truncate">{k}</span>
          {#if i.usedIn}<span class="used">Used in {i.usedIn}</span>{/if}
        </button>
        <input
          class="input mono val"
          aria-label="Value of {k}"
          spellcheck="false"
          placeholder={i.exists ? '' : 'not set'}
          value={varText(app.vars[k])}
          onkeydown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              e.currentTarget.value = varText(app.vars[k]);
              e.currentTarget.blur();
            }
          }}
          onchange={(e) => commit(k, e.currentTarget.value)}
        />
        {#if i.live}
          <span class="live faint" title="Updated by the app; never saved">live</span>
        {:else}
          <IconButton size="sm" label="Keep {k} after restart" pressed={persistOf(k)} disabled={!i.exists} onclick={() => togglePin(k)}><Pin /></IconButton>
        {/if}
        <IconButton size="sm" label="Delete {k}" tone="danger" disabled={!i.exists} onclick={() => attempt(() => api.deleteVar(k))}><X /></IconButton>
      </li>
    {:else}
      <li class="none faint">{search || filter !== 'all' ? 'No variables match.' : 'No variables yet.'}</li>
    {/each}
  </ul>
  </Collapse>
</section>

<style>
  .vars {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .add {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0 10px 8px;
    padding: 8px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--bg-2);
  }
  .pair {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    gap: 6px;
  }
  .search {
    position: relative;
    display: flex;
    align-items: center;
    padding: 0 10px 6px;
    color: var(--text-faint);
  }
  .search :global(svg) {
    position: absolute;
    left: 20px;
    top: 50%;
    transform: translateY(calc(-50% - 3px));
    pointer-events: none;
  }
  .search input {
    padding-left: 28px;
    height: calc(var(--row-h) - 4px);
  }
  .filter {
    padding: 0 10px 6px;
  }
  .filter :global(.seg) {
    width: 100%;
  }
  .filter :global(.seg button) {
    flex: 1;
    padding: 0 6px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0 6px 8px;
    overflow: auto;
    min-height: 0;
    flex: 1;
  }
  li {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(0, 0.75fr) auto auto;
    align-items: center;
    gap: 4px;
    padding: 2px 4px 2px 8px;
    border-radius: var(--radius);
  }
  li:hover {
    background: var(--bg-2);
  }
  .open {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    height: calc(var(--row-h) - 8px);
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-muted);
    text-align: left;
    cursor: pointer;
  }
  .open:hover .key,
  .open:focus-visible .key {
    color: var(--accent-text);
    text-decoration: underline;
  }
  .problem .open {
    color: var(--warn);
  }
  .open > :global(svg) {
    flex: none;
  }
  .key {
    min-width: 0;
    font-size: 11.5px;
  }
  .used {
    flex: none;
    margin-left: auto;
    padding: 0 6px;
    border-radius: 999px;
    border: 1px solid var(--border);
    font-size: 10.5px;
    line-height: 16px;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .val {
    height: calc(var(--row-h) - 8px);
    padding: 0 6px;
    font-size: 11.5px;
    background: transparent;
    border-color: transparent;
  }
  .val:hover {
    border-color: var(--border-strong);
  }
  .val:focus {
    background: var(--bg-2);
  }
  .live {
    font-size: 10.5px;
    width: calc(var(--row-h) - 8px);
    text-align: center;
  }
  .none {
    display: block;
    font-size: 12px;
    padding: 6px 8px;
  }
  .none:hover {
    background: none;
  }
  .error {
    font-size: 12px;
    color: var(--danger);
  }
</style>
