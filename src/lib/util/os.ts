import { isTauri } from '$lib/api/backend';
import { toasts } from '$lib/state/toast.svelte';

const WEB = /^https?:\/\//i;

/**
 * Open a web page in the default browser. The desktop app needs the opener plugin:
 * plain links and `window.open` do nothing in its window.
 */
export async function openExternal(url: string): Promise<void> {
  if (!WEB.test(url)) return;
  try {
    if (isTauri()) {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
    } else {
      window.open(url, '_blank', 'noopener');
    }
  } catch (e) {
    console.warn('[app] could not open link', url, e);
    toasts.show(`Couldn't open ${url}`, 'error');
  }
}

/** Send clicks on web links (`<a href="https://…">`) to `openExternal`. Returns a cleanup function. */
export function handleExternalLinks(root: Document | HTMLElement = document): () => void {
  const onClick = (e: Event) => {
    if (e.defaultPrevented || (e instanceof MouseEvent && e.button > 1)) return;
    const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!a || !WEB.test(a.getAttribute('href') ?? '')) return;
    e.preventDefault();
    void openExternal(a.href);
  };
  root.addEventListener('click', onClick);
  root.addEventListener('auxclick', onClick);
  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('auxclick', onClick);
  };
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
