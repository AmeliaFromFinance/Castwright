<script lang="ts">
  import { api } from '$lib/api';
  import type { ActionPackage } from '$lib/bindings/ActionPackage';
  import type { ConflictChoice } from '$lib/bindings/ConflictChoice';
  import type { ImportReport } from '$lib/bindings/ImportReport';
  import type { RefKind } from '$lib/bindings/RefKind';
  import { app } from '$lib/state/app.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import { assetStore } from '$lib/widgets/assets.svelte';
  import { CircleAlert, Info, Link2 } from '@lucide/svelte';
  import GraphPreview from './GraphPreview.svelte';
  import { importChoices, planImport, previewContext } from './sharing';
  import { actionsEditor as ed } from './store.svelte';
  import { varText } from './validate';

  interface Props {
    open: boolean;
    pkg: ActionPackage | null;
    /** File name, shown under the title. */
    source: string;
    onimported: (report: ImportReport) => void;
  }

  let { open = $bindable(), pkg, source, onimported }: Props = $props();

  let conflicts = $state<Record<string, ConflictChoice>>({});
  let links = $state<Record<string, string | null>>({});
  let shown = $state<string | null>(null);
  let busy = $state(false);
  let error = $state('');

  $effect(() => {
    if (!open) return;
    void assetStore.load(true);
    conflicts = {};
    links = {};
    error = '';
    shown = pkg?.actions[0]?.id ?? null;
  });

  const plan = $derived(
    pkg
      ? planImport(pkg, {
          actions: ed.actions ?? app.project?.actions ?? [],
          overlays: app.project?.overlays ?? [],
          assets: assetStore.items.map((a) => a.name),
          vars: app.vars
        })
      : null
  );
  const linkOf = (key: string, match: string | null) => (key in links ? links[key]! : match);
  const unlinked = $derived(plan ? plan.refs.filter((r) => !linkOf(r.key, r.match)).length : 0);
  const skipped = $derived(plan ? plan.actions.filter((a) => a.conflict && conflicts[a.id] === 'skip').length : 0);
  const count = $derived((plan?.actions.length ?? 0) - skipped);
  const preview = $derived(pkg?.actions.find((a) => a.id === shown) ?? null);
  const previewCtx = $derived(pkg ? previewContext(pkg) : {});

  const KIND: Record<RefKind, string> = { layer: 'Layer', action: 'Action', asset: 'File' };

  async function submit() {
    if (!pkg || !plan) return;
    busy = true;
    error = '';
    try {
      // Anything typed but not yet saved goes first, so the import can't be overwritten.
      await ed.saver.flush();
      if (ed.held) {
        error = 'Fix the actions marked "Not saved" first, then import.';
        return;
      }
      const report = await api.importActions(pkg, importChoices(plan, conflicts, links));
      open = false;
      onimported(report);
    } catch (e) {
      error = e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Import failed.';
    } finally {
      busy = false;
    }
  }
</script>

<Dialog bind:open title="Import actions" description={source} width={980}>
  {#if plan && pkg}
    <p class="note" role="note"><Info size={15} />Imported actions start turned off, so nothing runs until you switch them on.</p>
    <div class="cols">
      <div class="lists">
        <section aria-labelledby="imp-actions">
          <h3 id="imp-actions">Actions <span class="faint">{plan.actions.length}</span></h3>
          <ul class="acts">
            {#each plan.actions as a (a.id)}
              <li class:on={shown === a.id}>
                <button type="button" class="act" aria-pressed={shown === a.id} onclick={() => (shown = a.id)}>
                  <span class="name truncate">{a.name || 'Untitled'}</span>
                  <span class="meta faint truncate">{a.triggers} · {a.steps} {a.steps === 1 ? 'step' : 'steps'}</span>
                </button>
                {#if a.conflict}
                  <div class="conflict">
                    <span class="warn-text"><CircleAlert size={13} />Name taken</span>
                    <select
                      class="input sm"
                      aria-label="When “{a.name}” already exists"
                      value={conflicts[a.id] ?? 'keep_both'}
                      onchange={(e) => (conflicts[a.id] = e.currentTarget.value as ConflictChoice)}
                    >
                      <option value="keep_both">Keep both</option>
                      <option value="replace">Replace mine</option>
                      <option value="skip">Skip</option>
                    </select>
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        </section>

        {#if plan.refs.length}
          <section aria-labelledby="imp-links">
            <h3 id="imp-links">Links <span class="faint">{plan.refs.length}</span></h3>
            <p class="hint faint">These aren't in the file. Pick what to use here.</p>
            <ul class="refs">
              {#each plan.refs as r (r.key)}
                {@const value = linkOf(r.key, r.match)}
                <li>
                  <span class="kind">{KIND[r.ref.kind]}</span>
                  <span class="what">
                    <span class="name truncate">{r.ref.name || 'Untitled'}</span>
                    {#if r.ref.overlay_name}<span class="meta faint truncate">in {r.ref.overlay_name}</span>{/if}
                  </span>
                  <Link2 size={14} class="faint" />
                  <select
                    class="input sm"
                    aria-label="Link {KIND[r.ref.kind].toLowerCase()} “{r.ref.name}”"
                    value={value ?? ''}
                    onchange={(e) => (links[r.key] = e.currentTarget.value || null)}
                  >
                    <option value="">Leave unlinked</option>
                    {#each r.options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
                  </select>
                  {#if !value}
                    <span class="warn-text full"><CircleAlert size={13} />Steps using it won't work until you link it.</span>
                  {/if}
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if plan.newVars.length}
          <section aria-labelledby="imp-vars">
            <h3 id="imp-vars">New variables <span class="faint">{plan.newVars.length}</span></h3>
            <ul class="vars">
              {#each plan.newVars as v (v.name)}
                <li>
                  <code>{v.name}</code>
                  <span class="faint">{v.secret ? 'value not included' : v.default === null ? 'empty' : `starts at ${varText(v.default)}`}</span>
                </li>
              {/each}
            </ul>
          </section>
        {/if}
      </div>

      <section class="flow" aria-label="Flow of {preview?.name ?? 'the action'}">
        {#if preview}
          <GraphPreview graph={preview.graph} ctx={previewCtx} />
        {/if}
      </section>
    </div>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  {/if}
  {#snippet footer()}
    {#if unlinked}<span class="footnote warn-text"><CircleAlert size={13} />{unlinked} unlinked</span>{/if}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" {busy} disabled={!count} onclick={submit}>Import {count} {count === 1 ? 'action' : 'actions'}</Button>
  {/snippet}
</Dialog>

<style>
  .note {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
    padding: 9px 12px;
    border-radius: var(--radius);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: 12.5px;
    font-weight: 550;
  }
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 16px;
    min-height: 0;
  }
  .lists {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }
  h3 {
    margin-bottom: 6px;
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .acts,
  .refs {
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .acts li,
  .refs li {
    border-top: 1px solid var(--border);
  }
  .acts li:first-child,
  .refs li:first-child {
    border-top: 0;
  }
  .acts li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-right: 10px;
  }
  .acts li.on {
    background: var(--bg-2);
  }
  .act {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 8px 12px;
    border: 0;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }
  .name {
    font-weight: 600;
  }
  .meta {
    font-size: 11.5px;
  }
  .conflict {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }
  .warn-text {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--warn);
    white-space: nowrap;
  }
  .refs li {
    display: grid;
    grid-template-columns: 52px minmax(0, 1fr) auto minmax(0, 200px);
    align-items: center;
    gap: 8px;
    padding: 8px 10px 8px 12px;
  }
  .kind {
    font-size: 11px;
    font-weight: 650;
    color: var(--text-muted);
  }
  .what {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .full {
    grid-column: 2 / -1;
    white-space: normal;
  }
  .hint {
    margin: -2px 0 8px;
    font-size: 12px;
  }
  .input.sm {
    height: 28px;
    padding: 0 8px;
    font-size: 12.5px;
  }
  .vars {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12.5px;
  }
  .vars li {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .flow {
    position: sticky;
    top: 0;
    align-self: start;
    height: 420px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background:
      radial-gradient(circle, color-mix(in srgb, var(--text) 10%, transparent) 1px, transparent 1.5px) 0 0 / 16px 16px,
      var(--bg-0);
    overflow: hidden;
  }
  .error {
    margin-top: 12px;
    color: var(--danger);
  }
  .footnote {
    margin-right: auto;
  }
</style>
