<script lang="ts">
  import { untrack } from 'svelte';
  import type { LayerKind } from '$lib/bindings/LayerKind';
  import type { OverlayMsg } from '$lib/bindings/OverlayMsg';
  import { getStageCtx } from '../context';
  import { buildSrcdoc, pageMsg, parseWidgetMsg, seSession, toSeEvent, widgetLoadDetail } from '../se-bridge';

  interface Props {
    layerId: string;
    kind: Extract<LayerKind, { type: 'custom' }>;
  }
  let { layerId, kind }: Props = $props();
  const ctx = getStageCtx();

  let frame = $state<HTMLIFrameElement>();
  let ready = false;
  let queue: Record<string, unknown>[] = [];

  const srcdoc = $derived(
    buildSrcdoc(
      { html: kind.html ?? '', css: kind.css ?? '', js: kind.js ?? '', fields: kind.fields ?? {}, values: kind.values ?? {} },
      (p) => ctx.assetUrl(p)
    )
  );
  const session = $derived(JSON.stringify(seSession(ctx.recent, ctx.vars)));

  function post(msg: Record<string, unknown>) {
    const w = frame?.contentWindow;
    if (!w) return;
    try {
      // The sandboxed frame has an opaque origin, so '*' is the only usable target.
      w.postMessage(msg, '*');
    } catch (err) {
      console.warn('[overlay] custom widget message failed', err);
    }
  }

  function send(msg: Record<string, unknown>) {
    if (ready) post(msg);
    else if (queue.length < 200) queue.push(msg);
  }

  function init() {
    ready = true;
    const detail = widgetLoadDetail({
      fields: kind.fields ?? {},
      values: kind.values ?? {},
      recent: ctx.recent,
      vars: ctx.vars,
      isEditorMode: ctx.mode === 'editor',
      assetUrl: (p) => ctx.assetUrl(p)
    });
    post(pageMsg('init', { detail, store: ctx.widgetState[layerId] ?? {}, isEditorMode: ctx.mode === 'editor' }));
    const pending = queue;
    queue = [];
    for (const m of pending) post(m);
  }

  // A new document means a fresh handshake.
  $effect(() => {
    void srcdoc;
    untrack(() => {
      ready = false;
      queue = [];
    });
  });

  $effect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frame || e.source !== frame.contentWindow) return;
      const m = parseWidgetMsg(e.data);
      if (!m) return;
      if (m.type === 'ready') init();
      else if (m.type === 'store_set') ctx.storeWidgetValue(layerId, m.key, m.value);
      else ctx.storeWidgetValue(layerId, m.key, undefined);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  });

  function onFeed(msg: OverlayMsg) {
    switch (msg.type) {
      case 'event': {
        const se = toSeEvent(msg.event);
        if (se) send(pageMsg('event', { detail: se }));
        send(pageMsg('event', { detail: { listener: 'castwright:event', event: msg.event } }));
        break;
      }
      case 'chat_delete':
        send(pageMsg('event', { detail: { listener: 'delete-message', event: { msgId: msg.message_id } } }));
        break;
      case 'chat_clear_user':
        send(pageMsg('event', { detail: { listener: 'delete-messages', event: { userId: msg.user_id } } }));
        break;
      case 'chat_clear':
        send(pageMsg('event', { detail: { listener: 'delete-messages', event: { all: true } } }));
        break;
      case 'alert_play':
        send(pageMsg('event', { detail: { listener: 'castwright:alert', event: msg.play } }));
        break;
    }
  }

  $effect(() => {
    const feed = ctx.feed;
    if (!feed) return;
    return feed.subscribe(onFeed);
  });

  let lastSession = '';
  $effect(() => {
    const s = session;
    untrack(() => {
      if (s === lastSession) return;
      const first = lastSession === '';
      lastSession = s;
      if (!first && ready) post(pageMsg('session', { detail: { session: JSON.parse(s) as unknown } }));
    });
  });
</script>

<iframe
  bind:this={frame}
  class="cw-custom"
  class:cw-editor={ctx.mode === 'editor'}
  title="Custom widget"
  sandbox="allow-scripts"
  allow="autoplay"
  referrerpolicy="no-referrer"
  {srcdoc}
></iframe>

<style>
  .cw-custom {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    background: transparent;
    color-scheme: normal;
  }
  .cw-editor {
    pointer-events: none;
  }
</style>
