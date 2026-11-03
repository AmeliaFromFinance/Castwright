<script lang="ts">
  import type { SessionSummary } from '$lib/bindings/SessionSummary';
  import type { Ranked } from '$lib/bindings/Ranked';
  import { count } from '$lib/format';
  import Badge from '$lib/ui/Badge.svelte';
  import { openExternal } from '$lib/util/os';
  import Timeline from './Timeline.svelte';
  import { clock, donationText, durationText, markerLabel, markerTime, totalSubs } from './summary';

  interface Props {
    summary: SessionSummary;
    dark: boolean;
  }
  let { summary: s, dark }: Props = $props();

  const live = $derived(s.session.ended_at === null);
  const time = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const subParts = $derived(
    [
      s.new_subs && `${count(s.new_subs)} new`,
      s.resubs && `${count(s.resubs)} resub${s.resubs === 1 ? '' : 's'}`,
      s.gifted_subs && `${count(s.gifted_subs)} gifted`
    ]
      .filter(Boolean)
      .map((p) => String(p).replace(' ', '\u00a0'))
      .join(' · ')
  );
</script>

{#snippet list(title: string, rows: Ranked[], unit: string, empty: string)}
  <section class="block">
    <h3>{title}</h3>
    {#if rows.length}
      <ol>
        {#each rows as r, i (r.name)}
          <li><span class="rank">{i + 1}</span><span class="name truncate">{r.name}</span><span class="val">{count(r.amount)}{unit}</span></li>
        {/each}
      </ol>
    {:else}
      <p class="none">{empty}</p>
    {/if}
  </section>
{/snippet}

<article class="card" aria-label="Stream summary">
  <header>
    <div class="grow">
      <h2 class="truncate">{s.session.title || 'Untitled stream'}</h2>
      <p class="meta">
        {new Date(s.session.started_at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })},
        {time(s.session.started_at)} – {live ? 'now' : time(s.session.ended_at!)}
        {#if s.session.categories.length}· {s.session.categories.join(', ')}{/if}
      </p>
    </div>
    {#if live}<Badge tone="live">LIVE</Badge>{/if}
    {#if s.session.source === 'obs'}<Badge>From OBS</Badge>{/if}
  </header>

  <div class="tiles">
    <div class="tile"><div class="num">{durationText(s.duration_ms)}</div><div class="lbl">Streamed</div></div>
    <div class="tile">
      <div class="num">{count(s.session.peak_viewers)}</div>
      <div class="lbl">Peak viewers</div>
      <div class="sub">{s.session.avg_viewers ? `${count(s.session.avg_viewers)} average` : s.session.source === 'obs' ? 'Needs Twitch' : ''}</div>
    </div>
    <div class="tile"><div class="num">{count(s.follows)}</div><div class="lbl">New follows</div></div>
    <div class="tile"><div class="num">{count(totalSubs(s))}</div><div class="lbl">Subs</div><div class="sub">{subParts}</div></div>
    <div class="tile"><div class="num">{count(s.bits)}</div><div class="lbl">Bits</div></div>
    <div class="tile">
      <div class="num">{count(s.chat_messages)}</div>
      <div class="lbl">Chat messages</div>
      <div class="sub">{count(s.chatters)} chatters</div>
    </div>
  </div>

  <div class="cols">
    {@render list('Top chatters', s.top_chatters, '', 'No chat yet')}
    {@render list('Top cheerers', s.top_cheerers, '', 'No bits this time')}
    {@render list('Top gifters', s.top_gifters, '', 'No gifted subs')}
    <section class="block">
      <h3>Also</h3>
      <dl>
        <dt>First-time chatters</dt>
        <dd title={s.first_chatters.join(', ')}>{count(s.first_chatters.length)}</dd>
        <dt>Raids in</dt>
        <dd>{s.raids_in.length ? s.raids_in.map((r) => `${r.name} (${count(r.viewers)})`).join(', ') : 'None'}</dd>
        <dt>Raided</dt>
        <dd>{s.raids_out.length ? s.raids_out.map((r) => `${r.name} (${count(r.viewers)})`).join(', ') : 'Nobody'}</dd>
        {#if s.donation_count}
          <dt>Donations</dt>
          <dd>{count(s.donation_count)} · {donationText(s)}</dd>
        {/if}
        <dt>Alerts played</dt>
        <dd>{count(s.alerts)}</dd>
        <dt>Actions run</dt>
        <dd>{count(s.actions)}</dd>
      </dl>
    </section>
  </div>

  <div class="moments">
    <section class="block" aria-label="Markers">
      <h3>Markers</h3>
      {#if s.markers.length}
        <ol>
          {#each s.markers as m, i (m.id || i)}
            <li><span class="when">{markerTime(s, m)}</span><span class="name truncate" title={m.note ? m.description : undefined}>{markerLabel(m)}</span></li>
          {/each}
        </ol>
      {:else}
        <p class="none">No markers</p>
      {/if}
    </section>
    <section class="block" aria-label="Clips">
      <h3>Clips</h3>
      {#if s.clips.length}
        <ol>
          {#each s.clips as c (c.id)}
            <li>
              <span class="when">{clock((c.ts - s.session.started_at) / 1000)}</span>
              <button type="button" class="clip truncate" title={c.url} onclick={() => openExternal(c.url)}>{c.title || 'Untitled clip'}</button>
              <span class="val truncate url">{c.url.replace(/^https:\/\//, '')}</span>
            </li>
          {/each}
        </ol>
      {:else}
        <p class="none">No clips made in Castwright</p>
      {/if}
    </section>
  </div>

  <section class="block">
    <h3>Events per 10 minutes</h3>
    <Timeline summary={s} {dark} />
  </section>
</article>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  h2 {
    font-size: 18px;
    font-weight: 700;
    line-height: 1.3;
  }
  .meta {
    margin-top: 3px;
    font-size: 12.5px;
    color: var(--text-muted);
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 10px;
  }
  .tile {
    padding: 12px 14px;
    border-radius: var(--radius-lg);
    background: var(--bg-2);
    border: 1px solid var(--border);
    min-width: 0;
  }
  .num {
    font-size: 24px;
    font-weight: 700;
    line-height: 1.15;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .lbl {
    margin-top: 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
  }
  .sub {
    margin-top: 2px;
    font-size: 11.5px;
    line-height: 1.35;
    color: var(--text-faint);
    min-height: 1em;
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 1.4fr);
    gap: 22px;
  }
  .block {
    min-width: 0;
  }
  .moments {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 22px;
  }
  .when {
    flex: none;
    width: 58px;
    color: var(--text-faint);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .clip {
    flex: 0 1 auto;
    min-width: 0;
    border: 0;
    padding: 0;
    background: none;
    font: inherit;
    color: var(--accent-text);
    text-align: left;
    cursor: pointer;
  }
  .clip:hover {
    text-decoration: underline;
  }
  .url {
    flex: 1 1 0;
    min-width: 0;
    font-size: 12px;
  }
  h3 {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-faint);
    margin-bottom: 8px;
  }
  ol {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 13px;
  }
  li {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .rank {
    width: 12px;
    color: var(--text-faint);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
  }
  .name {
    flex: 1;
    min-width: 0;
  }
  .val {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .none {
    font-size: 13px;
    color: var(--text-faint);
  }
  dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 5px 12px;
    margin: 0;
    font-size: 13px;
  }
  dt {
    color: var(--text-muted);
  }
  dd {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
