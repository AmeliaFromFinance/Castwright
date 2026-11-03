<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fade, fly } from 'svelte/transition';
  import type { Event } from '$lib/bindings/Event';
  import type { LayerKind } from '$lib/bindings/LayerKind';
  import { messageParts, twitchBadges, visibleChat } from '../chat';
  import { highlightColor, layerRules, makeJudge } from '../chat-filters';
  import { defaultNameColor, isLightBackground, readableColor } from '../color';
  import { clock, useClock } from '../clock.svelte';
  import { getStageCtx } from '../context';
  import ChatBadges from '../emotes/ChatBadges.svelte';
  import ChatText from '../emotes/ChatText.svelte';
  import { paintStyle } from '../emotes/cosmetics';
  import { chatExtras } from '../emotes/store.svelte';
  import { chatPieces } from '../emotes/tokenize';
  import { displayName } from '../labels';
  import { alternator, DEFAULT_TEXT, fillColorOf, itemVars, textStyleCss } from '../styles';

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

  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const rules = $derived(layerRules(kind, ctx.chatRules));
  const judge = $derived(
    makeJudge(rules, {
      broadcaster: [str(ctx.vars['twitch.login']), str(ctx.vars['twitch.display_name'])],
      botLogin: str(ctx.vars['twitch.bot_login'])
    })
  );
  const lines = $derived(
    visibleChat(ctx.chat, {
      maxMessages: kind.max_messages || 12,
      hideCommands: false,
      hideUsers: [],
      fadeAfterS: kind.fade_after_s ?? 0,
      now: (kind.fade_after_s ?? 0) > 0 ? clock.now : 0,
      hidden: (e) => judge(e).hidden !== null
    })
  );
  const ordered = $derived(kind.newest_on_top ? lines.slice().reverse() : lines);
  const style = $derived({ ...DEFAULT_TEXT, ...(kind.style ?? {}) });
  const textCss = $derived(textStyleCss(style, 'inline'));
  const flipOf = alternator();
  const bubbleBg = $derived(fillColorOf(kind.bubble) || layerBackground);
  const lightBg = $derived(isLightBackground(bubbleBg));
  const emoteSize = $derived(Math.round((style.font_size || 28) * 1.45));
  const badgeSize = $derived(Math.round((style.font_size || 28) * 0.8));
  const live = $derived(ctx.mode === 'live');

  const channelId = $derived(typeof ctx.vars['twitch.user_id'] === 'string' ? ctx.vars['twitch.user_id'] : '');
  // Older projects lack these switches; they default to on.
  const emoteOpts = $derived({ seventv: kind.seventv_emotes !== false, bttv: kind.bttv_emotes !== false, ffz: kind.ffz_emotes !== false });
  const paints = $derived(kind.seventv_paints !== false);
  const badges7tv = $derived(kind.seventv_badges !== false);
  const emotes = $derived(chatExtras.emotes(emoteOpts));

  $effect(() => chatExtras.want(channelId, emoteOpts));
  $effect(() => {
    if (channelId && (paints || badges7tv)) chatExtras.wantCosmetics(lines.map((m) => m.user?.id ?? ''));
  });

  function nameColor(e: Event): string {
    const c = typeof e.data?.color === 'string' && e.data.color ? e.data.color : defaultNameColor(e.user?.login ?? displayName(e));
    return readableColor(c, lightBg);
  }

  function nameStyle(e: Event): string {
    const color = nameColor(e);
    const paint = paints ? chatExtras.cosmetics(e.user?.id)?.paint : null;
    const painted = paint ? paintStyle(paint, color, style.font_size || 28) : '';
    return painted ? `color:${color};${painted}` : `color:${color}`;
  }
</script>

<div class="cw-chat" class:cw-top={kind.newest_on_top} style={textCss}>
  {#each ordered as m (m.id)}
    {@const extra = paints || badges7tv ? chatExtras.cosmetics(m.user?.id) : undefined}
    {@const v = judge(m)}
    {@const hl = highlightColor(rules, v)}
    <div
      class="cw-chat-line"
      class:cw-hl={v.highlights.length > 0}
      class:cw-hl-first={v.highlights.includes('first')}
      class:cw-hl-mention={v.highlights.includes('mention')}
      class:cw-hl-keyword={v.highlights.includes('keyword')}
      class:cw-hl-user={v.highlights.includes('user')}
      class:cw-hl-redeemed={v.highlights.includes('redeemed')}
      style={[itemVars(kind.item_card, kind.bubble, nameColor(m), flipOf(m.id)), hl && `--cw-hl:${hl}`].filter(Boolean).join(';') || undefined}
      data-highlight={v.highlights.join(' ') || undefined}
      data-msg-id={m.id}
      data-user-id={m.user?.id ?? ''}
      animate:flip={{ duration: live ? 260 : 0 }}
      in:fly={{ y: kind.newest_on_top ? -14 : 14, duration: live ? 320 : 0, opacity: 0 }}
      out:fade={{ duration: live ? 260 : 0 }}
    >
      <ChatBadges twitch={kind.show_badges ? twitchBadges(m) : []} seventv={badges7tv ? extra?.badge : null} size={badgeSize} /><span
        class="cw-chat-name"
        class:cw-paint={paints && !!extra?.paint}
        style={nameStyle(m)}>{displayName(m)}</span
      ><span class="cw-chat-sep">{m.data?.is_action === true ? ' ' : ': '}</span><span class="cw-chat-msg" class:cw-action={m.data?.is_action === true}
        ><ChatText pieces={chatPieces(messageParts(m), emotes)} height={emoteSize} /></span
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
  .cw-chat-name {
    font-weight: 700;
  }
  .cw-hl {
    background-image: linear-gradient(
      90deg,
      var(--cw-hl) 0 4px,
      color-mix(in srgb, var(--cw-hl) 26%, transparent) 4px,
      color-mix(in srgb, var(--cw-hl) 8%, transparent) 85%
    );
  }
  /* Low priority, so card padding and corners win. */
  :where(.cw-hl) {
    padding-left: 12px;
    padding-right: 6px;
    border-radius: 6px;
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
</style>
