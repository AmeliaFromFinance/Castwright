<script lang="ts">
  import { untrack } from 'svelte';
  import { api } from '$lib/api';
  import type { GiveawayRecord } from '$lib/bindings/GiveawayRecord';
  import { saveExport } from '$lib/sessions/export';
  import { toasts } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import EmptyState from '$lib/ui/EmptyState.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import { Download, Ticket, Trash2 } from '@lucide/svelte';
  import GiveawayForm from './GiveawayForm.svelte';
  import GiveawayLive from './GiveawayLive.svelte';
  import { historyCsv } from './play-forms';
  import { play } from './play.svelte';
  import { interact } from './store.svelte';

  $effect(() => {
    untrack(() => void play.load());
  });

  const g = $derived(play.state?.giveaway ?? null);
  const rewards = $derived(interact.rewards.filter((r) => r.manageable));
  const past = $derived(play.history.filter((r) => r.ended_at > 0));

  const date = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });

  async function exportCsv() {
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      if (await saveExport(`castwright-giveaways-${stamp}`, 'csv', historyCsv(past))) toasts.success('CSV saved');
    } catch (e) {
      toasts.error(e);
    }
  }

  async function remove(r: GiveawayRecord) {
    try {
      await api.giveawayDeleteRecord(r.id);
      play.history = play.history.filter((x) => x.id !== r.id);
    } catch (e) {
      toasts.error(e);
    }
  }
</script>

{#if play.error}
  <div class="center">
    <EmptyState title="Giveaways aren't available" body={play.error}>
      {#snippet icon()}<Ticket size={28} />{/snippet}
    </EmptyState>
  </div>
{:else if play.state}
  <div class="cols">
    <section class="col" aria-label="Giveaway">
      {#if g}
        <GiveawayLive {g} />
      {:else}
        <div class="head"><h2>New giveaway</h2></div>
        <GiveawayForm {rewards} />
      {/if}
    </section>
    <section class="col side" aria-label="Past giveaways">
      <div class="head">
        <h2 class="grow">History</h2>
        <Button size="sm" variant="ghost" disabled={!past.length} onclick={exportCsv}><Download size={14} />Export CSV</Button>
      </div>
      {#if !past.length}
        <p class="faint">Finished giveaways show here.</p>
      {:else}
        <ul class="history">
          {#each past as r (r.id)}
            <li>
              <div class="grow">
                <div class="h-title">{r.title}</div>
                <div class="faint small">
                  {date(r.opened_at)} · {r.entrants.toLocaleString('en-US')} entered{r.winners.length ? ` · ${r.winners.join(', ')}` : ''}
                </div>
              </div>
              <IconButton size="sm" label="Delete {r.title}" onclick={() => remove(r)}><Trash2 /></IconButton>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
{/if}

<style>
  .center {
    flex: 1;
    display: grid;
    place-items: center;
  }
  .cols {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(260px, 1fr);
  }
  .col {
    min-height: 0;
    overflow: auto;
    padding: 14px 18px 24px;
  }
  .side {
    border-left: 1px solid var(--border);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    min-height: 26px;
  }
  h2 {
    font-size: 15px;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .history {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .history li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 8px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-1);
  }
  .h-title {
    font-weight: 600;
    font-size: 13px;
  }
  .faint {
    color: var(--text-faint);
    font-size: 12.5px;
  }
  .small {
    font-size: 12px;
  }
</style>
