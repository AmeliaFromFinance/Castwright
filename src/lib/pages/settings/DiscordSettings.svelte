<script lang="ts">
  import { api } from '$lib/api';
  import type { DiscordWebhook } from '$lib/bindings/DiscordWebhook';
  import type { SessionSummary } from '$lib/bindings/SessionSummary';
  import { app } from '$lib/state/app.svelte';
  import { attemptOk } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { Plus } from '@lucide/svelte';
  import DiscordHook from './DiscordHook.svelte';
  import { MAX_WEBHOOKS, newWebhook, type ChannelInfo } from './discord';

  const saved = $derived(app.settings?.discord.webhooks ?? []);
  /** Added here but not saved yet. */
  let fresh = $state<DiscordWebhook[]>([]);
  const list = $derived([...saved, ...fresh.filter((f) => !saved.some((s) => s.id === f.id))]);
  let latest = $state<SessionSummary | null>(null);

  $effect(() => {
    api
      .listSessions(1)
      .then(([first]) => (first ? api.sessionSummary(first.session.id) : null))
      .then((s) => (latest = s))
      .catch(() => {});
  });

  const channel = $derived<ChannelInfo>({
    channel: app.twitch?.broadcaster?.display_name || 'YourChannel',
    login: app.twitch?.broadcaster?.login || 'yourchannel',
    title: app.twitch?.stream.title || 'Stream title',
    category: app.twitch?.stream.category || 'Just Chatting'
  });

  function onsaved(h: DiscordWebhook) {
    if (!app.settings) return;
    const others = app.settings.discord.webhooks.filter((w) => w.id !== h.id);
    const at = app.settings.discord.webhooks.findIndex((w) => w.id === h.id);
    others.splice(at < 0 ? others.length : at, 0, h);
    app.settings.discord = { webhooks: others };
    fresh = fresh.filter((f) => f.id !== h.id);
  }

  async function ondelete(id: string) {
    if (fresh.some((f) => f.id === id)) {
      fresh = fresh.filter((f) => f.id !== id);
      return;
    }
    if (await attemptOk(() => api.deleteDiscordWebhook(id)) && app.settings) {
      app.settings.discord = { webhooks: app.settings.discord.webhooks.filter((w) => w.id !== id) };
    }
  }
</script>

<div class="discord">
  {#each list as hook (hook.id)}
    <DiscordHook {hook} {channel} summary={latest} {onsaved} {ondelete} />
  {:else}
    <p class="empty faint">No webhooks yet. Add one to post when you go live.</p>
  {/each}
  <div>
    <Button size="sm" disabled={list.length >= MAX_WEBHOOKS} onclick={() => (fresh = [...fresh, newWebhook()])}><Plus size={14} />Add webhook</Button>
  </div>
</div>

<style>
  .discord {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .empty {
    font-size: 13px;
  }
</style>
