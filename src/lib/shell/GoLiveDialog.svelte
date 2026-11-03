<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { golive, openPlace } from '$lib/state/golive.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import { CircleCheck, CircleX, RefreshCw, TriangleAlert } from '@lucide/svelte';
  import { fixLabel, sortChecks, summaryText, tally } from './golive';

  const checks = $derived(golive.checks ? sortChecks(golive.checks) : null);
  const t = $derived(golive.checks ? tally(golive.checks) : null);
  const items = $derived(app.settings?.golive.items ?? []);
  const done = $derived(items.filter((i) => golive.ticked.has(i.id)).length);
</script>

<Dialog bind:open={golive.open} title="Go-live check" description="Quick checks for the usual things that break a stream." width={580}>
  <div class="summary" role="status">
    {#if !checks}
      <span class="muted">Checking…</span>
    {:else if t}
      <span class="tally {t.fail ? 'fail' : t.warn ? 'warn' : 'pass'}">
        {#if t.fail}<CircleX size={16} />{:else if t.warn}<TriangleAlert size={16} />{:else}<CircleCheck size={16} />{/if}
        {summaryText(t)}
      </span>
      {#if golive.running}<span class="faint small">Checking again…</span>{/if}
    {/if}
  </div>

  {#if checks}
    <ul class="checks" aria-label="Checks">
      {#each checks as c (c.id)}
        <li class={c.status} data-check={c.id}>
          <span class="icon" aria-label={c.status === 'pass' ? 'Passed' : c.status === 'warn' ? 'Warning' : 'Problem'}>
            {#if c.status === 'pass'}<CircleCheck size={16} />{:else if c.status === 'warn'}<TriangleAlert size={16} />{:else}<CircleX size={16} />{/if}
          </span>
          <div class="text">
            <div class="label">{c.label}</div>
            <div class="detail">{c.detail}</div>
          </div>
          {#if c.fix}
            <Button size="sm" variant={c.status === 'fail' && c.fix.type !== 'open' ? 'primary' : 'secondary'} busy={golive.fixing === c.id} onclick={() => golive.fix(c)}>
              {fixLabel(c.fix)}
            </Button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <section class="mine" aria-labelledby="golive-mine">
    <header>
      <h3 id="golive-mine" class="eyebrow">Your list</h3>
      {#if items.length}<span class="faint small">{done} of {items.length} done</span>{/if}
      <div class="grow"></div>
      <button
        type="button"
        class="link"
        onclick={() => {
          golive.open = false;
          void openPlace('settings:golive');
        }}>Edit list</button
      >
    </header>
    {#if items.length}
      <ul class="ticks">
        {#each items as item (item.id)}
          <li>
            <label>
              <input type="checkbox" checked={golive.ticked.has(item.id)} onchange={() => golive.toggle(item.id)} />
              <span>{item.label}</span>
            </label>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="faint small">Add your own reminders, like "Mic on" or "Phone on silent".</p>
    {/if}
  </section>

  {#snippet footer()}
    <Button variant="ghost" busy={golive.running} onclick={() => golive.run()}><RefreshCw size={14} />Check again</Button>
    <div class="grow"></div>
    <Button variant="primary" onclick={() => (golive.open = false)}>Done</Button>
  {/snippet}
</Dialog>

<style>
  .summary {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 24px;
    margin-bottom: 10px;
  }
  .tally {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-weight: 650;
    font-size: 14px;
  }
  .tally.pass,
  .pass .icon {
    color: var(--ok);
  }
  .tally.warn,
  .warn .icon {
    color: var(--warn);
  }
  .tally.fail,
  .fail .icon {
    color: var(--danger);
  }
  .checks {
    list-style: none;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .checks li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 12px;
    border-top: 1px solid var(--border);
  }
  .checks li:first-child {
    border-top: 0;
  }
  .checks li.fail {
    background: color-mix(in srgb, var(--danger) 8%, transparent);
  }
  .icon {
    display: inline-flex;
    flex: none;
  }
  .text {
    flex: 1;
    min-width: 0;
  }
  .label {
    font-size: 13px;
    font-weight: 600;
  }
  .detail {
    font-size: 12px;
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
  .mine {
    margin-top: 18px;
  }
  .mine header {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 6px;
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent-text);
    font-size: 12px;
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
  .ticks {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ticks label {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 4px;
    border-radius: var(--radius);
    font-size: 13px;
    cursor: pointer;
  }
  .ticks label:hover {
    background: var(--bg-2);
  }
  .ticks input {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
  }
  .ticks input:checked + span {
    color: var(--text-muted);
    text-decoration: line-through;
  }
  .small {
    font-size: 12px;
  }
</style>
