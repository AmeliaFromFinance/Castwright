<script lang="ts">
  import { api } from '$lib/api';
  import type { Audience } from '$lib/bindings/Audience';
  import type { GiveawaySettings } from '$lib/bindings/GiveawaySettings';
  import type { Reward } from '$lib/bindings/Reward';
  import NumberInput from '$lib/editor/ui/NumberInput.svelte';
  import { toasts } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Collapse from '$lib/ui/Collapse.svelte';
  import Segmented from '$lib/ui/Segmented.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import { Ticket } from '@lucide/svelte';
  import ChatLineField from './ChatLineField.svelte';
  import { MAX_TITLE, defaultGiveawaySettings, giveawayIssues } from './play-forms';
  import { play } from './play.svelte';

  interface Props {
    /** Rewards Castwright made, so it can complete or refund them. */
    rewards: Reward[];
  }

  let { rewards }: Props = $props();

  // svelte-ignore state_referenced_locally
  let draft = $state<GiveawaySettings>(structuredClone($state.snapshot(play.state?.giveaway_settings) ?? defaultGiveawaySettings()));
  let tried = $state(false);
  let busy = $state(false);
  const err = $derived(tried ? giveawayIssues(draft) : {});

  const TOKENS = [
    { token: 'title', label: 'The prize' },
    { token: 'how', label: 'How to enter' },
    { token: 'keyword', label: 'Chat keyword' },
    { token: 'entries', label: 'People who entered' },
    { token: 'winner', label: 'Who won' },
    { token: 'previous', label: 'Who missed out (re-roll)' },
    { token: 'claim_s', label: 'Seconds to claim' }
  ];
  const AUDIENCE: Array<{ value: Audience; label: string }> = [
    { value: 'everyone', label: 'Everyone' },
    { value: 'followers', label: 'Followers' },
    { value: 'subscribers', label: 'Subs' }
  ];

  function pickReward(id: string) {
    const r = rewards.find((x) => x.id === id);
    draft.reward_id = r?.id ?? '';
    draft.reward_title = r?.title ?? '';
  }

  async function open(e: SubmitEvent) {
    e.preventDefault();
    tried = true;
    if (Object.keys(giveawayIssues(draft)).length) return;
    busy = true;
    try {
      await api.giveawayOpen($state.snapshot(draft));
      toasts.success('Giveaway open');
    } catch (x) {
      toasts.error(x);
    } finally {
      busy = false;
    }
  }
</script>

<form class="form" onsubmit={open} novalidate aria-label="New giveaway">
  <div class="f">
    <label for="gw-title">Prize</label>
    <input id="gw-title" class="input" maxlength={MAX_TITLE + 10} placeholder="Steam game key" aria-invalid={err.title ? 'true' : undefined} bind:value={draft.title} />
    {#if err.title}<p class="error">{err.title}</p>{/if}
  </div>

  <fieldset class="group">
    <legend class="label">How to enter</legend>
    <div class="two">
      <div class="f">
        <label for="gw-word">Chat keyword</label>
        <input id="gw-word" class="input mono" placeholder="!join" aria-invalid={err.keyword ? 'true' : undefined} bind:value={draft.keyword} />
        {#if err.keyword}<p class="error">{err.keyword}</p>{:else}<p class="hint">Empty turns chat entries off.</p>{/if}
      </div>
      <div class="f">
        <label for="gw-reward">Channel point reward</label>
        <select id="gw-reward" class="input" value={draft.reward_id} onchange={(e) => pickReward(e.currentTarget.value)}>
          <option value="">None</option>
          {#each rewards as r (r.id)}<option value={r.id}>{r.title} ({r.cost.toLocaleString('en-US')})</option>{/each}
          {#if draft.reward_id && !rewards.some((r) => r.id === draft.reward_id)}<option value={draft.reward_id}>{draft.reward_title} (not found)</option>{/if}
        </select>
        <p class="hint">Rewards made in Castwright. Refunded when someone can't enter.</p>
      </div>
    </div>
    {#if err.entry}<p class="error">{err.entry}</p>{/if}
  </fieldset>

  <fieldset class="group">
    <legend class="label">Who can enter</legend>
    <Segmented label="Who can enter" value={draft.rules.audience} options={AUDIENCE} onchange={(v) => (draft.rules.audience = v)} />
    {#if draft.rules.audience === 'followers'}
      <div class="row">
        <span>Followed for at least</span>
        <NumberInput label="Days followed" unit="days" min={0} max={3650} value={draft.rules.min_follow_days} oninput={(v) => (draft.rules.min_follow_days = Math.max(0, Math.round(v)))} />
      </div>
    {/if}
    <div class="switches">
      <Switch label="Leave out the broadcaster" showLabel checked={draft.rules.exclude_broadcaster} onchange={(v) => (draft.rules.exclude_broadcaster = v)} />
      <Switch label="Leave out mods" showLabel checked={draft.rules.exclude_mods} onchange={(v) => (draft.rules.exclude_mods = v)} />
      <Switch label="Leave out bots" showLabel checked={draft.rules.exclude_bots} onchange={(v) => (draft.rules.exclude_bots = v)} />
    </div>
  </fieldset>

  <fieldset class="group">
    <legend class="label">Entries</legend>
    <div class="row">
      <span>Subs get</span>
      <NumberInput label="Entries per sub" unit="×" min={1} max={100} value={draft.rules.sub_entries} oninput={(v) => (draft.rules.sub_entries = Math.min(100, Math.max(1, Math.round(v))))} />
      {#if err.sub_entries}<p class="error">{err.sub_entries}</p>{/if}
    </div>
    <div class="switches">
      <Switch label="Tier 2 and 3 subs get 2× and 3× that" showLabel checked={draft.rules.tier_bonus} onchange={(v) => (draft.rules.tier_bonus = v)} />
      {#if draft.reward_id}
        <Switch label="Each redemption adds more entries" showLabel checked={!draft.rules.one_entry} onchange={(v) => (draft.rules.one_entry = !v)} />
      {/if}
    </div>
  </fieldset>

  <fieldset class="group">
    <legend class="label">Timing</legend>
    <div class="three">
      <div class="f">
        <span class="sub">Close after</span>
        <NumberInput label="Close after minutes" unit="min" min={0} max={1440} value={draft.close_after_min} oninput={(v) => (draft.close_after_min = Math.max(0, Math.round(v)))} />
      </div>
      <div class="f">
        <span class="sub">Close at</span>
        <NumberInput label="Close at this many people" unit="people" min={0} max={100000} value={draft.close_after_entries} oninput={(v) => (draft.close_after_entries = Math.max(0, Math.round(v)))} />
      </div>
      <div class="f">
        <span class="sub">Time to claim</span>
        <NumberInput label="Seconds to claim" unit="s" min={0} max={3600} value={draft.claim_s} oninput={(v) => (draft.claim_s = Math.min(3600, Math.max(0, Math.round(v))))} />
      </div>
    </div>
    <p class="hint">0 turns each off. A winner claims by chatting before the time runs out.</p>
  </fieldset>

  <Collapse id="gw-messages" title="Chat messages" open={false}>
    <div class="lines">
      <ChatLineField label="Opened" line={draft.messages.opened} tokens={TOKENS} onchange={(l) => (draft.messages.opened = l)} />
      <ChatLineField label="Closed" line={draft.messages.closed} tokens={TOKENS} onchange={(l) => (draft.messages.closed = l)} />
      <ChatLineField label="Winner" line={draft.messages.winner} tokens={TOKENS} onchange={(l) => (draft.messages.winner = l)} />
      <ChatLineField label="Re-roll" line={draft.messages.reroll} tokens={TOKENS} onchange={(l) => (draft.messages.reroll = l)} />
    </div>
  </Collapse>

  <div class="actions">
    <Button variant="primary" type="submit" {busy}><Ticket size={14} />Open giveaway</Button>
  </div>
</form>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 620px;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-1);
  }
  .group {
    border: 0;
    padding: 0;
    margin: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .f {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .f > label,
  .label,
  .sub {
    font-size: 12px;
    font-weight: 550;
    color: var(--text-muted);
  }
  legend.label {
    margin-bottom: 4px;
  }
  .two,
  .three {
    display: grid;
    gap: 10px;
  }
  .two {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
  .three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .row > :global(:not(span):not(p)) {
    width: 130px;
  }
  .switches {
    display: grid;
    gap: 4px;
  }
  .lines {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 6px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
  }
  .hint {
    font-size: 12px;
    color: var(--text-faint);
  }
  .error {
    font-size: 12px;
    color: var(--danger);
  }
</style>
