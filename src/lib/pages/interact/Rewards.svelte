<script lang="ts">
  import type { Redemption } from '$lib/bindings/Redemption';
  import type { Reward } from '$lib/bindings/Reward';
  import { ago, count } from '$lib/format';
  import { attempt, toasts } from '$lib/state/toast.svelte';
  import Badge from '$lib/ui/Badge.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import EmptyState from '$lib/ui/EmptyState.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import { Check, Coins, Lock, Pause, Pencil, Play, Plus, Trash2, Undo2 } from '@lucide/svelte';
  import { duration, newReward } from './forms';
  import RewardDialog from './RewardDialog.svelte';
  import { interact } from './store.svelte';

  let editing = $state<Reward>(newReward());
  let dialogOpen = $state(false);
  let picked = $state<string[]>([]);
  let now = $state(Date.now());

  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(t);
  });

  const mine = $derived(interact.rewards.filter((r) => r.manageable));
  const theirs = $derived(interact.rewards.filter((r) => !r.manageable));
  const queue = $derived(interact.queue);
  const pickedItems = $derived(queue.filter((q) => picked.includes(q.id)));
  const allPicked = $derived(queue.length > 0 && pickedItems.length === queue.length);

  $effect(() => {
    const ids = new Set(queue.map((q) => q.id));
    if (picked.some((id) => !ids.has(id))) picked = picked.filter((id) => ids.has(id));
  });

  function edit(r: Reward) {
    editing = r;
    dialogOpen = true;
  }

  async function patch(r: Reward, p: Partial<Reward>, done: string) {
    await attempt(() => interact.saveReward({ ...$state.snapshot(r), ...p }), done);
  }

  let deleting = $state<Reward | null>(null);
  let deleteOpen = $state(false);

  function askDelete(r: Reward) {
    deleting = r;
    deleteOpen = true;
  }

  async function remove() {
    const r = deleting;
    deleteOpen = false;
    if (r) await attempt(() => interact.deleteReward(r), `Deleted "${r.title}"`);
  }

  async function finish(items: Redemption[], refund: boolean) {
    if (!items.length) return;
    const n = await attempt(() => interact.finish(items, refund));
    if (n !== undefined) toasts.success(`${refund ? 'Refunded' : 'Completed'} ${n} redemption${n === 1 ? '' : 's'}`);
  }

  function togglePick(id: string) {
    picked = picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id];
  }

  function details(r: Reward): string {
    return [
      r.cooldown_s > 0 && `Cooldown ${duration(r.cooldown_s)}`,
      r.max_per_stream > 0 && `${r.max_per_stream} per stream`,
      r.max_per_user > 0 && `${r.max_per_user} per viewer`,
      r.input_required && 'Asks for a message',
      r.skip_queue && 'Skips the queue'
    ]
      .filter(Boolean)
      .join(' · ');
  }
</script>

{#snippet rewardRow(r: Reward)}
  <li class="reward" class:off={!r.enabled} data-reward={r.title}>
    <span class="dot" style:background={r.color || 'var(--accent)'}></span>
    <div class="main">
      <div class="title-row">
        <span class="title truncate">{r.title}</span>
        {#if !r.enabled}<Badge>Off</Badge>{:else if r.paused}<Badge tone="warn">Paused</Badge>{/if}
      </div>
      <span class="meta faint truncate">{details(r) || r.prompt || 'No limits'}</span>
    </div>
    <span class="cost mono"><Coins size={13} />{count(r.cost)}</span>
    {#if r.manageable}
      <div class="tools">
        <Switch label="{r.title} on" checked={r.enabled} onchange={(v) => patch(r, { enabled: v }, v ? 'Reward on' : 'Reward off')} />
        <IconButton size="sm" label={r.paused ? `Resume ${r.title}` : `Pause ${r.title}`} onclick={() => patch(r, { paused: !r.paused }, r.paused ? 'Resumed' : 'Paused')}>
          {#if r.paused}<Play />{:else}<Pause />{/if}
        </IconButton>
        <IconButton size="sm" label="Edit {r.title}" onclick={() => edit(r)}><Pencil /></IconButton>
        <IconButton size="sm" tone="danger" label="Delete {r.title}" onclick={() => askDelete(r)}><Trash2 /></IconButton>
      </div>
    {:else}
      <span class="locked faint" title="Made on Twitch"><Lock size={13} /></span>
    {/if}
  </li>
{/snippet}

{#if interact.pointsError}
  <div class="center">
    <EmptyState title="Channel points aren't available" body={interact.pointsError}>
      {#snippet icon()}<Coins size={28} />{/snippet}
    </EmptyState>
  </div>
{:else}
  <div class="cols">
    <section class="col" aria-label="Rewards">
      <div class="head">
        <div class="grow">
          <h2>Rewards</h2>
          <p class="muted lead">Rewards made here can be changed here.</p>
        </div>
        <Button size="sm" variant="primary" onclick={() => edit(newReward())}><Plus size={14} />New reward</Button>
      </div>
      {#if mine.length}
        <ul class="list">{#each mine as r (r.id)}{@render rewardRow(r)}{/each}</ul>
      {:else if !interact.loading}
        <p class="none muted">No rewards made in Castwright yet.</p>
      {/if}
      {#if theirs.length}
        <h3>Made on Twitch</h3>
        <p class="note faint">Twitch only lets an app change rewards it made. Change these on Twitch. They still trigger alerts and actions.</p>
        <ul class="list">{#each theirs as r (r.id)}{@render rewardRow(r)}{/each}</ul>
      {/if}
    </section>

    <section class="col queue" aria-label="Redemption queue">
      <div class="head">
        <div class="grow">
          <h2>Waiting <span class="faint">{queue.length}</span></h2>
          <p class="muted lead">Redemptions of rewards made here. Complete them, or refund the points.</p>
        </div>
      </div>
      {#if queue.length}
        <div class="bulk">
          <label class="check">
            <input type="checkbox" checked={allPicked} onchange={() => (picked = allPicked ? [] : queue.map((q) => q.id))} />
            <span>{pickedItems.length ? `${pickedItems.length} selected` : 'Select all'}</span>
          </label>
          <div class="grow"></div>
          <Button size="sm" disabled={!pickedItems.length} onclick={() => finish(pickedItems, false)}><Check size={14} />Complete</Button>
          <Button size="sm" disabled={!pickedItems.length} onclick={() => finish(pickedItems, true)}><Undo2 size={14} />Refund</Button>
        </div>
        <ul class="list">
          {#each queue as q (q.id)}
            <li class="redemption" data-redemption={q.id}>
              <input type="checkbox" aria-label="Select {q.user.display_name}: {q.reward_title}" checked={picked.includes(q.id)} onchange={() => togglePick(q.id)} />
              <div class="main">
                <div class="title-row">
                  <span class="who">{q.user.display_name}</span>
                  <span class="faint truncate">{q.reward_title}</span>
                </div>
                {#if q.input}<span class="input-text">“{q.input}”</span>{/if}
              </div>
              <span class="when faint">{ago(q.redeemed_at, now)}</span>
              <IconButton size="sm" label="Complete {q.user.display_name}: {q.reward_title}" onclick={() => finish([q], false)}><Check /></IconButton>
              <IconButton size="sm" tone="danger" label="Refund {q.user.display_name}: {q.reward_title}" onclick={() => finish([q], true)}><Undo2 /></IconButton>
            </li>
          {/each}
        </ul>
      {:else}
        <EmptyState title="Nothing waiting" body="New redemptions show up here as they come in." />
      {/if}
    </section>
  </div>
{/if}

<RewardDialog bind:open={dialogOpen} reward={editing} />

<Dialog bind:open={deleteOpen} title={deleting ? `Delete "${deleting.title}"?` : 'Delete reward?'} width={420}>
  <p class="muted">Viewers can't redeem it anymore. Twitch refunds redemptions still waiting.</p>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (deleteOpen = false)}>Cancel</Button>
    <Button variant="danger" onclick={remove}>Delete reward</Button>
  {/snippet}
</Dialog>

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
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  }
  .col {
    min-height: 0;
    overflow: auto;
    padding: 14px 18px 24px;
  }
  .queue {
    border-left: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-1) 60%, transparent);
  }
  .head {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    margin-bottom: 12px;
  }
  h2 {
    font-size: 15px;
  }
  h3 {
    margin: 18px 0 2px;
    font-size: 13px;
  }
  .lead {
    font-size: 12.5px;
    margin-top: 2px;
  }
  .note {
    font-size: 12px;
    margin-bottom: 8px;
  }
  .none {
    font-size: 13px;
    padding: 10px 0;
  }
  .list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .reward,
  .redemption {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    padding: 8px 10px 8px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-1);
  }
  .reward.off .main,
  .reward.off .cost {
    opacity: 0.55;
  }
  .dot {
    flex: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .title,
  .who {
    font-weight: 600;
  }
  .meta {
    font-size: 12px;
  }
  .cost {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12.5px;
    color: var(--accent-text);
  }
  .tools {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .locked {
    display: inline-grid;
    place-items: center;
    width: 28px;
  }
  .bulk {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
    color: var(--text-muted);
  }
  .input-text {
    font-size: 12.5px;
    color: var(--text-muted);
  }
  .when {
    font-size: 12px;
    white-space: nowrap;
  }
  input[type='checkbox'] {
    width: 15px;
    height: 15px;
    accent-color: var(--accent);
  }
</style>
