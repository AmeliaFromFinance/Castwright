<script lang="ts">
  import type { Overlay } from '$lib/bindings/Overlay';
  import { ago } from '$lib/format';
  import OverlayStage from '$lib/overlay/OverlayStage.svelte';
  import { app } from '$lib/state/app.svelte';
  import Button from '$lib/ui/Button.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import { appAssetUrl } from '$lib/widgets/assets.svelte';
  import Popover from '$lib/editor/ui/Popover.svelte';
  import { Copy, Download, Ellipsis, Link, MonitorUp, Pencil, Trash2 } from '@lucide/svelte';

  interface Props {
    overlay: Overlay;
    now: number;
    onedit: () => void;
    oncopy: () => void;
    onobs: () => void;
    onduplicate: () => void;
    onexport: () => void;
    ondelete: () => void;
  }

  let { overlay, now, onedit, oncopy, onobs, onduplicate, onexport, ondelete }: Props = $props();

  let bw = $state(0);
  let bh = $state(0);
  const scale = $derived(bw && bh ? Math.min(bw / overlay.width, bh / overlay.height) : 0);
  const recent = $derived([...app.feed].reverse().slice(-20));
  const chat = $derived(app.chat.slice(-20));
  const assetUrl = (p: string) => appAssetUrl(p, app.server?.base_url, app.server?.asset_key);
  const count = $derived(overlay.layers.length);
</script>

<article class="card" data-overlay-card={overlay.id}>
  <button type="button" class="preview" aria-label="Edit {overlay.name}" onclick={onedit}>
    <div class="fit" bind:clientWidth={bw} bind:clientHeight={bh}>
      {#if scale > 0}
        <div class="stage" style="width:{overlay.width * scale}px;height:{overlay.height * scale}px" inert aria-hidden="true">
          <OverlayStage {overlay} vars={app.vars} {recent} {chat} {assetUrl} mode="editor" {scale} paused muted />
        </div>
      {/if}
    </div>
    {#if count === 0}<span class="empty-tag">Empty</span>{/if}
  </button>
  <div class="info">
    <div class="text">
      <h3 class="truncate" title={overlay.name}>{overlay.name}</h3>
      <p class="meta faint">
        <span class="mono">{overlay.width} × {overlay.height}</span>
        <span aria-hidden="true">·</span>
        <span>{count} {count === 1 ? 'layer' : 'layers'}</span>
        {#if overlay.updated_at > 0}
          <span aria-hidden="true">·</span>
          <span title={new Date(overlay.updated_at).toLocaleString()}>{ago(overlay.updated_at, now)}</span>
        {/if}
      </p>
    </div>
  </div>
  <div class="actions">
    <Button size="sm" onclick={onedit}><Pencil size={13} />Edit</Button>
    <div class="grow"></div>
    <IconButton label="Copy OBS link" onclick={oncopy}><Link /></IconButton>
    <IconButton label="Add to OBS" onclick={onobs}><MonitorUp /></IconButton>
    <Popover label="More for {overlay.name}" align="end" width={180}>
      {#snippet trigger(p)}
        <IconButton label="More actions" {...p}><Ellipsis /></IconButton>
      {/snippet}
      {#snippet children(close)}
        <button type="button" role="menuitem" class="mi" onclick={() => { close(); onduplicate(); }}><Copy />Duplicate</button>
        <button type="button" role="menuitem" class="mi" onclick={() => { close(); onexport(); }}><Download />Export…</button>
        <div class="menu-sep"></div>
        <button type="button" role="menuitem" class="mi danger" onclick={() => { close(); ondelete(); }}><Trash2 />Delete…</button>
      {/snippet}
    </Popover>
  </div>
</article>

<style>
  .card {
    display: flex;
    flex-direction: column;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-1);
    transition: border-color 0.12s var(--ease), box-shadow 0.12s var(--ease);
  }
  .card:hover {
    border-color: var(--border-strong);
    box-shadow: 0 6px 20px rgb(0 0 0 / 0.14);
  }
  .preview {
    position: relative;
    display: block;
    aspect-ratio: 16 / 9;
    padding: 10px;
    border: 0;
    border-bottom: 1px solid var(--border);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background:
      repeating-conic-gradient(color-mix(in srgb, var(--text) 5%, transparent) 0 25%, transparent 0 50%) 0 0 / 16px 16px,
      var(--bg-0);
    cursor: pointer;
    overflow: hidden;
  }
  .preview:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }
  .fit {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
  }
  .stage {
    position: relative;
    overflow: hidden;
    border-radius: 3px;
    outline: 1px dashed color-mix(in srgb, var(--text) 14%, transparent);
    pointer-events: none;
  }
  .empty-tag {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    padding: 3px 10px;
    border-radius: 999px;
    background: var(--bg-2);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 11.5px;
  }
  .info {
    display: flex;
    padding: 12px 14px 4px;
    min-width: 0;
  }
  .text {
    min-width: 0;
    flex: 1;
  }
  h3 {
    font-size: 14px;
    font-weight: 600;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 3px;
    font-size: 12px;
  }
  .meta .mono {
    font-size: 11.5px;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 8px 10px 10px 14px;
  }
</style>
