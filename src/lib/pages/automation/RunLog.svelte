<script lang="ts">
  import { clock } from '$lib/format';
  import { app } from '$lib/state/app.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Collapse from '$lib/ui/Collapse.svelte';
  import { runLog, actionsEditor as ed, type RunEntry } from './store.svelte';
  import type { LogEntry } from '$lib/bindings/LogEntry';

  let { open = $bindable(true) }: { open?: boolean } = $props();

  type Row = { kind: 'run'; ts: number; run: RunEntry } | { kind: 'log'; ts: number; log: LogEntry; i: number };

  const rows = $derived.by((): Row[] => {
    const runs: Row[] = runLog.runs.map((run) => ({ kind: 'run', ts: run.ts, run }));
    const logs: Row[] = app.logs
      .map((log, i) => ({ log, i }))
      .filter(({ log }) => log.source === 'automation' || log.source === 'script')
      .map(({ log, i }) => ({ kind: 'log', ts: log.ts, log, i }));
    return [...runs, ...logs].sort((a, b) => b.ts - a.ts).slice(0, 150);
  });
</script>

<section class="log pane" aria-label="Run log">
  <Collapse id="automation.runlog" title="Run log" meta={runLog.runs.length || ''} bind:open>
    {#snippet actions()}
      <Button size="sm" variant="ghost" disabled={!runLog.runs.length} onclick={() => runLog.clear()}>Clear</Button>
    {/snippet}
  <ol aria-live="polite">
    {#each rows as r (r.kind === 'run' ? `r${r.run.seq}` : `l${r.i}`)}
      {#if r.kind === 'run'}
        <li class="run" class:bad={!r.run.ok}>
          <span class="dot" class:ok={r.run.ok}><span class="sr-only">{r.run.ok ? 'Worked' : 'Failed'}</span></span>
          <div class="grow">
            <div class="line">
              <button type="button" class="name truncate" onclick={() => (ed.selectedId = r.run.action_id)}>{r.run.name}</button>
              <span class="faint small">{r.run.trigger}</span>
            </div>
            {#each r.run.errors as err, j (j)}
              <p class="err">{err}</p>
            {/each}
          </div>
          <span class="mono faint small" title={clock(r.ts)}>{r.run.duration_ms} ms</span>
        </li>
      {:else}
        <li class="entry {r.log.level}">
          <span class="src mono">{r.log.source}</span>
          <span class="grow msg">{r.log.message}</span>
          <span class="mono faint small">{clock(r.ts)}</span>
        </li>
      {/if}
    {:else}
      <li class="none faint">Runs show up here with their result.</li>
    {/each}
  </ol>
  </Collapse>
</section>

<style>
  .log {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0 6px 8px;
    overflow: auto;
    min-height: 0;
    flex: 1;
  }
  li {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 5px 8px;
    border-radius: var(--radius);
    font-size: 12.5px;
  }
  li:hover {
    background: var(--bg-2);
  }
  .dot {
    width: 7px;
    height: 7px;
    margin-top: 6px;
    flex: none;
    border-radius: 50%;
    background: var(--danger);
  }
  .dot.ok {
    background: var(--ok);
  }
  .line {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .name {
    border: 0;
    padding: 0;
    background: none;
    font-weight: 600;
    cursor: pointer;
    max-width: 60%;
  }
  .name:hover {
    text-decoration: underline;
  }
  .small {
    font-size: 11px;
    white-space: nowrap;
  }
  .err {
    margin-top: 2px;
    font-size: 12px;
    color: var(--danger);
    overflow-wrap: anywhere;
  }
  .src {
    flex: none;
    font-size: 10.5px;
    padding: 1px 5px;
    margin-top: 1px;
    border-radius: 4px;
    background: var(--bg-3);
    color: var(--text-muted);
  }
  .msg {
    overflow-wrap: anywhere;
    color: var(--text-muted);
  }
  .entry.error .msg {
    color: var(--danger);
  }
  .entry.warn .msg {
    color: var(--warn);
  }
  .none {
    font-size: 12px;
  }
  .none:hover {
    background: none;
  }
</style>
