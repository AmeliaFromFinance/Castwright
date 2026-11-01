<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { api } from '$lib/api';
  import { isTauri } from '$lib/api/backend';
  import { attempt, toasts } from '$lib/state/toast.svelte';
  import type { Event } from '$lib/bindings/Event';
  import type { EventKind } from '$lib/bindings/EventKind';
  import type { LogLevel } from '$lib/bindings/LogLevel';
  import { ALERT_KINDS, KIND_LABELS, ago, clock, count, describe, kindTone } from '$lib/format';
  import { copyText } from '$lib/util/os';
  import Button from '$lib/ui/Button.svelte';
  import Segmented from '$lib/ui/Segmented.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import EmptyState from '$lib/ui/EmptyState.svelte';
  import ChatPanel from '$lib/widgets/ChatPanel.svelte';
  import { Search, Download, RotateCcw, X, Copy, History } from '@lucide/svelte';

  type Tab = 'events' | 'chat' | 'log';
  let tab = $state<Tab>('events');

  const groups: Array<{ id: string; label: string; kinds: EventKind[] }> = [
    { id: 'follows', label: 'Follows', kinds: ['follow'] },
    { id: 'subs', label: 'Subs', kinds: ['sub', 'resub', 'gift_sub', 'community_gift'] },
    { id: 'bits', label: 'Bits', kinds: ['cheer', 'power_up'] },
    { id: 'raids', label: 'Raids', kinds: ['raid', 'shoutout_received'] },
    { id: 'points', label: 'Points', kinds: ['redemption'] },
    {
      id: 'community',
      label: 'Hype trains, polls, predictions',
      kinds: [
        'hype_train_begin',
        'hype_train_progress',
        'hype_train_end',
        'poll_begin',
        'poll_progress',
        'poll_end',
        'prediction_begin',
        'prediction_progress',
        'prediction_lock',
        'prediction_end',
        'charity'
      ]
    },
    { id: 'stream', label: 'Stream', kinds: ['stream_online', 'stream_offline', 'channel_update', 'ad_break', 'custom'] }
  ];
  const NON_CHAT = (Object.keys(KIND_LABELS) as EventKind[]).filter((k) => k !== 'chat');

  let picked = $state<string[]>([]);
  let search = $state('');
  let includeTests = $state(false);
  let events = $state<Event[]>([]);
  let loading = $state(true);
  let selected = $state<Event | null>(null);
  let now = $state(Date.now());

  const kinds = $derived(
    picked.length ? groups.filter((g) => picked.includes(g.id)).flatMap((g) => g.kinds) : NON_CHAT
  );

  let seq = 0;
  async function load() {
    const mine = ++seq;
    const r = await attempt(() => api.recentEvents(500, kinds, search.trim(), includeTests));
    if (mine !== seq) return;
    events = (r ?? []).filter((e) => e.kind !== 'chat');
    loading = false;
  }

  // Reload when filters change (search debounced) or a new event arrives.
  $effect(() => {
    void kinds;
    void includeTests;
    const q = search;
    void app.feed[0]?.id;
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  });

  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(t);
  });

  function toggle(id: string) {
    picked = picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id];
  }

  async function exportCsv() {
    if (!isTauri()) {
      toasts.show('Exporting needs the desktop app');
      return;
    }
    const { save } = await import('@tauri-apps/plugin-dialog');
    const stamp = new Date().toISOString().slice(0, 10);
    const path = await save({ defaultPath: `castwright-events-${stamp}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (!path) return;
    const n = await attempt(() => api.exportHistoryCsv(path));
    if (n !== undefined) toasts.success(`Exported ${count(n)} events`);
  }

  function amount(e: Event): string {
    if (e.amount === null) return '';
    if (e.kind === 'charity') return `${e.amount.toFixed(2)} ${e.currency ?? ''}`;
    if (e.kind === 'cheer') return `${count(e.amount)} bits`;
    if (e.kind === 'raid') return `${count(e.amount)} viewers`;
    if (e.kind === 'community_gift') return `${count(e.amount)} subs`;
    if (e.kind === 'redemption') return `${count(e.amount)} pts`;
    return count(e.amount);
  }

  // Log
  let levels = $state<LogLevel[]>(['info', 'warn', 'error']);
  let source = $state('all');
  let logSearch = $state('');
  const sources = $derived(['all', ...new Set(app.logs.map((l) => l.source))].sort((a, b) => (a === 'all' ? -1 : b === 'all' ? 1 : a.localeCompare(b))));
  const logs = $derived(
    app.logs
      .filter((l) => levels.includes(l.level))
      .filter((l) => source === 'all' || l.source === source)
      .filter((l) => !logSearch.trim() || l.message.toLowerCase().includes(logSearch.trim().toLowerCase()))
      .slice()
      .reverse()
  );
  const warnCount = $derived(app.logs.filter((l) => l.level !== 'info').length);

  function copyLogs() {
    const text = logs
      .slice()
      .reverse()
      .map((l) => `${new Date(l.ts).toISOString()} ${l.level.toUpperCase()} [${l.source}] ${l.message}`)
      .join('\n');
    copyText(text, 'Log copied');
  }
</script>

<div class="activity">
  <header class="toolbar">
    <h1>Activity</h1>
    <Segmented
      label="View"
      bind:value={tab}
      options={[
        { value: 'events', label: 'Events' },
        { value: 'chat', label: 'Chat' },
        { value: 'log', label: warnCount ? `Log (${warnCount})` : 'Log' }
      ]}
    />
    <div class="grow"></div>
    {#if tab === 'events'}
      <label class="search">
        <Search size={14} />
        <input class="input" type="search" placeholder="Search by name" bind:value={search} aria-label="Search events by name" />
      </label>
      <Switch label="Show tests" showLabel bind:checked={includeTests} />
      <Button size="sm" onclick={exportCsv}><Download size={14} />Export CSV</Button>
    {:else if tab === 'log'}
      <label class="search">
        <Search size={14} />
        <input class="input" type="search" placeholder="Search log" bind:value={logSearch} aria-label="Search log" />
      </label>
      <select class="input src" bind:value={source} aria-label="Source">
        {#each sources as s (s)}<option value={s}>{s === 'all' ? 'All sources' : s}</option>{/each}
      </select>
      <Button size="sm" onclick={copyLogs} disabled={!logs.length}><Copy size={14} />Copy</Button>
    {/if}
  </header>

  {#if tab === 'events'}
    <div class="filters" role="group" aria-label="Event types">
      <button type="button" class="chip" aria-pressed={picked.length === 0} onclick={() => (picked = [])}>All</button>
      {#each groups as g (g.id)}
        <button type="button" class="chip" aria-pressed={picked.includes(g.id)} onclick={() => toggle(g.id)}>{g.label}</button>
      {/each}
      <div class="grow"></div>
      <span class="faint small">{loading ? 'Loading…' : `${count(events.length)} event${events.length === 1 ? '' : 's'}`}</span>
    </div>

    <div class="split">
      <div class="table-wrap">
        {#if !loading && events.length === 0}
          <EmptyState
            title={search || picked.length ? 'Nothing matches' : 'No events yet'}
            body={search || picked.length
              ? 'Try other filters.'
              : 'Follows, subs, cheers and raids show up here once Twitch is connected. Use the Test buttons on the Alerts page to try things out.'}
          >
            {#snippet icon()}<History size={28} />{/snippet}
          </EmptyState>
        {:else}
          <table>
            <thead>
              <tr><th class="t">Time</th><th>Type</th><th>Event</th><th class="amt">Amount</th><th class="act"><span class="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {#each events as e (e.id)}
                <tr class:sel={selected?.id === e.id} onclick={() => (selected = e)}>
                  <td class="t faint" title={new Date(e.ts).toLocaleString()}>{now - e.ts < 86_400_000 ? clock(e.ts) : new Date(e.ts).toLocaleDateString()}</td>
                  <td>
                    <span class="kind" style="--tone:{kindTone(e.kind)}">{KIND_LABELS[e.kind]}</span>
                    {#if e.test}<span class="test">Test</span>{/if}
                  </td>
                  <td class="desc">
                    <span class="truncate">{describe(e)}</span>
                    {#if e.message && e.kind !== 'chat'}<span class="msg muted truncate">“{e.message}”</span>{/if}
                  </td>
                  <td class="amt mono">{amount(e)}</td>
                  <td class="act">
                    {#if ALERT_KINDS.includes(e.kind)}
                      <button
                        type="button"
                        class="icon"
                        aria-label="Replay alert"
                        title="Replay alert"
                        onclick={(ev) => {
                          ev.stopPropagation();
                          attempt(() => api.alertReplay(e.id), 'Alert queued');
                        }}><RotateCcw size={14} /></button
                      >
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>

      {#if selected}
        {@const e = selected}
        <aside class="detail" aria-label="Event details">
          <div class="row dhead">
            <span class="kind" style="--tone:{kindTone(e.kind)}">{KIND_LABELS[e.kind]}</span>
            <div class="grow"></div>
            <button type="button" class="icon" aria-label="Close details" onclick={() => (selected = null)}><X size={15} /></button>
          </div>
          <h2>{describe(e)}</h2>
          <p class="faint small">{new Date(e.ts).toLocaleString()} · {ago(e.ts, now)}</p>
          {#if e.message}<blockquote class="selectable">{e.message}</blockquote>{/if}
          <dl>
            {#if e.user}<dt>User</dt><dd class="selectable">{e.user.display_name} <span class="faint">({e.user.login})</span></dd>{/if}
            {#if e.recipient}<dt>Recipient</dt><dd>{e.recipient.display_name}</dd>{/if}
            {#if e.amount !== null}<dt>Amount</dt><dd>{amount(e)}</dd>{/if}
            {#if e.tier}<dt>Tier</dt><dd>{e.tier}</dd>{/if}
            {#if e.months}<dt>Months</dt><dd>{e.months}</dd>{/if}
            {#if e.is_gift}<dt>Gift</dt><dd>Yes</dd>{/if}
            {#if e.is_anonymous}<dt>Anonymous</dt><dd>Yes</dd>{/if}
          </dl>
          {#if Object.keys(e.data).length}
            <div class="eyebrow">Extra data</div>
            <pre class="selectable">{JSON.stringify(e.data, null, 2)}</pre>
          {/if}
          <div class="row gap">
            {#if ALERT_KINDS.includes(e.kind)}
              <Button size="sm" onclick={() => attempt(() => api.alertReplay(e.id), 'Alert queued')}><RotateCcw size={14} />Replay alert</Button>
            {/if}
            <Button size="sm" variant="ghost" onclick={() => copyText(JSON.stringify(e, null, 2), 'Event copied')}><Copy size={14} />Copy JSON</Button>
          </div>
        </aside>
      {/if}
    </div>
  {:else if tab === 'chat'}
    <div class="chat">
      <ChatPanel compact={false} />
    </div>
  {:else}
    <div class="filters" role="group" aria-label="Log levels">
      {#each [['info', 'Info'], ['warn', 'Warnings'], ['error', 'Errors']] as [lv, label] (lv)}
        <button
          type="button"
          class="chip"
          aria-pressed={levels.includes(lv as LogLevel)}
          onclick={() => (levels = levels.includes(lv as LogLevel) ? levels.filter((l) => l !== lv) : [...levels, lv as LogLevel])}
          >{label}</button
        >
      {/each}
    </div>
    <div class="log-wrap">
      {#if logs.length === 0}
        <EmptyState title="Nothing logged" body="Connection changes, automation runs and problems show up here." />
      {:else}
        <ol class="log selectable">
          {#each logs as l, i (i)}
            <li class={l.level}>
              <span class="lt mono faint">{clock(l.ts)}</span>
              <span class="lv">{l.level === 'info' ? '' : l.level === 'warn' ? 'Warning' : 'Error'}</span>
              <span class="ls mono">{l.source}</span>
              <span class="lm">{l.message}</span>
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  {/if}
</div>

<style>
  .activity {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .toolbar {
    height: 54px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 16px;
    border-bottom: 1px solid var(--border);
  }
  h1 {
    font-size: 15px;
    font-weight: 650;
    margin-right: 8px;
  }
  .search {
    position: relative;
    display: flex;
    align-items: center;
    width: 220px;
    color: var(--text-faint);
  }
  .search :global(svg) {
    position: absolute;
    left: 9px;
    pointer-events: none;
  }
  .search input {
    padding-left: 28px;
  }
  .src {
    width: 150px;
  }
  .filters {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }
  .chip {
    height: 26px;
    padding: 0 11px;
    border-radius: 999px;
    border: 1px solid var(--border);
    font-size: 12px;
    color: var(--text-muted);
    background: var(--bg-1);
  }
  .chip:hover {
    color: var(--text);
    border-color: var(--border-strong);
  }
  .chip[aria-pressed='true'] {
    background: var(--accent-soft);
    border-color: transparent;
    color: var(--accent-text);
    font-weight: 600;
  }
  .small {
    font-size: 12px;
  }
  .split {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .table-wrap {
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
  thead th {
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
    z-index: 1;
  }
  th:nth-child(2) {
    width: 190px;
  }
  .t {
    width: 110px;
    white-space: nowrap;
  }
  .amt {
    width: 120px;
    text-align: right;
  }
  .act {
    width: 48px;
  }
  tbody tr {
    cursor: pointer;
  }
  tbody tr:hover {
    background: var(--bg-2);
  }
  tbody tr.sel {
    background: var(--bg-3);
  }
  td {
    padding: 0 12px;
    height: 40px;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }
  .desc {
    overflow: hidden;
  }
  .desc span {
    display: block;
  }
  .msg {
    font-size: 12px;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .kind {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
  }
  .kind::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--tone);
  }
  .test {
    margin-left: 6px;
    font-size: 10.5px;
    font-weight: 650;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--bg-3);
    color: var(--text-muted);
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
  .detail {
    width: 340px;
    flex: none;
    border-left: 1px solid var(--border);
    padding: 16px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--bg-1);
  }
  .dhead {
    gap: 8px;
  }
  .detail h2 {
    font-size: 15px;
    font-weight: 650;
    line-height: 1.35;
  }
  blockquote {
    margin: 0;
    padding: 8px 12px;
    border-left: 3px solid var(--accent);
    background: var(--bg-2);
    border-radius: 0 var(--radius) var(--radius) 0;
    font-size: 13px;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 14px;
    font-size: 13px;
    margin: 0;
  }
  dt {
    color: var(--text-muted);
  }
  dd {
    margin: 0;
  }
  pre {
    margin: 0;
    padding: 10px;
    border-radius: var(--radius);
    background: var(--bg-2);
    font-family: var(--font-mono);
    font-size: 11.5px;
    overflow-x: auto;
    max-height: 260px;
  }
  .gap {
    gap: 8px;
  }
  .chat {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    max-width: 900px;
    width: 100%;
    margin: 0 auto;
    border-inline: 1px solid var(--border);
  }
  .log-wrap {
    flex: 1;
    overflow: auto;
    display: flex;
    flex-direction: column;
  }
  .log {
    list-style: none;
    font-size: 12.5px;
  }
  .log li {
    display: grid;
    grid-template-columns: max-content 64px 90px 1fr;
    gap: 10px;
    padding: 6px 16px;
    border-bottom: 1px solid var(--border);
    align-items: baseline;
  }
  .lt {
    white-space: nowrap;
  }
  .lv {
    font-size: 11px;
    font-weight: 700;
  }
  .log li.warn .lv {
    color: var(--warn);
  }
  .log li.error .lv {
    color: var(--danger);
  }
  .log li.error {
    background: color-mix(in srgb, var(--danger) 7%, transparent);
  }
  .ls {
    color: var(--text-muted);
    font-size: 11.5px;
  }
  .lm {
    line-height: 1.45;
    word-break: break-word;
  }
</style>
