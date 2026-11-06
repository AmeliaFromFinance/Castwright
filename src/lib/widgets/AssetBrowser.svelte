<script lang="ts">
  import { api } from '$lib/api';
  import type { AssetInfo } from '$lib/bindings/AssetInfo';
  import { bytes } from '$lib/format';
  import { app } from '$lib/state/app.svelte';
  import { attempt, attemptOk, toasts } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import Segmented from '$lib/ui/Segmented.svelte';
  import { Ban, Check, FileQuestion, Image, Music, Pause, Play, Plus, Search, Trash2, Video } from '@lucide/svelte';
  import { assetStore, ASSET_EXT, previewUrl, type AssetKind } from './assets.svelte';

  interface Props {
    open: boolean;
    kind: AssetKind | 'any';
    label: string;
    value: string;
    onpick: (path: string) => void;
  }

  let { open = $bindable(), kind, label, value, onpick }: Props = $props();

  type Filter = AssetKind | 'all';
  let filter = $state<Filter>('all');
  let query = $state('');
  let busy = $state(false);
  let broken = $state<Record<string, true>>({});
  let playing = $state('');
  let confirming = $state('');
  let audio: HTMLAudioElement | null = null;

  const KINDS: AssetKind[] = ['image', 'video', 'audio'];
  const NOUN: Record<AssetKind, string> = { image: 'images', video: 'videos', audio: 'sounds' };

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const k = kind === 'any' ? (filter === 'all' ? null : filter) : kind;
    return assetStore.items.filter((a) => (k ? a.kind === k : KINDS.includes(a.kind as AssetKind)) && (!q || a.name.toLowerCase().includes(q)));
  });
  const missing = $derived(!!value && !/^(https?:|data:)/.test(value) && !assetStore.items.some((a) => a.path === value));
  const noun = $derived(kind === 'any' ? 'files' : NOUN[kind]);

  $effect(() => {
    if (open) {
      assetStore.load(true);
      query = '';
    } else {
      stopSound();
      confirming = '';
    }
  });

  /** Whether the project mentions the file anywhere (layers, alerts, actions, sounds). */
  function inUse(a: AssetInfo): boolean {
    return !!app.project && JSON.stringify(app.project).includes(JSON.stringify(a.path).slice(1, -1));
  }

  async function remove(a: AssetInfo) {
    if (playing === a.path) stopSound();
    const ok = await attemptOk(() => api.deleteAsset(a.name));
    confirming = '';
    if (!ok) return;
    await assetStore.load(true);
    if (a.path === value) onpick('');
    toasts.show(`Deleted ${a.name}`);
  }

  const url = (a: AssetInfo) => previewUrl(a.path, app.demo, app.server?.base_url, app.server?.asset_key);

  function pick(path: string) {
    stopSound();
    onpick(path);
    open = false;
  }

  function stopSound() {
    audio?.pause();
    audio = null;
    playing = '';
  }

  function toggleSound(a: AssetInfo) {
    if (playing === a.path) return stopSound();
    stopSound();
    if (!url(a)) {
      toasts.show('Playing files needs the desktop app.');
      return;
    }
    const el = new Audio(url(a));
    el.volume = 0.7;
    el.onended = () => stopSound();
    el.onerror = () => {
      stopSound();
      toasts.show(`Couldn't play ${a.name}.`);
    };
    audio = el;
    playing = a.path;
    el.play().catch(() => undefined);
  }

  async function add() {
    if (app.demo) {
      toasts.show('Adding files needs the desktop app.');
      return;
    }
    if (busy) return;
    const { open: browse } = await import('@tauri-apps/plugin-dialog');
    const lower = kind === 'any' ? KINDS.flatMap((k) => ASSET_EXT[k]) : ASSET_EXT[kind];
    // Some file pickers match extensions case-sensitively.
    const extensions = [...lower, ...lower.map((e) => e.toUpperCase())];
    const picked = await attempt(() => browse({ multiple: true, filters: [{ name: label, extensions }] }));
    const paths = Array.isArray(picked) ? picked : typeof picked === 'string' ? [picked] : [];
    if (!paths.length) return;
    busy = true;
    try {
      const added = await attempt(() => api.importAssets(paths));
      if (!added?.length) return;
      await assetStore.load(true);
      // One file: use it right away. Several: show them to choose from.
      if (added.length === 1) pick(added[0]!.path);
      else query = '';
    } finally {
      busy = false;
    }
  }
</script>

<Dialog bind:open title="Choose {label.toLowerCase()}" width={760}>
  <div class="bar">
    <label class="search">
      <Search size={14} aria-hidden="true" />
      <input class="input" type="search" placeholder="Search {noun}" aria-label="Search {noun}" bind:value={query} />
    </label>
    {#if kind === 'any'}
      <Segmented
        label="Show"
        bind:value={filter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'image', label: 'Images' },
          { value: 'video', label: 'Videos' },
          { value: 'audio', label: 'Sounds' }
        ]}
      />
    {/if}
    <Button size="sm" onclick={add} disabled={busy}><Plus size={14} />{busy ? 'Adding…' : 'Add files'}</Button>
  </div>

  {#if missing}
    <p class="note">The current file, <b>{value.replace(/^assets\//, '')}</b>, is no longer in your assets.</p>
  {/if}

  <div class="grid" role="list" aria-label={label}>
    <div class="cell" role="listitem">
      <button type="button" class="tile none" aria-pressed={!value} onclick={() => pick('')}>
        <span class="thumb"><Ban size={28} aria-hidden="true" /></span>
        <span class="file">None</span>
      </button>
    </div>
    {#each shown as a (a.path)}
      {@const selected = a.path === value}
      <div class="cell" role="listitem">
        <button type="button" class="tile" aria-pressed={selected} title={a.name} onclick={() => pick(a.path)}>
          <span class="thumb" class:checker={a.kind === 'image' && url(a) && !broken[a.path]}>
            {#if a.kind === 'image' && url(a) && !broken[a.path]}
              <img src={url(a)} alt="" loading="lazy" draggable="false" onerror={() => (broken[a.path] = true)} />
            {:else if a.kind === 'video' && url(a) && !broken[a.path]}
              <video
                src="{url(a)}#t=0.5"
                muted
                playsinline
                loop
                preload="metadata"
                onerror={() => (broken[a.path] = true)}
                onmouseenter={(e) => e.currentTarget.play().catch(() => undefined)}
                onmouseleave={(e) => e.currentTarget.pause()}
              ></video>
              <span class="badge"><Video size={12} aria-hidden="true" /></span>
            {:else if a.kind === 'audio'}
              <Music size={28} aria-hidden="true" />
            {:else if a.kind === 'video'}
              <Video size={28} aria-hidden="true" />
            {:else if a.kind === 'image'}
              <Image size={28} aria-hidden="true" />
            {:else}
              <FileQuestion size={28} aria-hidden="true" />
            {/if}
            {#if selected}<span class="check"><Check size={14} aria-hidden="true" /></span>{/if}
          </span>
          <span class="file">{a.name}</span>
          <span class="size muted">{bytes(Number(a.bytes))}</span>
        </button>
        {#if confirming === a.path}
          <div class="confirm" role="group" aria-label="Delete {a.name}?">
            <p>Delete <b>{a.name}</b>?</p>
            <p class="muted">{inUse(a) ? "It's in use. Those places will show it as missing." : "This can't be undone."}</p>
            <div class="row">
              <Button size="sm" variant="danger" onclick={() => remove(a)}>Delete</Button>
              <Button size="sm" variant="ghost" onclick={() => (confirming = '')}>Keep</Button>
            </div>
          </div>
        {:else}
          <button type="button" class="del" aria-label="Delete {a.name}" title="Delete" onclick={() => (confirming = a.path)}><Trash2 size={13} /></button>
        {/if}
        {#if a.kind === 'audio' && confirming !== a.path}
          <span class="over">
          <button type="button" class="play" aria-label="{playing === a.path ? 'Stop' : 'Play'} {a.name}" onclick={() => toggleSound(a)}>
            {#if playing === a.path}<Pause size={14} />{:else}<Play size={14} />{/if}
          </button>
          </span>
        {/if}
      </div>
    {/each}
  </div>

  {#if !shown.length}
    <p class="empty muted">
      {query ? `No ${noun} match “${query}”.` : `No ${noun} yet. Add files to use them here.`}
    </p>
  {/if}
</Dialog>

<style>
  .bar {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .search {
    position: relative;
    flex: 1;
    min-width: 180px;
    display: flex;
    align-items: center;
    color: var(--text-3);
  }
  .search :global(svg) {
    position: absolute;
    left: 9px;
    pointer-events: none;
  }
  .search input {
    width: 100%;
    padding-left: 28px;
  }
  .note {
    margin: 0 0 12px;
    padding: 8px 10px;
    border-radius: var(--radius);
    background: var(--warn-bg, var(--bg-2));
    font-size: 13px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
  }
  .cell {
    position: relative;
    min-width: 0;
  }
  .tile {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-2);
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  .tile:hover {
    border-color: var(--border-strong, var(--text-3));
  }
  .tile[aria-pressed='true'] {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .thumb {
    position: relative;
    display: grid;
    place-items: center;
    aspect-ratio: 16 / 10;
    margin-bottom: 4px;
    border-radius: calc(var(--radius) - 2px);
    overflow: hidden;
    color: var(--text-3);
    background: var(--bg-1);
  }
  /* Checkerboard so transparent images are visible. */
  .checker {
    background:
      repeating-conic-gradient(var(--bg-3, #0002) 0 25%, transparent 0 50%) 0 0 / 16px 16px,
      var(--bg-1);
  }
  .thumb img,
  .thumb video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .badge,
  .check {
    position: absolute;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
  }
  .badge {
    left: 6px;
    bottom: 6px;
    background: rgb(0 0 0 / 0.6);
    color: #fff;
  }
  .check {
    right: 6px;
    top: 6px;
    background: var(--accent);
    color: var(--accent-fg, #fff);
  }
  .file {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }
  .size {
    font-size: 11px;
  }
  /* Sits over the thumbnail, so the play button doesn't select the sound. */
  .over {
    position: absolute;
    top: 7px;
    left: 7px;
    right: 7px;
    aspect-ratio: 16 / 10;
    display: grid;
    place-items: center;
    pointer-events: none;
  }
  .play {
    pointer-events: auto;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border: 0;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-fg, #fff);
    cursor: pointer;
  }
  .del {
    position: absolute;
    top: 12px;
    left: 12px;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 6px;
    background: rgb(0 0 0 / 0.6);
    color: #fff;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s;
  }
  .cell:hover .del,
  .del:focus-visible {
    opacity: 1;
  }
  .del:hover {
    background: var(--danger, #d33);
  }
  .confirm {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 6px;
    padding: 10px;
    border: 1px solid var(--danger, #d33);
    border-radius: var(--radius);
    background: var(--bg-1);
    font-size: 12px;
  }
  .confirm p {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .confirm .row {
    display: flex;
    gap: 6px;
    margin-top: 4px;
  }
  .empty {
    margin: 16px 0 4px;
    text-align: center;
  }
</style>
