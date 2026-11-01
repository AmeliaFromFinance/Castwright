<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fade, fly } from 'svelte/transition';
  import type { Event } from '$lib/bindings/Event';
  import type { LayerKind } from '$lib/bindings/LayerKind';
  import { emoteUrl, messageParts, roles, visibleChat, type Role } from '../chat';
  import { defaultNameColor, isLightBackground, readableColor } from '../color';
  import { clock, useClock } from '../clock.svelte';
  import { getStageCtx } from '../context';
  import { displayName } from '../labels';
  import { boxStyleCss, DEFAULT_TEXT, textStyleCss } from '../styles';

  interface Props {
    kind: Extract<LayerKind, { type: 'chat' }>;
    /** Layer background, used when bubbles are transparent. */
    layerBackground: string;
  }
  let { kind, layerBackground }: Props = $props();
  const ctx = getStageCtx();

  $effect(() => {
    if ((kind.fade_after_s ?? 0) > 0) return useClock();
  });

  const lines = $derived(
    visibleChat(ctx.chat, {
      maxMessages: kind.max_messages || 12,
      hideCommands: kind.hide_commands,
      hideUsers: kind.hide_users ?? [],
      fadeAfterS: kind.fade_after_s ?? 0,
      now: (kind.fade_after_s ?? 0) > 0 ? clock.now : 0
    })
  );
  const ordered = $derived(kind.newest_on_top ? lines.slice().reverse() : lines);
  const style = $derived({ ...DEFAULT_TEXT, ...(kind.style ?? {}) });
  const textCss = $derived(textStyleCss(style, 'inline'));
  const bubbleCss = $derived(boxStyleCss(kind.bubble));
  const bubbleBg = $derived(kind.bubble?.background && kind.bubble.background !== 'transparent' ? kind.bubble.background : layerBackground);
  const lightBg = $derived(isLightBackground(bubbleBg));
  const emoteSize = $derived(Math.round((style.font_size || 28) * 1.45));
  const badgeSize = $derived(Math.round((style.font_size || 28) * 0.8));
  const live = $derived(ctx.mode === 'live');

  function nameColor(e: Event): string {
    const c = typeof e.data?.color === 'string' && e.data.color ? e.data.color : defaultNameColor(e.user?.login ?? displayName(e));
    return readableColor(c, lightBg);
  }

  const BADGE: Record<Role, { title: string; bg: string; path: string }> = {
    broadcaster: { title: 'Broadcaster', bg: '#e91916', path: 'M3 5.5h7.5v7H3zM11.5 8l3.5-2v6l-3.5-2z' },
    moderator: { title: 'Moderator', bg: '#00ad03', path: 'M12.6 2.5l.9.9-6.4 6.4 1.2 1.2-1.1 1.1-1.2-1.2-1.8 1.8a1 1 0 01-1.4-1.4l1.8-1.8-1.2-1.2L4.5 7.6l1.2 1.2z' },
    vip: { title: 'VIP', bg: '#e005b9', path: 'M4.5 3.5h7l2.5 3.2L8 13.5 2 6.7z' },
    subscriber: { title: 'Subscriber', bg: '#8205b4', path: 'M8 2.2l1.75 3.6 3.95.55-2.87 2.77.69 3.93L8 11.2l-3.52 1.85.69-3.93L2.3 6.35l3.95-.55z' }
  };
</script>

<div class="cw-chat" class:cw-top={kind.newest_on_top} style={textCss}>
  {#each ordered as m (m.id)}
    <div
      class="cw-chat-line"
      style={bubbleCss}
      data-msg-id={m.id}
      data-user-id={m.user?.id ?? ''}
      animate:flip={{ duration: live ? 260 : 0 }}
      in:fly={{ y: kind.newest_on_top ? -14 : 14, duration: live ? 320 : 0, opacity: 0 }}
      out:fade={{ duration: live ? 260 : 0 }}
    >
      {#if kind.show_badges}
        {#each roles(m) as r (r)}
          <svg class="cw-chat-badge" width={badgeSize} height={badgeSize} viewBox="0 0 16 16" role="img" aria-label={BADGE[r].title}>
            <rect width="16" height="16" rx="3.5" fill={BADGE[r].bg} />
            <path d={BADGE[r].path} fill="#fff" />
          </svg>
        {/each}
      {/if}
      <span class="cw-chat-name" style="color:{nameColor(m)}">{displayName(m)}</span><span class="cw-chat-sep"
        >{m.data?.is_action === true ? ' ' : ': '}</span
      ><span class="cw-chat-msg" class:cw-action={m.data?.is_action === true}
        >{#each messageParts(m) as p, i (i)}{#if p.type === 'emote'}<img
              class="cw-emote"
              src={emoteUrl(p.id)}
              alt={p.text}
              title={p.text}
              style="height:{emoteSize}px"
              draggable="false"
            />{:else if p.type === 'mention'}<b class="cw-mention">{p.text}</b>{:else if p.type === 'cheermote'}<b
              class="cw-cheer">{p.text}</b
            >{:else}{p.text}{/if}{/each}</span
      >
    </div>
  {/each}
</div>

<style>
  .cw-chat {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 6px;
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
  }
  .cw-chat.cw-top {
    justify-content: flex-start;
  }
  .cw-chat-line {
    flex: 0 0 auto;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .cw-chat-badge {
    display: inline-block;
    vertical-align: -0.12em;
    margin-right: 0.25em;
    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.3));
  }
  .cw-chat-name {
    font-weight: 700;
  }
  .cw-chat-sep {
    opacity: 0.75;
    white-space: pre;
  }
  .cw-chat-msg {
    white-space: pre-wrap;
  }
  .cw-action {
    font-style: italic;
  }
  .cw-emote {
    display: inline-block;
    vertical-align: middle;
    margin: -0.3em 0.05em;
    width: auto;
    text-shadow: none;
  }
  .cw-mention,
  .cw-cheer {
    font-weight: 700;
  }
</style>
