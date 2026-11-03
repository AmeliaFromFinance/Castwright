<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { bytes, clock } from '$lib/format';
  import Button from '$lib/ui/Button.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import { openExternal } from '$lib/util/os';
  import { Check, ExternalLink, FileText, ShieldCheck } from '@lucide/svelte';
  import { issueUrl } from './health';
  import { health } from './store.svelte';

  const p = $derived(health.preview);
  const total = $derived(p ? p.files.reduce((n, f) => n + f.bytes, 0) : 0);

  const ALWAYS = ['App version and system', 'Settings, with secrets removed', 'Recent log', 'Health check', 'Counts of overlays, layers and actions'];
</script>

<Dialog bind:open={health.reportOpen} title="Save a bug report" description="Puts what's needed to look into a problem in one .zip file." width={560}>
  <h3 class="eyebrow">What's included</h3>
  <ul class="checks">
    {#each ALWAYS as item (item)}
      <li><Check size={14} />{item}</li>
    {/each}
    {#if p?.has_crash}<li><Check size={14} />Details of the last crash</li>{/if}
    <li class="opt">
      <label>
        <input type="checkbox" bind:checked={health.includeProject} onchange={() => health.loadPreview()} />
        <span>
          Include project
          <span class="hint">Your overlays, alerts and actions, so the problem can be repeated. Secrets are still removed.</span>
        </span>
      </label>
    </li>
  </ul>

  <h3 class="eyebrow">Files</h3>
  {#if p}
    <ul class="files" aria-label="Files in the report">
      {#each p.files as f (f.name)}
        <li><FileText size={13} /><span class="mono">{f.name}</span><span class="muted grow">{f.what}</span><span class="faint mono">{bytes(f.bytes)}</span></li>
      {/each}
    </ul>
    <p class="faint small">{p.file_name} · about {bytes(total)} before compression</p>
  {:else}
    <p class="muted small">Getting the list…</p>
  {/if}

  <p class="note"><ShieldCheck size={15} /><span>Nothing is uploaded. Sign-ins, passwords, tokens, webhook links and email addresses are removed. Your home folder shows as ~.</span></p>
  <p class="small">
    To share it, open a GitHub issue and drag the file into it.
    <button type="button" class="link" onclick={() => openExternal(issueUrl(app.info?.version ?? ''))}>Open GitHub issue <ExternalLink size={11} /></button>
  </p>

  {#snippet footer()}
    <Button onclick={() => (health.reportOpen = false)}>Cancel</Button>
    <Button variant="primary" busy={health.saving} disabled={!p} onclick={() => health.save()}>Save bug report…</Button>
  {/snippet}
</Dialog>

<Dialog open={!!health.crash} onclose={() => (health.crash = null)} title="Castwright closed unexpectedly last time" width={460}>
  <p class="small">Save a bug report? It includes what happened just before{health.crash ? ` (${clock(health.crash.ts)})` : ''}, so the problem is easier to find.</p>
  {#snippet footer()}
    <Button onclick={() => (health.crash = null)}>Not now</Button>
    <Button variant="primary" onclick={() => health.showReport()}>Save bug report…</Button>
  {/snippet}
</Dialog>

<style>
  h3 {
    margin: 4px 0 8px;
  }
  .checks,
  .files {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    margin-bottom: 14px;
  }
  .checks li {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .checks :global(svg) {
    color: var(--ok);
    flex: none;
  }
  .opt label {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    cursor: pointer;
    margin-top: 4px;
  }
  .opt input {
    width: 15px;
    height: 15px;
    margin: 1px 0 0;
    accent-color: var(--accent);
  }
  .hint {
    display: block;
    color: var(--text-muted);
    font-size: 12px;
  }
  .files {
    gap: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    margin-bottom: 6px;
  }
  .files li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    border-top: 1px solid var(--border);
    font-size: 12.5px;
  }
  .files li:first-child {
    border-top: 0;
  }
  .files :global(svg) {
    color: var(--text-faint);
    flex: none;
  }
  .note {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    margin: 14px 0 8px;
    font-size: 12.5px;
    color: var(--text-muted);
  }
  .note :global(svg) {
    color: var(--ok);
    flex: none;
    margin-top: 1px;
  }
  .small {
    font-size: 12.5px;
  }
  .link {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent-text);
    font-size: inherit;
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
</style>
