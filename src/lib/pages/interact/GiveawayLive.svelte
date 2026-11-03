<script lang="ts">
  import { api } from '$lib/api';
  import type { Giveaway } from '$lib/bindings/Giveaway';
  import type { Winner } from '$lib/bindings/Winner';
  import NumberInput from '$lib/editor/ui/NumberInput.svelte';
  import { defaultNameColor } from '$lib/overlay/color';
  import { clock, useClock } from '$lib/overlay/clock.svelte';
  import { toasts } from '$lib/state/toast.svelte';
  import Badge from '$lib/ui/Badge.svelte';
  import Button from '$lib/ui/Button.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import { Check, CircleStop, DoorOpen, PartyPopper, RotateCcw, Search, X } from '@lucide/svelte';
  import { claimLeft, howToEnter } from './play-forms';

  interface Props {
    g: Giveaway;
  }

  let { g }: Props = $props();

  $effect(() => useClock());
  const now = $derived(clock.now);

  let busy = $state('');
  let count = $state(1);
  let query = $state('');

  const tickets = $derived(g.entrants.reduce((a, e) => a + e.entries, 0));
  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const list = q ? g.entrants.filter((e) => e.viewer.name.toLowerCase().includes(q) || e.viewer.login.includes(q)) : g.entrants;
    return list.slice().reverse();
  });
  const winners = $derived(g.winners.slice().reverse());
  const how = $derived(howToEnter(g.settings));

  async function run<T>(key: string, fn: () => Promise<T>, done?: string) {
    busy = key;
    try {
      await fn();
      if (done) toasts.success(done);
    } catch (e) {
      toasts.error(e);
    } finally {
      busy = '';
    }
  }

  const color = (name: string, c: string) => c || defaultNameColor(name);

  function stateBadge(w: Winner): { tone: 'ok' | 'warn' | 'danger' | 'neutral'; text: string } {
    const left = claimLeft(w, now);
    if (w.state === 'claimed') return { tone: 'ok', text: 'Claimed' };
    if (w.state === 'missed') return { tone: 'danger', text: 'Didn’t claim' };
    if (w.state === 'rerolled') return { tone: 'neutral', text: 'Re-rolled' };
    if (left !== null) return { tone: 'warn', text: `${left}s to claim` };
    return { tone: 'neutral', text: 'Drawn' };
  }

  const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
</script>

<section class="live" aria-label="Running giveaway">
  <div class="top">
    <div class="grow">
      <div class="title-row">
        <h2>{g.settings.title}</h2>
        {#if g.open}<span class="pill live-pill">Open</span>{:else}<span class="pill">Closed</span>{/if}
      </div>
      {#if how}<p class="hint">{how}</p>{/if}
    </div>
    <div class="count" aria-label="Entries">
      <strong data-testid="gw-count">{g.entrants.length.toLocaleString('en-US')}</strong>
      <span>entered{tickets !== g.entrants.length ? ` · ${tickets.toLocaleString('en-US')} entries` : ''}</span>
    </div>
  </div>

  <div class="bar">
    {#if g.open}
      <Button busy={busy === 'close'} onclick={() => run('close', () => api.giveawaySetOpen(false), 'Entries closed')}><CircleStop size={14} />Close entries</Button>
    {:else}
      <Button busy={busy === 'reopen'} onclick={() => run('reopen', () => api.giveawaySetOpen(true), 'Entries open again')}><DoorOpen size={14} />Open entries</Button>
    {/if}
    <div class="draw">
      <NumberInput label="Winners to draw" min={1} max={50} value={count} oninput={(v) => (count = Math.min(50, Math.max(1, Math.round(v))))} />
      <Button variant="primary" busy={busy === 'draw'} disabled={!g.entrants.length} onclick={() => run('draw', () => api.giveawayDraw(count))}>
        <PartyPopper size={14} />Draw {count > 1 ? `${count} winners` : 'winner'}
      </Button>
    </div>
    <div class="grow"></div>
    <Button variant="ghost" busy={busy === 'finish'} onclick={() => run('finish', () => api.giveawayFinish(), 'Saved to history')}><Check size={14} />Done</Button>
  </div>

  {#if winners.length}
    <div class="winners" aria-label="Winners">
      {#each winners as w (w.viewer.id + w.drawn_at)}
        {@const b = stateBadge(w)}
        <article class="winner" class:missed={w.state === 'missed'} class:faded={w.state === 'rerolled'} aria-label="Winner {w.viewer.name}">
          <div class="w-head">
            <span class="name" style="color:{color(w.viewer.login, w.viewer.color)}">{w.viewer.name}</span>
            <span class="faint">{w.entries} {w.entries === 1 ? 'entry' : 'entries'}</span>
            <Badge tone={b.tone}>{b.text}</Badge>
            <div class="grow"></div>
            {#if w.state !== 'rerolled'}
              {#if w.state !== 'claimed'}
                <Button size="sm" busy={busy === `claim-${w.viewer.id}`} onclick={() => run(`claim-${w.viewer.id}`, () => api.giveawayClaim(w.viewer.id))}><Check size={13} />Mark claimed</Button>
              {/if}
              <Button size="sm" variant={w.state === 'missed' ? 'primary' : 'secondary'} busy={busy === `reroll-${w.viewer.id}`} onclick={() => run(`reroll-${w.viewer.id}`, () => api.giveawayReroll(w.viewer.id))}>
                <RotateCcw size={13} />Re-roll
              </Button>
            {/if}
          </div>
          {#if w.state === 'missed'}<p class="prompt">They didn't chat in time. Re-roll to pick someone else.</p>{/if}
          {#if w.state !== 'rerolled'}
            {#if w.said.length}
              <ul class="said" aria-label="Recent chat from {w.viewer.name}">
                {#each w.said as l, i (i)}<li><span class="faint mono">{time(l.ts)}</span> {l.text}</li>{/each}
              </ul>
            {:else}
              <p class="faint small">No chat from them yet.</p>
            {/if}
          {/if}
        </article>
      {/each}
    </div>
  {/if}

  <div class="entrants">
    <div class="e-head">
      <h3 class="grow">Entrants</h3>
      <label class="search">
        <Search size={13} />
        <input class="input" placeholder="Search" aria-label="Search entrants" bind:value={query} />
      </label>
    </div>
    {#if !g.entrants.length}
      <p class="faint small">Nobody yet. {how}</p>
    {:else if !shown.length}
      <p class="faint small">Nobody matches “{query}”.</p>
    {:else}
      <ul class="list" aria-label="Entrant list">
        {#each shown as e (e.viewer.id)}
          <li>
            <span class="name" style="color:{color(e.viewer.login, e.viewer.color)}">{e.viewer.name}</span>
            {#if e.viewer.sub_tier > 0}<Badge tone="accent">Sub{e.viewer.sub_tier > 1 ? ` T${e.viewer.sub_tier}` : ''}</Badge>{/if}
            {#if e.via === 'points'}<Badge>Points</Badge>{/if}
            <span class="grow"></span>
            <span class="faint mono">{e.entries}×</span>
            <IconButton size="sm" label="Remove {e.viewer.name}" onclick={() => run(`rm-${e.viewer.id}`, () => api.giveawayRemove(e.viewer.id))}><X /></IconButton>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<style>
  .live {
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 680px;
  }
  .top {
    display: flex;
    align-items: flex-start;
    gap: 16px;
  }
  .title-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  h2 {
    font-size: 17px;
  }
  h3 {
    font-size: 13px;
  }
  .pill {
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: var(--bg-3);
    color: var(--text-muted);
  }
  .live-pill {
    background: var(--live);
    color: var(--on-live);
  }
  .count {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    font-size: 12px;
    color: var(--text-muted);
  }
  .count strong {
    font-size: 28px;
    line-height: 1.1;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-1);
  }
  .draw {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .draw > :global(:first-child) {
    width: 70px;
  }
  .grow {
    flex: 1;
  }
  .winners {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .winner {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--accent) 7%, var(--bg-1));
  }
  .winner.missed {
    border-color: color-mix(in srgb, var(--danger) 55%, var(--border));
    background: color-mix(in srgb, var(--danger) 7%, var(--bg-1));
  }
  .winner.faded {
    opacity: 0.55;
    border-color: var(--border);
    background: var(--bg-1);
  }
  .w-head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .name {
    font-weight: 700;
  }
  .w-head .name {
    font-size: 16px;
  }
  .prompt {
    font-size: 12.5px;
    color: var(--danger);
  }
  .said {
    list-style: none;
    margin: 0;
    padding: 8px 10px;
    border-radius: var(--radius);
    background: var(--bg-2);
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 12.5px;
  }
  .entrants {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .e-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-faint);
  }
  .search .input {
    width: 180px;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    max-height: 420px;
    overflow: auto;
  }
  .list li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px 4px 12px;
    font-size: 13px;
  }
  .list li + li {
    border-top: 1px solid var(--border);
  }
  .faint {
    color: var(--text-faint);
  }
  .small,
  .hint {
    font-size: 12px;
  }
  .hint {
    color: var(--text-muted);
  }
</style>
