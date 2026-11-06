<script lang="ts" module>
  // Sound and speech play once per alert, even if the layer remounts.
  const voiced = new Set<string>();
</script>

<script lang="ts">
  import { tick, untrack } from 'svelte';
  import type { AlertPlay } from '$lib/bindings/AlertPlay';
  import { animSpec, durationOf, play as playAnim } from '../anim';
  import { alertTimes } from '../alert-timing';
  import { getStageCtx } from '../context';
  import { alertCard, cssValue, frameCss, scopeClass } from '../styles';
  import StyledText from '../StyledText.svelte';

  interface Props {
    layerId: string;
    width: number;
    height: number;
  }
  let { layerId, width, height }: Props = $props();
  const ctx = getStageCtx();

  let current = $state.raw<AlertPlay | null>(null);
  let card = $state<HTMLElement>();
  let video = $state<HTMLVideoElement>();
  let timers: ReturnType<typeof setTimeout>[] = [];
  let anim: Animation | null = null;
  let exiting = false;
  let sound: HTMLAudioElement | null = null;
  let speaking = false;

  const isAudio = $derived(ctx.audioLayerId === layerId && !ctx.muted);
  // Text only hides the image or video even when one is set.
  const textOnly = $derived(current?.layout === 'text_only');
  const imageUrl = $derived(current && !textOnly ? ctx.assetUrl(current.image) : '');
  const videoUrl = $derived(current && !textOnly ? ctx.assetUrl(current.video) : '');
  const hasMedia = $derived(!!(imageUrl || videoUrl));
  const layout = $derived(current ? (hasMedia ? current.layout : 'text_only') : 'text_only');
  const accent = $derived(current ? cssValue(current.accent) : '');
  const cardStyle = $derived(current ? alertCard(current) : null);
  const carded = $derived(!!cardStyle);
  const scope = $derived(scopeClass(layerId));
  const cardCss = $derived.by(() => {
    const c = cardStyle;
    if (!c) return '';
    const s = `:where(.${scope})`;
    const css = frameCss(c, `${s} .cw-alert`, { noLean: true });
    const lean = c.lean ? `${s} .cw-alert-wrap{transform:rotate(${c.lean}deg)}` : '';
    return [css, lean].filter(Boolean).join('\n').replace(/<\/style/gi, '');
  });

  function clearTimers() {
    for (const t of timers) clearTimeout(t);
    timers = [];
  }

  function stopAudio() {
    if (sound) {
      sound.pause();
      sound = null;
    }
    if (speaking) {
      speaking = false;
      try {
        window.speechSynthesis?.cancel();
      } catch {
        // not available
      }
    }
  }

  function speak(p: AlertPlay) {
    const text = (p.event?.message ?? '').trim();
    if (!p.tts || !text) return;
    try {
      const synth = window.speechSynthesis;
      if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
      const u = new SpeechSynthesisUtterance(text);
      u.volume = Math.min(1, Math.max(0, p.volume / 100));
      speaking = true;
      u.onend = () => (speaking = false);
      synth.speak(u);
    } catch {
      // speech is optional
    }
  }

  function startAudio(p: AlertPlay, elapsed: number) {
    if (!isAudio || voiced.has(p.id) || elapsed > 1500) return;
    voiced.add(p.id);
    const url = ctx.assetUrl(p.sound);
    if (!url) {
      speak(p);
      return;
    }
    try {
      const a = new Audio(url);
      a.volume = Math.min(1, Math.max(0, p.volume / 100));
      a.onended = () => {
        if (sound === a) {
          sound = null;
          speak(p);
        }
      };
      sound = a;
      a.play().catch((err: unknown) => {
        console.warn('[overlay] alert sound blocked or failed', err);
        if (sound === a) sound = null;
        speak(p);
      });
    } catch (err) {
      console.warn('[overlay] alert sound failed', err);
      speak(p);
    }
  }

  function hide(id: string) {
    if (current?.id !== id) return;
    clearTimers();
    anim?.cancel();
    anim = null;
    current = null;
    stopAudio();
  }

  function runExit(p: AlertPlay, endAt: number) {
    if (exiting || current?.id !== p.id) return;
    exiting = true;
    clearTimers();
    anim?.cancel();
    const spec = card ? animSpec(p.exit, 'exit', width, height) : null;
    const left = Math.max(0, endAt - Date.now());
    if (spec) spec.options.duration = Math.max(1, Math.min(left || durationOf(p.exit, 'exit'), durationOf(p.exit, 'exit')));
    if (spec && card) {
      spec.options.delay = 0;
      const r = playAnim(card, spec);
      anim = r.anim;
      void r.done.then(() => hide(p.id));
    } else {
      hide(p.id);
    }
    // Safety net in case the animation never reports back.
    timers.push(setTimeout(() => hide(p.id), left + 120));
    if (sound) {
      const s = sound;
      const fadeFrom = s.volume;
      const steps = 6;
      for (let i = 1; i <= steps; i++) {
        timers.push(setTimeout(() => (s.volume = Math.max(0, fadeFrom * (1 - i / steps))), (left / steps) * i));
      }
    }
  }

  async function start(a: NonNullable<typeof ctx.alert>) {
    clearTimers();
    anim?.cancel();
    anim = null;
    exiting = false;
    stopAudio();
    const p = a.play;
    const t = alertTimes(a);
    const now = Date.now();
    if (now >= t.endAt) {
      current = null;
      return;
    }
    current = p;
    await tick();
    if (current?.id !== p.id) return;
    const elapsed = now - a.startedAt;
    startAudio(p, elapsed);
    if (now >= t.exitAt) {
      runExit(p, t.endAt);
      return;
    }
    const spec = card ? animSpec(p.enter, 'enter', width, height) : null;
    if (spec && card) {
      const r = playAnim(card, spec);
      anim = r.anim;
      // Joining late (reconnect, layer shown mid-alert): skip ahead.
      if (r.anim && elapsed > 0) r.anim.currentTime = elapsed;
      void r.done.then(() => {
        if (anim === r.anim && !exiting) {
          r.anim?.cancel();
          anim = null;
        }
      });
    }
    timers.push(setTimeout(() => runExit(p, t.endAt), t.exitAt - Date.now()));
  }

  $effect(() => {
    const a = ctx.alert;
    untrack(() => {
      if (!a) {
        if (current) hide(current.id);
        return;
      }
      if (current?.id !== a.play.id) {
        void start(a);
      } else if (a.stoppedAt !== null && !exiting) {
        runExit(a.play, alertTimes(a).endAt);
      } else if (current !== a.play && !exiting) {
        // Same alert with new content (editor preview): update without restarting.
        current = a.play;
      }
    });
  });

  // Alert video: with sound on the audio layer, muted elsewhere.
  const volume = $derived(current ? Math.min(1, Math.max(0, current.volume / 100)) || 0 : 0);
  $effect(() => {
    const v = video;
    if (!v) return;
    v.volume = volume;
    v.muted = !isAudio;
    v.play().catch(() => {
      if (!v.muted) {
        v.muted = true;
        v.play().catch(() => undefined);
      }
    });
  });

  $effect(() => () => {
    clearTimers();
    anim?.cancel();
    stopAudio();
  });
</script>

{#if current}
  {#if cardCss}{@html `<style data-cw-frame="alert">${cardCss}</style>`}{/if}
  {#key current.id}
    <div class="cw-alert-wrap cw-layout-{layout}" style="--cw-h:{height}px;--cw-w:{width}px">
      <div
        bind:this={card}
        class="cw-alert cw-layout-{layout}"
        class:cw-carded={carded}
        style:--cw-accent={accent || 'transparent'}
        data-alert-id={current.id}
        data-kind={current.kind}
      >
        {#if hasMedia}
          <div class="cw-alert-media">
            {#if videoUrl}
              <!-- svelte-ignore a11y_media_has_caption -->
              <video
                bind:this={video}
                src={videoUrl}
                autoplay
                playsinline
                muted
                loop
                preload="auto"
                onerror={() => console.warn(`[overlay] alert video failed to load: ${current?.video ?? ''}`)}
              ></video>
            {:else}
              <img src={imageUrl} alt="" draggable="false" />
            {/if}
          </div>
        {/if}
        <div class="cw-alert-text">
          {#if current.title}
            <StyledText class="cw-alert-title" text={current.title} style={current.title_style} />
          {/if}
          {#if accent && current.title}
            <span class="cw-alert-accent" aria-hidden="true"></span>
          {/if}
          {#if current.message}
            <StyledText class="cw-alert-message" text={current.message} style={current.message_style} />
          {/if}
        </div>
      </div>
    </div>
  {/key}
{/if}

<style>
  .cw-alert-wrap {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  .cw-alert {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    max-width: 100%;
    max-height: 100%;
    gap: 14px;
    will-change: transform, opacity;
    transform-origin: 50% 60%;
  }
  .cw-alert-media {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
  }
  /* Media gets a definite height so images without intrinsic size (SVG) still show. */
  .cw-alert-media img,
  .cw-alert-media video {
    display: block;
    height: 100%;
    width: auto;
    max-width: 100%;
    object-fit: contain;
  }
  .cw-layout-media_above .cw-alert-media {
    height: calc(var(--cw-h) * 0.48);
    max-width: 100%;
  }
  .cw-alert-text {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    min-width: 0;
  }
  .cw-alert-accent {
    display: block;
    width: 56px;
    height: 4px;
    border-radius: 2px;
    background: var(--cw-accent);
    margin: 2px 0 4px;
  }

  .cw-alert.cw-layout-media_left {
    flex-direction: row;
    align-items: center;
    gap: 22px;
  }
  .cw-layout-media_left .cw-alert-media {
    flex: 0 0 auto;
    height: calc(var(--cw-h) * 0.7);
    max-width: calc(var(--cw-w) * 0.4);
  }
  .cw-layout-media_left .cw-alert-text {
    align-items: flex-start;
  }

  .cw-alert.cw-layout-media_behind {
    width: 100%;
    height: 100%;
    justify-content: center;
    overflow: hidden;
  }
  .cw-alert.cw-layout-media_behind:not(.cw-carded) {
    border-radius: 20px;
  }
  .cw-layout-media_behind .cw-alert-media {
    position: absolute;
    inset: 0;
  }
  .cw-layout-media_behind .cw-alert-media img,
  .cw-layout-media_behind .cw-alert-media video {
    width: 100%;
    height: 100%;
    max-width: none;
    object-fit: cover;
  }
  .cw-layout-media_behind .cw-alert-text {
    position: relative;
    padding: 24px;
  }
</style>
