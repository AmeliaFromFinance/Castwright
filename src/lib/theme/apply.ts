import type { AppearanceSettings } from '$lib/bindings/AppearanceSettings';
import type { WindowEffect } from '$lib/bindings/WindowEffect';
import { parseHex } from './color';
import { cssVariables, resolveTheme, uiFontStack, type Theme } from './themes';
import { applyZoom } from '$lib/state/zoom';

export function prefersDark(): boolean {
  return typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : true;
}

function withAlpha(hex: string, alpha: number): string {
  const rgb = parseHex(hex);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : hex;
}

/** Apply a theme to the document. `effect` is the window effect actually in use. */
export function applyTheme(appearance: AppearanceSettings, effect: WindowEffect = 'solid'): Theme {
  const theme = resolveTheme(appearance.theme, appearance.custom_themes, prefersDark());
  const root = document.documentElement;
  for (const [k, v] of Object.entries(cssVariables(theme))) root.style.setProperty(k, v);
  if (appearance.app_font === 'inter' || appearance.app_font === 'system') root.style.setProperty('--font-ui', uiFontStack(appearance.app_font));
  const translucent = effect === 'mica' || effect === 'acrylic';
  root.style.setProperty('--app-bg', translucent ? withAlpha(theme.tokens['bg-0'], 0.55) : theme.tokens['bg-0']);
  root.style.colorScheme = theme.spec.base;
  root.dataset.base = theme.spec.base;
  root.dataset.reduceMotion = String(appearance.reduce_motion);
  applyZoom(appearance.ui_scale);
  root.dataset.effect = translucent ? 'translucent' : 'solid';
  return theme;
}

export function watchSystemTheme(cb: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
