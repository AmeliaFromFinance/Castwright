<script lang="ts">
  import { api } from '$lib/api';
  import type { ConnState } from '$lib/bindings/ConnState';
  import type { HealthLevel } from '$lib/bindings/HealthLevel';
  import { ago, bytes, clock, duration } from '$lib/format';
  import { chatExtras } from '$lib/overlay/emotes/store.svelte';
  import { attemptOk } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import { copyText } from '$lib/util/os';
  import { CircleCheck, CircleX, Copy, RotateCw, TriangleAlert } from '@lucide/svelte';
  import { filterProblems, pagesText, problemLine, sources, untilText } from './health';
  import { health } from './store.svelte';

  const s = $derived(health.snapshot);
  const sum = $derived(health.summary);
  const providers = $derived(chatExtras.providers());
  let source = $state('');
  const problems = $derived(s ? filterProblems(s.problems, source || null) : []);
  const problemSources = $derived(s ? sources(s.problems) : []);

  const CONN: Record<ConnState, [string, string]> = {
    connected: ['Connected', 'ok'],
    connecting: ['Connecting…', 'warn'],
    error: ['Problem', 'bad'],
    disconnected: ['Not connected', 'off']
  };
  const TONE: Record<HealthLevel, string> = { ok: 'ok', warn: 'warn', bad: 'bad' };
  const pct = (n: number) => `${n.toFixed(1)}%`;
</script>

{#snippet conn(state: ConnState, label?: string)}
  <span class="state"><i class="dot {CONN[state][1]}"></i>{label ?? CONN[state][0]}</span>
{/snippet}

<Dialog bind:open={health.open} title="Health" description="How Castwright and its connections are doing right now. Updates live." width={780}>
  <div class="summary {TONE[sum.level]}" role="status">
    {#if sum.level === 'bad'}<CircleX size={16} />{:else if sum.level === 'warn'}<TriangleAlert size={16} />{:else}<CircleCheck size={16} />{/if}
    <b>{sum.text}</b>
  </div>
  {#if sum.issues.length}
    <ul class="issues" aria-label="What needs attention">
      {#each sum.issues as i, n (n)}
        <li class={i.level}><i class="dot {TONE[i.level]}"></i>{i.text}</li>
      {/each}
    </ul>
  {/if}

  {#if s}
    <section aria-labelledby="h-overlays">
      <h3 id="h-overlays" class="eyebrow">Overlays</h3>
      {#if s.overlays.length}
        <table>
          <thead><tr><th>Overlay</th><th>Open in</th><th>Last change</th><th><span class="sr-only">Reload</span></th></tr></thead>
          <tbody>
            {#each s.overlays as o (o.id)}
              <tr>
                <td>{o.name}</td>
                <td>{@render conn(o.pages.length ? 'connected' : 'disconnected', pagesText(o.pages))}</td>
                <td class="muted">
                  {#if o.pages.length && o.last_connect}Opened {ago(o.last_connect, s.ts)}
                  {:else if o.last_disconnect}Closed {ago(o.last_disconnect, s.ts)}
                  {:else}Not opened since start{/if}
                </td>
                <td class="end">
                  <Button size="sm" variant="ghost" disabled={!o.pages.length} aria-label="Reload {o.name}" onclick={() => attemptOk(() => api.reloadOverlay(o.id), `Reloaded ${o.name}`)}>
                    <RotateCw size={13} />Reload
                  </Button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="faint small">No overlays yet.</p>
      {/if}
    </section>

    <div class="cols">
      <div>
        <section aria-labelledby="h-obs">
          <h3 id="h-obs" class="eyebrow">OBS</h3>
          <dl>
            <dt>Status</dt>
            <dd>{@render conn(s.obs.state, s.obs.state === 'connected' ? `OBS ${s.obs.version}` : undefined)}</dd>
            {#if s.obs.error && s.obs.state !== 'connected'}<dt>Error</dt><dd>{s.obs.error}</dd>{/if}
            {#if s.obs.state === 'connected'}
              <dt>Scene</dt><dd>{s.obs.scene || '–'}</dd>
              <dt>Streaming</dt><dd>{s.obs.streaming ? `Live ${duration(s.obs.stream_ms)}` : 'Off'}</dd>
              <dt>Recording</dt><dd>{s.obs.recording ? duration(s.obs.record_ms) : 'Off'}</dd>
              <dt>Dropped frames</dt><dd class="mono">{pct(s.obs.dropped_percent)}</dd>
              <dt>Render lag</dt><dd class="mono">{pct(s.obs.render_lag_percent)}</dd>
              <dt>Encoder lag</dt><dd class="mono">{pct(s.obs.encoder_lag_percent)}</dd>
              <dt>CPU</dt><dd class="mono">{pct(s.obs.cpu_percent)}</dd>
              <dt>FPS</dt><dd class="mono">{s.obs.fps.toFixed(0)}</dd>
            {/if}
          </dl>
        </section>
        <section aria-labelledby="h-app">
          <h3 id="h-app" class="eyebrow">App</h3>
          <dl>
            <dt>Version</dt><dd>{s.app.version}</dd>
            <dt>System</dt><dd>{s.app.os} {s.app.arch}</dd>
            <dt>Portable mode</dt><dd>{s.app.portable ? 'On' : 'Off'}</dd>
            <dt>Uptime</dt><dd>{duration(s.app.uptime_ms)}</dd>
            <dt>Memory</dt><dd>{s.app.memory_bytes === null ? 'Not available' : bytes(s.app.memory_bytes)}</dd>
            <dt>Overlay server</dt><dd>{@render conn(s.app.server_running ? 'connected' : 'error', s.app.server_running ? 'Running' : 'Stopped')}</dd>
            <dt>Data folder</dt>
            <dd><span class="mono selectable">{s.app.data_dir}</span>{#if s.app.data_bytes !== null}<span class="faint">{` · ${bytes(s.app.data_bytes)}`}</span>{/if}</dd>
          </dl>
        </section>
      </div>

      <section aria-labelledby="h-twitch">
        <h3 id="h-twitch" class="eyebrow">Twitch</h3>
        <dl>
          <dt>Signed in</dt>
          <dd>
            {#if s.twitch.signed_in}{s.twitch.login}{#if s.twitch.bot_login}<span class="faint">{` · bot ${s.twitch.bot_login}`}</span>{/if}
            {:else}{@render conn('disconnected', s.twitch.has_client_id ? 'No' : 'No client ID')}{/if}
          </dd>
          {#if s.twitch.signed_in}
            {#if s.twitch.token_expires_at}<dt>Token expires</dt><dd>{untilText(s.twitch.token_expires_at, s.ts)}<span class="faint">{' (renews itself)'}</span></dd>{/if}
            <dt>Permissions</dt>
            <dd>{#if s.twitch.missing_scopes.length}<span class="warn-text">Missing {s.twitch.missing_scopes.join(', ')}</span>{:else}All there{/if}</dd>
            <dt>Events</dt>
            <dd>
              {@render conn(s.twitch.eventsub)}
              {#if s.twitch.subscriptions_ready}<span class="faint">{` · ${s.twitch.subscriptions_active} of ${s.twitch.subscriptions_total} active`}</span>{/if}
            </dd>
            {#if s.twitch.failed.length}
              <dt>Not coming in</dt>
              <dd>
                <ul class="failed">
                  {#each s.twitch.failed as f (f.kind)}<li><span class="mono">{f.kind}</span> <span class="muted">{f.reason}</span></li>{/each}
                </ul>
              </dd>
            {/if}
            <dt>Last event</dt><dd>{s.twitch.last_event_at ? ago(s.twitch.last_event_at, s.ts) : 'None yet'}</dd>
            <dt>Chat</dt><dd>{@render conn(s.twitch.chat)}</dd>
          {/if}
          {#if s.twitch.error}<dt>Error</dt><dd>{s.twitch.error}</dd>{/if}
          <dt>Emotes</dt>
          <dd>
            {#if providers.length}
              <ul class="failed">
                {#each providers as p (p.provider)}
                  <li>
                    {@render conn(p.state === 'ok' ? 'connected' : p.state === 'loading' ? 'connecting' : 'error', p.name)}
                    <span class="muted">{p.state === 'ok' ? `${p.emotes} emotes` : p.state === 'loading' ? 'Loading…' : p.error}</span>
                  </li>
                {/each}
              </ul>
            {:else}<span class="faint">Not loaded in this window yet</span>{/if}
          </dd>
        </dl>
      </section>
    </div>

    <section aria-labelledby="h-problems">
      <header class="row">
        <h3 id="h-problems" class="eyebrow grow">Recent problems</h3>
        {#if problemSources.length > 1}
          <select bind:value={source} aria-label="Filter by source">
            <option value="">All sources</option>
            {#each problemSources as src (src)}<option value={src}>{src}</option>{/each}
          </select>
        {/if}
      </header>
      {#if problems.length}
        <ul class="problems" aria-label="Recent warnings and errors">
          {#each problems as p, n (n)}
            <li class={p.level}>
              <span class="mono faint time">{clock(p.ts)}</span>
              <span class="lvl">{p.level === 'error' ? 'Error' : 'Warning'}</span>
              <span class="src mono">{p.source}</span>
              <span class="msg selectable">{p.message}</span>
              <IconButton size="sm" label="Copy" onclick={() => copyText(problemLine(p))}><Copy size={13} /></IconButton>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="faint small">No warnings or errors since Castwright started.</p>
      {/if}
    </section>
  {:else}
    <p class="muted">Checking…</p>
  {/if}

  {#snippet footer()}
    <Button onclick={() => health.showReport()}>Save bug report…</Button>
    <div class="grow"></div>
    <Button variant="primary" onclick={() => (health.open = false)}>Done</Button>
  {/snippet}
</Dialog>

<style>
  .summary {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }
  .summary.ok {
    color: var(--ok);
  }
  .summary.warn,
  .warn-text {
    color: var(--warn);
  }
  .summary.bad {
    color: var(--danger);
  }
  .issues {
    list-style: none;
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 12.5px;
  }
  .issues li {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  section {
    margin-top: 18px;
  }
  h3 {
    margin-bottom: 8px;
  }
  header.row h3 {
    margin-bottom: 0;
  }
  header.row {
    margin-bottom: 8px;
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 28px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }
  th {
    text-align: left;
    font-weight: 600;
    color: var(--text-muted);
    padding: 0 8px 6px 0;
  }
  td {
    padding: 4px 8px 4px 0;
    border-top: 1px solid var(--border);
  }
  .end {
    text-align: right;
    padding-right: 0;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 5px 14px;
    font-size: 12.5px;
  }
  dt {
    color: var(--text-muted);
  }
  dd {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .state {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .failed {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .failed li {
    display: flex;
    flex-wrap: wrap;
    gap: 0 6px;
  }
  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-faint);
  }
  .dot.ok {
    background: var(--ok);
  }
  .dot.warn {
    background: var(--warn);
  }
  .dot.bad {
    background: var(--danger);
  }
  select {
    font-size: 12px;
    padding: 3px 6px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--bg-2);
    color: var(--text);
  }
  .problems {
    list-style: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    max-height: 220px;
    overflow: auto;
    font-size: 12.5px;
  }
  .problems li {
    display: grid;
    grid-template-columns: max-content 58px 86px 1fr max-content;
    align-items: center;
    gap: 10px;
    padding: 4px 6px 4px 10px;
    border-top: 1px solid var(--border);
  }
  .problems li:first-child {
    border-top: 0;
  }
  .lvl {
    font-weight: 600;
    font-size: 11.5px;
  }
  .warn .lvl {
    color: var(--warn);
  }
  .error .lvl {
    color: var(--danger);
  }
  .src {
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .msg {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .small {
    font-size: 12px;
  }
</style>
