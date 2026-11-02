<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { onFlush } from '$lib/state/flush';
  import { api } from '$lib/api';
  import type { EventKind } from '$lib/bindings/EventKind';
  import type { Overlay } from '$lib/bindings/Overlay';
  import type { Phase } from '$lib/overlay/anim';
  import type OverlayStage from '$lib/overlay/OverlayStage.svelte';
  import { app } from '$lib/state/app.svelte';
  import { attempt, toasts } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import ResizeHandle from '$lib/ui/ResizeHandle.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import { appAssetUrl } from '$lib/widgets/assets.svelte';
  import {
    ArrowLeft,
    Check,
    CircleAlert,
    Eye,
    EyeOff,
    Frame,
    Link,
    LoaderCircle,
    Magnet,
    Minus,
    Pause,
    Play,
    Plus,
    Redo2,
    Undo2
  } from '@lucide/svelte';
  import Canvas from './Canvas.svelte';
  import Inspector from './inspector/Inspector.svelte';
  import { isTypingTarget, shortcutFor } from './keys';
  import LayerPanel from './LayerPanel.svelte';
  import PreviewVarsDialog from './PreviewVarsDialog.svelte';
  import { sampleAlert, sampleChat, sampleEvent, testableKinds } from './samples';
  import { EditorStore } from './store.svelte';
  import TestMenu from './TestMenu.svelte';
  import Popover from './ui/Popover.svelte';

  interface Props {
    overlay: Overlay;
    onclose: () => void;
  }

  let { overlay, onclose }: Props = $props();

  const store = new EditorStore(untrack(() => overlay), (o) => api.saveOverlay(o));
  const stopFlush = onFlush(() => store.flush());
  let stage = $state<OverlayStage>();
  let canvas = $state<Canvas>();
  let wide = $state(false);
  let leftW = $state(248);
  let rightW = $state(336);
  // Code editing in a custom widget wants more room.
  let winW = $state(1440);
  const rightShown = $derived(wide ? Math.max(rightW, Math.min(620, winW * 0.46)) : rightW);
  let varsOpen = $state(false);
  let leaving = $state(false);
  let alertTimer: ReturnType<typeof setTimeout> | null = null;

  const vars = $derived({ ...app.vars, ...store.varOverrides });
  const recent = $derived([...app.feed].reverse().slice(-40).concat(store.testEvents));
  const chat = $derived(app.chat.slice(-60).concat(store.testChat));
  const assetUrl = (p: string) => appAssetUrl(p, app.server?.base_url, app.server?.asset_key);
  const kinds = $derived(testableKinds(app.project?.alerts));
  const hasTestData = $derived(!!store.testAlert || store.testEvents.length > 0 || store.testChat.length > 0 || Object.keys(store.varOverrides).length > 0);

  // Pick up changes saved elsewhere, but never over local edits.
  $effect(() => {
    const remote = app.project?.overlays.find((o) => o.id === store.doc.id);
    untrack(() => {
      if (!store.syncRemote(remote) && !store.dirty && store.saveState === 'saved' && !leaving) {
        toasts.show('This overlay was deleted.');
        onclose();
      }
    });
  });

  onDestroy(() => {
    stopFlush();
    if (alertTimer) clearTimeout(alertTimer);
    // Leaving through the side bar: save whatever is waiting.
    void store.flush().then((ok) => {
      if (!ok) toasts.error(store.saveError ?? "Couldn't save the overlay.");
    });
    store.dispose();
  });

  async function back() {
    leaving = true;
    const ok = await store.flush();
    if (!ok) {
      leaving = false;
      toasts.show(`Couldn't save: ${store.saveError ?? 'unknown error'}. Your changes are still here.`, 'error');
      return;
    }
    onclose();
  }

  function preview(id: string, phase: Phase) {
    stage?.preview(id, phase);
  }

  function playAlert(kind: EventKind) {
    const play = sampleAlert(app.project?.alerts, kind, undefined, vars);
    if (!play) {
      toasts.show('That alert has no enabled variation.');
      return;
    }
    if (!store.doc.layers.some((l) => l.kind.type === 'alerts')) toasts.show('Add an Alerts layer to see alerts on this overlay.');
    store.testAlert = { play, startedAt: Date.now(), stoppedAt: null };
    if (alertTimer) clearTimeout(alertTimer);
    const total = play.duration_ms + (play.exit.duration_ms || 400) + 600;
    alertTimer = setTimeout(() => {
      if (store.testAlert?.play.id === play.id) store.testAlert = null;
    }, total);
  }

  function sendEvent(kind: EventKind) {
    const e = sampleEvent(kind);
    store.testEvents = [...store.testEvents, e].slice(-40);
    store.feed.emit({ type: 'event', event: e });
  }

  function sendChat() {
    const e = sampleChat();
    store.testChat = [...store.testChat, e].slice(-60);
    store.feed.emit({ type: 'event', event: e });
  }

  function clearTests() {
    store.testAlert = null;
    store.testEvents = [];
    store.testChat = [];
    store.varOverrides = {};
  }

  async function copyLink() {
    const url = await attempt(() => api.overlayUrl(store.doc.id));
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toasts.success('OBS link copied');
    } catch {
      toasts.show(url);
    }
  }

  async function editContent(id: string) {
    store.select(id);
    await tick();
    const el = document.getElementById(`p-${id}-text`);
    el?.focus();
  }

  /** Canvas-only keys (delete, nudge…) apply when the canvas, the layer list or nothing has focus. */
  function canvasFocus(t: EventTarget | null): boolean {
    if (!(t instanceof Element) || t === document.body) return true;
    return !!t.closest('.surface, .left .list, .ed-toolbar');
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.defaultPrevented || isTypingTarget(e.target) || document.querySelector('dialog[open]')) return;
    const a = shortcutFor(e);
    if (!a) return;
    if (a.type === 'undo') store.undo();
    else if (a.type === 'redo') store.redo();
    else {
      if (!canvasFocus(e.target)) return;
      const sel = store.selected;
      if (a.type === 'deselect') {
        if (!sel) return;
        store.select(null);
      } else if (!sel) {
        return;
      } else if (a.type === 'duplicate') store.duplicate(sel.id);
      else if (a.type === 'delete') store.remove(sel.id);
      else if (a.type === 'nudge') {
        if (sel.locked) return;
        store.nudge(a.dx, a.dy);
      }
    }
    e.preventDefault();
  }

  const zoomPct = $derived(`${Math.round(store.zoom * 100)}%`);
</script>

<svelte:window {onkeydown} bind:innerWidth={winW} />

<div class="editor" class:wide>
  <header class="ed-toolbar">
    <Button size="sm" variant="ghost" onclick={back} busy={leaving} aria-label="Back to overlays">
      <ArrowLeft size={15} />Overlays
    </Button>
    <span class="sep"></span>
    <input
      class="title"
      aria-label="Overlay name"
      spellcheck="false"
      value={store.doc.name}
      oninput={(e) => {
        const v = e.currentTarget.value;
        store.change((d) => (d.name = v), { key: 'overlay:name' });
      }}
      onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
    <span class="dims mono faint">{store.doc.width} × {store.doc.height}</span>

    <div class="grow"></div>

    <div class="group">
      <IconButton label="Undo (Ctrl+Z)" disabled={!store.canUndo} onclick={() => store.undo()}><Undo2 /></IconButton>
      <IconButton label="Redo (Ctrl+Shift+Z)" disabled={!store.canRedo} onclick={() => store.redo()}><Redo2 /></IconButton>
    </div>
    <span class="sep"></span>
    <div class="group zoom">
      <IconButton size="sm" label="Zoom out" onclick={() => canvas?.setZoom(store.zoom / 1.25)}><Minus /></IconButton>
      <Popover label="Zoom" width={150} align="end">
        {#snippet trigger(p)}
          <button type="button" class="zoom-btn mono" aria-label="Zoom {zoomPct}" {...p}>{zoomPct}</button>
        {/snippet}
        {#snippet children(close)}
          <button type="button" role="menuitem" class="mi" onclick={() => { store.fit = true; close(); }}>Fit to window</button>
          <div class="menu-sep"></div>
          {#each [0.25, 0.5, 1, 2] as zv (zv)}
            <button type="button" role="menuitem" class="mi" onclick={() => { canvas?.setZoom(zv); close(); }}>{zv * 100}%</button>
          {/each}
        {/snippet}
      </Popover>
      <IconButton size="sm" label="Zoom in" onclick={() => canvas?.setZoom(store.zoom * 1.25)}><Plus /></IconButton>
    </div>
    <div class="group">
      <IconButton label="Snap to edges and centres" pressed={store.snapping} onclick={() => (store.snapping = !store.snapping)}><Magnet /></IconButton>
      <IconButton label="Show hidden layers" pressed={store.showHidden} onclick={() => (store.showHidden = !store.showHidden)}>
        {#if store.showHidden}<Eye />{:else}<EyeOff />{/if}
      </IconButton>
      <IconButton label="Safe area guide" pressed={store.safeArea} onclick={() => (store.safeArea = !store.safeArea)}><Frame /></IconButton>
      <IconButton label={store.animate ? 'Pause animations' : 'Play animations'} pressed={store.animate} onclick={() => (store.animate = !store.animate)}>
        {#if store.animate}<Pause />{:else}<Play />{/if}
      </IconButton>
    </div>
    <span class="sep"></span>
    <TestMenu
      {kinds}
      sound={store.sound}
      {hasTestData}
      onalert={playAlert}
      onevent={sendEvent}
      onchat={sendChat}
      onvars={() => (varsOpen = true)}
      onclear={clearTests}
      onsound={(v) => (store.sound = v)}
    />
    <IconButton label="Copy OBS link" onclick={copyLink}><Link /></IconButton>
    <div class="status" role="status" aria-live="polite">
      {#if store.saveState === 'saving' || store.saveState === 'pending'}
        <LoaderCircle size={14} class="spin" /><span>Saving…</span>
      {:else if store.saveState === 'error'}
        <button type="button" class="retry" onclick={() => store.retry()} title={store.saveError ?? ''}>
          <CircleAlert size={14} /><span>Not saved · Retry</span>
        </button>
      {:else}
        <Check size={14} /><span>Saved</span>
      {/if}
    </div>
  </header>

  <div class="body" style="grid-template-columns:{leftW}px auto minmax(0, 1fr) auto {rightShown}px">
    <LayerPanel {store} />
    <ResizeHandle bind:size={leftW} id="editor.layers" min={180} max={480} initial={248} panel="before" label="Resize layers panel" />
    <Canvas bind:this={canvas} bind:stage {store} {vars} {recent} {chat} {assetUrl} onedit={editContent} />
    <ResizeHandle bind:size={rightW} id="editor.properties" min={280} max={760} initial={336} panel="after" label="Resize properties panel" />
    <Inspector {store} {vars} {wide} onpreview={preview} ontestalert={() => playAlert(kinds[0] ?? 'follow')} ontogglewide={() => (wide = !wide)} />
  </div>
</div>

<PreviewVarsDialog
  bind:open={varsOpen}
  overlay={store.doc}
  vars={app.vars}
  overrides={store.varOverrides}
  onchange={(v) => (store.varOverrides = v)}
/>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .ed-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 54px;
    flex: none;
    padding: 0 12px 0 8px;
    border-bottom: 1px solid var(--border);
  }
  .sep {
    width: 1px;
    height: 22px;
    background: var(--border);
    margin: 0 4px;
    flex: none;
  }
  .title {
    min-width: 80px;
    width: 240px;
    max-width: 30vw;
    height: 30px;
    padding: 0 8px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    font-weight: 600;
    font-size: 14px;
    text-overflow: ellipsis;
  }
  .title:hover {
    border-color: var(--border);
  }
  .title:focus {
    border-color: var(--focus);
    background: var(--bg-2);
    outline: none;
  }
  .dims {
    font-size: 11.5px;
    white-space: nowrap;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .zoom {
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-2);
  }
  .zoom-btn {
    min-width: 50px;
    height: 24px;
    padding: 0 6px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    font-size: 12px;
    cursor: pointer;
  }
  .zoom-btn:hover,
  .zoom-btn[aria-expanded='true'] {
    background: var(--bg-3);
  }
  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 76px;
    justify-content: flex-end;
    font-size: 12px;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .status :global(.spin) {
    animation: spin 0.9s linear infinite;
  }
  .retry {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 6px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--danger);
    cursor: pointer;
    font-size: 12px;
  }
  .retry:hover {
    background: var(--bg-3);
  }
  .body {
    flex: 1;
    min-height: 0;
    display: grid;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (max-width: 1180px) {
    .dims {
      display: none;
    }
  }
</style>
