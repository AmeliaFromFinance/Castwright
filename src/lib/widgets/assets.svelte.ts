import { api } from '$lib/api';
import type { AssetInfo } from '$lib/bindings/AssetInfo';

export type AssetKind = 'image' | 'video' | 'audio';

export const ASSET_EXT: Record<AssetKind, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'apng'],
  video: ['webm', 'mp4', 'mov', 'm4v'],
  audio: ['mp3', 'ogg', 'wav', 'm4a', 'aac', 'flac', 'opus']
};

class AssetStore {
  items = $state<AssetInfo[]>([]);
  private loaded = false;
  private loading: Promise<void> | null = null;

  /** Load the asset list once (or again when `force`). */
  load(force = false): Promise<void> {
    if (this.loaded && !force) return Promise.resolve();
    if (this.loading && !force) return this.loading;
    this.loading = api
      .listAssets()
      .then((items) => {
        this.items = items;
        this.loaded = true;
      })
      .catch(() => {})
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }
}

export const assetStore = new AssetStore();

/** URL for an asset path (`assets/x.png`) in the app window. */
export function appAssetUrl(path: string, baseUrl: string | undefined, assetKey: string | undefined): string {
  if (!path) return '';
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  const name = path.startsWith('assets/') ? path.slice(7) : path;
  if (!baseUrl) return '';
  return `${baseUrl}/assets/${encodeURIComponent(name)}?key=${encodeURIComponent(assetKey ?? '')}`;
}

/** Preview URL for the app window. The demo has no file server, so only inline files show there. */
export function previewUrl(path: string, demo: boolean, baseUrl: string | undefined, assetKey: string | undefined): string {
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  return demo ? '' : appAssetUrl(path, baseUrl, assetKey);
}
