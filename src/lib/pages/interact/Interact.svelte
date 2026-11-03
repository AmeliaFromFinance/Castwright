<script lang="ts">
  import { untrack } from 'svelte';
  import { app } from '$lib/state/app.svelte';
  import { loadPref, savePref } from '$lib/state/persist';
  import Button from '$lib/ui/Button.svelte';
  import EmptyState from '$lib/ui/EmptyState.svelte';
  import Segmented from '$lib/ui/Segmented.svelte';
  import { RefreshCw, Vote } from '@lucide/svelte';
  import { needsNewSignIn } from './forms';
  import Polls from './Polls.svelte';
  import Rewards from './Rewards.svelte';
  import { interact } from './store.svelte';

  type Tab = 'points' | 'polls';
  let tab = $state<Tab>(loadPref<Tab>('interact.tab', 'points'));
  $effect(() => savePref('interact.tab', tab));

  const account = $derived(app.twitch?.broadcaster ?? null);
  const signedIn = $derived(!!account);

  $effect(() => {
    if (signedIn) untrack(() => void interact.load());
  });

  $effect(() => {
    const feed = app.feed;
    untrack(() => interact.takeFeed(feed));
  });

  function openSettings() {
    app.page = 'settings';
  }
</script>

<div class="interact">
  <header class="toolbar">
    <h1>Interact</h1>
    <Segmented
      label="Section"
      value={tab}
      options={[
        { value: 'points', label: 'Channel points' },
        { value: 'polls', label: 'Polls & predictions' }
      ]}
      onchange={(v) => (tab = v)}
    />
    <div class="grow"></div>
    {#if signedIn}
      <Button size="sm" variant="ghost" busy={interact.loading} onclick={() => interact.load()}><RefreshCw size={14} />Refresh</Button>
    {/if}
  </header>

  {#if !signedIn}
    <div class="empty">
      <EmptyState title="Sign in to Twitch" body="Rewards, polls and predictions come from your Twitch channel.">
        {#snippet icon()}<Vote size={28} />{/snippet}
        <Button variant="primary" onclick={openSettings}>Open Twitch settings</Button>
      </EmptyState>
    </div>
  {:else}
    {#if needsNewSignIn(account)}
      <p class="banner" role="status">
        You signed in before these features were added. Sign out and in again in Settings → Twitch to use them. Everything else keeps working.
        <button type="button" class="link" onclick={openSettings}>Open settings</button>
      </p>
    {/if}
    <div class="body">
      {#if tab === 'points'}<Rewards />{:else}<Polls />{/if}
    </div>
  {/if}
</div>

<style>
  .interact {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 14px;
    height: 54px;
    flex: none;
    padding: 0 16px;
    border-bottom: 1px solid var(--border);
  }
  h1 {
    font-size: 15px;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .empty {
    flex: 1;
    display: grid;
    place-items: center;
  }
  .banner {
    margin: 12px 16px 0;
    padding: 8px 12px;
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--warn) 12%, transparent);
    font-size: 12.5px;
  }
  .link {
    margin-left: 6px;
    color: var(--accent-text);
    text-decoration: underline;
  }
</style>
