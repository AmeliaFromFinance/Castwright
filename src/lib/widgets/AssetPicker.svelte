<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/state/app.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import { ChevronDown, Globe, Image, Music, TriangleAlert, Video, X } from '@lucide/svelte';
  import AssetBrowser from './AssetBrowser.svelte';
  import { assetStore, previewUrl, type AssetKind } from './assets.svelte';

  interface Props {
    value: string;
    kind?: AssetKind | 'any';
    label: string;
    id?: string;
    onchange?: (v: string) => void;
  }

  let { value = $bindable(), kind = 'any', label, id, onchange }: Props = $props();
  let open = $state(false);
  let broken = $state(false);

  onMount(() => {
    assetStore.load();
  });

  const asset = $derived(assetStore.items.find((a) => a.path === value));
  const isUrl = $derived(/^(https?:|data:)/.test(value) && !asset);
  const missing = $derived(!!value && !isUrl && !asset);
  const name = $derived(!value ? 'None' : isUrl ? 'Web address' : (asset?.name ?? value.replace(/^assets\//, '')));
  const thumb = $derived(asset?.kind === 'image' ? previewUrl(asset.path, app.demo, app.server?.base_url, app.server?.asset_key) : '');

  $effect(() => {
    void thumb;
    broken = false;
  });

  function set(v: string) {
    value = v;
    onchange?.(v);
  }
</script>

<div class="picker">
  <button {id} type="button" class="input pick" aria-label={label} aria-haspopup="dialog" data-value={value} onclick={() => (open = true)}>
    <span class="icon" class:muted={!value}>
      {#if thumb && !broken}
        <img src={thumb} alt="" draggable="false" onerror={() => (broken = true)} />
      {:else if missing}
        <TriangleAlert size={14} />
      {:else if isUrl}
        <Globe size={14} />
      {:else if (asset?.kind ?? kind) === 'audio'}
        <Music size={14} />
      {:else if (asset?.kind ?? kind) === 'video'}
        <Video size={14} />
      {:else}
        <Image size={14} />
      {/if}
    </span>
    <span class="file" class:muted={!value}>{name}{missing ? ' (missing)' : ''}</span>
    <ChevronDown size={14} aria-hidden="true" />
  </button>
  {#if value}<IconButton label="Clear {label.toLowerCase()}" onclick={() => set('')}><X /></IconButton>{/if}
</div>

<AssetBrowser bind:open {kind} {label} {value} onpick={set} />

<style>
  .picker {
    display: flex;
    gap: 4px;
    align-items: center;
    min-width: 0;
  }
  .pick {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: left;
    cursor: pointer;
  }
  .icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    overflow: hidden;
    background: var(--bg-2);
  }
  .icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .file {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
