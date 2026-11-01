<script lang="ts">
  import { tick } from 'svelte';
  import { app } from '$lib/state/app.svelte';
  import { api } from '$lib/api';
  import { attempt } from '$lib/state/toast.svelte';
  import { contrast } from '$lib/theme/color';
  import Button from '$lib/ui/Button.svelte';
  import type { Event } from '$lib/bindings/Event';

  let { compact = true }: { compact?: boolean } = $props();

  let list: HTMLOListElement | undefined = $state();
  let stick = $state(true);
  let draft = $state('');
  let sending = $state(false);
  let asBot = $state(true);

  const signedIn = $derived(!!app.twitch?.broadcaster);
  const hasBot = $derived(!!app.twitch?.bot);
  const messages = $derived(app.chat.slice(-200));

  $effect(() => {
    void messages.length;
    if (stick) tick().then(() => list?.scrollTo({ top: list.scrollHeight }));
  });

  function onScroll() {
    if (!list) return;
    stick = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  }

  /** Twitch name colours are picked by viewers; nudge ones that are hard to read. */
  function nameColor(e: Event): string {
    const c = typeof e.data.color === 'string' && /^#[0-9a-f]{6}$/i.test(e.data.color) ? e.data.color : '';
    const bg = app.theme?.tokens['bg-1'] ?? '#161a21';
    if (c && contrast(c, bg) >= 3) return c;
    return 'var(--accent-text)';
  }

  async function send(e: SubmitEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    sending = true;
    const ok = await attempt(() => api.twitchSendChat(text, hasBot && asBot));
    sending = false;
    if (ok !== undefined) {
      draft = '';
      stick = true;
    }
  }
</script>

<div class="head">
  <h3 class="eyebrow">Chat</h3>
  <span class="grow"></span>
  {#if !stick}
    <button type="button" class="jump" onclick={() => {
      stick = true;
      list?.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
    }}>New messages ↓</button>
  {/if}
</div>
<ol class="chat" class:compact bind:this={list} onscroll={onScroll} aria-label="Chat messages" aria-live="off">
  {#each messages as m (m.id)}
    <li class:own={m.data.sent_by_castwright === true}>
      {#if m.roles.broadcaster}<span class="role b" title="Broadcaster">B</span>{:else if m.roles.moderator}<span class="role m" title="Moderator">M</span>{:else if m.roles.vip}<span class="role v" title="VIP">V</span>{/if}
      <b style:color={nameColor(m)}>{m.user?.display_name ?? ''}</b><span class="colon">:</span>
      <span class="msg selectable">
        {#each m.message_parts.length ? m.message_parts : [{ type: 'text', text: m.message ?? '' } as const] as part, i (i)}
          {#if part.type === 'emote'}<img
              class="emote"
              alt={part.text}
              title={part.text}
              src="https://static-cdn.jtvnw.net/emoticons/v2/{encodeURIComponent(part.id)}/default/dark/1.0"
            />{:else if part.type === 'mention'}<strong>{part.text}</strong>{:else}{part.text}{/if}
        {/each}
      </span>
    </li>
  {:else}
    <li class="none muted">{signedIn ? 'Chat messages appear here.' : 'Sign in to Twitch in Settings to see chat.'}</li>
  {/each}
</ol>
<form class="send" onsubmit={send}>
  <label class="sr-only" for="chat-input">Chat message</label>
  <input
    id="chat-input"
    class="input"
    placeholder={signedIn ? (hasBot && asBot ? `Chat as ${app.twitch?.bot?.display_name}` : `Chat as ${app.twitch?.broadcaster?.display_name}`) : 'Not signed in'}
    maxlength="500"
    disabled={!signedIn}
    bind:value={draft}
  />
  {#if hasBot}
    <button
      type="button"
      class="as"
      title="Switch between your account and the bot"
      onclick={() => (asBot = !asBot)}>{asBot ? 'Bot' : 'You'}</button
    >
  {/if}
  <Button type="submit" variant="primary" size="sm" disabled={!signedIn || !draft.trim()} busy={sending}>Send</Button>
</form>

<style>
  .head {
    display: flex;
    align-items: center;
    height: 36px;
    padding: 0 14px;
    flex: none;
  }
  .jump {
    border: 0;
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 999px;
    cursor: pointer;
  }
  .chat {
    flex: 1;
    list-style: none;
    margin: 0;
    padding: 0 14px 8px;
    overflow: auto;
    min-height: 0;
    font-size: 13px;
    line-height: 1.45;
  }
  .compact {
    font-size: 12.5px;
  }
  li {
    padding: 3px 0;
    overflow-wrap: anywhere;
  }
  li.own {
    opacity: 0.85;
  }
  b {
    font-weight: 650;
  }
  .colon {
    margin-right: 5px;
  }
  .role {
    display: inline-grid;
    place-items: center;
    width: 15px;
    height: 15px;
    margin-right: 4px;
    border-radius: 3px;
    font-size: 9.5px;
    font-weight: 800;
    vertical-align: 1px;
    color: #fff;
  }
  .role.b {
    background: #d93036;
  }
  .role.m {
    background: #1f8a3e;
  }
  .role.v {
    background: #b4239c;
  }
  .emote {
    height: 1.6em;
    vertical-align: middle;
    margin: -0.3em 0;
  }
  .none {
    font-size: 12px;
    padding: 6px 0;
  }
  .send {
    display: flex;
    gap: 6px;
    padding: 10px;
    border-top: 1px solid var(--border);
  }
  .as {
    border: 1px solid var(--border);
    background: var(--bg-2);
    color: var(--text-muted);
    border-radius: var(--radius);
    padding: 0 8px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }
</style>
