<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { Credits } from '$lib/bindings/Credits';
  import type { Event } from '$lib/bindings/Event';
  import type { LayerKind } from '$lib/bindings/LayerKind';
  import { render } from '$lib/logic/template';
  import { normLogin, twitchBadges } from '../chat';
  import { defaultNameColor, readableColor } from '../color';
  import { getStageCtx } from '../context';
  import { creditBlocks, pageStarts, rollOffset, rollPlan, sampleCredits, type CreditRow } from '../credits';
  import ChatBadges from '../emotes/ChatBadges.svelte';
  import { paintStyle } from '../emotes/cosmetics';
  import { chatExtras } from '../emotes/store.svelte';
  import { prefersReducedMotion } from '../scenes';
  import { DEFAULT_TEXT, textStyleCss } from '../styles';
  import StyledText from '../StyledText.svelte';

  interface Props {
    kind: Extract<LayerKind, { type: 'credits' }>;
    layerId: string;
  }
  let { kind, layerId }: Props = $props();
  const ctx = getStageCtx();
  const editor = $derived(ctx.mode === 'editor');

  const source = $derived<Credits | null>(ctx.credits ?? (editor ? sampleCredits() : null));
  const rollCount = $derived(ctx.rolls[layerId] ?? 0);

  /** The names of the running roll; they don't change while it runs. */
  let shown = $state<Credits | null>(null);
  let startedAt = $state<number | null>(null);
  let now = $state(0);
  const reduced = prefersReducedMotion();

  function start() {
    shown = source;
    startedAt = performance.now();
    now = startedAt;
  }

  onMount(() => {
    if (!editor) ctx.loadCredits();
  });

  // Start on load once names are there; in the editor only while animation is on.
  $effect(() => {
    if (kind.start !== 'on_load' || !source || (editor && ctx.paused)) return;
    untrack(() => {
      if (startedAt === null) start();
    });
  });

  // Roll credits step, or Roll now in the editor.
  let seenRolls = untrack(() => rollCount);
  $effect(() => {
    const n = rollCount;
    untrack(() => {
      if (n !== seenRolls) {
        seenRolls = n;
        start();
      }
    });
  });

  // Paused in the editor: back to the first screen.
  $effect(() => {
    if (editor && ctx.paused && kind.start === 'on_load') untrack(() => (startedAt = null));
  });

  const names = $derived(shown ?? (editor ? source : null));
  const blocks = $derived(
    creditBlocks(names, kind.sections ?? [], { maxChatters: kind.max_chatters ?? 10, showAmounts: kind.show_amounts !== false })
  );
  const heading = $derived(render(kind.heading ?? '', ctx.vars).trim());
  const footer = $derived(render(kind.footer ?? '', ctx.vars).trim());
  const style = $derived({ ...DEFAULT_TEXT, ...(kind.style ?? {}) });
  const titleStyle = $derived({ ...DEFAULT_TEXT, ...(kind.title_style ?? {}) });
  const headingStyle = $derived({ ...DEFAULT_TEXT, ...(kind.heading_style ?? {}) });
  const nameCss = $derived(textStyleCss(style, 'inline'));
  const badgeSize = $derived(Math.round((style.font_size || 28) * 0.8));
  const chatStyle = $derived(kind.names === 'chat');

  // Chat colours and badges come from the newest message each person sent.
  const lastChat = $derived.by(() => {
    const map = new Map<string, Event>();
    if (!chatStyle) return map;
    for (const e of ctx.chat) {
      if (e.user?.id) map.set(`id:${e.user.id}`, e);
      if (e.user?.login) map.set(`login:${normLogin(e.user.login)}`, e);
    }
    return map;
  });
  const channelId = $derived(typeof ctx.vars['twitch.user_id'] === 'string' ? ctx.vars['twitch.user_id'] : '');
  $effect(() => {
    if (chatStyle && channelId) chatExtras.wantCosmetics(blocks.flatMap((b) => b.rows.map((r) => r.user_id)));
  });

  const chatOf = (r: CreditRow) => (r.user_id && lastChat.get(`id:${r.user_id}`)) || (r.login && lastChat.get(`login:${normLogin(r.login)}`)) || null;

  function nameStyle(r: CreditRow): string {
    if (!chatStyle) return '';
    const e = chatOf(r);
    const raw = typeof e?.data?.color === 'string' && e.data.color ? e.data.color : defaultNameColor(r.login || r.name);
    const color = readableColor(raw);
    const paint = chatExtras.cosmetics(r.user_id)?.paint;
    const painted = paint ? paintStyle(paint, color, style.font_size || 28) : '';
    return painted ? `color:${color};${painted}` : `color:${color}`;
  }

  // Sizes in layer pixels (the editor scales the stage).
  let view = $state<HTMLDivElement>();
  let roll = $state<HTMLDivElement>();
  let boxH = $state(0);
  let contentH = $state(0);
  let pages = $state<number[]>([0]);

  function measure() {
    if (!view || !roll) return;
    boxH = view.clientHeight;
    contentH = roll.offsetHeight;
    if (!reduced) return;
    const rect = roll.getBoundingClientRect();
    const k = roll.offsetHeight > 0 ? rect.height / roll.offsetHeight : 1;
    const items = [...roll.querySelectorAll<HTMLElement>('[data-credit-item]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { top: (r.top - rect.top) / (k || 1), height: r.height / (k || 1) };
    });
    pages = pageStarts(items, boxH);
  }

  $effect(() => {
    const v = view;
    const r = roll;
    if (!v || !r || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(v);
    ro.observe(r);
    return () => ro.disconnect();
  });
  $effect(() => {
    void blocks;
    void heading;
    void footer;
    measure();
  });

  const repeat = $derived(!!kind.repeat);
  // Scrolling down, the order is flipped so the heading still comes in first.
  const down = $derived(kind.scroll === 'down' && !reduced);
  const plan = $derived(rollPlan(boxH, contentH, { speed: kind.speed || 60, fitS: kind.fit_s || 0, repeat, down }));
  const pageMs = $derived(Math.max(1, kind.page_s || 6) * 1000);
  const elapsed = $derived(startedAt === null ? 0 : now - startedAt);
  const done = $derived(startedAt !== null && !repeat && elapsed >= (reduced ? pageMs * pages.length : plan.ms));

  // One frame at a time while rolling; nothing runs once it has stopped.
  $effect(() => {
    if (startedAt === null || done) return;
    let raf = requestAnimationFrame(function frame(t) {
      now = t;
      raf = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(raf);
  });

  const page = $derived.by(() => {
    const i = Math.floor(elapsed / pageMs);
    return repeat ? i % pages.length : Math.min(pages.length - 1, i);
  });
  const transform = $derived.by(() => {
    if (reduced) return `translateY(${-(pages[page] ?? 0)}px)`;
    if (startedAt === null) return 'none';
    return `translateY(${rollOffset(plan, elapsed, repeat)}px)`;
  });
  // Reduced motion: hide what belongs to the next page.
  const clip = $derived.by(() => {
    if (!reduced) return '';
    const next = pages[page + 1];
    return next === undefined ? '' : `clip-path:inset(0 0 ${Math.max(0, contentH - next)}px 0)`;
  });
  const waiting = $derived(!editor && startedAt === null);
</script>

<div
  class="cw-credits"
  class:cw-two={kind.columns === 2}
  class:cw-fade={kind.fade_edges !== false && !reduced}
  class:cw-rolling={startedAt !== null && !done}
  class:cw-done={done}
  class:cw-paged={reduced}
  class:cw-waiting={waiting}
  data-scroll={down ? 'down' : 'up'}
  bind:this={view}
>
  <div class="cw-credits-roll" bind:this={roll} style="transform:{transform};{clip}">
    {#if heading}
      <div class="cw-credits-heading" data-credit-item><StyledText text={heading} style={headingStyle} block /></div>
    {/if}
    {#each blocks as b (b.kind)}
      <section class="cw-credits-section" data-kind={b.kind}>
        {#if b.title}
          <div class="cw-credits-title" data-credit-item><StyledText text={b.title} style={titleStyle} block /></div>
        {/if}
        <ul class="cw-credits-names" style={nameCss}>
          {#each b.rows as r, i (i)}
            {@const extra = chatStyle ? chatExtras.cosmetics(r.user_id) : undefined}
            {@const msg = chatStyle ? chatOf(r) : null}
            <li class="cw-credits-row" data-credit-item data-user-id={r.user_id || undefined}>
              {#if chatStyle}<ChatBadges twitch={msg ? twitchBadges(msg) : []} seventv={extra?.badge ?? null} size={badgeSize} />{/if}<span
                class="cw-credits-name"
                class:cw-paint={!!extra?.paint}
                style={nameStyle(r) || undefined}>{r.name}</span
              >{#if r.note}<span class="cw-credits-amount">{r.note}</span>{/if}
            </li>
          {/each}
        </ul>
      </section>
    {/each}
    {#if footer}
      <div class="cw-credits-footer" data-credit-item><StyledText text={footer} style={headingStyle} block /></div>
    {/if}
  </div>
</div>

<style>
  .cw-credits {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  .cw-fade {
    -webkit-mask-image: linear-gradient(to bottom, transparent, #000 9%, #000 91%, transparent);
    mask-image: linear-gradient(to bottom, transparent, #000 9%, #000 91%, transparent);
  }
  .cw-waiting {
    visibility: hidden;
  }
  .cw-credits-roll {
    display: flex;
    flex-direction: column;
    gap: 1.6em;
    will-change: transform;
  }
  [data-scroll='down'] > .cw-credits-roll {
    flex-direction: column-reverse;
  }
  .cw-credits-section {
    display: flex;
    flex-direction: column;
    gap: 0.35em;
  }
  .cw-credits-names {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.2em 1.2em;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .cw-two .cw-credits-names {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .cw-credits-row {
    overflow-wrap: anywhere;
  }
  .cw-credits-amount {
    margin-left: 0.5em;
    font-size: 0.72em;
    font-weight: 500;
    opacity: 0.7;
  }
</style>
