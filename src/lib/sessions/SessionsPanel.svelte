<script lang="ts">
  import { api } from '$lib/api';
  import type { SessionListItem } from '$lib/bindings/SessionListItem';
  import { count } from '$lib/format';
  import { attempt } from '$lib/state/toast.svelte';
  import Badge from '$lib/ui/Badge.svelte';
  import EmptyState from '$lib/ui/EmptyState.svelte';
  import { CalendarClock, ChevronRight } from '@lucide/svelte';
  import { sessions } from './store.svelte';
  import { durationText } from './summary';

  let rows = $state<SessionListItem[]>([]);
  let loading = $state(true);

  $effect(() => {
    void sessions.version;
    let stale = false;
    attempt(() => api.listSessions(200)).then((r) => {
      if (stale) return;
      rows = r ?? [];
      loading = false;
    });
    return () => (stale = true);
  });

  const day = (ts: number) => new Date(ts).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const length = (r: SessionListItem) => durationText((r.session.ended_at ?? Date.now()) - r.session.started_at);
</script>

<div class="wrap">
  {#if !loading && rows.length === 0}
    <EmptyState title="No streams yet" body="Each time you go live, Castwright keeps a summary here: follows, subs, bits, raids, chat and more.">
      {#snippet icon()}<CalendarClock size={28} />{/snippet}
    </EmptyState>
  {:else}
    <table aria-label="Past streams">
      <thead>
        <tr>
          <th class="d">Date</th>
          <th>Stream</th>
          <th class="n">Length</th>
          <th class="n">Peak</th>
          <th class="n">Follows</th>
          <th class="n">Subs</th>
          <th class="n">Bits</th>
          <th class="n">Chat</th>
          <th class="go"><span class="sr-only">Open</span></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.session.id)}
          <tr onclick={() => sessions.show(r.session.id)}>
            <td class="d">{day(r.session.started_at)}</td>
            <td class="title">
              <span class="truncate">{r.session.title || 'Untitled stream'}</span>
              <span class="faint truncate small">{r.session.categories.join(', ')}</span>
            </td>
            <td class="n">
              {#if r.session.ended_at === null}<Badge tone="live">LIVE</Badge>{:else}{length(r)}{/if}
            </td>
            <td class="n">{count(r.session.peak_viewers)}</td>
            <td class="n">{count(r.follows)}</td>
            <td class="n">{count(r.subs)}</td>
            <td class="n">{count(r.bits)}</td>
            <td class="n">{count(r.chat_messages)}</td>
            <td class="go">
              <button
                type="button"
                class="icon"
                aria-label="Open summary for {day(r.session.started_at)}"
                onclick={(e) => {
                  e.stopPropagation();
                  sessions.show(r.session.id);
                }}><ChevronRight size={15} /></button
              >
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .wrap {
    flex: 1;
    overflow: auto;
    display: flex;
    flex-direction: column;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    table-layout: fixed;
  }
  th {
    position: sticky;
    top: 0;
    background: var(--bg-0);
    text-align: left;
    font-size: 11px;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-faint);
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }
  td {
    padding: 0 12px;
    height: 48px;
    border-bottom: 1px solid var(--border);
  }
  tbody tr {
    cursor: pointer;
  }
  tbody tr:hover {
    background: var(--bg-2);
  }
  .d {
    width: 150px;
    white-space: nowrap;
  }
  .n {
    width: 84px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .title {
    overflow: hidden;
  }
  .title span {
    display: block;
  }
  .small {
    font-size: 12px;
  }
  .go {
    width: 48px;
  }
  .icon {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border-radius: var(--radius);
    color: var(--text-muted);
  }
  .icon:hover {
    background: var(--bg-3);
    color: var(--text);
  }
</style>
