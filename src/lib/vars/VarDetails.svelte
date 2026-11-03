<script lang="ts">
  import { api } from '$lib/api';
  import { ago } from '$lib/format';
  import { varText } from '$lib/pages/automation/validate';
  import { app } from '$lib/state/app.svelte';
  import { attempt } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import { Bell, CircleAlert, Layers, Radio, Zap } from '@lucide/svelte';
  import { varInspector as vi } from './inspector.svelte';
  import { typeOf } from './text';
  import type { VarRef } from './usage';

  const key = $derived(vi.details);
  const info = $derived(key ? vi.info(key) : null);
  const changed = $derived(key ? app.varTimes[key] : undefined);
  const kind = $derived.by(() => {
    if (!info) return '';
    const by = info.usage.builtIn ? `, set by ${info.usage.builtIn.source}` : '';
    if (info.live) return `Live${by}`;
    return `${info.saved ? 'Saved' : 'Session only'}${by}`;
  });

  function close() {
    vi.details = null;
  }

  async function remove() {
    const k = key;
    if (!k) return;
    if (await attempt(() => api.deleteVar(k).then(() => true))) close();
  }

  function rename(to: string) {
    if (!key) return;
    vi.renaming = { from: key, to };
    vi.details = null;
  }
</script>

{#snippet list(title: string, refs: VarRef[], empty: string)}
  <section class="group" aria-label={title}>
    <h3>{title} <span class="faint">{refs.length}</span></h3>
    {#if refs.length}
      <ul>
        {#each refs as r, i (i)}
          {@const w = r.where}
          <li>
            {#if w.type === 'app'}
              <span class="ref static"><Radio size={14} /><span class="what"><b>{w.title}</b><span class="faint">Updated by Castwright</span></span></span>
            {:else}
              <button type="button" class="ref" onclick={() => vi.goTo(w)}>
                {#if w.type === 'node'}<Zap size={14} />{:else if w.type === 'layer'}<Layers size={14} />{:else}<Bell size={14} />{/if}
                <span class="what">
                  <b class="truncate">{w.title}</b>
                  <span class="faint truncate">{w.detail} · {r.field}</span>
                </span>
                <span class="go faint">Open</span>
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="none faint">{empty}</p>
    {/if}
  </section>
{/snippet}

<Dialog open={!!info} title={key ?? ''} width={560} onclose={close}>
  {#if info}
    <dl class="facts">
      <dt>Value</dt>
      <dd class="mono val">{info.exists ? varText(info.value) || '(empty)' : 'Not set'}</dd>
      <dt>Type</dt>
      <dd>{typeOf(info.value, info.exists)}</dd>
      <dt>Kept</dt>
      <dd>{kind}</dd>
      <dt>Changed</dt>
      <dd>{changed ? ago(changed) : 'Not since Castwright started'}</dd>
    </dl>

    {#if info.problem?.type === 'unset'}
      <div class="problem" role="status">
        <CircleAlert size={15} />
        <div>
          <p>Something reads this variable, but nothing sets it. It may be a typo.</p>
          {#if info.problem.suggestion}
            {@const suggestion = info.problem.suggestion}
            <p class="fix">
              Did you mean <code>{suggestion}</code>?
              <Button size="sm" onclick={() => rename(suggestion)}>Change to {suggestion}…</Button>
            </p>
          {/if}
        </div>
      </div>
    {:else if info.problem?.type === 'unread'}
      <div class="problem" role="status">
        <CircleAlert size={15} />
        <div>
          <p>This variable is saved, but nothing in the project reads it. Custom widgets and the local API don't count, so check those first.</p>
          <p class="fix"><Button size="sm" variant="danger" onclick={remove}>Delete variable</Button></p>
        </div>
      </div>
    {/if}

    {@render list('Written by', info.usage.writers, 'Nothing in the project sets it.')}
    {@render list('Read by', info.usage.readers, 'Nothing in the project reads it.')}
  {/if}
  {#snippet footer()}
    {#if info && !info.live}
      <Button variant="danger" disabled={!info.exists} onclick={remove}>Delete</Button>
    {/if}
    <div class="grow"></div>
    {#if info && !info.usage.builtIn}
      <Button onclick={() => rename(info.key)}>Rename…</Button>
    {/if}
    <Button variant="primary" onclick={close}>Close</Button>
  {/snippet}
</Dialog>

<style>
  .facts {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 6px 16px;
    margin: 0 0 14px;
    font-size: 13px;
  }
  dt {
    color: var(--text-faint);
  }
  dd {
    margin: 0;
  }
  .val {
    overflow-wrap: anywhere;
  }
  .problem {
    display: flex;
    gap: 8px;
    margin-bottom: 14px;
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--warn) 9%, transparent);
    color: var(--text);
    font-size: 13px;
  }
  .problem > :global(svg) {
    flex: none;
    margin-top: 2px;
    color: var(--warn);
  }
  .fix {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
  }
  .group + .group {
    margin-top: 14px;
  }
  h3 {
    margin-bottom: 6px;
    font-size: 12px;
    font-weight: 650;
    color: var(--text-muted);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .ref {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 40px;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-2);
    color: var(--text-muted);
    text-align: left;
    font: inherit;
  }
  button.ref {
    cursor: pointer;
  }
  button.ref:hover,
  button.ref:focus-visible {
    border-color: var(--accent);
  }
  button.ref:hover .go {
    color: var(--accent-text);
  }
  .ref.static {
    background: transparent;
  }
  .what {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
    font-size: 12.5px;
  }
  .what b {
    color: var(--text);
    font-weight: 600;
  }
  .go {
    font-size: 12px;
  }
  .none {
    font-size: 12.5px;
  }
</style>
