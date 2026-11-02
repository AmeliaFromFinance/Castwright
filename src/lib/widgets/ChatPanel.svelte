<script lang="ts">
  import { tick } from 'svelte';
  import { app } from '$lib/state/app.svelte';
  import { api } from '$lib/api';
  import { attempt } from '$lib/state/toast.svelte';
  import { contrast } from '$lib/theme/color';
  import Button from '$lib/ui/Button.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import { loadPref, savePref } from '$lib/state/persist';
  import { Settings2 } from '@lucide/svelte';
  import { messageParts, twitchBadges } from '$lib/overlay/chat';
  import ChatBadges from '$lib/overlay/emotes/ChatBadges.svelte';
  import ChatText from '$lib/overlay/emotes/ChatText.svelte';
  import { paintStyle } from '$lib/overlay/emotes/cosmetics';
  import { chatExtras } from '$lib/overlay/emotes/store.svelte';
  import { chatPieces } from '$lib/overlay/emotes/tokenize';
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

  const OPTIONS = [
    ['twitchBadges', 'Twitch badges'],
    ['seventvBadges', '7TV badges'],
    ['paints', '7TV name paints'],
    ['seventv', '7TV emotes'],
    ['bttv', 'BetterTTV emotes'],
    ['ffz', 'FrankerFaceZ emotes']
  ] as const;
  type Options = Record<(typeof OPTIONS)[number][0], boolean>;
  const ALL_ON: Options = { twitchBadges: true, seventvBadges: true, paints: true, seventv: true, bttv: true, ffz: true };
  let opts = $state<Options>({ ...ALL_ON, ...loadPref<Partial<Options>>('chat.display', {}) });
  let showOptions = $state(false);
  let optsBox: HTMLDivElement | undefined = $state();

  function setOption(key: keyof Options, on: boolean) {
    opts[key] = on;
    savePref('chat.display', opts);
  }

  const channelId = $derived(app.twitch?.broadcaster?.id || (typeof app.vars['twitch.user_id'] === 'string' ? app.vars['twitch.user_id'] : ''));
  const emoteOpts = $derived({ seventv: opts.seventv, bttv: opts.bttv, ffz: opts.ffz });
  const emotes = $derived(chatExtras.emotes(emoteOpts));
  // Text is 13px, emotes about 1.6em.
  const emoteHeight = $derived(compact ? 20 : 21);

  $effect(() => chatExtras.want(channelId, emoteOpts));
  $effect(() => {
    if (channelId && (opts.paints || opts.seventvBadges)) chatExtras.wantCosmetics(messages.slice(-60).map((m) => m.user?.id ?? ''));
  });

  function nameStyle(e: Event): string {
    const color = nameColor(e);
    const paint = opts.paints ? chatExtras.cosmetics(e.user?.id)?.paint : null;
    const painted = paint ? paintStyle(paint, color.startsWith('#') ? color : 'currentColor', 13) : '';
    return painted ? `color:${color};${painted}` : `color:${color}`;
  }

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

<svelte:window
  onpointerdown={(e) => {
    if (showOptions && !optsBox?.contains(e.target as Node)) showOptions = false;
  }}
  onkeydown={(e) => {
    if (showOptions && e.key === 'Escape') showOptions = false;
  }}
/>

<div class="head">
  <h3 class="eyebrow">Chat</h3>
  <span class="grow"></span>
  <div class="opts" bind:this={optsBox}>
    <IconButton label="Chat display options" size="sm" pressed={showOptions} aria-expanded={showOptions} onclick={() => (showOptions = !showOptions)}>
      <Settings2 size={14} />
    </IconButton>
    {#if showOptions}
      <div class="menu" role="group" aria-label="Chat display options">
        {#each OPTIONS as [key, label] (key)}
          <Switch {label} showLabel checked={opts[key]} onchange={(v) => setOption(key, v)} />
        {/each}
      </div>
    {/if}
  </div>
  {#if !stick}
    <button type="button" class="jump" onclick={() => {
      stick = true;
      list?.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
    }}>New messages ↓</button>
  {/if}
</div>
<ol class="chat" class:compact bind:this={list} onscroll={onScroll} aria-label="Chat messages" aria-live="off">
  {#each messages as m (m.id)}
    {@const extra = opts.paints || opts.seventvBadges ? chatExtras.cosmetics(m.user?.id) : undefined}
    <li class:own={m.data.sent_by_castwright === true}>
      <span class="badges"><ChatBadges twitch={opts.twitchBadges ? twitchBadges(m) : []} seventv={opts.seventvBadges ? extra?.badge : null} size={15} /></span
      ><b class="name" class:cw-paint={opts.paints && !!extra?.paint} style={nameStyle(m)}>{m.user?.display_name ?? ''}</b><span class="colon">:</span>
      <span class="msg selectable"><ChatText pieces={chatPieces(messageParts(m), emotes)} height={emoteHeight} /></span>
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
  .badges:empty {
    display: none;
  }
  .badges :global(.cw-chat-badge) {
    margin-right: 4px;
    vertical-align: -3px;
  }
  .opts {
    position: relative;
    margin-right: 6px;
  }
  .menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 5;
    display: grid;
    gap: 4px;
    padding: 10px 12px;
    white-space: nowrap;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
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
