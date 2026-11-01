<script lang="ts">
  import { api } from '$lib/api';
  import { app } from '$lib/state/app.svelte';
  import { attempt } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import { Pin, Plus, Search, X } from '@lucide/svelte';
  import { VAR_KEY_HELP, isValidVarKey, parseVarValue, varText } from './validate';

  // Never saved by the backend, whatever is asked.
  const LIVE = /^(stream|obs|twitch)\./;
  // The backend doesn't report which variables are kept, so guess for edits.
  const guessPersist = (k: string) => !LIVE.test(k) && !/^(session|last)\./.test(k);

  let search = $state('');
  let adding = $state(false);
  let newKey = $state('');
  let newValue = $state('');
  let newPersist = $state(true);
  let keyError = $state<string | null>(null);
  let pinned = $state<Record<string, boolean>>({});

  const keys = $derived(
    Object.keys(app.vars)
      .filter((k) => !search.trim() || k.toLowerCase().includes(search.trim().toLowerCase()))
      .sort()
  );

  const persistOf = (k: string) => pinned[k] ?? guessPersist(k);

  function commit(k: string, text: string) {
    const prev = app.vars[k];
    const value = parseVarValue(text, prev);
    if (value === prev) return;
    void attempt(() => api.setVar(k, value, persistOf(k)));
  }

  function togglePin(k: string) {
    pinned[k] = !persistOf(k);
    void attempt(() => api.setVar(k, app.vars[k], pinned[k]!));
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
      pinned[k] = newPersist && !LIVE.test(k);
      newKey = '';
      newValue = '';
      adding = false;
    }
  }
</script>

<section class="vars" aria-label="Variables">
  <header>
    <h3 class="eyebrow">Variables</h3>
    <span class="faint count">{Object.keys(app.vars).length}</span>
    <div class="grow"></div>
    <Button size="sm" variant="ghost" pressed={adding} onclick={() => (adding = !adding)}><Plus size={13} />Add</Button>
  </header>

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

  <ul>
    {#each keys as k (k)}
      {@const live = LIVE.test(k)}
      <li>
        <span class="key mono truncate" title={k}>{k}</span>
        <input
          class="input mono val"
          aria-label="Value of {k}"
          spellcheck="false"
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
        {#if live}
          <span class="live faint" title="Updated by the app; never saved">live</span>
        {:else}
          <IconButton size="sm" label="Keep {k} after restart" pressed={persistOf(k)} onclick={() => togglePin(k)}><Pin /></IconButton>
        {/if}
        <IconButton size="sm" label="Delete {k}" tone="danger" onclick={() => attempt(() => api.deleteVar(k))}><X /></IconButton>
      </li>
    {:else}
      <li class="none faint">{search ? 'No variables match.' : 'No variables yet.'}</li>
    {/each}
  </ul>
</section>

<style>
  .vars {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-top: 1px solid var(--border);
  }
  header {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 38px;
    flex: none;
    padding: 0 8px 0 14px;
  }
  .count {
    font-size: 11px;
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
    grid-template-columns: minmax(0, 1fr) minmax(0, 0.9fr) auto auto;
    align-items: center;
    gap: 4px;
    padding: 2px 4px 2px 8px;
    border-radius: var(--radius);
  }
  li:hover {
    background: var(--bg-2);
  }
  .key {
    font-size: 11.5px;
    color: var(--text-muted);
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
