import { isTauri } from '$lib/api/backend';
import { toasts } from '$lib/state/toast.svelte';

/** Open a web page in the default browser. */
export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

/** Show a file or folder in the system file manager. */
export async function reveal(path: string): Promise<void> {
  if (!isTauri()) {
    toasts.show('Available in the desktop app');
    return;
  }
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
  await revealItemInDir(path);
}

export async function copyText(text: string, done = 'Copied'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toasts.success(done);
}
