<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { app } from '$lib/state/app.svelte';
  import { attempt, toasts } from '$lib/state/toast.svelte';
  import type { AssetInfo } from '$lib/bindings/AssetInfo';
  import IconButton from '$lib/ui/IconButton.svelte';
  import { FolderOpen, X } from '@lucide/svelte';
  import { assetStore } from './assets.svelte';

  interface Props {
    value: string;
    kind?: 'image' | 'video' | 'audio' | 'any';
    label: string;
    id?: string;
    onchange?: (v: string) => void;
  }

  let { value = $bindable(), kind = 'any', label, id, onchange }: Props = $props();

  const EXT: Record<string, string[]> = {
    image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'apng'],
    video: ['webm', 'mp4', 'mov', 'm4v'],
    audio: ['mp3', 'ogg', 'wav', 'm4a', 'aac', 'flac', 'opus']
  };

  onMount(() => {
    assetStore.load();
  });

  const options = $derived(assetStore.items.filter((a: AssetInfo) => kind === 'any' || a.kind === kind));
  const isUrl = $derived(/^(https?:|data:)/.test(value));

  function set(v: string) {
    value = v;
    onchange?.(v);
  }

  async function browse() {
    if (app.demo) {
      toasts.show('Adding files needs the desktop app.');
      return;
    }
    const { open } = await import('@tauri-apps/plugin-dialog');
    const extensions = kind === 'any' ? [...EXT.image!, ...EXT.video!, ...EXT.audio!] : EXT[kind]!;
    const picked = await open({ multiple: false, filters: [{ name: label, extensions }] });
    if (typeof picked !== 'string') return;
    const added = await attempt(() => api.importAssets([picked]));
    if (added?.[0]) {
      await assetStore.load(true);
      set(added[0].path);
    }
  }
</script>

<div class="picker">
  <select
    {id}
    class="input"
    aria-label={label}
    value={isUrl ? '__url' : value}
    onchange={(e) => {
      const v = e.currentTarget.value;
      if (v !== '__url') set(v);
    }}
  >
    <option value="">None</option>
    {#each options as a (a.path)}<option value={a.path}>{a.name}</option>{/each}
    {#if value && !isUrl && !options.some((a) => a.path === value)}<option value={value}>{value} (missing)</option>{/if}
    {#if isUrl}<option value="__url">Web address</option>{/if}
  </select>
  <IconButton label="Add a file" onclick={browse}><FolderOpen /></IconButton>
  {#if value}<IconButton label="Clear" onclick={() => set('')}><X /></IconButton>{/if}
</div>

<style>
  .picker {
    display: flex;
    gap: 4px;
    align-items: center;
    min-width: 0;
  }
</style>
