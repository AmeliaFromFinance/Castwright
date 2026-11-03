<script lang="ts">
  import { VAR_KEY_HELP, isValidVarKey } from '$lib/pages/automation/validate';
  import { app } from '$lib/state/app.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import { builtIn, isLiveKey } from './builtins';
  import { varInspector as vi } from './inspector.svelte';

  const from = $derived(vi.renaming?.from ?? '');
  let to = $state('');
  let busy = $state(false);

  $effect(() => {
    to = vi.renaming?.to ?? '';
  });

  const name = $derived(to.trim());
  const error = $derived.by(() => {
    if (!name || name === from) return null;
    if (!isValidVarKey(name)) return VAR_KEY_HELP;
    // Reads of a name that was never set can move onto an existing variable.
    if (from in app.vars && (builtIn(name) || isLiveKey(name) || name in app.vars)) return `There's already a variable called ${name}.`;
    return null;
  });
  const preview = $derived(vi.renaming && name && name !== from && !error ? vi.preview(from, name) : null);
  const ready = $derived(!!preview && !busy);

  /** Back to the details of the variable. */
  function close() {
    vi.details = from;
    vi.renaming = null;
  }

  async function apply() {
    if (!ready) return;
    busy = true;
    const ok = await vi.rename(from, name);
    busy = false;
    if (ok) vi.renaming = null;
  }

  /** The text around the first difference, so long templates stay readable. */
  function excerpt(before: string, after: string): [string, string] {
    let i = 0;
    while (i < before.length && before[i] === after[i]) i++;
    const start = Math.max(0, i - 30);
    const cut = (s: string) => (start > 0 ? '…' : '') + (s.length - start > 90 ? `${s.slice(start, start + 90)}…` : s.slice(start));
    return [cut(before), cut(after)];
  }
</script>

<Dialog open={!!vi.renaming} title="Rename {from}" width={600} onclose={close}>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      void apply();
    }}
  >
    <label class="label" for="rename-var">New name</label>
    <input id="rename-var" class="input mono" spellcheck="false" aria-invalid={error ? 'true' : undefined} bind:value={to} />
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </form>

  {#if preview}
    <h3>{preview.changes.length} {preview.changes.length === 1 ? 'change' : 'changes'}</h3>
    {#if preview.changes.length}
      <ul class="changes" aria-label="Changes">
        {#each preview.changes as c, i (i)}
          {@const [b, a] = excerpt(c.before, c.after)}
          <li>
            <div class="where"><b>{c.where.title}</b> <span class="faint">{c.where.detail} · {c.field}</span></div>
            <div class="mono before">{b}</div>
            <div class="mono after">{a}</div>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="faint">Nothing in the project uses it. Only the value moves.</p>
    {/if}
    <p class="note faint">A backup is made first. Undo from the message after renaming, or restore it from Settings → Backups.</p>
  {/if}

  {#snippet footer()}
    <Button onclick={close}>Cancel</Button>
    <Button variant="primary" disabled={!ready} {busy} onclick={apply}>Rename</Button>
  {/snippet}
</Dialog>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .label {
    font-size: 12px;
    font-weight: 550;
    color: var(--text-muted);
  }
  .error {
    font-size: 12px;
    color: var(--danger);
  }
  h3 {
    margin: 16px 0 6px;
    font-size: 12px;
    font-weight: 650;
    color: var(--text-muted);
  }
  .changes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 320px;
    overflow: auto;
  }
  li {
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-2);
    font-size: 12.5px;
  }
  .where {
    margin-bottom: 4px;
  }
  .where b {
    font-weight: 600;
  }
  .before,
  .after {
    font-size: 11.5px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    padding-left: 16px;
    position: relative;
  }
  .before {
    color: var(--text-faint);
    text-decoration: line-through;
  }
  .before::before,
  .after::before {
    position: absolute;
    left: 2px;
  }
  .before::before {
    content: '−';
  }
  .after::before {
    content: '+';
    color: var(--ok);
  }
  .note {
    margin-top: 10px;
    font-size: 12px;
  }
</style>
